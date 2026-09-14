import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { DataAccessClient } from "@cobudget/data-access";
import { AppModule } from "../app.module.js";
import { loadApiConfigFrom } from "../config.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { invocation, loadRegistrations } from "../../../../packages/rate-limit/src/index.ts";
import { budgetApiHttp } from "./modules.ts";
import { installedRoutes } from "../rate-limit/inventory.js";

import { CreationAuthorizationStore } from "./transaction-store.js";
import { DurableProposalStore } from "../../../../packages/budget-application/src/persistence/proposal-store.ts";
import { requestDigest } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";

void test("registered confirmation route authenticates before lookup, rejects echoed authority and serves stored replay", async () => {
  const h = new Harness(); let lookups = 0; let policy = 0;
  const request = { proposalId: "bcp_" + "a".repeat(32), confirmationBinding: "binding", confirmationIdempotencyKey: "1111111111111111" };
  const stored = { confirmationOutcomeId: "stored-outcome", budgetSpaceId: "stored-budget" };
  const client = { platformSelect: async () => { lookups++; return { rows: [{ candidate_budget_space_id: "stored-budget" }] }; },
    tenantSelect: async () => ({ rows: [{ request_digest: requestDigest(request), committed_response: stored }] }),
  } as unknown as DataAccessClient;
  const binding = budgetApiHttp({ client, transactions: new CreationAuthorizationStore(client, 3),
    proposals: new DurableProposalStore(client, () => assert.fail("allocate on replay"), () => "2026-09-15T12:00:00.000Z"),
    context: async (_request, subject) => ({ environment: "test", subjectId: subject, accountId: "account", profileId: "profile", sessionGeneration: 1 }),
    persistence: { attempts: 3, reload: async () => assert.fail("reload on replay"), authorize: async () => assert.fail("policy on replay"), allowAudit: async () => assert.fail("audit on replay") },
  }, { context: async () => assert.fail("p2 context"), ports: async () => assert.fail("p2 ports") }, { client, clock: { now: () => new Date("2026-09-15T12:00:00.000Z") } });
  const authorize = h.boundary.authorize.bind(h.boundary);
  h.boundary.authorize = async (...args) => { policy++; return authorize(...args); };
  const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "confirmation-test",
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
  const module = await Test.createTestingModule({ imports: [AppModule.register(config, () => undefined, {
    modules: binding.modules, boundary: h.boundary, surfaceApproved: async () => true, csrf: async () => true, sessionLocator: req => req.headers.cookie,
    deny: response => { throw new HttpException(response, 403); },
    rateLimit: { evidence: () => invocation("api:POST:/v1/budget-creation-proposals/:proposalId/confirm", "api_route", "test-only", "test-only"),
      enforce: async () => ({ outcome: "allow", provenance: "test-only", release: async () => undefined }) },
  }, testHistory)] }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  try {
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    // PROTO-ACTIVATION-001: the eight routes are registered in config/rate-limit/registrations.json (the proposal file is gone).
    assert.deepEqual(installedRoutes(app.getHttpAdapter().getInstance()).map(route => route.id).filter(id => id.includes("/v1/budget-")).sort(),
      loadRegistrations().map(row => row.registration_id).filter(id => id.includes("/v1/budget-") && !id.includes("/categories") && !id.includes("/targets") && !id.includes("/plan")).sort());
    const url = "/v1/budget-creation-proposals/" + request.proposalId + "/confirm";
    assert.equal((await app.inject({ method: "POST", url, payload: { confirmationBinding: "binding" } })).statusCode, 403);
    assert.equal(lookups, 0);
    const headers = { cookie: "opaque", "idempotency-key": "1111111111111111" };
    const invalid = await app.inject({ method: "POST", url, headers, payload: { confirmationBinding: "binding", budgetSpaceId: "caller" } });
    assert.equal(invalid.statusCode, 400); assert.equal(lookups, 0);
    const replay = await app.inject({ method: "POST", url, headers, payload: { confirmationBinding: "binding" } });
    assert.equal(replay.statusCode, 201); assert.deepEqual(replay.json(), stored); assert.equal(policy, 0);
    const conflict = await app.inject({ method: "POST", url, headers, payload: { confirmationBinding: "changed" } });
    assert.equal(conflict.statusCode, 409); assert.equal(policy, 0); assert.equal(h.state.spaces.length, 0);
  } finally { await app.close(); }
});
