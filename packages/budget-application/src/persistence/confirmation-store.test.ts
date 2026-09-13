import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import type { DataAccessClient, Condition } from "@cobudget/data-access";
import { createOrRegenerateProposal } from "../creation-proposals/application.ts";
import { testAuthContext, testPorts, FakeClock } from "../creation-proposals/support.ts";
import type { ProposalRecord } from "../creation-proposals/ports.ts";
import { confirmBudgetCreation, confirmationRequest, ConfirmationError } from "../creation-confirmation/index.ts";
import { DurableProposalStore } from "./proposal-store.ts";
import { DurableConfirmationStore } from "./confirmation-store.ts";
import type { ConfirmationDependencies } from "./confirmation-store.ts";

type Row = Record<string, unknown>;
type State = Record<string, Row[]>;
function database() {
  let state: State = {}; let tail = Promise.resolve(); let commitFailure = false; let transient: string | undefined;
  const match = (row: Row, conditions: readonly Condition[] = []) => conditions.every(c => row[c.column] === c.value);
  const bound = (get: () => State): DataAccessClient => ({
    transaction: async (_options, work) => {
      assert.equal(_options.isolation ?? "serializable", "serializable");
      const prior = tail; let release = () => {}; tail = new Promise<void>(r => { release = r; }); await prior;
      const draft = structuredClone(state);
      try {
        const result = await work(bound(() => draft));
        if (transient) { const code = transient; transient = undefined; throw { sqlState: code }; }
        if (commitFailure) throw new Error("deferred constraint failure");
        state = draft; return result;
      } finally { release(); }
    },
    platformSelect: async q => { const rows = (get()[q.table] ?? []).filter(r => match(r, q.conditions)); return { command: "SELECT", oid: 0, fields: [], rows: structuredClone(rows), rowCount: rows.length }; },
    platformInsert: async q => { (get()[q.table] ??= []).push(structuredClone(q.values)); return { command: "SELECT", oid: 0, fields: [], rows: [], rowCount: 1 }; },
    platformUpdate: async q => { const rows = (get()[q.table] ?? []).filter(r => match(r, q.conditions)); rows.forEach(r => Object.assign(r, structuredClone(q.set))); return { command: "SELECT", oid: 0, fields: [], rows: [], rowCount: rows.length }; },
    platformDelete: async () => { throw new Error("forbidden"); },
    tenantSelect: async q => { const rows = (get()[q.table] ?? []).filter(r => r.budget_space_id === q.budgetSpaceId && match(r, q.conditions)); return { command: "SELECT", oid: 0, fields: [], rows: structuredClone(rows), rowCount: rows.length }; },
    tenantInsert: async q => { assert.ok(q.budgetSpaceId); (get()[q.table] ??= []).push({ ...structuredClone(q.values), budget_space_id: q.budgetSpaceId }); return { command: "SELECT", oid: 0, fields: [], rows: [], rowCount: 1 }; },
    tenantUpdate: async () => { throw new Error("forbidden"); }, tenantDelete: async () => { throw new Error("forbidden"); },
  });
  return { client: bound(() => state), state: () => state, failCommit: () => { commitFailure = true; }, transient: (s: string) => { transient = s; } };
}
async function fixture() {
  const db = database(); const context = testAuthContext(); const clock = new FakeClock("2026-09-15T12:00:00.000Z");
  const proposals = new DurableProposalStore(db.client, randomUUID, () => clock.now().toISOString());
  const ports = testPorts({ store: proposals, clock, constraintReader: { currentConstraintVersion: () => "cbd-231/0.1" } });
  // The proposal adapter's default isolation is serializable too.

  const created = await createOrRegenerateProposal({ subjectContext: context, idempotencyKeyHeader: "3333333333333333",
    body: { name: "Groceries", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "weekly", anchor: "monday" } } }, ports);
  assert.equal(created.kind, "created"); if (created.kind !== "created") throw new Error("fixture");
  const request = confirmationRequest(created.response.proposalId, "1111111111111111", { confirmationBinding: created.response.confirmationBinding });
  const points: string[] = []; let failAt = ""; let authorizations = 0;
  const dependencies: ConfirmationDependencies = { attempts: 3, reload: async () => ({ context, ports }),
    authorize: async () => { authorizations++; return { policyVersion: "p1", policyDigest: "a".repeat(64), inputSchemaVersion: 1, authorizationVersion: 1 }; },
    allowAudit: async client => { await client.platformInsert({ table: "test_restricted_audit", values: { outcome: "allow" } }); },
    boundary: async p => { points.push(p); if (p === failAt) throw new Error("injected:" + p); },
  };
  const store = new DurableConfirmationStore(db.client, proposals, dependencies);
  return { db, context, clock, ports, request, proposals, points, dependencies, store,
    fail: (p: string) => { failAt = p; }, authorizations: () => authorizations,
    confirm: () => confirmBudgetCreation(store, context, request),
    record: () => db.state().budget_creation_proposal![0]!.proposal_payload as ProposalRecord };
}
void test("CONF-233-T01/T02/T10 exact graph, stored replay and post-commit serialization loss", async () => {
  const f = await fixture(); const response = await f.confirm(); const snapshot = structuredClone(f.db.state());
  for (const table of ["budget_space", "budget_space_membership", "budget_space_schedule_version", "budget_creation_operation", "budget_creation_audit", "budget_creation_success", "budget_creation_idempotency", "test_restricted_audit"]) assert.equal(snapshot[table]?.length, 1, table);
  assert.equal(snapshot.budget_space_period?.length, 4);
  assert.equal(snapshot.budget_space_period?.filter(p => p.status === "active").length, 1);
  assert.equal(snapshot.budget_space![0]!.current_period_id, response.currentPeriodId);
  assert.equal(f.record().status, "confirmed");
  assert.throws(() => JSON.stringify(response, () => { throw new Error("delivery failed"); }), /delivery failed/);
  assert.equal(JSON.stringify(await f.confirm()), JSON.stringify(response));
  assert.equal(f.authorizations(), 1); assert.deepEqual(f.db.state(), snapshot);
  const audit = JSON.stringify(snapshot.budget_creation_audit);
  for (const forbidden of ["Groceries", "monday", "confirmationBinding", "sessionGeneration"]) assert.ok(!audit.includes(forbidden));
});
void test("CONF-233-T03 concurrent same/different keys converge without duplicate state", async () => {
  const f = await fixture(); const results = await Promise.all([f.confirm(), f.confirm()]); assert.deepEqual(results[0], results[1]);
  const g = await fixture(); const outcomes = await Promise.allSettled([g.confirm(), confirmBudgetCreation(g.store, g.context, { ...g.request, confirmationIdempotencyKey: "2222222222222222" })]);
  assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1); assert.equal(g.db.state().budget_space?.length, 1);
});
void test("CONF-233-T02 scoped key reuse for another proposal conflicts through the original tenant", async () => {
  const f = await fixture(); await f.confirm(); const before = structuredClone(f.db.state());
  await assert.rejects(confirmBudgetCreation(f.store, f.context, { ...f.request, proposalId: "bcp_" + "f".repeat(32) }), (e: unknown) => e instanceof ConfirmationError && e.code === "idempotency_key_reused");
  assert.deepEqual(f.db.state(), before);
});
void test("CONF-233-T04/T08 every proposal/context/version mutation denies without state", async () => {
  const mutations: ((f: Awaited<ReturnType<typeof fixture>>) => void)[] = [
    f => f.clock.advanceMs(31 * 60_000), f => f.clock.set("2026-09-16T04:00:00.000Z"),
    f => Object.assign(f.record(), { successorProposalId: "successor" }), f => Object.assign(f.record(), { draftRevision: 2 }),
    f => Object.assign(f.record(), { previewDigest: "x" }), f => Object.assign(f.record(), { status: "invalidated" }),
    ...["environment", "subjectId", "accountId", "profileId", "sessionGeneration"].map(key => (f: Awaited<ReturnType<typeof fixture>>) => Object.assign(f.record(), { [key]: "changed" })),
    ...["proposalContractVersion", "periodContractVersion", "calendarDataVersion", "timeZoneDataVersion", "currencyCatalogVersion"].map(key => (f: Awaited<ReturnType<typeof fixture>>) => Object.assign(f.record().governingVersions, { [key]: "changed" })),
    f => Object.assign(f.record(), { confirmationBinding: "changed" }),
    f => Object.assign(f.ports, { constraintReader: undefined }),
    f => Object.assign(f.ports, { constraintReader: { currentConstraintVersion: () => "changed" } }),
  ];
  for (const mutate of mutations) { const f = await fixture(); mutate(f); const before = structuredClone(f.db.state()); await assert.rejects(f.confirm()); assert.deepEqual(f.db.state(), before); }
});
void test("CONF-233-T05 commit context reload, governing data and authorization failure roll back", async () => {
  for (const field of ["subjectId", "accountId", "profileId", "sessionGeneration"] as const) {
    const f = await fixture(); const before = structuredClone(f.db.state());
    const store = new DurableConfirmationStore(f.db.client, f.proposals, { ...f.dependencies,
      reload: async () => ({ context: { ...f.context, [field]: field === "sessionGeneration" ? 2 : "changed" }, ports: f.ports }) });
    await assert.rejects(confirmBudgetCreation(store, f.context, f.request), /proposal_not_found/); assert.deepEqual(f.db.state(), before);
  }
  const f = await fixture(); const before = structuredClone(f.db.state());
  for (const dependencies of [
    { ...f.dependencies, reload: async () => { throw new ConfirmationError("unauthenticated"); } },
    { ...f.dependencies, reload: async () => ({ context: f.context, ports: { ...f.ports, timeZoneDataVersion: "new-version" } }) },
    { ...f.dependencies, authorize: async () => { throw new ConfirmationError("authorization_denied"); } },
  ]) {
    await assert.rejects(confirmBudgetCreation(new DurableConfirmationStore(f.db.client, f.proposals, dependencies), f.context, f.request));
    assert.deepEqual(f.db.state(), before);
  }
});
void test("CONF-233-T06/T07 every observed write boundary and deferred constraint failure roll back", async () => {
  const baseline = await fixture(); await baseline.confirm();
  for (const point of baseline.points) {
    const f = await fixture(); const before = structuredClone(f.db.state()); f.fail(point);
    await assert.rejects(f.confirm(), /injected/); assert.deepEqual(f.db.state(), before, point);
  }
  const f = await fixture(); const before = structuredClone(f.db.state()); f.db.failCommit(); await assert.rejects(f.confirm(), /deferred/); assert.deepEqual(f.db.state(), before);
});
void test("CONF-233-T09 request and closed transaction reject optional setup", async () => {
  for (const name of ["categories", "targets", "bills", "goals", "transactions", "memberships", "accountLinks", "subjectId", "budgetSpaceId", "preview", "governingVersions"]) {
    assert.throws(() => confirmationRequest("bcp_" + "a".repeat(32), "1111111111111111", { confirmationBinding: "binding", [name]: [] }), /invalid_request/);
  }
  const f = await fixture(); await f.confirm();
  assert.deepEqual(Object.keys(f.db.state()).sort(), ["budget_creation_proposal", "budget_space", "budget_space_membership", "budget_space_schedule_version", "budget_space_period", "budget_creation_operation", "budget_creation_audit", "budget_creation_success", "budget_creation_idempotency", "test_restricted_audit"].sort());
});
void test("23505/40001/40P01 retry the whole operation, rereading authority", async () => {
  for (const state of ["23505", "40001", "40P01"]) { const f = await fixture(); f.db.transient(state); await f.confirm(); assert.equal(f.authorizations(), 2); assert.equal(f.db.state().budget_space?.length, 1); }
});

void test("CONF-233-T10 committed outcome load failure is recovered by same-key retry", async () => {
  const f = await fixture();
  await assert.rejects(confirmBudgetCreation({ confirm: work => f.store.confirm(work), loadCommitted: async () => { throw new Error("response read failed"); } }, f.context, f.request), /response read failed/);
  const before = structuredClone(f.db.state()); const response = await f.confirm();
  assert.equal(response.confirmationOutcomeId, before.budget_creation_success![0]!.success_id);
  assert.deepEqual(f.db.state(), before); assert.equal(f.authorizations(), 1);
});
