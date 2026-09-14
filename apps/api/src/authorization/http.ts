import { PUBLIC_SURFACES, apiIdentity, surfaceOutcome } from "../../../../packages/rate-limit/src/index.ts";
import { ApiRateLimits } from "../rate-limit/http.js";
import type { ApiSurfaceGate } from "../rate-limit/http.js";
import { externalDenial } from "@cobudget/contracts/authorization";
import type { ExternalDenial } from "@cobudget/contracts/authorization";
import { createParamDecorator, HttpException, Inject, Injectable, RequestMethod, ServiceUnavailableException, SetMetadata } from "@nestjs/common";
import type { CallHandler, CanActivate, DynamicModule, ExecutionContext, NestInterceptor, OnModuleInit } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { DiscoveryService, HttpAdapterHost, Reflector } from "@nestjs/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { from, lastValueFrom } from "rxjs";
import type { Observable } from "rxjs";
import { HealthController } from "../health.controller.js";
import { AuthorizationBoundary } from "./boundary.js";
import { AuthorizationDenied } from "./boundary.js";
import { unavailableTransactions } from "./boundary.js";
import type { AuthorizedContext, EffectContext } from "./boundary.js";
import { absentFactSource, FactAssembler } from "./facts.js";
import type { Operation } from "./facts.js";

const METADATA = Symbol("authorization.route");
const PRE_AUTHENTICATION = Symbol("authorization.pre_authentication");
export const API_AUTHORIZATION = Symbol("authorization.dependencies");
/** A route-owned application failure, transported only after rollback. */
export class RouteFailure extends Error {
  readonly status: number; readonly response: Readonly<{ error: string }>;
  constructor(status: number, error: string) { super("route failure"); this.status = status; this.response = Object.freeze({ error }); }
}
export type RouteReplay = { readonly kind: "committed"; readonly response: unknown } | { readonly kind: "conflict" } | { readonly kind: "absent" };
export interface RouteAuthorization {
  readonly replay?: (request: FastifyRequest, subject: string) => Promise<RouteReplay>;
  readonly action: string;
  readonly purpose: "user_delegated";
  readonly resourceLocator: (request: FastifyRequest) => Omit<Operation, "action" | "purpose" | "mode">;
}
export interface ApiAuthorizationOptions {
  readonly modules?: readonly DynamicModule[];
  boundary: AuthorizationBoundary;
  rateLimit?: ApiSurfaceGate;
  /** CBD-266 supplies the approved surface check when its hook order is settled. */
  surfaceApproved(request: FastifyRequest): Promise<boolean>;
  /** Read an opaque session locator only; the fact source resolves the session. */
  sessionLocator(request: FastifyRequest): unknown;
  /** Supplied by the approved PR-94-003 response contract. */
  deny(response: ExternalDenial): never;
}
export const Authorize = (metadata: RouteAuthorization): MethodDecorator => SetMetadata(METADATA, Object.freeze({ ...metadata }));
/** CBD-266 section 8.1 / CBD-190 (PROTO-IDENTITY-API-001): a registration, authentication or recovery
 * surface cannot require an existing session. Surface enforcement still runs first with
 * pre-authentication counting keys; no policy is evaluated and no transaction is opened. The
 * marker is explicit so the route is inventoried like any other and never a silent bypass. */
export const PreAuthenticationSurface = (): MethodDecorator => SetMetadata(PRE_AUTHENTICATION, true);
/**
 * PROTO-IDENTITY-API-001 correction C7 (security S02): the marker previously
 * bypassed policy on metadata alone with no restriction on which routes
 * could carry it. `onModuleInit` now accepts it only on this explicit,
 * closed set of identity pre-authentication surfaces (begin, the local
 * hosted ceremony's authorize/choose, and the callback) and refuses at
 * startup to install a route that carries both `@Authorize` and this
 * marker, or that carries this marker outside the set.
 */
const ELIGIBLE_PRE_AUTHENTICATION_SURFACES: ReadonlySet<string> = new Set([
  "POST /v1/identity/begin",
  "GET /v1/identity/callback",
  "GET /v1/identity/local/authorize",
  "GET /v1/identity/local/choose",
]);
const active = new WeakMap<object, EffectContext>();
export const Authorization = createParamDecorator((_data: unknown, context: ExecutionContext): EffectContext => {
  const effect = active.get(context.switchToHttp().getRequest<object>());
  if (!effect) throw new AuthorizationDenied();
  return effect;
});

