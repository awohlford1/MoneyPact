import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Controller, Get } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
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
import { CSRF_COOKIE_NAME } from "./ceremony.ts";
import { createFakeIdentityClient, FakeIdentityDatabase } from "./test-support/fake-client.ts";
import { APPLICATION_ORIGIN, localConfig, localEnvironment } from "./test-support/harness.ts";

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
  it("assembles the API with the real session fact source and transaction store, and a browser can sign in, read /me, be denied without a cookie, and sign out", async () => {
    const db = new FakeIdentityDatabase();
    const { app, runtime } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(db), rateLimit: syntheticGate });
    const b = await browser(app);
    try {
      assert.ok(runtime.runtime, "local identity runtime composed");
      assert.notEqual(runtime.authorization.sessionLocator({ headers: { cookie: `${SESSION_COOKIE_NAME}=abc` } } as never), undefined, "the real session locator reads the session cookie");
      const routes = installedRoutes(b.server).map((route) => route.id);
      for (const route of ["api:POST:/v1/identity/begin", "api:GET:/v1/identity/callback", "api:GET:/v1/identity/local/authorize", "api:GET:/v1/identity/local/choose", "api:GET:/v1/identity/me", "api:POST:/v1/identity/logout"]) assert.ok(routes.includes(route), route);

      const denied = await b.inject("GET", "/v1/identity/me");
      assert.equal(denied.statusCode, 403);
      assert.deepEqual(denied.json(), { outcome: "deny", reason: "denied" });

      const committed = await signIn(b);
      assert.equal(committed.statusCode, 303, committed.body);
      assert.equal(committed.headers.location, `${APPLICATION_ORIGIN}/`);
      assert.ok(b.cookies[SESSION_COOKIE_NAME] && b.cookies[CSRF_COOKIE_NAME], "session and CSRF cookies delivered");
      assert.equal(committed.headers["cache-control"], "no-store");

      const me = await b.inject("GET", "/v1/identity/me");
      assert.equal(me.statusCode, 200, me.body);
      const view = me.json<{ accountSubjectId: string; profileId: string; identityBindingId: string; environmentId: string; assurance: string }>();
      assert.equal(view.accountSubjectId, db.rows("account_subject")[0]!.account_subject_id);
      assert.equal(view.profileId, db.rows("financial_profile")[0]!.profile_id);
      assert.equal(view.environmentId, "test");
      assert.equal(view.assurance, "session");
      assert.deepEqual(Object.keys(view).sort(), ["accountSubjectId", "assurance", "environmentId", "identityBindingId", "profileId"]);

      const forged = await b.inject("GET", "/v1/identity/me", { cookie: `${SESSION_COOKIE_NAME}=${"x".repeat(43)}.${"y".repeat(43)}`, authorization: "Bearer not-a-session" });
      assert.equal(forged.statusCode, 403, "a bearer token or guessed cookie is never a session");

      const csrfRejected = await b.inject("POST", "/v1/identity/logout", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin" });
      assert.equal(csrfRejected.statusCode, 403);
      assert.ok(b.cookies[SESSION_COOKIE_NAME], "a CSRF-rejected logout changes nothing");

      const logout = await b.inject("POST", "/v1/identity/logout", { origin: APPLICATION_ORIGIN, "sec-fetch-site": "same-origin", "x-csrf-token": b.cookies[CSRF_COOKIE_NAME]! });
      assert.equal(logout.statusCode, 200, logout.body);
      assert.deepEqual(logout.json(), { signedOut: true });
      assert.equal(b.cookies[SESSION_COOKIE_NAME], undefined, "deletion header cleared the session cookie");
      assert.equal(db.count("account_session", [{ column: "state", value: "revoked" }]), 1);
      const afterLogout = await b.inject("GET", "/v1/identity/me");
      assert.equal(afterLogout.statusCode, 403);
      assert.ok(runtime.audit!.snapshot().length >= 2, "denials were appended to the in-process restricted audit stream");
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

  it("with the real CBD-266 surface gate every identity route is denied as unregistered until registrations and approved records exist (recorded blocker)", async () => {
    const db = new FakeIdentityDatabase();
    const { app, runtime } = await createComposedApiApplication(localConfig(), () => undefined, testHistory, { client: createFakeIdentityClient(db) });
    const b = await browser(app);
    try {
      const begin = await b.inject("POST", "/v1/identity/begin", { origin: APPLICATION_ORIGIN, "content-type": "application/json" }, { ceremony: "sign_in" });
      assert.equal(begin.statusCode, 403);
      const audit = runtime.audit!.snapshot().at(-1) as { enforcement?: { safe_reason_class: string; earliest_decisive_gate: string } } | undefined;
      assert.equal(audit?.enforcement?.safe_reason_class, "deny_unregistered");
      assert.equal(audit?.enforcement?.earliest_decisive_gate, "surface");
      assert.equal((await b.inject("GET", "/health")).statusCode, 200);
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
