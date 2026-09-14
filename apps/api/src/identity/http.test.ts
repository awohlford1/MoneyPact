import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Controller, Get } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import { apiIdentity, invocation } from "../../../../packages/rate-limit/src/index.ts";
import { AppModule } from "../app.module.js";
import { createComposedApiApplication } from "../application.js";
import { Authorize } from "../authorization/http.js";
import { testHistory } from "../authorization/test-support.js";
import { runApiBootstrap } from "../bootstrap.js";
import { loadApiConfigFrom } from "../config.js";
import { resolveApiFieldEncryptionProvider } from "../config.js";
import { configureHttpSecurity } from "../http-security.js";
import type { ApiSurfaceGate } from "../rate-limit/http.js";
import { composeApiRuntime } from "../sessions/runtime.ts";
import { installedRoutes } from "../rate-limit/inventory.js";
import { createFakeIdentityClient, FakeIdentityDatabase } from "./test-support/fake-client.ts";
import { APPLICATION_ORIGIN, localConfig, localEnvironment } from "./test-support/harness.ts";

/** C9: there is no CSRF cookie any more; this literal is only used to assert its absence. */
const CSRF_COOKIE_NAME_LITERAL = "__Host-cobudget_csrf";

const IDENTITY_ROUTES = ["/v1/identity/begin", "/v1/identity/callback", "/v1/identity/local/authorize", "/v1/identity/local/choose", "/v1/identity/me", "/v1/identity/logout", "/protected/probe", "/health"];

/** Synthetic surface approval for these tests only: CBD-266's registry has no approved bounded record yet (see the final report). */
const syntheticGate: ApiSurfaceGate = {
  evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url ?? "/"), "api_route", "test-only", "test-only"),
  enforce: async (request) => IDENTITY_ROUTES.includes(request.routeOptions.url ?? "") ? { outcome: "allow", provenance: "test-only", release: async () => undefined } : { outcome: "deny_unregistered" },
};

const HOST = "localhost:3000";

interface Browser {
  readonly app: NestFastifyApplication;
  readonly server: FastifyInstance;
  cookies: Record<string, string>;
  inject(method: "GET" | "POST", url: string, headers?: Record<string, string>, payload?: Record<string, unknown>): Promise<{ statusCode: number; headers: Record<string, unknown>; json<T>(): T; body: string }>;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
}

function remember(cookies: Record<string, string>, setCookie: unknown): void {
  const values = Array.isArray(setCookie) ? setCookie : typeof setCookie === "string" ? [setCookie] : [];
  for (const header of values as string[]) {
    const [pair, ...attributes] = header.split(";");
    const index = pair!.indexOf("=");
    const name = pair!.slice(0, index);
    const value = pair!.slice(index + 1);
    if (attributes.some((attribute) => attribute.trim() === "Max-Age=0") || value === "") delete cookies[name];
    else cookies[name] = value;
  }
}

async function browser(app: NestFastifyApplication): Promise<Browser> {
  await app.init();
  const server = app.getHttpAdapter().getInstance() as FastifyInstance;
  await server.ready();
  const cookies: Record<string, string> = {};
  const state: Browser = {
    app, server, cookies,
    async inject(method, url, headers = {}, payload) {
      const response = await app.inject({ method, url, headers: { host: HOST, ...(Object.keys(cookies).length ? { cookie: cookieHeader(cookies) } : {}), ...headers }, ...(payload === undefined ? {} : { payload }) });
      remember(cookies, response.headers["set-cookie"]);
      return response;
    },
  };
  return state;
}

/** Drives the whole browser journey through the real Fastify instance and returns the committed callback response. */
async function signIn(b: Browser, scenario = "subject-a") {
  const begin = await b.inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
  assert.equal(begin.statusCode, 200, begin.body);
  const authorize = new URL(begin.json<{ navigateTo: string }>().navigateTo);
  assert.equal(authorize.origin, "http://127.0.0.1:3001");
  const chooser = await b.inject("GET", `${authorize.pathname}${authorize.search}`, { host: "127.0.0.1:3001" });
  assert.equal(chooser.statusCode, 200, chooser.body);
  assert.match(chooser.headers["content-type"] as string, /text\/html/);
  const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)?.[1]?.replaceAll("&amp;", "&");
  assert.ok(link, "chooser renders the synthetic scenario link");
  const choice = await b.inject("GET", link.replace("subject-a", scenario), { host: "127.0.0.1:3001" });
  assert.equal(choice.statusCode, 303);
  const callback = new URL(choice.headers.location as string);
  assert.equal(callback.origin, APPLICATION_ORIGIN);
  return b.inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
}

