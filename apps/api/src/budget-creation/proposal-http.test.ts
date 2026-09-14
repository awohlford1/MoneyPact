/**
 * PROTO-ACTIVATION-001 A5 (review R05): regeneration is authorized under its own released cell.
 * `POST /v1/budget-creation-proposals` with `supersedesProposalId` is dispatched as
 * `proposal.regenerate` with the predecessor as the subject-owned target row -- loaded by the
 * datastore for the acting subject, its lifecycle revision captured at precheck and rechecked at
 * commit -- and audited as such; without the field it stays `proposal.create`. A predecessor owned
 * by another subject, an absent row and a stale revision all deny before the handler runs; a
 * malformed locator (PROTO-QA-FIXES-001 F2) names no row and is reported by the canonical validation.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { ApiSubjectScopedUserPolicyInput } from "@cobudget/contracts/authorization";
import { subjectFixture } from "../../../../packages/contracts/src/authorization/fixtures/index.ts";
import { invocation } from "../../../../packages/rate-limit/src/index.ts";
import { AppModule } from "../app.module.js";
import { loadApiConfigFrom } from "../config.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { proposalHttp } from "./proposal-http.ts";
import { testPorts } from "../../../../packages/budget-application/src/creation-proposals/support.ts";

const PREDECESSOR = "bcp_" + "b".repeat(32);
const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "proposal-route-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });

function regenerateFixture(): ApiSubjectScopedUserPolicyInput {
  const fixture = subjectFixture("proposal.regenerate");
  return { ...fixture, resource: { ...fixture.resource!, id: PREDECESSOR } };
}

async function application(h: Harness) {
  const module = await Test.createTestingModule({ imports: [AppModule.register(config, () => undefined, {
    modules: [proposalHttp({
      context: async (_request, subject) => ({ environment: "env-local-1", subjectId: subject, accountId: subject, profileId: "profile-1", sessionGeneration: 1 }),
      ports: async () => testPorts(),
    })],
    boundary: h.boundary, surfaceApproved: async () => true, csrf: async () => true, sessionLocator: (request) => request.headers.cookie,
    deny: (response) => { throw new HttpException(response, 403); },
    rateLimit: { evidence: () => invocation("api:POST:/v1/budget-creation-proposals", "api_route", "test-only", "test-only"), enforce: async () => ({ outcome: "allow", provenance: "test-only", release: async () => undefined }) },
  }, testHistory)] }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  const post = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/budget-creation-proposals", headers: { cookie: "opaque", "idempotency-key": "1111111111111111" }, payload: body });
  return { app, post };
}

describe("PROTO-ACTIVATION-001 A5: server-selected regenerate action", () => {
  it("without supersedesProposalId the route is proposal.create (subject-self) and reaches the handler", async () => {
    const h = new Harness(subjectFixture("proposal.create"));
    const { app, post } = await application(h);
    try {
      const response = await post({ name: "Plan", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(h.state.audits.find((event) => event.outcome === "allow")?.actionCode, "proposal.create");
      assert.deepEqual(h.order, ["begin", "allow-audit", "commit"]);
    } finally { await app.close(); }
  });

  it("with supersedesProposalId the route is proposal.regenerate against the predecessor row: audited as regenerate, the predecessor's revision captured", async () => {
    const h = new Harness(regenerateFixture());
    const { app, post } = await application(h);
    try {
      const response = await post({ name: "Plan", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } }, supersedesProposalId: PREDECESSOR });
      // The policy allowed regeneration against the predecessor row; the application then finds no such draft in its own (empty) store.
      assert.equal(response.statusCode, 404, response.body);
      const allow = h.state.audits.find((event) => event.outcome === "allow");
      assert.equal(allow?.actionCode, "proposal.regenerate");
      assert.equal(JSON.parse(allow?.cellRef as string).action, "proposal.regenerate");
      assert.equal((allow?.capturedVersions as { targetVersion?: number })?.targetVersion, 1, "the predecessor's lifecycle revision is in the captured set");
      assert.ok(h.reads.some((read) => read.source === "datastore" && read.transaction), "the target row was re-read inside the transaction");
    } finally { await app.close(); }
  });

  it("a predecessor owned by another subject denies (scope_mismatch) before the handler", async () => {
    const h = new Harness(regenerateFixture());
    (h.input as ApiSubjectScopedUserPolicyInput).resource!.owningSubjectId = "subject-2";
    const { app, post } = await application(h);
    try {
      const response = await post({ name: "Plan", supersedesProposalId: PREDECESSOR });
      assert.equal(response.statusCode, 403); assert.deepEqual(response.json(), { outcome: "deny", reason: "denied" });
      assert.equal(h.state.audits.at(-1)?.reasonClass, "scope_mismatch");
      assert.deepEqual(h.order, ["deny-audit"], "no transaction was opened");
    } finally { await app.close(); }
  });

  it("an absent predecessor row (not this subject's, or unknown) denies input_invalid without an identifier-only lookup", async () => {
    const h = new Harness(regenerateFixture());
    h.corrupt = (source, facts) => { if (source === "datastore") for (const key of Object.keys(facts)) if (key.startsWith("resource.")) delete facts[key]; };
    const { app, post } = await application(h);
    try {
      const response = await post({ name: "Plan", supersedesProposalId: PREDECESSOR });
      assert.equal(response.statusCode, 403);
      // The assembler refused the input before evaluation: recorded as an authorization-gate denial with no policy evaluation.
      const denial = h.state.audits.at(-1) as { outcome?: string; enforcement?: { earliest_decisive_gate: string; authorization_evaluation: string } } | undefined;
      assert.equal(denial?.outcome, "deny");
      assert.equal(denial?.enforcement?.earliest_decisive_gate, "authorization");
      assert.equal(denial?.enforcement?.authorization_evaluation, "not_run");
      assert.deepEqual(h.order, ["deny-audit"]);
    } finally { await app.close(); }
  });

  it("a predecessor whose lifecycle revision changed between precheck and commit denies stale_version inside the transaction, before the handler", async () => {
    const h = new Harness(regenerateFixture());
    const transaction = h.store.transaction.bind(h.store);
    h.store.transaction = async <T>(work: (transaction: unknown) => Promise<T>): Promise<T> => {
      (h.input as ApiSubjectScopedUserPolicyInput).resource!.version = 2; // a concurrent regeneration advanced the predecessor
      return transaction(work);
    };
    const { app, post } = await application(h);
    try {
      const response = await post({ name: "Plan", supersedesProposalId: PREDECESSOR });
      assert.equal(response.statusCode, 403);
      assert.equal(h.state.audits.at(-1)?.reasonClass, "stale_version");
      assert.deepEqual(h.order, ["begin", "rollback", "deny-audit"]);
    } finally { await app.close(); }
  });

  it("PROTO-QA-FIXES-001 F2: a malformed predecessor locator is not a target row; it selects proposal.create and the canonical field error is returned with every other field error preserved in section 5.1 order", async () => {
    const h = new Harness(subjectFixture("proposal.create"));
    const { app, post } = await application(h);
    try {
      const alone = await post({ name: "Plan", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } }, supersedesProposalId: "not-a-proposal" });
      assert.equal(alone.statusCode, 400, alone.body);
      assert.deepEqual(alone.json().fieldErrors.map((e: { path: string; code: string }) => [e.path, e.code]), [["supersedesProposalId", "supersedes-proposal-id.invalid"]]);
      assert.equal(h.state.audits.find((event) => event.outcome === "allow")?.actionCode, "proposal.create", "no target row was named: the request is the subject-self create action");
      const together = await post({ name: "", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } }, supersedesProposalId: "not-a-proposal" });
      assert.equal(together.statusCode, 400, together.body);
      assert.deepEqual(together.json().fieldErrors.map((e: { path: string; code: string }) => [e.path, e.code]), [["name", "name.required"], ["supersedesProposalId", "supersedes-proposal-id.invalid"]], "the other field error is preserved, in catalog order");
      const wrongType = await post({ name: "Plan", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } }, supersedesProposalId: 7 });
      assert.equal(wrongType.statusCode, 400, wrongType.body);
      assert.deepEqual(wrongType.json().fieldErrors.map((e: { code: string }) => e.code), ["supersedes-proposal-id.expected-string"]);
      assert.ok(!h.state.audits.some((event) => event.actionCode === "proposal.regenerate"), "a malformed locator never reaches the regenerate cell");
    } finally { await app.close(); }
  });

  it("PROTO-QA-FIXES-001 F2: a well-formed but unknown predecessor keeps the uniform 404 (the datastore finds no such row for the subject)", async () => {
    const h = new Harness(regenerateFixture());
    const { app, post } = await application(h);
    try {
      const response = await post({ name: "Plan", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } }, supersedesProposalId: PREDECESSOR });
      assert.equal(response.statusCode, 404, response.body); assert.deepEqual(response.json(), { error: "proposal_not_found" });
      assert.equal(h.state.audits.find((event) => event.outcome === "allow")?.actionCode, "proposal.regenerate");
    } finally { await app.close(); }
  });
});
