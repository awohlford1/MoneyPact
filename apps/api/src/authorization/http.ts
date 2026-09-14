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
import { runWithAction } from "../sessions/action-scope.ts";

const METADATA = Symbol("authorization.route");
const PRE_AUTHENTICATION = Symbol("authorization.pre_authentication");
const SESSION_AUTHENTICATED = Symbol("authorization.session_authenticated");
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
  /**
   * PROTO-ACTIVATION-001 A5 (review R05): a route whose server-selected action depends on an untrusted
   * locator in the request (CBD-232 regeneration: `supersedesProposalId` in the body) declares the closed
   * set of actions it may dispatch and a trusted pre-policy `select` that reads the locator, resolves it
   * for the authenticated subject, and returns the action plus the operation locator the boundary then
   * evaluates. The selected action must be in `actions`; the body never becomes an authority fact -- the
   * datastore loads the target row by environment and subject and the policy re-proves ownership.
   */
  readonly actions?: readonly string[];
  readonly select?: (request: FastifyRequest, subject: string) => Promise<{ readonly action: string } & Omit<Operation, "action" | "purpose" | "mode">>;
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
  /**
   * PROTO-ACTIVATION-001 A1 (CBD-191 section 5.1): the cookie-authenticated mutation guard. Called for every
   * non-safe method on a session-authenticated route (pre-authentication surfaces excepted) after the session
   * and surface gates and before any replay, policy or effect; must verify the exact allowed Origin,
   * `Sec-Fetch-Site: same-origin` and the `X-CoBudget-CSRF` value against the session's keyed digest.
   */
  csrf(request: FastifyRequest): Promise<boolean>;
  /** Supplied by the approved PR-94-003 response contract. */
  deny(response: ExternalDenial): never;
}
export const Authorize = (metadata: RouteAuthorization): MethodDecorator => SetMetadata(METADATA, Object.freeze({ ...metadata }));
/** CBD-266 section 8.1 / CBD-190 (PROTO-IDENTITY-API-001): a registration, authentication or recovery
 * surface cannot require an existing session. Surface enforcement still runs first with
 * pre-authentication counting keys; no policy is evaluated and no transaction is opened. The
 * marker is explicit so the route is inventoried like any other and never a silent bypass. */
export interface PreAuthenticationSurfaceOptions {
  /**
   * PROTO-QA-FIXES-001 F4: a navigation surface (the identity callback) that the surface gate denies as
   * `deny_input_invalid` -- no ceremony resolves from the request, so no counter is touched -- answers
   * with a 303 to the location this returns (the application-owned result page with a closed outcome)
   * instead of the uniform JSON denial, so a person landing there reaches the same accessible result
   * page every other malformed callback receives. The enforcement audit is recorded exactly as before,
   * nothing is consumed and no session exists; `undefined` keeps the JSON denial. Exhaustion and every
   * other denial class are unchanged.
   */
  readonly deniedNavigation?: (request: FastifyRequest) => string | undefined;
}
export const PreAuthenticationSurface = (options: PreAuthenticationSurfaceOptions = {}): MethodDecorator => SetMetadata(PRE_AUTHENTICATION, Object.freeze({ ...options }));
/** PROTO-QA-FIXES-001 F1: the closed set of effect denials that return the ceremony's reserved unit. A confirm
 * that passed the session gate, the replay lookup, the locator and the policy but was denied inside its effect
 * (expired or superseded proposal, altered binding) committed nothing, so the reserved initial `space.create`
 * unit it was admitted on goes back to the ceremony and the corrected confirm is admitted on the same session.
 * Ordinary units and committed effects are never refunded (CBD-266 section 4.7 `proto-bootstrap-v1`). */
const REFUNDABLE_EFFECT_DENIALS: ReadonlySet<string> = new Set(["proposal_not_current", "confirmation_stale"]);
/**
 * PROTO-ACTIVATION-001: a session-authenticated surface with no policy cell.
 * The released p2 matrix (CBD-236 section 8.5) carries `profile.read` for the
 * identity `me` route but no cell for `logout`, and the packet forbids inventing
 * one. The surface still runs enforcement first and the pre-policy session gate
 * (an unresolvable cookie is denied before the handler with the uniform
 * response); it evaluates no policy and opens no transaction, and the route's
 * own CSRF check (CBD-191 section 5.1) is the mutation guard. Like the
 * pre-authentication marker it is accepted only on a closed set and is refused
 * next to `@Authorize`, so it can never become a silent bypass.
 */
