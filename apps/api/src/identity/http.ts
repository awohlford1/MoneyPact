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
 * PROTO-IDENTITY-API-001 correction C2 (review R02 / security S06) took
 * `me` and `logout` off the boundary's idempotency `replay` hook, which had
 * skipped policy evaluation. PROTO-ACTIVATION-001 then activated them:
 * `me` is bound to the released p2 `profile.read` subject-self cell (CBD-236
 * section 8.5.1) through the normal `@Authorize` path and the real
 * subject-scoped fact assembly, so a valid cookie allows and no cookie is
 * denied before the handler; `logout` carries `@SessionAuthenticatedSurface`
 * because p2 defines no logout cell and the packet forbids inventing one --
 * the pre-policy session gate and the CBD-191 section 5.1 CSRF check are its
 * guards (reported as a finding, not a cell).
 *
 * Every callback answer is a 303 navigation: the committed success
 * destination (with `Set-Cookie` only on first delivery) or the
 * application-owned result page with a closed public outcome. Status, body
 * and headers are identical across every failure class (§7).
 */
import { Controller, Get, HttpCode, Module, Post, Req, Res } from "@nestjs/common";
import type { EffectContext } from "../authorization/boundary.js";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import { checkCsrf, readSessionCookieValue } from "@cobudget/sessions";
import { Authorization, Authorize, PreAuthenticationSurface, RouteFailure, SessionAuthenticatedSurface } from "../authorization/http.js";
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

const LOOPBACK: readonly string[] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/**
 * The origin the browser addressed. The application origin proxies `/v1` to
 * this process (the Next development server's rewrite; CBD-190 section 8 keeps
 * the ceremony origin distinct), and that proxy replaces the Host header with
 * its destination while carrying the browser's host in `X-Forwarded-Host`.
 * PROTO-ACTIVATION-001: the forwarded host and protocol are honoured only when
 * the TCP peer is the loopback interface -- the only place the local proxy can
 * live -- so the CBD-190 callback context check sees the origin the browser
 * navigated to. `trustProxy` stays off for everything else; a hosted deployment
 * needs its own reviewed proxy trust (reported as a finding).
 */
function observedOrigin(request: FastifyRequest): string {
  const forwardedHost = header(request, "x-forwarded-host");
  if (forwardedHost && LOOPBACK.includes(request.ip) && /^[a-z0-9.-]+(?::\d{1,5})?$/iu.test(forwardedHost)) {
    const forwardedProto = header(request, "x-forwarded-proto");
    return `${forwardedProto === "https" ? "https" : "http"}://${forwardedHost}`;
  }
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

    // PROTO-ACTIVATION-001 (C2 activation, RC-05): the released p2 `profile.read` subject-self cell
    // (CBD-236 section 8.5.1, PROTO-POLICY-V2-DECISION-001) authorizes the identity `me` view. The
    // locator names only the subject scope: no acting space, membership or target row exists here,
    // and the boundary's real fact assembly stamps the configured environment from runtime
    // configuration. The cell's `bind_cache_key` obligation is discharged by ApiTransactionStore.
    @Get("me")
    @Authorize({ action: "profile.read", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default", scope: "subject" }) })
    async me(@Authorization() effect: EffectContext): Promise<unknown> {
      const live = required();
      const subject = effect.input.subject;
      if (!subject || typeof subject.sessionRef !== "string" || typeof subject.sessionVersion !== "number" || !effect.input.assurance) throw new RouteFailure(401, "not_authenticated");
      const view = await live.ceremony.viewResolved(effect.transaction as DataAccessClient, { accountSubjectId: subject.accountSubjectId, sessionRef: subject.sessionRef, sessionVersion: subject.sessionVersion, assurance: effect.input.assurance.level });
      if (!view) throw new RouteFailure(401, "not_authenticated");
      // C9 (Manager ruling): the raw CSRF bootstrap value travels only in this same-origin JSON
      // response body, held in browser memory -- never a cookie, URL or log field (CBD-191 §5.1).
      return { accountSubjectId: view.accountSubjectId, profileId: view.profileId, identityBindingId: view.identityBindingId, sessionRef: view.sessionRef, sessionVersion: view.sessionVersion, environmentId: view.environmentId, assurance: view.assurance, csrfValue: view.csrfValue };
    }

    // PROTO-ACTIVATION-001: p2 (CBD-236 section 8.5) defines no logout cell and the packet forbids
    // inventing one, so logout stays on the session-authenticated path: the pre-policy session gate
    // denies an unresolvable cookie, and the CBD-191 section 5.1 CSRF check below guards the mutation.
    @Post("logout")
    @HttpCode(200)
    @SessionAuthenticatedSurface()
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
