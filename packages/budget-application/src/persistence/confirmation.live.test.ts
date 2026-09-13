import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { bindClient } from "../../../data-access/src/binding.ts";
import { PRODUCTION_TABLE_CATALOG } from "../../../data-access/src/catalog.ts";
import { createOrRegenerateProposal } from "../creation-proposals/application.ts";
import { testAuthContext, testPorts, FakeClock } from "../creation-proposals/support.ts";
import { confirmationRequest, confirmBudgetCreation } from "../creation-confirmation/index.ts";
import { DurableProposalStore } from "./proposal-store.ts";
import { DurableConfirmationStore } from "./confirmation-store.ts";

// Exactly the opt-in condition in data-access/src/transaction.live.test.ts.
// Manager provisions/migrates the scratch database; this test never resets it.
const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev";
void test("CONF-233 live PostgreSQL graph, concurrent convergence, replay, rollback and deferred constraints", { skip: !configured }, async () => {
  const { createMigrationConnection, createApiConnection } = await import("../../../data-access/src/connection.ts");
  const admin = createMigrationConnection(); const api = createApiConnection();
  const auditTable = "cbd233_audit_" + randomUUID().replaceAll("-", "");
  try {
    await admin.query('CREATE TABLE ' + auditTable + ' (operation_id uuid PRIMARY KEY, outcome text NOT NULL)');
    await admin.query('GRANT SELECT, INSERT ON ' + auditTable + ' TO cobudget_api');
    const client = bindClient(api, true, { ...PRODUCTION_TABLE_CATALOG, [auditTable]: "identity" });
    async function fixture(failure?: string) {
      const context = testAuthContext({ subjectId: randomUUID(), accountId: randomUUID(), profileId: randomUUID() });
      const connection = await admin.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [context.subjectId]);
        await connection.query("INSERT INTO financial_profile (profile_id, account_subject_id, profile_state) VALUES ($1,$2,'active')", [context.profileId, context.subjectId]);
        await connection.query("COMMIT");
      } catch (error) { await connection.query("ROLLBACK"); throw error; } finally { connection.release(); }
      const clock = new FakeClock("2026-09-15T12:00:00.000Z");
      const proposals = new DurableProposalStore(client, randomUUID, () => clock.now().toISOString());
      const ports = testPorts({ store: proposals, clock, idGenerator: { proposalId: () => "bcp_" + randomUUID().replaceAll("-", "") }, constraintReader: { currentConstraintVersion: () => "cbd-231/0.1" } });
      const proposal = await createOrRegenerateProposal({ subjectContext: context, idempotencyKeyHeader: randomUUID(), body: {
        name: "Live fixture", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "weekly", anchor: "monday" } } }, ports);
      assert.equal(proposal.kind, "created"); if (proposal.kind !== "created") throw new Error("fixture");
      const request = confirmationRequest(proposal.response.proposalId, randomUUID(), { confirmationBinding: proposal.response.confirmationBinding });
      const located = await proposals.locate({ ...context, proposalId: request.proposalId }); assert.ok(located);
      const store = new DurableConfirmationStore(client, proposals, { attempts: 5, reload: async () => ({ context, ports }),
        authorize: async () => ({ policyVersion: "p1", policyDigest: "a".repeat(64), inputSchemaVersion: 1, authorizationVersion: 1 }),
        allowAudit: async (tx, plan) => { await tx.platformInsert({ table: auditTable, values: { operation_id: plan.operationId, outcome: "allow" } }); },
        boundary: async point => {
          if (point === failure) throw new Error("injected rollback");
        } });
      return { context, request, store, budgetSpaceId: located.candidateBudgetSpaceId, confirm: () => confirmBudgetCreation(store, context, request) };
    }
    const same = await fixture(); const [a, b] = await Promise.all([same.confirm(), same.confirm()]); assert.deepEqual(a, b);
    assert.equal(JSON.stringify(await same.confirm()), JSON.stringify(a));
    for (const table of ["budget_space", "budget_space_membership", "budget_space_schedule_version", "budget_creation_operation", "budget_creation_audit", "budget_creation_success", "budget_creation_idempotency"]) {
      assert.equal((await client.tenantSelect({ table, budgetSpaceId: a.budgetSpaceId })).rowCount, 1, table);
    }
    assert.equal((await client.tenantSelect({ table: "budget_space_period", budgetSpaceId: a.budgetSpaceId })).rowCount, 4);
    const different = await fixture();
    const outcomes = await Promise.allSettled([different.confirm(), confirmBudgetCreation(different.store, different.context, { ...different.request, confirmationIdempotencyKey: randomUUID() })]);
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
    for (const failure of ["after:budget_space", "after:budget_space_membership", "after:budget_space_schedule_version", "after:period:3", "after:allow_audit", "after:budget_creation_audit", "after:budget_creation_success", "after:budget_creation_idempotency", "after:proposal_confirmed", "before:commit"]) {
      const f = await fixture(failure); await assert.rejects(f.confirm(), /injected rollback/);
      for (const table of ["budget_space", "budget_space_membership", "budget_space_schedule_version", "budget_space_period", "budget_creation_operation", "budget_creation_audit", "budget_creation_success", "budget_creation_idempotency"]) assert.equal((await client.tenantSelect({ table, budgetSpaceId: f.budgetSpaceId })).rowCount, 0);
    }
    // Real deferred graph constraints remain the final guard, not the fake's mutex.
    await assert.rejects(client.transaction({ isolation: "serializable" }, async tx => {
      await tx.tenantInsert({ table: "budget_space_membership", budgetSpaceId: randomUUID(), values: {
        membership_id: randomUUID(), account_subject_id: same.context.subjectId, profile_id: same.context.profileId,
        created_by_subject_id: same.context.subjectId, role: "primary_owner", status: "active" } });
    }), (e: unknown) => (e as { sqlState?: string }).sqlState === "23503");
  } finally {
    await api.end();
    await admin.query('DROP TABLE IF EXISTS ' + auditTable);
    await admin.end();
  }
});
