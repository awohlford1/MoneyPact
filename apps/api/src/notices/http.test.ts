/**
 * PK8-F01 route tests through the real Fastify instance, the real
 * `ApiAuthorizationBoundary`, the real fact assembler and the released policy
 * (CBD-236 p6: the dedicated `notice.read` / `notice.mark_read` subject-self
 * cells, docs/cbd-236-p6-subject-self-amendment-proposal.md `P6-E04`), over
 * an in-memory notice store wrapped in a snapshot transaction so commit and
 * rollback are observable.
 *
 *   NOTICES-01  GET /v1/notices answers the caller's own rows only, newest
 *               first, with `read_at`, in the `WireNotice` shape and nothing
 *               else; a subject with no rows reads an empty list.
 *   NOTICES-02  POST /v1/notices/{id}/read stamps one of the caller's own rows
 *               once and commits; a repeat answers the stamped row without
 *               writing; another person's identifier, an unknown one and a
 *               malformed one answer the same `404 notice_not_found` with
 *               nothing written; no session is the uniform denial.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { CURRENT_POLICY_VERSION, expectedProvenance } from "@cobudget/contracts/authorization";
import type { PolicyInput } from "@cobudget/contracts/authorization";
import { apiIdentity, invocation } from "../../../../packages/rate-limit/src/index.ts";
import { subjectFixture } from "../../../../packages/contracts/src/authorization/fixtures/index.ts";
import type { AccountLifecycleNoticeRow } from "../../../../packages/data-access/src/account-lifecycle-notice.ts";
import { AppModule } from "../app.module.js";
import { Harness, testHistory } from "../authorization/test-support.js";
import { loadApiConfigFrom } from "../config.js";
import { NOTICES_MARK_READ_ACTION, NOTICES_READ_ACTION, noticesHttp } from "./http.ts";
import type { NoticesHttpDependencies } from "./http.ts";

const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "notices-test", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });
const ROUTES = ["/v1/notices", "/v1/notices/:noticeId/read"];
const ALICE = "subject-alice";
const BOB = "subject-bob";
const SPACE = "11111111-1111-4111-8111-111111111111";
const N1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const N2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const N3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const NOW = "2026-09-15T18:00:00.000Z";

function subjectInput(accountSubjectId: string, action: string = NOTICES_READ_ACTION): PolicyInput {
  const base = subjectFixture(action, CURRENT_POLICY_VERSION);
  const input = { ...base, subject: { ...base.subject, accountSubjectId } };
  return { ...input, provenance: expectedProvenance(input as PolicyInput) } as PolicyInput;
}

function row(notice_id: string, account_subject_id: string, created_at: string, message_code = "MSG-73-040", budget_space_id: string | null = SPACE): AccountLifecycleNoticeRow {
  return { notice_id, account_subject_id, budget_space_id, message_code, event_correlation_id: "c-1", created_at, read_at: null };
}

async function application() {
  const rows = new Map<string, AccountLifecycleNoticeRow>([
    [N1, row(N1, ALICE, "2026-09-15T10:00:00.000Z", "MSG-73-050")],
    [N2, row(N2, ALICE, "2026-09-15T12:00:00.000Z")],
    [N3, row(N3, BOB, "2026-09-15T11:00:00.000Z", "MSG-73-015", null)],
  ]);
  const statements = { reads: 0, writes: 0 };
  const dependencies: NoticesHttpDependencies = {
    now: () => new Date(NOW),
    within: () => ({
      list: async (subject) => { statements.reads++; return [...rows.values()].filter((r) => r.account_subject_id === subject); },
      read: async (subject, noticeId) => { statements.reads++; const found = rows.get(noticeId); return found && found.account_subject_id === subject ? found : null; },
      markRead: async (subject, noticeId, at) => {
        statements.writes++;
        const found = rows.get(noticeId);
        if (!found || found.account_subject_id !== subject) return 0;
        // The PK-2 trigger: read_at is set-once.
        if (found.read_at !== null) throw new Error("account_lifecycle_notice is write-once; only read_at may change");
        rows.set(noticeId, { ...found, read_at: at });
        return 1;
      },
    }),
  };
  const h = new Harness(subjectInput(ALICE));
  // The general store's obligation handling: `bind_cache_key` (notice.read) names caching dimensions, nothing to write;
  // `recheck_at_commit` (notice.mark_read, CBD-236 p6) is discharged by the boundary itself (boundary.ts), never routed
  // to the store's own discharge, but the store's verify() still sees the full obligation list and must accept it.
  h.store.discharge = async (_transaction, _input, obligation) => obligation.kind === "bind_cache_key";
  h.store.verify = async (_transaction, _input, obligations) => obligations.every((obligation) => obligation.kind === "audit" || obligation.kind === "bind_cache_key" || obligation.kind === "recheck_at_commit");
  // A snapshot transaction over the in-memory rows: kept on return, discarded on throw.
  const harnessTransaction = h.store.transaction.bind(h.store);
  h.store.transaction = async (work) => {
    const snapshot = new Map(rows);
    try { return await harnessTransaction(work); }
    catch (error) { rows.clear(); for (const [k, v] of snapshot) rows.set(k, v); throw error; }
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config, () => undefined, {
      modules: [noticesHttp(dependencies).module],
      boundary: h.boundary, surfaceApproved: async () => true, csrf: async () => true,
      rateLimit: {
        evidence: (request) => invocation(apiIdentity(request.method, request.routeOptions.url!), "api_route", "test-only", "test-only"),
        enforce: async (request) => ROUTES.includes(request.routeOptions.url!) ? { outcome: "allow", provenance: "test-only", release: async () => undefined } : { outcome: "deny_unregistered" },
      },
      sessionLocator: (request) => request.headers.cookie,
      deny: (response) => { throw new HttpException(response, 403); },
    }, testHistory)],
  }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  let subject = ALICE;
  const as = (nextSubject: string) => { subject = nextSubject; };
  const call = (method: "GET" | "POST", url: string) => {
    h.input = subjectInput(subject, method === "POST" ? NOTICES_MARK_READ_ACTION : NOTICES_READ_ACTION);
    return app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}), headers: { cookie: "opaque" } });
  };
  return { app, h, rows, statements, as, call };
}

describe("PK8-F01 subject-self notices routes through the real Fastify instance", () => {
  it("NOTICES-01: the list answers the caller's own rows only, newest first, in the WireNotice shape; another subject sees only theirs; a subject with none reads an empty list", async () => {
    const { app, as, call, h } = await application();
    try {
      const listed = await call("GET", "/v1/notices");
      assert.equal(listed.statusCode, 200, listed.body);
      assert.deepEqual(listed.json(), { notices: [
        { noticeId: N2, budgetSpaceId: SPACE, messageCode: "MSG-73-040", createdAt: "2026-09-15T12:00:00.000Z", readAt: null },
        { noticeId: N1, budgetSpaceId: SPACE, messageCode: "MSG-73-050", createdAt: "2026-09-15T10:00:00.000Z", readAt: null },
      ] });
      assert.ok(!listed.body.includes("correlation") && !listed.body.includes(BOB), "the correlation id and other people's rows never reach the wire");
      assert.ok(h.order.includes("commit"));
      as(BOB);
      const bobs = await call("GET", "/v1/notices");
      assert.equal(bobs.statusCode, 200, bobs.body);
      assert.deepEqual(bobs.json().notices.map((n: { noticeId: string; budgetSpaceId: string | null }) => [n.noticeId, n.budgetSpaceId]), [[N3, null]]);
      as("subject-nobody");
      const empty = await call("GET", "/v1/notices");
      assert.equal(empty.statusCode, 200); assert.deepEqual(empty.json(), { notices: [] });
      // No session: the uniform denial before any statement.
      const noSession = await app.inject({ method: "GET", url: "/v1/notices" });
      assert.equal(noSession.statusCode, 403);
    } finally { await app.close(); }
  });

  it("NOTICES-02: mark-read stamps one own row once and commits; a repeat answers the row without writing; another person's, an unknown and a malformed id are the same 404 with nothing written", async () => {
    const { app, as, call, rows, statements } = await application();
    try {
      const stamped = await call("POST", `/v1/notices/${N1}/read`);
      assert.equal(stamped.statusCode, 200, stamped.body);
      assert.deepEqual(stamped.json(), { notice: { noticeId: N1, budgetSpaceId: SPACE, messageCode: "MSG-73-050", createdAt: "2026-09-15T10:00:00.000Z", readAt: NOW } });
      assert.equal(rows.get(N1)?.read_at, NOW, "committed");
      assert.equal(statements.writes, 1);
      // The list now carries the stamp.
      const listed = await call("GET", "/v1/notices");
      assert.equal(listed.json().notices.find((n: { noticeId: string }) => n.noticeId === N1).readAt, NOW);
      // A repeat is idempotent: the stamped row, no second write (the trigger would raise on one).
      const repeat = await call("POST", `/v1/notices/${N1}/read`);
      assert.equal(repeat.statusCode, 200, repeat.body);
      assert.equal(repeat.json().notice.readAt, NOW);
      assert.equal(statements.writes, 1, "nothing written by the repeat");
      // Bob's row by identifier, an unknown identifier and a malformed one: one answer, nothing written.
      const before = JSON.stringify([...rows.values()]);
      for (const id of [N3, "00000000-0000-4000-8000-00000000ffff", "not-a-notice", SPACE]) {
        const miss = await call("POST", `/v1/notices/${id}/read`);
        assert.equal(miss.statusCode, 404, `${id}: ${miss.body}`);
        assert.deepEqual(miss.json(), { error: "notice_not_found" });
      }
      assert.equal(JSON.stringify([...rows.values()]), before);
      assert.equal(statements.writes, 1);
      assert.equal(rows.get(N3)?.read_at, null, "Bob's row is untouched by Alice");
      // Bob stamps his own.
      as(BOB);
      const bobs = await call("POST", `/v1/notices/${N3}/read`);
      assert.equal(bobs.statusCode, 200, bobs.body);
      assert.equal(bobs.json().notice.noticeId, N3);
      // And cannot stamp Alice's unread one.
      assert.equal((await call("POST", `/v1/notices/${N2}/read`)).statusCode, 404);
      assert.equal(rows.get(N2)?.read_at, null);
      const noSession = await app.inject({ method: "POST", url: `/v1/notices/${N2}/read`, payload: {} });
      assert.equal(noSession.statusCode, 403);
    } finally { await app.close(); }
  });
});