export function unavailableApiAuthorization(failure: () => void): ApiAuthorizationOptions {
  return {
    boundary: new AuthorizationBoundary(new FactAssembler("api", absentFactSource), unavailableTransactions, undefined, failure),
    surfaceApproved: async () => false,
    sessionLocator: () => undefined,
    // This signals missing runtime dependencies; it is not the pending denial-status contract.
    deny: () => { throw new ServiceUnavailableException(externalDenial()); },
  };
}

@Injectable()
export class ApiAuthorizationBoundary implements CanActivate, NestInterceptor, OnModuleInit {
  readonly #options: ApiAuthorizationOptions;
  readonly #reflector: Reflector;
  readonly #discovery: DiscoveryService;
  readonly #adapter: HttpAdapterHost;
  readonly #pending = new WeakMap<object, AuthorizedContext>();
  readonly #replays = new WeakMap<object, RouteReplay>();
  readonly #registered = new Set<string>();
  readonly #preAuthentication = new Set<string>();
  readonly #missing: string[] = [];
  readonly #leases = new WeakMap<object, () => Promise<void>>();
  readonly #surfacePassed = new WeakSet<object>();
  readonly #rateLimit: ApiSurfaceGate;

  constructor(@Inject(API_AUTHORIZATION) options: ApiAuthorizationOptions, @Inject(Reflector) reflector: Reflector,
    @Inject(DiscoveryService) discovery: DiscoveryService, @Inject(HttpAdapterHost) adapter: HttpAdapterHost) {
    this.#options = options; this.#rateLimit = options.rateLimit ?? new ApiRateLimits("cbd266-prototype-v1"); this.#reflector = reflector; this.#discovery = discovery; this.#adapter = adapter;
  }
  inventory(): readonly string[] { return [...this.#missing]; }
  onModuleInit(): void {
    for (const wrapper of this.#discovery.getControllers()) {
      if (!wrapper.instance || !wrapper.metatype) continue;
      const prototype = Object.getPrototypeOf(wrapper.instance) as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== "function") continue;
        const method = this.#reflector.get<RequestMethod | undefined>(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const prefix = this.#reflector.get<string>(PATH_METADATA, wrapper.metatype) ?? "";
        const path = this.#reflector.get<string>(PATH_METADATA, handler) ?? "";
        if (typeof prefix !== "string" || typeof path !== "string") { this.#missing.push(`${wrapper.name}.${name}`); continue; }
        const key = `${RequestMethod[method]} /${[prefix, path].join("/").split("/").filter(Boolean).join("/")}`;
        const authMetadata = this.#reflector.get<RouteAuthorization | undefined>(METADATA, handler);
        const preAuthentication = this.#reflector.get<true | undefined>(PRE_AUTHENTICATION, handler);
        if (wrapper.metatype === HealthController && handler === HealthController.prototype.getReadiness) this.#registered.add(key);
        else if (preAuthentication) {
          // C7: reject at startup rather than silently letting a policy-evaluated route skip policy, or an ineligible route skip the session gate.
          if (authMetadata) throw new Error(`authorization startup: "${key}" carries both @Authorize and @PreAuthenticationSurface`);
          if (!ELIGIBLE_PRE_AUTHENTICATION_SURFACES.has(key)) throw new Error(`authorization startup: "${key}" is marked @PreAuthenticationSurface but is not an eligible pre-authentication surface`);
          this.#registered.add(key); this.#preAuthentication.add(key);
        }
        else if (authMetadata) this.#registered.add(key);
        else this.#missing.push(key);
      }
    }
    const server = this.#adapter.httpAdapter.getInstance<FastifyInstance>();
    // Fastify preHandler precedes Nest guards. Install the surface/session gate
    // before CBD-236's raw-route/metadata guard on the same Fastify instance.
    server.addHook("preHandler", async (request, reply) => {
      if (request.routeOptions.url === undefined) return;
      const evidence = this.#rateLimit.evidence(request);
      let actor: string | undefined;
      try {
        if (!PUBLIC_SURFACES[apiIdentity(request.method, request.routeOptions.url)] && !this.#preAuthentication.has(`${request.method} ${request.routeOptions.url}`)) {
          try { actor = await this.#options.boundary.resolveSession(this.#options.sessionLocator(request)); }
          catch {
            return await this.#options.boundary.rejectEnforcement({ ...surfaceOutcome(evidence, "deny_input_invalid"), earliest_decisive_gate: "session", safe_reason_class: "not_authenticated" });
          }
        }
        const decision = await this.#rateLimit.enforce(request, actor);
        if (decision.outcome !== "allow") return await this.#options.boundary.rejectEnforcement(surfaceOutcome(evidence, decision.outcome));
        this.#leases.set(request, decision.release); this.#surfacePassed.add(request);
      } catch (error) {
        if (!(error instanceof AuthorizationDenied)) {
          try { await this.#options.boundary.rejectEnforcement(surfaceOutcome(evidence, "deny_counter_unavailable")); } catch { /* One decisive denial. */ }
        }
        try { this.#options.deny(externalDenial()); }
        catch (denial) { return reply.code(denial instanceof HttpException ? denial.getStatus() : 503).send(externalDenial()); }
      }
    });
    server.addHook("onResponse", async (request) => {
      const release = this.#leases.get(request); this.#leases.delete(request);
      if (release) { try { await release(); } catch { /* Failure cannot reset a ceiling or admit work. */ } }
    });
    server.addHook("preHandler", async (request, reply) => {
      // No matched route invokes no customer handler; preserve the router's 404.
      if (request.routeOptions.url === undefined) return;
      // Generated HEAD routes execute the same public read-only handlers.
      // Operational health stays isolated from protected pools (AL-266-004/008).
      if (PUBLIC_SURFACES[apiIdentity(request.method, request.routeOptions.url)]) return;
      if (this.#registered.has(`${request.method} ${request.routeOptions.url}`)) return;
      try { await this.#options.boundary.reject(); }
      catch {
        try { this.#options.deny(externalDenial()); }
        catch (error) { return reply.code(error instanceof HttpException ? error.getStatus() : 503).send(externalDenial()); }
      }
    });
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getClass() === HealthController && context.getHandler() === HealthController.prototype.getReadiness) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    try {
      if (!this.#surfacePassed.has(request)) return await this.#options.boundary.reject();
      if (!await this.#options.surfaceApproved(request)) return await this.#options.boundary.rejectEnforcement(surfaceOutcome(this.#rateLimit.evidence(request), "deny_policy_unavailable"));
      if (this.#reflector.get<true | undefined>(PRE_AUTHENTICATION, context.getHandler())) return true;
      const metadata = this.#reflector.get<RouteAuthorization | undefined>(METADATA, context.getHandler());
      if (!metadata || metadata.purpose !== "user_delegated") return await this.#options.boundary.reject();
      // Replay is authenticated independently and never evaluates creation policy.
      if (metadata.replay) {
        const subject = await this.#options.boundary.resolveSession(this.#options.sessionLocator(request));
        const replay = await metadata.replay(request, subject);
        if (replay.kind !== "absent") { this.#replays.set(request, replay); return true; }
      }
      const operation = { ...metadata.resourceLocator(request), action: metadata.action, purpose: metadata.purpose, mode: "user_delegated" as const };
      const authorized = await this.#options.boundary.authorize({ operation, credential: this.#options.sessionLocator(request) }, this.#rateLimit.evidence(request));
      this.#pending.set(request, authorized);
      return true;
    } catch (error) {
      if (error instanceof RouteFailure) {
        try { await this.#options.boundary.rejectEnforcement(surfaceOutcome(this.#rateLimit.evidence(request), "deny_input_invalid")); } catch { /* Restricted pre-policy rejection. */ }
        throw new HttpException(error.response, error.status);
      }
      if (!(error instanceof AuthorizationDenied)) {
        try { await this.#options.boundary.reject(); } catch { /* Denial is recorded before responding. */ }
      }
      return this.#options.deny(externalDenial());
    }
  }
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getClass() === HealthController && context.getHandler() === HealthController.prototype.getReadiness) return next.handle();
    if (this.#reflector.get<true | undefined>(PRE_AUTHENTICATION, context.getHandler())) return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const replay = this.#replays.get(request);
    this.#replays.delete(request);
    if (replay?.kind === "committed") return from(Promise.resolve(replay.response));
    if (replay?.kind === "conflict") return from(Promise.reject(new HttpException({ error: "idempotency_key_reused" }, 409)));
    const authorized = this.#pending.get(request);
    this.#pending.delete(request);
    return from((async () => {
      try {
        if (!authorized) return await this.#options.boundary.reject();
        const result = await this.#options.boundary.execute(authorized, async (effect) => {
          active.set(request, effect);
          try { return await lastValueFrom(next.handle()); }
          finally { active.delete(request); }
        });
        if (result instanceof RouteFailure) throw result;
        return result;
      } catch (error) {
        if (error instanceof RouteFailure) throw new HttpException(error.response, error.status);
        return this.#options.deny(externalDenial());
      }
    })());
  }
}
