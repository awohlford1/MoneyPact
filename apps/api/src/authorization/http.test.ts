import { apiIdentity, invocation } from "../../../../packages/rate-limit/src/index.ts";
import { installedRoutes } from "../rate-limit/inventory.js";
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Controller, Get, HttpException, Post } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module.js";
import { loadApiConfigFrom } from "../config.js";
import { Authorization } from "./http.js";
import { RouteFailure } from "./http.js";
import { Authorize } from "./http.js";
import { ApiAuthorizationBoundary } from "./http.js";
import { PreAuthenticationSurface } from "./http.js";
import type { EffectContext } from "./boundary.js";
import { Harness, testHistory } from "./test-support.js";
import type { TestState } from "./test-support.js";

const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "authorization-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
let handlerCalls = 0;
let replayCalls = 0;
let replayResult: import("./http.js").RouteReplay | RouteFailure = { kind: "absent" };
@Controller("protected")
class ProtectedController {
  @Get("missing")
  missing(): unknown { handlerCalls++; return { secret: "never-return" }; }

  @Post("bootstrap")
  @Authorize({ action: "space.create", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }), replay: async () => { replayCalls++; if (replayResult instanceof RouteFailure) throw replayResult; return replayResult; } })
  create(@Authorization() effect: EffectContext): unknown {
    handlerCalls++;
    (effect.transaction as TestState).spaces.push(effect.input.bootstrap!.candidateSpaceId);
    return { created: true };
  }
}

