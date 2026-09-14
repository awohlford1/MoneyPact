import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { DataAccessClient } from "@cobudget/data-access";
import { ordinaryFixture } from "@cobudget/contracts/authorization";
import { AppModule } from "../app.module.js";
import { loadApiConfigFrom } from "../config.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { invocation } from "../../../../packages/rate-limit/src/index.ts";
import { FakeClock } from "../../../../packages/budget-application/src/creation-proposals/support.ts";
import { budgetSpacesHttp, listOwnSpaces } from "./http.ts";
import { proposalHttp } from "../budget-creation/proposal-http.ts";

void test("mounted detail reads a member's stored current period; p2 routes deny without effects or cookies when no environment is configured", async () => {
  const h = new Harness(ordinaryFixture("1.view_space"));
  let reads = 0; let handlerCalls = 0;
  const client = { readOwnBudgetMemberships: async (subject: string) => ({ rows: subject === "subject-1" ? [{ budget_space_id: "space-1", membership_id: "membership-1" }] : [] }),
    tenantSelect: async (query: { table: string; budgetSpaceId: string }) => {
      reads++; assert.equal(query.budgetSpaceId, "space-1");
      const rows = query.table === "budget_space_membership" ? [{}] : query.table === "budget_space" ? [{ name: "Household", name_version: 1,
        time_zone: "America/New_York", currency_code: "USD", lifecycle: "live", lifecycle_version: 1, current_schedule_version_id: "schedule-1", current_period_id: "period-1" }]
        : query.table === "budget_space_period" ? [{ period_id: "period-1", schedule_version_id: "schedule-1", status: "active", period_start_date: "2026-11-30", period_end_date: "2026-12-06" }]
        : [{ schedule_version_id: "schedule-1", sequence: 1, cadence_definition: { cadence: "weekly", anchor: "monday" } }];
      return { rows, rowCount: rows.length };
    } } as unknown as DataAccessClient;
  // Keep the boundary's real transaction/audit fixture while supplying the
  // transaction-scoped reader used by the handler.
  const transaction = h.store.transaction;
  h.store.transaction = work => transaction(async tx => { Object.assign(tx as object, client); return work(tx); });
  const modules = [budgetSpacesHttp({ client, clock: new FakeClock("2026-12-01T02:00:00.000Z") }), proposalHttp({
    context: async () => { handlerCalls++; throw new Error("p2 handler reached under p1"); },
    ports: async () => { handlerCalls++; throw new Error("p2 store reached under p1"); },
  })];
  const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "budget-route-test",
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
  const module = await Test.createTestingModule({ imports: [AppModule.register(config, () => undefined, {
    modules, boundary: h.boundary, surfaceApproved: async () => true, csrf: async () => true, sessionLocator: request => request.headers.cookie,
    deny: response => { throw new HttpException(response, 403); },
    rateLimit: { evidence: () => invocation("api:GET:/v1/budget-spaces/:budgetSpaceId", "api_route", "test-only", "test-only"),
      enforce: async () => ({ outcome: "allow", provenance: "test-only", release: async () => undefined }) },
  }, testHistory)] }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  try {
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const headers = { cookie: "opaque" };
    const response = await app.inject({ method: "GET", url: "/v1/budget-spaces/space-1", headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().activePeriod.periodId, "period-1", "ACT-06: the stored current period row");
    assert.equal(response.json().activePeriod.start, "2026-11-30"); assert.equal(response.json().nextPeriods.length, 3);
    const prior = reads;
    // Non-member and wrong-space denials are byte-identical to a policy denial (CBD-236 PC-236-009): uniform external body, no access_denied code.
    const wrong = await app.inject({ method: "GET", url: "/v1/budget-spaces/wrong", headers });
    assert.equal(wrong.statusCode, 403); assert.deepEqual(wrong.json(), { outcome: "deny", reason: "denied" });
    h.input.subject!.accountSubjectId = "subject-2";
    const foreign = await app.inject({ method: "GET", url: "/v1/budget-spaces/space-1", headers });
    assert.equal(foreign.statusCode, 403); assert.deepEqual(foreign.json(), wrong.json());
    h.input.subject!.accountSubjectId = "subject-1";
    assert.equal(reads, prior);
    for (const [method, url] of [["POST", "/v1/budget-creation-proposals"], ["GET", "/v1/budget-creation-proposals/bcp_" + "a".repeat(32)], ["GET", "/v1/budget-spaces"]] as const) {
      const denied = await app.inject({ method, url, headers });
      assert.equal(denied.statusCode, 403); assert.equal(denied.headers["set-cookie"], undefined);
    }
    assert.equal(handlerCalls, 0); assert.equal(reads, prior);
    assert.deepEqual(h.state.effects, []); assert.deepEqual(h.state.spaces, []); assert.deepEqual(h.state.memberships, []);
    await assert.rejects(h.boundary.authorize({ credential: "opaque", operation: { action: "proposal.create", purpose: "user_delegated", mode: "user_delegated", fieldSet: "default" } }));
    console.log("PROTO p1 fact-assembly denial class:", h.state.audits.at(-1)?.reasonClass);
  } finally { await app.close(); }
});

void test("list own returns only membership-selected spaces and refuses missing identity", async () => {
  const client = { readOwnBudgetMemberships: async (subject: string) => { assert.equal(subject, "owner"); return { rows: [{ budget_space_id: "owned", membership_id: "member" }] }; },
    tenantSelect: async (query: { budgetSpaceId: string }) => { assert.equal(query.budgetSpaceId, "owned"); return { rows: [{ name: "Home", name_version: 1, lifecycle: "live", lifecycle_version: 1, currency_code: "USD", time_zone: "America/New_York" }] }; },
  } as unknown as DataAccessClient;
  assert.deepEqual(await listOwnSpaces(client, "owner"), { spaces: [{ budgetSpaceId: "owned", membershipId: "member", name: "Home", nameVersion: 1, lifecycle: "live", lifecycleVersion: 1, currencyCode: "USD", timeZone: "America/New_York" }] });
  await assert.rejects(listOwnSpaces(client, ""));
});
