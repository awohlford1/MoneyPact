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
import { Authorize } from "./http.js";
import { ApiAuthorizationBoundary } from "./http.js";
import type { EffectContext } from "./boundary.js";
import { Harness, testHistory } from "./test-support.js";
import type { TestState } from "./test-support.js";

const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "authorization-test" });
let handlerCalls = 0;
@Controller("protected")
class ProtectedController {
  @Get("missing")
  missing(): unknown { handlerCalls++; return { secret: "never-return" }; }

  @Post("bootstrap")
  @Authorize({ action: "space.create", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default" }) })
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
      sessionLocator: (request) => request.headers.cookie,
      deny: (response) => { throw new HttpException(response, 403); }, // Synthetic response contract for this test only.
    }, testHistory)],
    controllers: protectedControllers ? [ProtectedController] : [],
  }).compile();
  return module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
}
describe("API enforcement installation", () => {
  it("keeps health public and denies routes without decisions, including raw Fastify routes", async () => {
    handlerCalls = 0; const h = new Harness(); const app = await application(h);
    try {
      const server = app.getHttpAdapter().getInstance();
      server.get("/raw", async () => { handlerCalls++; return "never-return"; });
      await app.init(); await server.ready();
      assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
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