async function application(h: Harness, protectedControllers = true): Promise<NestFastifyApplication> {
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config, () => undefined, {
      boundary: h.boundary, surfaceApproved: async () => true,
      // This suite isolates CBD-236 policy behavior with a synthetic surface approval.
      rateLimit: {
        evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url!), "api_route", "test-only", "test-only"),
        enforce: async (request) => ["/health", "/protected/bootstrap"].includes(request.routeOptions.url!)
          ? { outcome: "allow", provenance: "test-only", release: async () => undefined } : { outcome: "deny_unregistered" },
      },
      sessionLocator: (request) => request.headers.cookie,
      deny: (response) => { throw new HttpException(response, 403); }, // Synthetic response contract for this test only.
    }, testHistory)],
    controllers: protectedControllers ? [ProtectedController] : [],
  }).compile();
  return module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
}
describe("API enforcement installation", () => {
  it("FX-266-UNREGISTERED-API-ROUTE discovers and denies a real new route before facts, policy or effect", async () => {
    handlerCalls = 0; const h = new Harness();
    const module = await Test.createTestingModule({ imports: [AppModule.register(config, () => undefined, {
      boundary: h.boundary, surfaceApproved: async () => assert.fail("later surface callback"), sessionLocator: (request) => request.headers.cookie,
      deny: (response) => { throw new HttpException(response, 403); },
    }, testHistory)], controllers: [ProtectedController] }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    try {
      await app.init(); await app.getHttpAdapter().getInstance().ready();
      assert.ok(installedRoutes(app.getHttpAdapter().getInstance()).some((r) => r.id === "api:POST:/protected/bootstrap"));
      const before = structuredClone(h.state);
      const response = await app.inject({ method: "POST", url: "/protected/bootstrap", headers: { cookie: "opaque" }, payload: { actorId: "forged" } });
      assert.equal(response.statusCode, 403); assert.equal(handlerCalls, 0);
      assert.deepEqual(h.reads.map((r) => r.source), ["session_store"]);
      assert.deepEqual({ ...h.state, audits: [] }, { ...before, audits: [] });
      assert.equal(h.state.audits.length, 1);
      const audit = h.state.audits[0] as unknown as { enforcement: { earliest_decisive_gate: string; authorization_evaluation: string } };
      assert.equal(audit.enforcement.earliest_decisive_gate, "surface"); assert.equal(audit.enforcement.authorization_evaluation, "not_run");
      assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
      assert.equal((await app.inject({ method: "HEAD", url: "/health" })).statusCode, 200);
    } finally { await app.close(); }
  });
  it("keeps health public and denies routes without decisions, including raw Fastify routes", async () => {
    handlerCalls = 0; const h = new Harness(); const app = await application(h);
    try {
      const server = app.getHttpAdapter().getInstance();
      server.get("/raw", async () => { handlerCalls++; return "never-return"; });
      await app.init(); await server.ready();
      assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
      assert.equal((await app.inject({ method: "HEAD", url: "/health" })).statusCode, 200);
      for (const url of ["/protected/missing", "/raw"]) {
        const response = await app.inject({ method: "GET", url });
        assert.equal(response.statusCode, 403); assert.deepEqual(response.json(), { outcome: "deny", reason: "denied" });
      }
      assert.equal(handlerCalls, 0);
      assert.deepEqual(app.get(ApiAuthorizationBoundary).inventory(), ["GET /protected/missing"]);
    } finally { await app.close(); }
  });
  it("runs a bootstrap handler inside obligation discharge and commits before responding", async () => {
    handlerCalls = 0; const h = new Harness(); const app = await application(h);
    try {
      await app.init(); await app.getHttpAdapter().getInstance().ready();
      const response = await app.inject({ method: "POST", url: "/protected/bootstrap", headers: { cookie: "opaque" }, payload: { role: "primary_owner", subject: "forged", provenance: "session_store" } });
      assert.equal(response.statusCode, 201); assert.deepEqual(response.json(), { created: true });
      assert.equal(handlerCalls, 1); assert.equal(h.state.spaces.length, 1); assert.equal(h.state.memberships.length, 1);
      assert.deepEqual(h.order, ["begin", "allow-audit", "commit"]);
    } finally { await app.close(); }
  });
  it("serializes session and audit failures identically and rolls back the response's effects", async () => {
    const h = new Harness(); const app = await application(h);
    try {
      await app.init(); await app.getHttpAdapter().getInstance().ready();
      const absent = await app.inject({ method: "POST", url: "/protected/bootstrap", payload: { subject: h.input.subject } });
      h.failAudit = true;
      const audit = await app.inject({ method: "POST", url: "/protected/bootstrap", headers: { cookie: "opaque" } });
      assert.equal(absent.statusCode, 403); assert.equal(audit.statusCode, absent.statusCode); assert.deepEqual(audit.json(), absent.json());
      assert.equal(h.state.spaces.length, 0); assert.equal(h.state.memberships.length, 0);
    } finally { await app.close(); }
  });
  it("inventories every currently composed controller route", async () => {
    const app = await application(new Harness(), false);
    try { await app.init(); assert.deepEqual(app.get(ApiAuthorizationBoundary).inventory(), []); }
    finally { await app.close(); }
  });
  it("refuses startup before registration without a released compatible tuple", () => {
    assert.throws(() => AppModule.register(config, () => undefined, undefined, []), /policy_version_unsupported/);
    assert.throws(() => AppModule.register(config, () => undefined, undefined, [{ ...testHistory[0], digest: "0".repeat(64) }]), /policy_version_unsupported/);
  });
});

describe("CBD233-REPLAY-001 authenticated pre-policy replay", () => {
  for (const kind of ["committed", "conflict", "absent", "unauthenticated"] as const) {
    it(kind, async () => {
      const h = new Harness(); handlerCalls = 0; replayCalls = 0;
      replayResult = kind === "committed" ? { kind, response: { budgetSpaceId: "original" } }
        : kind === "conflict" ? { kind } : { kind: "absent" };
      let authorizations = 0;
      const authorize = h.boundary.authorize.bind(h.boundary);
      h.boundary.authorize = async (...args) => { authorizations++; return authorize(...args); };
      const app = await application(h);
      try {
        await app.init(); await app.getHttpAdapter().getInstance().ready();
        const response = await app.inject({ method: "POST", url: "/protected/bootstrap",
          ...(kind === "unauthenticated" ? {} : { headers: { cookie: "opaque" } }) });
        assert.equal(replayCalls, kind === "unauthenticated" ? 0 : 1);
        assert.equal(authorizations, kind === "absent" ? 1 : 0);
        assert.equal(handlerCalls, kind === "absent" ? 1 : 0);
        assert.equal(response.statusCode, kind === "conflict" ? 409 : kind === "unauthenticated" ? 403 : 201);
        if (kind === "committed") assert.deepEqual(response.json(), { budgetSpaceId: "original" });
        if (kind !== "absent") assert.equal(h.state.spaces.length, 0);
      } finally { replayResult = { kind: "absent" }; await app.close(); }
    });
  }
});

describe("PROTO-IDENTITY-API-001 C7: @PreAuthenticationSurface is restricted to an explicit eligible surface set", () => {
  it("fails startup when a route carries both @Authorize and @PreAuthenticationSurface", async () => {
    @Controller("v1/identity")
    class DualMarkerController {
      @Post("begin")
      @PreAuthenticationSurface()
      @Authorize({ action: "space.create", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
      begin(): unknown { handlerCalls++; return { never: true }; }
    }
    const h = new Harness();
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config, () => undefined, { boundary: h.boundary, surfaceApproved: async () => true, rateLimit: { evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url!), "api_route", "test-only", "test-only"), enforce: async () => ({ outcome: "allow", provenance: "test-only", release: async () => undefined }) }, sessionLocator: () => undefined, deny: (response) => { throw new HttpException(response, 403); } }, testHistory)],
      controllers: [DualMarkerController],
    }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    await assert.rejects(app.init(), /carries both @Authorize and @PreAuthenticationSurface/);
    await app.close();
  });

  it("fails startup when a route carries @PreAuthenticationSurface outside the eligible identity surface set", async () => {
    @Controller("protected")
    class IneligibleMarkerController {
      @Get("not-eligible")
      @PreAuthenticationSurface()
      probe(): unknown { handlerCalls++; return { never: true }; }
    }
    const h = new Harness();
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config, () => undefined, { boundary: h.boundary, surfaceApproved: async () => true, rateLimit: { evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url!), "api_route", "test-only", "test-only"), enforce: async () => ({ outcome: "allow", provenance: "test-only", release: async () => undefined }) }, sessionLocator: () => undefined, deny: (response) => { throw new HttpException(response, 403); } }, testHistory)],
      controllers: [IneligibleMarkerController],
    }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    await assert.rejects(app.init(), /is not an eligible pre-authentication surface/);
    await app.close();
  });

  it("a marked eligible route still passes the rate-limit gate and skips the session/policy gate", async () => {
    @Controller("v1/identity")
    class EligibleController {
      @Post("begin")
      @PreAuthenticationSurface()
      begin(): unknown { handlerCalls++; return { ok: true }; }
    }
    handlerCalls = 0;
    let enforced = 0;
    const h = new Harness();
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config, () => undefined, {
        boundary: h.boundary, surfaceApproved: async () => true,
        rateLimit: {
          evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url!), "api_route", "test-only", "test-only"),
          enforce: async (request) => { enforced++; return request.routeOptions.url === "/v1/identity/begin" ? { outcome: "allow", provenance: "test-only", release: async () => undefined } : { outcome: "deny_unregistered" }; },
        },
        sessionLocator: () => undefined,
        deny: (response) => { throw new HttpException(response, 403); },
      }, testHistory)],
      controllers: [EligibleController],
    }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    try {
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const response = await app.inject({ method: "POST", url: "/v1/identity/begin" });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(handlerCalls, 1, "no session cookie was supplied, yet the eligible pre-authentication route still ran");
      assert.equal(enforced, 1, "the rate-limit gate still ran for the eligible surface");
    } finally { await app.close(); }
  });
});

for (const stage of ["precheck", "rolled-back"] as const) {
  it("preserves the application conflict status at " + stage, async () => {
    const h = new Harness(); const failure = new RouteFailure(409, "proposal_not_current");
    if (stage === "precheck") replayResult = failure;
    else h.boundary.execute = async <T>() => failure as T;
    const app = await application(h);
    try {
      await app.init(); await app.getHttpAdapter().getInstance().ready();
      const response = await app.inject({ method: "POST", url: "/protected/bootstrap", headers: { cookie: "opaque" } });
      assert.equal(response.statusCode, 409); assert.deepEqual(response.json(), { error: "proposal_not_current" });
      assert.equal(h.state.spaces.length, 0); assert.equal(h.state.memberships.length, 0);
    } finally { replayResult = { kind: "absent" }; await app.close(); }
  });
}
