import { externalDenial } from "@cobudget/contracts/authorization";
import type { ExternalDenial } from "@cobudget/contracts/authorization";
import { createParamDecorator, HttpException, Inject, Injectable, RequestMethod, ServiceUnavailableException, SetMetadata } from "@nestjs/common";
import type { CallHandler, CanActivate, ExecutionContext, NestInterceptor, OnModuleInit } from "@nestjs/common";
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
export const API_AUTHORIZATION = Symbol("authorization.dependencies");
export interface RouteAuthorization {
  readonly action: string;
  readonly purpose: "user_delegated";
  readonly resourceLocator: (request: FastifyRequest) => Omit<Operation, "action" | "purpose" | "mode">;
}
export interface ApiAuthorizationOptions {
  boundary: AuthorizationBoundary;
  /** CBD-266 supplies the approved surface check when its hook order is settled. */
  surfaceApproved(request: FastifyRequest): Promise<boolean>;
  /** Read an opaque session locator only; the fact source resolves the session. */
  sessionLocator(request: FastifyRequest): unknown;
  /** Supplied by the approved PR-94-003 response contract. */
  deny(response: ExternalDenial): never;
}
export const Authorize = (metadata: RouteAuthorization): MethodDecorator => SetMetadata(METADATA, Object.freeze({ ...metadata }));
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
  readonly #registered = new Set<string>();
  readonly #missing: string[] = [];

  constructor(@Inject(API_AUTHORIZATION) options: ApiAuthorizationOptions, @Inject(Reflector) reflector: Reflector,
    @Inject(DiscoveryService) discovery: DiscoveryService, @Inject(HttpAdapterHost) adapter: HttpAdapterHost) {
    this.#options = options; this.#reflector = reflector; this.#discovery = discovery; this.#adapter = adapter;
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
        if (wrapper.metatype === HealthController && handler === HealthController.prototype.getReadiness) this.#registered.add(key);
        else if (this.#reflector.get<RouteAuthorization | undefined>(METADATA, handler)) this.#registered.add(key);
        else this.#missing.push(key);
      }
    }
    const server = this.#adapter.httpAdapter.getInstance<FastifyInstance>();
    server.addHook("preHandler", async (request, reply) => {
      // No matched route invokes no customer handler; preserve the router's 404.
      if (request.routeOptions.url === undefined) return;
      if (request.method === "GET" && request.routeOptions.url === "/openapi.json") return;
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
      const metadata = this.#reflector.get<RouteAuthorization | undefined>(METADATA, context.getHandler());
      if (!metadata || metadata.purpose !== "user_delegated") return await this.#options.boundary.reject();
      // Session resolution occurs inside authorize. No body can supply authority.
      const operation = { ...metadata.resourceLocator(request), action: metadata.action, purpose: metadata.purpose, mode: "user_delegated" as const };
      const authorized = await this.#options.boundary.authorize({ operation, credential: this.#options.sessionLocator(request) });
      if (!await this.#options.surfaceApproved(request)) return await this.#options.boundary.reject();
      this.#pending.set(request, authorized);
      return true;
    } catch (error) {
      if (!(error instanceof AuthorizationDenied)) {
        try { await this.#options.boundary.reject(); } catch { /* Denial is recorded before responding. */ }
      }
      return this.#options.deny(externalDenial());
    }
  }
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getClass() === HealthController && context.getHandler() === HealthController.prototype.getReadiness) return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorized = this.#pending.get(request);
    this.#pending.delete(request);
    return from((async () => {
      try {
        if (!authorized) return await this.#options.boundary.reject();
        return await this.#options.boundary.execute(authorized, async (effect) => {
          active.set(request, effect);
          try { return await lastValueFrom(next.handle()); }
          finally { active.delete(request); }
        });
      } catch { return this.#options.deny(externalDenial()); }
    })());
  }
}
