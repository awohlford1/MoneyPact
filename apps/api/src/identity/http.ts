/**
 * CBD-190 identity routes (PROTO-IDENTITY-API-001).
 *
 *   POST /v1/identity/begin            pre-authentication  §4.1 begin
 *   GET  /v1/identity/callback         pre-authentication  §4.2-§7 callback
 *   GET  /v1/identity/local/authorize  pre-authentication  local Cognito-shaped ceremony (dev/test only)
 *   GET  /v1/identity/local/choose     pre-authentication  local synthetic chooser selection (dev/test only)
 *   GET  /v1/identity/me               session-authenticated identity view
 *   POST /v1/identity/logout           session-authenticated, CSRF-checked sign-out
 *
 * The four pre-authentication routes carry `@PreAuthenticationSurface()`:
 * the boundary still runs surface (rate-limit) enforcement first, skips the
 * session gate the contract says they cannot require, evaluates no policy
 * and opens no transaction. Startup rejects that marker on any route
 * outside this closed set, and rejects a route carrying both the marker
 * and `@Authorize` (PROTO-IDENTITY-API-001 correction C7).
 *
 * PROTO-IDENTITY-API-001 correction C2 (review R02 / security S06): `me`
 * and `logout` previously ran their real work inside the boundary's
 * idempotency `replay` hook and unconditionally returned `committed`,
 * which skips policy evaluation and the authorized transaction path
 * entirely -- effectively a policy bypass for both routes. The p1 policy
 * matrix carries no `identity.me`/`identity.logout` cell yet (that is
 * `PROTO-RATELIMIT-APPROVAL-001`/p2's release, not this packet's), so both
 * routes now go through the *normal* `@Authorize` path with no `replay`:
 * `decide()` denies an action with no matching cell, so both routes are
 * denied (403) for every request, cookie or not, until p2 releases the
 * matching cell. That is a deliberate, disclosed limitation, not a
 * regression: binding either route to its released cell is then a
 * metadata-only change (add the resource locator a real cell needs), and
 * the handler bodies below already contain the real behavior they will
 * run once authorized. Until then, the web packet must treat a 403 on
 * `/v1/identity/me` as signed-out.
 *
 * Every callback answer is a 303 navigation: the committed success
 * destination (with `Set-Cookie` only on first delivery) or the
 * application-owned result page with a closed public outcome. Status, body
 * and headers are identical across every failure class (§7).
 */
import { Controller, Get, HttpCode, Module, Post, Req, Res } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { checkCsrf, readSessionCookieValue } from "@cobudget/sessions";
import { Authorize, PreAuthenticationSurface, RouteFailure } from "../authorization/http.js";
import type { IdentityCeremony } from "./ceremony.ts";
import { LOCAL_ISSUER_PATH } from "./config.ts";
import { isLocalScenario } from "./local-issuer.ts";
import type { LocalIssuer } from "./local-issuer.ts";

export interface IdentityRuntime {
  readonly ceremony: IdentityCeremony;
  /** Present only under COBUDGET_IDENTITY_PROVIDER=local. */
  readonly localIssuer: LocalIssuer | undefined;
  readonly sessionPepper: Buffer;
}

export interface IdentityHttp {
  readonly module: DynamicModule;
  /** Installs the response hooks the replay-path routes need (cookie deletion on logout). Call once on the Fastify instance before `ready()`. */
  install(server: FastifyInstance): void;
}

@Module({})
export class IdentityModule {}

/** CBD-191 §5.1: the CSRF header name the raw bootstrap value (delivered via `GET /v1/identity/me`, never a cookie) is echoed back on. */
const CSRF_HEADER = "x-cobudget-csrf";
const CHOOSE_PATH = `${LOCAL_ISSUER_PATH}/choose`;

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function rawQuery(request: FastifyRequest): string | undefined {
  const index = request.url.indexOf("?");
  return index === -1 ? undefined : request.url.slice(index + 1);
}

function observedOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