describe("PROTO-WIRE-01/02 identity routes through the real Fastify instance", () => {
  it("assembles the API with the real session fact source and transaction store; a browser signs in, /me allows with the cookie (p2 profile.read) and denies without, logout needs the bootstrap CSRF value (PROTO-ACTIVATION-001, ACT-03)", async () => {
    const db = new FakeIdentityDatabase();
    const { app, runtime } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(db), rateLimit: syntheticGate });
    const b = await browser(app);
    try {
      assert.ok(runtime.runtime, "local identity runtime composed");
      assert.notEqual(runtime.authorization.sessionLocator({ headers: { cookie: `${SESSION_COOKIE_NAME}=abc` } } as never), undefined, "the real session locator reads the session cookie");
      const routes = installedRoutes(b.server).map((route) => route.id);
      for (const route of ["api:POST:/v1/identity/begin", "api:GET:/v1/identity/callback", "api:GET:/v1/identity/local/authorize", "api:GET:/v1/identity/local/choose", "api:GET:/v1/identity/me", "api:POST:/v1/identity/logout"]) assert.ok(routes.includes(route), route);
      // ACT-01: the four route modules are composed alongside identity in the running API.
      for (const route of ["api:POST:/v1/budget-creation-proposals", "api:GET:/v1/budget-creation-proposals/{proposalId}", "api:POST:/v1/budget-creation-proposals/{proposalId}/confirm", "api:GET:/v1/budget-spaces", "api:GET:/v1/budget-spaces/{budgetSpaceId}", "api:GET:/v1/budget-spaces/{budgetSpaceId}/categories", "api:PUT:/v1/budget-spaces/{budgetSpaceId}/categories", "api:PUT:/v1/budget-spaces/{budgetSpaceId}/targets", "api:GET:/v1/budget-spaces/{budgetSpaceId}/plan"]) assert.ok(routes.includes(route), route);

      // No cookie: denied before the handler by the session gate, with the uniform response.
      const denied = await b.inject("GET", "/v1/identity/me");
      assert.equal(denied.statusCode, 403);
      assert.deepEqual(denied.json(), { outcome: "deny", reason: "denied" });
      const logoutAnonymous = await b.inject("POST", "/v1/identity/logout", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin" });
      assert.equal(logoutAnonymous.statusCode, 403, "logout without a session is denied before its handler");

      const committed = await signIn(b);
      assert.equal(committed.statusCode, 303, committed.body);
      assert.equal(committed.headers.location, `${APPLICATION_ORIGIN}/`);
      // C9 (Manager ruling): only the session cookie is ever set -- no CSRF cookie exists to check for.
      assert.ok(b.cookies[SESSION_COOKIE_NAME], "session cookie delivered");
      const issuedCookie = b.cookies[SESSION_COOKIE_NAME]!;
      assert.equal(b.cookies[CSRF_COOKIE_NAME_LITERAL], undefined, "no CSRF cookie is ever delivered");
      assert.equal(committed.headers["cache-control"], "no-store");

      // A valid, resolvable cookie is allowed through the released p2 profile.read cell and the real
      // subject-scoped fact assembly; the body is the CBD-191 section 5.1 bootstrap response.
      const me = await b.inject("GET", "/v1/identity/me");
      assert.equal(me.statusCode, 200, me.body);
      const view = me.json() as Record<string, unknown>;
      assert.equal(typeof view.accountSubjectId, "string"); assert.equal(typeof view.profileId, "string");
      assert.equal(typeof view.sessionRef, "string"); assert.equal(view.sessionVersion, 1);
      assert.equal(view.environmentId, "test"); assert.equal(view.assurance, "session");
      assert.equal(typeof view.csrfValue, "string", "the raw CSRF value is delivered in the bootstrap body");
      assert.equal(me.headers["set-cookie"], undefined, "no cookie of any kind is set by the bootstrap");
      const csrfValue = view.csrfValue as string;
      const allowAudit = runtime.audit!.snapshot().filter((event) => event.outcome === "allow").at(-1) as { cellRef?: unknown } | undefined;
      assert.equal(allowAudit?.cellRef, JSON.stringify({ kind: "subject", action: "profile.read" }), "the allow was recorded under the p2 subject cell");

      // RC-06 (bounded retention): a reload's bootstrap read receives the same session-bound value again.
      const again = await b.inject("GET", "/v1/identity/me");
      assert.equal(again.statusCode, 200);
      assert.equal((again.json() as Record<string, unknown>).csrfValue, csrfValue);

      const forged = await b.inject("GET", "/v1/identity/me", { cookie: `${SESSION_COOKIE_NAME}=${"x".repeat(43)}.${"y".repeat(43)}`, authorization: "Bearer not-a-session" });
      assert.equal(forged.statusCode, 403, "a bearer token or guessed cookie is never a session");

      // Logout: the session gate admits the cookie; the boundary's A1 CSRF guard needs the header from the bootstrap value
      // and denies uniformly at the session gate before the handler runs.
      const logoutNoHeader = await b.inject("POST", "/v1/identity/logout", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin" });
      assert.equal(logoutNoHeader.statusCode, 403);
      assert.deepEqual(logoutNoHeader.json(), { outcome: "deny", reason: "denied" });
      assert.ok(b.cookies[SESSION_COOKIE_NAME], "a rejected logout changes nothing");
      assert.equal(db.count("account_session", [{ column: "state", value: "revoked" }]), 0);
      const logoutCrossSite = await b.inject("POST", "/v1/identity/logout", { origin: "https://evil.example", "sec-fetch-site": "cross-site", "x-cobudget-csrf": csrfValue });
      assert.equal(logoutCrossSite.statusCode, 403);
      const logout = await b.inject("POST", "/v1/identity/logout", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-cobudget-csrf": csrfValue });
      assert.equal(logout.statusCode, 200, logout.body);
      assert.deepEqual(logout.json(), { signedOut: true });
      assert.equal(b.cookies[SESSION_COOKIE_NAME], undefined, "the session cookie is deleted in the logout response");
      assert.equal(db.count("account_session", [{ column: "state", value: "revoked" }]), 1);
      const afterLogout = await b.inject("GET", "/v1/identity/me", { cookie: `${SESSION_COOKIE_NAME}=${issuedCookie}` });
      assert.equal(afterLogout.statusCode, 403, "the revoked session no longer resolves");
      assert.ok(runtime.audit!.snapshot().length >= 2, "decisions were appended to the in-process restricted audit stream");
    } finally { await app.close(); }
  });

  it("PROTO-WIRE-01: a session cookie issued by the callback reaches an @Authorize-protected test-only route with the resolved subject; without a cookie the boundary denies it", async () => {
    const db = new FakeIdentityDatabase();
    const config = localConfig();
    const runtime = composeApiRuntime(config, () => undefined, { client: createFakeIdentityClient(db), rateLimit: syntheticGate });
    let observed: string | undefined;
    @Controller("protected")
    class ProbeController {
      @Get("probe")
      @Authorize({ action: "space.create", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }), replay: async (_request, subject) => { observed = subject; return { kind: "committed", response: { subject } }; } })
      probe(): unknown { return { never: true }; }
    }
    const module = await Test.createTestingModule({ imports: [AppModule.register(config, () => undefined, runtime.authorization, testHistory)], controllers: [ProbeController] }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    await configureHttpSecurity(app, config);
    runtime.identity.install(app.getHttpAdapter().getInstance());
    const b = await browser(app);
    try {
      const anonymous = await b.inject("GET", "/protected/probe");
      assert.equal(anonymous.statusCode, 403);
      assert.equal(observed, undefined);
      assert.equal((await signIn(b)).statusCode, 303);
      const authenticated = await b.inject("GET", "/protected/probe");
      assert.equal(authenticated.statusCode, 200, authenticated.body);
      assert.equal(observed, db.rows("account_subject")[0]!.account_subject_id);
      assert.deepEqual(authenticated.json(), { subject: observed });
      const resolved = await runtime.authorization.boundary.resolveSession(runtime.authorization.sessionLocator({ headers: { cookie: cookieHeader(b.cookies) } } as never));
      assert.equal(resolved, observed, "the boundary's own resolveSession returns the same subject through the real fact source");
      await assert.rejects(runtime.authorization.boundary.resolveSession(undefined));
    } finally { await app.close(); }
  });

  it("every callback failure class is one uniform 303 to the application-owned result page, and the begin route refuses a foreign origin", async () => {
    const db = new FakeIdentityDatabase();
    const { app } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(db), rateLimit: syntheticGate });
    const b = await browser(app);
    try {
      const foreign = await b.inject("POST", "/v1/identity/begin", { origin: "http://evil.invalid", "content-type": "application/json" }, { ceremony: "sign_in" });
      assert.equal(foreign.statusCode, 400);
      const navigate = await b.inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-mode": "navigate", "content-type": "application/json" }, { ceremony: "register" });
      assert.equal(navigate.statusCode, 303);
      assert.ok((navigate.headers.location as string).startsWith("http://127.0.0.1:3001/v1/identity/local/authorize?"));
      for (const [scenario, outcome] of [["cancel", "cancelled"], ["deny", "not_completed"], ["verification-pending", "verification_pending"], ["outage", "temporarily_unavailable"], ["bad-signature", "invalid_or_expired"]] as const) {
        const response = await signIn(b, scenario);
        assert.equal(response.statusCode, 303, scenario);
        assert.equal(response.headers.location, `${APPLICATION_ORIGIN}/identity/result?outcome=${outcome}`, scenario);
        assert.equal(response.headers["set-cookie"], undefined, scenario);
        assert.equal(response.body, "", scenario);
      }
      const malformed = await b.inject("GET", "/v1/identity/callback?code=x&code=y&state=z");
      assert.equal(malformed.statusCode, 303);
      assert.equal(malformed.headers.location, `${APPLICATION_ORIGIN}/identity/result?outcome=invalid_or_expired`);
      const wrongOrigin = await b.inject("GET", `/v1/identity/callback?code=${"c".repeat(43)}&state=${"s".repeat(43)}`, { host: "evil.invalid" });
      assert.equal(wrongOrigin.statusCode, 303);
      assert.equal(db.count("account_subject"), 0);
      assert.equal(db.count("account_session"), 0);
      const hosted = await b.inject("GET", "/v1/identity/local/authorize?client_id=other", { host: "127.0.0.1:3001" });
      assert.equal(hosted.statusCode, 400);
    } finally { await app.close(); }
  });

  it("with the real CBD-266 surface gate (config/rate-limit) the ceremony counts on its own server-issued ceremony bucket, the session routes on the approved identity-session record, and the recovery route on the independent recovery pool (PROTO-ACTIVATION-001 A7, ACT-01)", async () => {
    const db = new FakeIdentityDatabase();
    const { app, runtime } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(db), scheduler: null });
    const b = await browser(app);
    try {
      const committed = await signIn(b);
      assert.equal(committed.statusCode, 303, committed.body);
      assert.ok(b.cookies[SESSION_COOKIE_NAME], "session cookie delivered through the real surface gate");
      // CBD266-SURFACE-STAGES-001 (R2-01, SEC-ACT-R2-F03): the whole ceremony -- begin, authorize, chooser
      // and the completing callback -- runs end to end through the real registry and registrations with
      // rlp-266-identity-ceremony-v1 and rlp-266-bootstrap-v1 both projected on surf-266-authentication
      // (pre-authentication routes carry no restricted audit event of their own; the stage-resolved record
      // choice itself is proven directly against this same real registry in
      // apps/api/src/rate-limit/http.test.ts).
      const me = await b.inject("GET", "/v1/identity/me");
      assert.equal(me.statusCode, 200, me.body);
      const events = runtime.audit!.snapshot() as { outcome?: string; enforcement?: { registration_id: string; parameter_record_id: string | null; surface_id: string | null } }[];
      const meAllow = events.filter((event) => event.outcome === "allow").at(-1);
      assert.equal(meAllow?.enforcement?.parameter_record_id, "rlp-266-identity-session-v1", "the me route is bound to the approved identity-session record");
      assert.equal(meAllow?.enforcement?.surface_id, "surf-266-session");
      // Recovery: its own approved record on surf-266-recovery, admitted even after the session pool is exhausted.
      for (let i = 0; i < 80; i++) await b.inject("GET", "/v1/identity/me");
      const exhausted = await b.inject("GET", "/v1/identity/me");
      assert.equal(exhausted.statusCode, 403, "the session pool is exhausted (70 per minute)");
      const last = runtime.audit!.snapshot().at(-1) as { enforcement?: { safe_reason_class: string } } | undefined;
      assert.equal(last?.enforcement?.safe_reason_class, "deny_exhausted");
      const recovery = await b.inject("GET", "/v1/identity/recovery");
      assert.equal(recovery.statusCode, 200, recovery.body);
      assert.equal(typeof recovery.json<{ csrfValue?: string }>().csrfValue, "string", "the recovery surface re-establishes a usable session state");
      const recoveryAllow = (runtime.audit!.snapshot() as typeof events).filter((event) => event.outcome === "allow").at(-1);
      assert.equal(recoveryAllow?.enforcement?.parameter_record_id, "rlp-266-recovery-v1");
      assert.equal(recoveryAllow?.enforcement?.surface_id, "surf-266-recovery");
      // A second sign-in is a second ceremony with its own bootstrap bucket: the first ceremony's traffic did not consume it.
      const second = await signIn(b);
      assert.equal(second.statusCode, 303, second.body);
      assert.equal((await b.inject("GET", "/health")).statusCode, 200);
      const unregistered = await b.inject("GET", "/v1/identity/nowhere");
      assert.equal(unregistered.statusCode, 404, "an unmatched route keeps the router's 404");
    } finally { await app.close(); }
  });

  it("PROTO-GUARD-STAGES-SEC-001 SEC-STAGES-F01: a real HTTP callback carrying a known pending state with a garbage, missing or duplicate code, or a wrong origin, never reserves the first-sign-in unit -- the genuine callback for the same ceremony still completes", async () => {
    const db = new FakeIdentityDatabase();
    const runtime = composeApiRuntime(localConfig(), () => undefined, { client: createFakeIdentityClient(db), scheduler: null });
    if (!runtime.runtime || !runtime.localIssuer) throw new Error("harness requires the local adapter");
    const { ceremony } = runtime.runtime;
    const issuer = runtime.localIssuer;
    const gate = runtime.authorization.rateLimit!;
    const begun = await ceremony.begin({ ceremony: "sign_in", postResultDestinationId: "home", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.ok(begun.ok, "begin");
    if (!begun.ok) return;
    const authorize = new URL(begun.navigateTo);
    const hosted = issuer.authorize(Object.fromEntries(authorize.searchParams.entries()));
    assert.ok(hosted.ok, "hosted authorize");
    if (!hosted.ok) return;
    const callbackUrl = issuer.choose(hosted.requestId, "subject-a");
    assert.ok(callbackUrl, "chooser");
    const callback = new URL(callbackUrl!);
    const state = callback.searchParams.get("state")!;
    const code = callback.searchParams.get("code")!;
    const request = (query: string, overrides: Partial<FastifyRequest> = {}): FastifyRequest => ({
      method: "GET", url: `/v1/identity/callback?${query}`, routeOptions: { url: "/v1/identity/callback" },
      query: Object.fromEntries(new URLSearchParams(query)), ip: "127.0.0.1", protocol: "http", host: "localhost:3000", headers: {}, ...overrides,
    }) as unknown as FastifyRequest;
    // The pending challenge is untouched by every one of these (only `find`, never `take`, is reachable
    // from a `reserved` probe): none of them may be the request the eventual real callback replays as.
    assert.equal(await gate.reserved?.(request(`code=${"!".repeat(8)}&state=${state}`), undefined), false, "garbage code does not reserve");
    assert.equal(await gate.reserved?.(request(`state=${state}`), undefined), false, "missing code does not reserve");
    assert.equal(await gate.reserved?.(request(`code=${code}&code=${code}&state=${state}`), undefined), false, "duplicate code does not reserve");
    assert.equal(await gate.reserved?.(request(`code=${code}&state=${state}`, { host: "evil.invalid" } as Partial<FastifyRequest>), undefined), false, "wrong origin does not reserve");
    // The same known, still-pending ceremony still resolves the reservation -- proving the above consumed
    // nothing from it -- and the genuine callback still completes end to end.
    assert.equal(await gate.reserved?.(request(`code=${code}&state=${state}`), undefined), true, "the genuine callback is the reserved first-sign-in unit");
    const completed = await ceremony.complete({ rawQuery: callback.search.slice(1), method: "GET", observedOrigin: callback.origin, path: callback.pathname, receiptTime: new Date() });
    assert.equal(completed.kind, "success", "the genuine callback for the same ceremony still completes");
  });

  it("PROTO-GUARD-STAGES-SEC-001 SEC-STAGES-F02: unknown-state callbacks cannot exhaust the ordinary pool a valid, in-flight ceremony's own authorize and callback traffic needs", async () => {
    const db = new FakeIdentityDatabase();
    const { app } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(db), scheduler: null });
    const b = await browser(app);
    try {
      const begin = await b.inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" }, { ceremony: "sign_in", postResultDestinationId: "home" });
      assert.equal(begin.statusCode, 200, begin.body);
      const authorize = new URL(begin.json<{ navigateTo: string }>().navigateTo);
      // A flood of callbacks naming no known ceremony at all -- well beyond the ceremony record's 15-unit
      // ceiling -- must never draw from the same pool the ceremony issued above still needs.
      for (let i = 0; i < 15; i++) {
        const junk = await b.inject("GET", `/v1/identity/callback?code=${"c".repeat(43)}&state=${"s".repeat(43)}`);
        assert.notEqual(junk.statusCode, 200, `unknown-state callback ${i} is denied, not admitted`);
      }
      const chooser = await b.inject("GET", `${authorize.pathname}${authorize.search}`, { host: "127.0.0.1:3001" });
      assert.equal(chooser.statusCode, 200, chooser.body);
      const link = /href="([^"]+scenario=subject-a)"/.exec(chooser.body)?.[1]?.replaceAll("&amp;", "&");
      assert.ok(link, "chooser renders the synthetic scenario link");
      const choice = await b.inject("GET", link!, { host: "127.0.0.1:3001" });
      assert.equal(choice.statusCode, 303, "the valid ceremony's own authorize/chooser step still completes after the flood");
      const callback = new URL(choice.headers.location as string);
      const committed = await b.inject("GET", `${callback.pathname}${callback.search}`, { "sec-fetch-mode": "navigate" });
      assert.equal(committed.statusCode, 303, "the valid ceremony's own callback still completes after the flood");
      assert.ok(b.cookies[SESSION_COOKIE_NAME], "session cookie delivered despite the preceding unknown-state flood");
    } finally { await app.close(); }
  });

  it("PROTO-QA-FIXES-001 F4: a callback from which no ceremony resolves is denied by the real surface gate with nothing consumed and no session, and answered by the same accessible 303 result navigation as every other malformed callback", async () => {
    const db = new FakeIdentityDatabase();
    const { app, runtime } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(db), scheduler: null });
    const b = await browser(app);
    try {
      type Enforcement = { earliest_decisive_gate: string; safe_reason_class: string; counter_store_evidence: string; parameter_record_id: string | null };
      const audits = () => runtime.audit!.snapshot().length;
      for (const [name, path] of [["missing query", "/v1/identity/callback"], ["unknown state", `/v1/identity/callback?code=${"c".repeat(43)}&state=${"s".repeat(43)}`]] as const) {
        const before = audits();
        const response = await b.inject("GET", path, { "sec-fetch-mode": "navigate" });
        assert.equal(response.statusCode, 303, `${name}: ${response.statusCode} ${response.body}`);
        assert.equal(response.headers.location, `${APPLICATION_ORIGIN}/identity/result?outcome=invalid_or_expired`, name);
        assert.equal(response.headers["set-cookie"], undefined, name);
        assert.equal(response.body, "", name);
        assert.equal(audits(), before + 1, `${name}: the surface denial is still recorded`);
        const enforcement = (runtime.audit!.snapshot().at(-1) as { enforcement?: Enforcement }).enforcement;
        assert.equal(enforcement?.earliest_decisive_gate, "surface", name);
        assert.equal(enforcement?.safe_reason_class, "deny_input_invalid", name);
        assert.equal(enforcement?.counter_store_evidence, "not_consumed", `${name}: no counter was touched`);
      }
      // A JSON-shaped fetch of the same unresolvable callback is answered identically: the route is a navigation surface.
      const fetched = await b.inject("GET", "/v1/identity/callback", { accept: "application/json" });
      assert.equal(fetched.statusCode, 303);
      assert.equal(db.count("account_subject"), 0);
      assert.equal(db.count("account_session"), 0);
      // The genuine ceremony still completes afterwards (nothing of its pool was spent by the unresolvable requests).
      const committed = await signIn(b);
      assert.equal(committed.statusCode, 303, committed.body);
      assert.ok(b.cookies[SESSION_COOKIE_NAME]);
    } finally { await app.close(); }
  });

  it("PROTO-WIRE-02: the explicit unavailable provider keeps the fail-closed boundary; startup resolves identity and session configuration before any application effect", async () => {
    const unavailable = composeApiRuntime(loadApiConfigFrom(localEnvironment({ COBUDGET_IDENTITY_PROVIDER: "unavailable" })), () => undefined);
    assert.equal(unavailable.runtime, undefined);
    assert.equal(unavailable.authorization.sessionLocator({ headers: { cookie: "x" } } as never), undefined);
    await assert.rejects(unavailable.authorization.boundary.resolveSession("anything"));
    const { app } = await createComposedApiApplication(loadApiConfigFrom(localEnvironment({ COBUDGET_IDENTITY_PROVIDER: "unavailable" })), () => undefined, testHistory);
    const b = await browser(app);
    try {
      assert.equal((await b.inject("GET", "/v1/identity/me")).statusCode, 404, "no identity route is mounted on the unavailable path");
      assert.equal((await b.inject("GET", "/health")).statusCode, 200);
    } finally { await app.close(); }

    const calls: string[] = [];
    const dependencies = (environment: Record<string, string | undefined>) => ({
      loadConfig: () => { calls.push("validate"); return loadApiConfigFrom(environment); },
      resolveEncryptionProvider: (config: ReturnType<typeof loadApiConfigFrom>) => { calls.push("encryption"); return resolveApiFieldEncryptionProvider(config); },
      createApplication: async () => { calls.push("create"); return { enableShutdownHooks: () => undefined, listen: async () => undefined }; },
      sink: () => { calls.push("ready"); },
    });
    await runApiBootstrap(dependencies(localEnvironment()));
    assert.deepEqual(calls, ["validate", "encryption", "create", "ready"]);
    calls.length = 0;
    await assert.rejects(runApiBootstrap(dependencies(localEnvironment({ COBUDGET_IDENTITY_ENVIRONMENT_ID: "production" }))), /COBUDGET_IDENTITY_ENVIRONMENT_ID/);
    assert.deepEqual(calls, ["validate"], "cross-environment values fail at validation, before any effect");
    calls.length = 0;
    await assert.rejects(runApiBootstrap(dependencies(localEnvironment({ COBUDGET_SESSION_PEPPER: Buffer.alloc(8).toString("base64") }))), /COBUDGET_SESSION_PEPPER/);
    assert.deepEqual(calls, ["validate", "encryption"], "a short pepper fails in the pre-effect identity resolution, before the application exists");
  });
});
