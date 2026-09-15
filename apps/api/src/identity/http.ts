/**
 * CBD-190 identity routes (PROTO-IDENTITY-API-001).
 *
 *   POST /v1/identity/begin            pre-authentication  §4.1 begin
 *   GET  /v1/identity/callback         pre-authentication  §4.2-§7 callback
 *   GET  /v1/identity/local/authorize  pre-authentication  local Cognito-shaped ceremony (dev/test only)
 *   GET  /v1/identity/local/choose     pre-authentication  local synthetic chooser selection (dev/test only)
 *   GET  /v1/identity/me               session-authenticated identity view
 *   GET  /v1/identity/recovery         the same bootstrap view on the independent surf-266-recovery pool (CBD-266 anti-lockout)
 *   POST /v1/identity/step-up/begin    session-authenticated, CSRF-checked fresh-assurance step-up (PK-4)
 *   GET  /v1/identity/step-up/callback provider redirect for that step-up (PK-4)
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
import { Controller, Get, HttpCode, Module, Post, Put, Req, Res } from "@nestjs/common";
import type { EffectContext } from "../authorization/boundary.js";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import { checkCsrf, readSessionCookieValue } from "@cobudget/sessions";
import { MAX_DISPLAY_NAME_LENGTH, writeDisplayName } from "../../../../packages/data-access/src/financial-profile.ts";
import { Authorization, Authorize, PreAuthenticationSurface, RouteFailure, SessionAuthenticatedSurface } from "../authorization/http.js";
import type { IdentityCeremony } from "./ceremony.ts";
import { LOCAL_ISSUER_PATH } from "./config.ts";
import { isLocalScenario } from "./local-issuer.ts";
import type { LocalIssuer } from "./local-issuer.ts";
import { observedOrigin, requestPath } from "./callback-context.ts";

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

/**
 * PROTO-HARDENING-001 (GUARD-STAGES-F03): origin derivation moved verbatim to
 * `./callback-context.ts`, which `sessions/runtime.ts` now imports too instead
 * of replicating it. See that module for why the proxy headers are honoured
 * only from a loopback peer.
 */

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

    // PROTO-QA-FIXES-001 F4: a callback from which no ceremony resolves is denied by the surface gate before any
    // counter is touched (SEC-STAGES-F02); it is answered by the same 303 to the result page as every other
    // malformed callback (section 7 uniformity), never a bare JSON denial. Nothing is consumed, no session exists.
    @Get("callback")
    @PreAuthenticationSurface({ deniedNavigation: () => runtime ? `${runtime.ceremony.config.applicationOrigin}${runtime.ceremony.config.resultPath}?outcome=invalid_or_expired` : undefined })
    async callback(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      if (!runtime) { await reply.code(503).send({ error: "identity_unavailable" }); return; }
      const result = await runtime.ceremony.complete({ rawQuery: rawQuery(request), method: request.method, observedOrigin: observedOrigin(request), path: requestPath(request.url), receiptTime: new Date() });
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
      // CBD-236 p6 P6-D03/P6-E06: displayName is additive to this projection (null when unset).
      return { accountSubjectId: view.accountSubjectId, profileId: view.profileId, identityBindingId: view.identityBindingId, sessionRef: view.sessionRef, sessionVersion: view.sessionVersion, environmentId: view.environmentId, assurance: view.assurance, displayName: view.displayName, csrfValue: view.csrfValue };
    }

    /**
     * PROTO-ACTIVATION-001 A7 (SEC-ACT-F03): the session-recovery surface. It is the `me` bootstrap under the
     * same released `profile.read` cell, registered on `surf-266-recovery` with its own approved record
     * (`rlp-266-recovery-v1`, CBD266-RECOVERY-RECORD-001) so that an actor whose ordinary session pool is
     * exhausted can still re-establish a usable session state (a fresh bootstrap value) -- the independent
     * recovery pool CBD-266's anti-lockout rules require to exist in fact, not only as a record.
     */
    @Get("recovery")
    @Authorize({ action: "profile.read", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default", scope: "subject" }) })
    async recovery(@Authorization() effect: EffectContext): Promise<unknown> {
      return this.me(effect);
    }

    /**
     * CBD-236 p6 (`profile.set_display_name`, `P6-D02`; docs/cbd-236-p6-subject-self-amendment-proposal.md
     * `P6-E04`). The subject-self mutate cell that sets the caller's own `financial_profile.display_name`
     * (`DI-91-065`; design section 9 `IV-010`; `PK8-F06`; `EXEC-PK8-RULINGS-001` item b). The bound is
     * `writeDisplayName`'s own 1..80-code-point check (`packages/data-access/src/financial-profile.ts`),
     * not a `PolicyInput` field (`P6-E04`'s note); a `RangeError` from that check maps to `400
     * display_name_invalid`. The compare-and-set reads `expectedVersion` from the decided input's own
     * `profile.profileVersion` -- the same value `SubjectScopedCapturedVersions` already captured and
     * `recheck_at_commit` re-equality-checks at commit -- never a second, independently read value; a
     * concurrent write moving the version answers `409 version_conflict`.
     */
    @Put("me/display-name")
    @Authorize({ action: "profile.set_display_name", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default", scope: "subject" }) })
    async setDisplayName(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const subject = effect.input.subject;
      const profile = effect.input.profile;
      // These two are guaranteed by a successful decide() on this cell (profile.set_display_name captures
      // both), so this is defense in depth, not a reachable branch under a valid decision.
      if (!subject || typeof subject.accountSubjectId !== "string" || !subject.accountSubjectId || !profile || typeof profile.profileVersion !== "number") return new RouteFailure(401, "not_authenticated");
      const body = (request.body ?? {}) as Record<string, unknown>;
      const raw = body.displayName;
      // RouteFailure is *returned*, never thrown, from inside the boundary's transaction: a throw is caught by
      // AuthorizationBoundary#execute's catch-all and converted into a generic deny (the notices route's own
      // convention -- see its header comment -- and the reason the uniform denial vocabulary never leaks HTTP status).
      if (typeof raw !== "string") return new RouteFailure(400, "invalid_request");
      const trimmed = raw.trim();
      if (trimmed.length === 0 || [...trimmed].length > MAX_DISPLAY_NAME_LENGTH) return new RouteFailure(400, "display_name_invalid");
      const client = effect.transaction as DataAccessClient;
      if (!client.profileSelect || !client.profileUpdate) return new RouteFailure(503, "identity_unavailable");
      let version: number | null;
      try { version = await writeDisplayName(client as DataAccessClient & Required<Pick<DataAccessClient, "profileSelect" | "profileUpdate">>, subject.accountSubjectId, trimmed, profile.profileVersion); }
      catch (error) { if (error instanceof RangeError) return new RouteFailure(400, "display_name_invalid"); throw error; }
      if (version === null) return new RouteFailure(409, "version_conflict");
      return { displayName: trimmed, version };
    }

    /**
     * PK-4 (CBD-234 design section 10.4; CBD-236 OQ-236-005). Begins a
     * fresh-assurance step-up for the current session, bound to one protected
     * action code and one budget space the caller is a member of. It mints no
     * session, changes no subject mapping and writes nothing until its own
     * callback completes; the answer is the provider navigation, in the same
     * two shapes `POST /v1/identity/begin` uses (a 303 for a navigation
     * request, the target as JSON otherwise).
     *
     * The CSRF check is this route's own, exactly as for `logout`: the
     * released policy has no cell for beginning a ceremony, so the guards are
     * the surface gate, the pre-policy session gate and CBD-191 section 5.1.
     */
    @Post("step-up/begin")
    @SessionAuthenticatedSurface()
    async stepUpBegin(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      if (!runtime) { await reply.code(503).send({ error: "identity_unavailable" }); return; }
      const cookie = readSessionCookieValue(header(request, "cookie"));
      const session = await runtime.ceremony.csrfDigestFor(cookie);
      if (!session) { await reply.code(401).send({ error: "not_authenticated" }); return; }
      const csrfOk = checkCsrf(runtime.sessionPepper, { method: request.method, origin: header(request, "origin"), allowedOrigin: runtime.ceremony.config.applicationOrigin, secFetchSite: header(request, "sec-fetch-site"), csrfHeaderValue: header(request, CSRF_HEADER), csrfDigest: session.csrfDigest });
      if (!csrfOk) { await reply.code(403).send({ error: "csrf_rejected" }); return; }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await runtime.ceremony.beginStepUp({
        action: body.action, budgetSpaceId: body.budgetSpaceId, postResultDestinationId: body.postResultDestinationId,
        origin: header(request, "origin"), secFetchSite: header(request, "sec-fetch-site"), sessionCookie: cookie,
      });
      if (!result.ok) {
        const status = result.reason === "capacity" ? 503 : result.reason === "session_required" ? 401 : result.reason === "action_not_protected" || result.reason === "space_not_permitted" ? 403 : 400;
        await reply.code(status).send({ error: result.reason });
        return;
      }
      if (wantsNavigation(request)) { await reply.code(303).header("location", result.navigateTo).send(); return; }
      await reply.code(200).send({ navigateTo: result.navigateTo, challengeId: result.challengeId });
    }

    /**
     * PK-4. The step-up ceremony's provider redirect, and the only route that
     * can complete one. Like `GET /v1/identity/callback` every answer is a 303
     * navigation -- the post-result destination on success, the
     * application-owned result page carrying a closed public outcome
     * otherwise -- and no `Set-Cookie` is ever emitted here, because a
     * step-up issues no session.
     */
    @Get("step-up/callback")
    @PreAuthenticationSurface({ deniedNavigation: () => runtime ? `${runtime.ceremony.config.applicationOrigin}${runtime.ceremony.config.resultPath}?outcome=invalid_or_expired` : undefined })
    async stepUpCallback(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
      if (!runtime) { await reply.code(503).send({ error: "identity_unavailable" }); return; }
      const result = await runtime.ceremony.completeStepUp({ rawQuery: rawQuery(request), method: request.method, observedOrigin: observedOrigin(request), path: requestPath(request.url), receiptTime: new Date() });
      await reply.code(303).header("location", result.navigateTo).send();
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
      // A8/A9: the deadline timers belong to the process lifecycle; release them when the server closes.
      server.addHook("onClose", async () => { runtime?.ceremony.stop(); });
      server.addHook("onSend", async (request, reply, payload) => {
        const headers = pendingHeaders.get(request);
        if (headers) { pendingHeaders.set(request, undefined); for (const value of headers) reply.header("set-cookie", value); }
        return payload;
      });
    },
  };
}