export const SessionAuthenticatedSurface = (): MethodDecorator => SetMetadata(SESSION_AUTHENTICATED, true);
const ELIGIBLE_SESSION_AUTHENTICATED_SURFACES: ReadonlySet<string> = new Set(["POST /v1/identity/logout"]);
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
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);
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
    csrf: async () => false,
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
  readonly #deniedNavigation = new Map<string, NonNullable<PreAuthenticationSurfaceOptions["deniedNavigation"]>>();
  /** F1: the refund of a reserved unit consumed for this request, applied at most once on an effect denial. */
  readonly #refunds = new WeakMap<object, () => Promise<boolean>>();
  readonly #missing: string[] = [];
  readonly #leases = new WeakMap<object, () => Promise<void>>();
  readonly #surfacePassed = new WeakSet<object>();
  /** B1: requests whose surface unit is reserved and therefore consumed in canActivate, keyed to the resolved actor. */
  readonly #deferred = new WeakMap<object, string>();
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
        const preAuthentication = this.#reflector.get<PreAuthenticationSurfaceOptions | undefined>(PRE_AUTHENTICATION, handler);
        const sessionAuthenticated = this.#reflector.get<true | undefined>(SESSION_AUTHENTICATED, handler);
        if (wrapper.metatype === HealthController && handler === HealthController.prototype.getReadiness) this.#registered.add(key);
        else if (sessionAuthenticated) {
          if (authMetadata || preAuthentication) throw new Error(`authorization startup: "${key}" carries @SessionAuthenticatedSurface next to another authorization marker`);
          if (!ELIGIBLE_SESSION_AUTHENTICATED_SURFACES.has(key)) throw new Error(`authorization startup: "${key}" is marked @SessionAuthenticatedSurface but is not an eligible session-authenticated surface`);
          this.#registered.add(key);
        }
        else if (preAuthentication) {
          // C7: reject at startup rather than silently letting a policy-evaluated route skip policy, or an ineligible route skip the session gate.
          if (authMetadata) throw new Error(`authorization startup: "${key}" carries both @Authorize and @PreAuthenticationSurface`);
          if (!ELIGIBLE_PRE_AUTHENTICATION_SURFACES.has(key)) throw new Error(`authorization startup: "${key}" is marked @PreAuthenticationSurface but is not an eligible pre-authentication surface`);
          this.#registered.add(key); this.#preAuthentication.add(key);
          if (preAuthentication.deniedNavigation) this.#deniedNavigation.set(key, preAuthentication.deniedNavigation);
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
        // B1 (R2-02, SEC-ACT-R2-F02): a reserved bootstrap unit is not spent by an attempt that may still be denied
        // before its effect; canActivate consumes it after the CSRF check, the replay lookup and the locator validation.
        if (actor !== undefined && await this.#rateLimit.reserved?.(request, actor)) { this.#deferred.set(request, actor); return; }
        const decision = await this.#rateLimit.enforce(request, actor);
        if (decision.outcome !== "allow") {
          // F4: an unresolvable request on a navigation surface is denied the same way (audited, nothing consumed) and answered by navigation.
          const navigation = decision.outcome === "deny_input_invalid" ? this.#deniedNavigation.get(`${request.method} ${request.routeOptions.url}`)?.(request) : undefined;
          if (navigation) {
            try { await this.#options.boundary.rejectEnforcement(surfaceOutcome(evidence, decision.outcome)); } catch { /* One decisive denial, recorded. */ }
            return reply.code(303).header("location", navigation).send();
          }
          return await this.#options.boundary.rejectEnforcement(surfaceOutcome(evidence, decision.outcome));
        }
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
      this.#refunds.delete(request);
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
      if (!this.#surfacePassed.has(request) && !this.#deferred.has(request)) return await this.#options.boundary.reject();
      if (!await this.#options.surfaceApproved(request)) return await this.#options.boundary.rejectEnforcement(surfaceOutcome(this.#rateLimit.evidence(request), "deny_policy_unavailable"));
      if (this.#reflector.get<PreAuthenticationSurfaceOptions | undefined>(PRE_AUTHENTICATION, context.getHandler())) return true;
      // A1: every cookie-authenticated non-safe request proves Origin, fetch metadata and the CSRF value before any
      // replay lookup, policy evaluation or effect; a failure is the uniform denial at the session gate.
      if (!SAFE_METHODS.has(request.method.toUpperCase()) && !await this.#options.csrf(request)) {
        return await this.#options.boundary.rejectEnforcement({ ...surfaceOutcome(this.#rateLimit.evidence(request), "deny_input_invalid"), earliest_decisive_gate: "session", safe_reason_class: "not_authenticated" });
      }
      // The session gate in the preHandler already resolved this request's session (a failure never reaches here).
      if (this.#reflector.get<true | undefined>(SESSION_AUTHENTICATED, context.getHandler())) return true;
      const metadata = this.#reflector.get<RouteAuthorization | undefined>(METADATA, context.getHandler());
      if (!metadata || metadata.purpose !== "user_delegated") return await this.#options.boundary.reject();
      // Replay is authenticated independently and never evaluates creation policy.
      if (metadata.replay) {
        const subject = await this.#options.boundary.resolveSession(this.#options.sessionLocator(request));
        const replay = await metadata.replay(request, subject);
        if (replay.kind !== "absent") { this.#replays.set(request, replay); return true; }
      }
      let operation: Operation;
      if (metadata.select) {
        const subject = await this.#options.boundary.resolveSession(this.#options.sessionLocator(request));
        const selected = await metadata.select(request, subject);
        if (!metadata.actions?.includes(selected.action)) return await this.#options.boundary.reject();
        operation = { ...selected, purpose: metadata.purpose, mode: "user_delegated" as const };
      } else operation = { ...metadata.resourceLocator(request), action: metadata.action, purpose: metadata.purpose, mode: "user_delegated" as const };
      // B1: the reserved unit is consumed here -- the request is authenticated, CSRF-proven, not a replay and names a
      // valid target -- and still before policy evaluation (CBD-266 section 8.1: the surface decision precedes policy).
      if (this.#deferred.has(request)) {
        const decision = await this.#rateLimit.enforce(request, this.#deferred.get(request));
        this.#deferred.delete(request);
        if (decision.outcome !== "allow") return await this.#options.boundary.rejectEnforcement(surfaceOutcome(this.#rateLimit.evidence(request), decision.outcome));
        this.#leases.set(request, decision.release); this.#surfacePassed.add(request);
        if (decision.refund) this.#refunds.set(request, decision.refund);
      }
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
  async #refund(request: object): Promise<void> {
    const refund = this.#refunds.get(request); this.#refunds.delete(request);
    if (refund) { try { await refund(); } catch { /* A failed refund leaves the unit consumed; it never admits work. */ } }
  }
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getClass() === HealthController && context.getHandler() === HealthController.prototype.getReadiness) return next.handle();
    if (this.#reflector.get<PreAuthenticationSurfaceOptions | undefined>(PRE_AUTHENTICATION, context.getHandler())) return next.handle();
    if (this.#reflector.get<true | undefined>(SESSION_AUTHENTICATED, context.getHandler())) {
      // No policy, no transaction: the route's own failures still travel as HTTP statuses, never as a 500.
      return from((async () => {
        try { return await lastValueFrom(next.handle()); }
        catch (error) { if (error instanceof RouteFailure) throw new HttpException(error.response, error.status); throw error; }
      })());
    }
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
        // The action scope lets the composed transaction store dispatch to the package store that owns this action.
        const result = await runWithAction(authorized.input.request.action, () => this.#options.boundary.execute(authorized, async (effect) => {
          active.set(request, effect);
          try { return await lastValueFrom(next.handle()); }
          finally { active.delete(request); }
        }));
        if (result instanceof RouteFailure) throw result;
        return result;
      } catch (error) {
        if (error instanceof RouteFailure) {
          // F1: the effect was denied after the surface decision and committed nothing; return the reserved unit once.
          if (REFUNDABLE_EFFECT_DENIALS.has(error.response.error)) await this.#refund(request);
          throw new HttpException(error.response, error.status);
        }
        return this.#options.deny(externalDenial());
      }
    })());
  }
}