function wantsNavigation(request: FastifyRequest): boolean {
  const mode = header(request, "sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (header(request, "accept") ?? "").includes("text/html");
}

/**
 * Explicit composition (no global mutable dependencies). `runtime` is
 * `undefined` only when a caller mounts the module without a local adapter
 * (the runtime composition does not); every route then fails closed.
 */
export function identityHttp(runtime: IdentityRuntime | undefined): IdentityHttp {
  const pendingHeaders = new WeakMap<FastifyRequest, readonly string[] | undefined>();
  const unavailable = (): never => { throw new RouteFailure(503, "identity_unavailable"); };
  const required = (): IdentityRuntime => runtime ?? unavailable();

  @Controller("v1/identity")
  class IdentityController {
    @Post("begin")
    @PreAuthenticationSurface()
    async begin(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      if (!runtime) { await reply.code(503).send({ error: "identity_unavailable" }); return; }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await runtime.ceremony.begin({
        ceremony: body.ceremony, postResultDestinationId: body.postResultDestinationId,
        origin: header(request, "origin"), secFetchSite: header(request, "sec-fetch-site"), sessionCookie: readSessionCookieValue(header(request, "cookie")),
      });
      if (!result.ok) {
        const status = result.reason === "capacity" ? 503 : result.reason === "session_required" ? 401 : 400;
        await reply.code(status).send({ error: result.reason });
        return;
      }
      if (wantsNavigation(request)) { await reply.code(303).header("location", result.navigateTo).send(); return; }
      await reply.code(200).send({ navigateTo: result.navigateTo });
    }

    @Get("callback")
    @PreAuthenticationSurface()
    async callback(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      if (!runtime) { await reply.code(503).send({ error: "identity_unavailable" }); return; }
      const result = await runtime.ceremony.complete({ rawQuery: rawQuery(request), method: request.method, observedOrigin: observedOrigin(request), path: request.url.split("?")[0] ?? request.url, receiptTime: new Date() });
      if (result.kind === "success") for (const cookie of result.setCookie) reply.header("set-cookie", cookie);
      await reply.code(303).header("location", result.navigateTo).send();
    }

    @Get("local/authorize")
    @PreAuthenticationSurface()
    async localAuthorize(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      const issuer = runtime?.localIssuer;
      if (!issuer) { await reply.code(404).send({ error: "not_found" }); return; }
      const outcome = issuer.authorize(request.query as Record<string, string | string[] | undefined>);
      if (!outcome.ok) {
        if (outcome.redirectUri && outcome.state) {
          const target = new URL(outcome.redirectUri);
          target.searchParams.set("error", outcome.error);
          target.searchParams.set("state", outcome.state);
          await reply.code(303).header("location", target.toString()).send();
          return;
        }
        await reply.code(400).send({ error: outcome.error });
        return;
      }
      await reply.code(200).type("text/html; charset=utf-8").send(issuer.renderChooser(outcome.requestId, CHOOSE_PATH));
    }

    @Get("local/choose")
    @PreAuthenticationSurface()
    async localChoose(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      const issuer = runtime?.localIssuer;
      if (!issuer) { await reply.code(404).send({ error: "not_found" }); return; }
      const query = request.query as Record<string, unknown>;
      const requestId = typeof query.request === "string" ? query.request : undefined;
      const scenario = query.scenario;
      const target = requestId && isLocalScenario(scenario) ? issuer.choose(requestId, scenario) : undefined;
      if (!target) { await reply.code(400).send({ error: "invalid_request" }); return; }
      await reply.code(303).header("location", target).send();
    }

    // C2: no `replay` -- authorization runs the normal policy path. p1 carries no `identity.me`
    // cell, so `decide()` denies every request here until p2 releases one (a metadata-only change).
    @Get("me")
    @Authorize({ action: "identity.me", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
    async me(@Req() request: FastifyRequest): Promise<unknown> {
      const live = required();
      const view = await live.ceremony.view(readSessionCookieValue(header(request, "cookie")));
      if (!view) throw new RouteFailure(401, "not_authenticated");
      // C9 (Manager ruling): the raw CSRF bootstrap value travels only in this same-origin JSON
      // response body, held in browser memory -- never a cookie, URL or log field (CBD-191 §5.1).
      return { accountSubjectId: view.accountSubjectId, profileId: view.profileId, identityBindingId: view.identityBindingId, environmentId: view.environmentId, assurance: view.assurance, csrfValue: view.csrfValue };
    }

    // C2: no `replay`, same reasoning as `me` above; p1 carries no `identity.logout` cell.
    @Post("logout")
    @HttpCode(200)
    @Authorize({ action: "identity.logout", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
    async logout(@Req() request: FastifyRequest): Promise<unknown> {
      const live = required();
      const cookie = readSessionCookieValue(header(request, "cookie"));
      const session = await live.ceremony.csrfDigestFor(cookie);
      if (!session) throw new RouteFailure(401, "not_authenticated");
      const csrfOk = checkCsrf(live.sessionPepper, { method: request.method, origin: header(request, "origin"), allowedOrigin: live.ceremony.config.applicationOrigin, secFetchSite: header(request, "sec-fetch-site"), csrfHeaderValue: header(request, CSRF_HEADER), csrfDigest: session.csrfDigest });
      if (!csrfOk) throw new RouteFailure(403, "csrf_rejected");
      pendingHeaders.set(request, await live.ceremony.logout(session.sessionRef));
      return { signedOut: true };
    }
  }

  return {
    module: { module: IdentityModule, controllers: [IdentityController] },
    install(server) {
      server.addHook("onSend", async (request, reply, payload) => {
        const headers = pendingHeaders.get(request);
        if (headers) { pendingHeaders.set(request, undefined); for (const value of headers) reply.header("set-cookie", value); }
        return payload;
      });
    },
  };
}
