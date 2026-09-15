import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import type { DataAccessClient } from "@cobudget/data-access";
import { bindClient } from "../../../data-access/src/binding.ts";
import { PRODUCTION_TABLE_CATALOG } from "../../../data-access/src/catalog.ts";
import { createOrRegenerateProposal } from "../creation-proposals/application.ts";
import { testAuthContext, testDisclosures, testPorts, FakeClock } from "../creation-proposals/support.ts";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../creation-confirmation/disclosure.ts";
import { consentDependency } from "./consent-store.ts";
import { confirmationRequest, confirmBudgetCreation } from "../creation-confirmation/index.ts";
import { DurableProposalStore } from "./proposal-store.ts";
import { DurableConfirmationStore } from "./confirmation-store.ts";

/**
 * CBD233-STALE-CHECK-ORDER-001: a write counter over the CBD-246 statement seam.
 *
 * Every statement the confirmation can write goes through one of these methods, so recording them
 * here is the transaction's own write log. The residue queries at the end of a rolled-back
 * transaction cannot tell a denial that wrote two rows and rolled them back from one that wrote
 * no row at all; this can. `transaction` re-wraps the scoped client the callback receives, so the
 * statements issued inside the serializable transaction are counted, not only those outside it.
 */
function countingClient(client: DataAccessClient, log: string[]): DataAccessClient {
  return {
    ...client,
    transaction: (options, work) => client.transaction(options, scoped => work(countingClient(scoped, log))),
    tenantInsert: query => { log.push("tenantInsert " + query.table); return client.tenantInsert(query); },
    tenantUpdate: query => { log.push("tenantUpdate " + query.table); return client.tenantUpdate(query); },
    tenantDelete: query => { log.push("tenantDelete " + query.table); return client.tenantDelete(query); },
    platformInsert: query => { log.push("platformInsert " + query.table); return client.platformInsert(query); },
    platformUpdate: query => { log.push("platformUpdate " + query.table); return client.platformUpdate(query); },
    platformDelete: query => { log.push("platformDelete " + query.table); return client.platformDelete(query); },
  };
}

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
    const disclosures = testDisclosures();
    const disclosure = disclosures.current(PRIMARY_OWNER_SELF_DISCLOSURE);
    /** `acknowledged` defaults to the registry's current claim; `null` deliberately sends none. */
    async function fixture(failure?: string, acknowledged: { kind: string; version: number } | null | undefined = undefined, skipConsent = false) {
      const context = testAuthContext({ subjectId: randomUUID(), accountId: randomUUID(), profileId: randomUUID() });
      const connection = await admin.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [context.subjectId]);
        await connection.query("INSERT INTO financial_profile (profile_id, account_subject_id, profile_state) VALUES ($1,$2,'active')", [context.profileId, context.subjectId]);
        await connection.query("COMMIT");
      } catch (error) { await connection.query("ROLLBACK"); throw error; } finally { connection.release(); }
      const clock = new FakeClock("2026-09-15T12:00:00.000Z");
      // Everything the confirmation does runs through the counted client; the residue assertions read
      // through the raw one, so a residue query never disturbs the write log.
      const writes: string[] = []; const points: string[] = [];
      const counted = countingClient(client, writes);
      const proposals = new DurableProposalStore(counted, randomUUID, () => clock.now().toISOString());
      const ports = testPorts({ store: proposals, clock, idGenerator: { proposalId: () => "bcp_" + randomUUID().replaceAll("-", "") }, constraintReader: { currentConstraintVersion: () => "cbd-231/0.1" } });
      const proposal = await createOrRegenerateProposal({ subjectContext: context, idempotencyKeyHeader: randomUUID(), body: {
        name: "Live fixture", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "weekly", anchor: "monday" } } }, ports);
      assert.equal(proposal.kind, "created"); if (proposal.kind !== "created") throw new Error("fixture");
      const acknowledgedDisclosure = acknowledged === undefined ? { kind: PRIMARY_OWNER_SELF_DISCLOSURE, version: disclosure.version } : acknowledged;
      const request = confirmationRequest(proposal.response.proposalId, randomUUID(), acknowledgedDisclosure
        ? { confirmationBinding: proposal.response.confirmationBinding, acknowledgedDisclosure }
        : { confirmationBinding: proposal.response.confirmationBinding });
      const located = await proposals.locate({ ...context, proposalId: request.proposalId }); assert.ok(located);
      const store = new DurableConfirmationStore(counted, proposals, { attempts: 5, reload: async () => ({ context, ports }),
        authorize: async () => ({ policyVersion: "p1", policyDigest: "a".repeat(64), inputSchemaVersion: 1, authorizationVersion: 1 }),
        allowAudit: async (tx, plan) => { await tx.platformInsert({ table: auditTable, values: { operation_id: plan.operationId, outcome: "allow" } }); },
        // The production consent dependency (CBD-236 SS7; CBD233-STALE-CHECK-ORDER-001): phase 1
        // compares the claim before the first insert, phase 2 writes the creator's row on this same
        // client immediately after the creator membership.
        consent: skipConsent ? () => async () => undefined : consentDependency(disclosures, randomUUID),
        boundary: async point => {
          points.push(point);
          if (point === failure) throw new Error("injected rollback");
        } });
      return { context, request, store, budgetSpaceId: located.candidateBudgetSpaceId, membershipId: located.candidatePrimaryMembershipId,
        writes, points, reset: () => { writes.length = 0; points.length = 0; },
        confirm: () => confirmBudgetCreation(store, context, request) };
    }
    const same = await fixture(); const [a, b] = await Promise.all([same.confirm(), same.confirm()]); assert.deepEqual(a, b);
    assert.equal(JSON.stringify(await same.confirm()), JSON.stringify(a));
    for (const table of ["budget_space", "budget_space_membership", "budget_space_consent", "budget_space_schedule_version", "budget_creation_operation", "budget_creation_audit", "budget_creation_success", "budget_creation_idempotency"]) {
      assert.equal((await client.tenantSelect({ table, budgetSpaceId: a.budgetSpaceId })).rowCount, 1, table);
    }
    // CONSENT-L-01: exactly one consent row, carrying the registry's version and digest and the policy
    // tuple of the decision that authorized the write -- never a request value, and never the
    // membership's authorization_version.
    const consentRows = await client.tenantSelect({ table: "budget_space_consent", budgetSpaceId: a.budgetSpaceId });
    const row = consentRows.rows[0] as Record<string, unknown>;
    assert.equal(row.membership_id, a.primaryOwnerMembershipId);
    assert.equal(row.account_subject_id, same.context.subjectId);
    assert.equal(row.recorded_by_subject_id, same.context.subjectId);
    assert.equal(row.role, "primary_owner");
    assert.equal(row.resource_scope, "full");
    assert.equal(row.source, "self_disclosure");
    assert.equal(row.state, "current");
    assert.equal(row.assurance_ref, null);
    assert.equal(row.disclosure_kind, PRIMARY_OWNER_SELF_DISCLOSURE);
    assert.equal(Number(row.disclosure_version), disclosure.version);
    assert.equal(row.disclosure_digest, disclosure.digest);
    assert.equal(row.policy_version, a.authorization.policyVersion);
    assert.equal(row.policy_digest, a.authorization.policyDigest);
    assert.ok(Number(row.source_record_version) >= 1);
    // Evidence is write-once except the state transition, and no application role can delete it.
    await assert.rejects(client.transaction({ isolation: "serializable" }, tx => tx.tenantUpdate({ table: "budget_space_consent",
      budgetSpaceId: a.budgetSpaceId, set: { disclosure_version: 99 }, conditions: [{ column: "consent_id", value: row.consent_id }] })),
      (e: unknown) => (e as { sqlState?: string }).sqlState === "23514");
    await assert.rejects(client.transaction({ isolation: "serializable" }, tx => tx.tenantDelete({ table: "budget_space_consent",
      budgetSpaceId: a.budgetSpaceId, conditions: [{ column: "consent_id", value: row.consent_id }] })),
      (e: unknown) => typeof (e as { sqlState?: string }).sqlState === "string");

    // CONSENT-L-04 (CBD233-STALE-CHECK-ORDER-001): a stale, foreign or absent acknowledgement is
    // denied `stale_disclosure` ahead of the transaction's first insert. Zero rows at the end proves
    // only that the rollback worked; the write log proves there was nothing to roll back. The whole
    // log is pinned, not just its INSERTs: the one statement a denied confirmation still issues is
    // the conditional no-op UPDATE that claims the proposal row lock, which every denial of this
    // contract performs and which writes no creation row. The boundary log shows how far the
    // transaction got -- the claim, reload and authorization decisions, then the disclosure check,
    // and nothing after it.
    for (const claim of [{ kind: PRIMARY_OWNER_SELF_DISCLOSURE, version: disclosure.version + 1 }, { kind: "invitation", version: disclosure.version }, null]) {
      const label = JSON.stringify(claim ?? null);
      const stale = await fixture(undefined, claim);
      stale.reset();
      await assert.rejects(stale.confirm(), (error: unknown) => (error as { code?: string }).code === "stale_disclosure", label);
      assert.deepEqual(stale.writes, ["platformUpdate budget_creation_proposal"], "a " + label + " claim wrote " + JSON.stringify(stale.writes));
      assert.deepEqual(stale.points, ["before:proposal_claim", "after:proposal_claim", "before:dependency_reload", "after:dependency_reload",
        "before:authorization", "after:authorization", "before:disclosure_check"], "boundary log after " + label);
      for (const table of ["budget_space", "budget_space_membership", "budget_space_consent", "budget_creation_idempotency"]) {
        assert.equal((await client.tenantSelect({ table, budgetSpaceId: stale.budgetSpaceId })).rowCount, 0, table + " after " + label);
      }
    }
    // The other half of the ordering: a valid claim is compared before the first insert too, and its
    // consent row is still written immediately after the creator membership in the one transaction.
    const ordered = await fixture(); ordered.reset();
    await ordered.confirm();
    const inserted = ordered.writes.filter(statement => statement.startsWith("tenantInsert") || statement.startsWith("platformInsert"));
    assert.ok(ordered.points.indexOf("after:disclosure_check") < ordered.points.indexOf("before:budget_space"), "the comparison precedes the first insert");
    assert.equal(ordered.points[ordered.points.indexOf("after:disclosure_check") + 1], "before:budget_space");
    assert.deepEqual(inserted.slice(0, 3), ["tenantInsert budget_space", "tenantInsert budget_space_membership", "tenantInsert budget_space_consent"]);
    assert.equal(ordered.points[ordered.points.indexOf("after:budget_space_membership") + 1], "before:budget_space_consent");
    for (const table of ["budget_space", "budget_space_membership", "budget_space_consent"]) {
      assert.equal((await client.tenantSelect({ table, budgetSpaceId: ordered.budgetSpaceId })).rowCount, 1, table + " after a valid claim");
    }

    // A membership may not activate without its consent row. The whole confirmation runs unchanged
    // except that the consent write is skipped: the migration's deferred activation-atomicity trigger
    // refuses the transaction at COMMIT, so a handler that dropped the consent write could not ship a
    // membership without evidence even if every application-side check were removed.
    const orphan = await fixture(undefined, undefined, true);
    await assert.rejects(orphan.confirm(), (e: unknown) => /commit/u.test((e as Error).message));
    for (const table of ["budget_space", "budget_space_membership", "budget_space_consent"]) {
      assert.equal((await client.tenantSelect({ table, budgetSpaceId: orphan.budgetSpaceId })).rowCount, 0, table + " after a membership with no consent");
    }
    assert.equal((await client.tenantSelect({ table: "budget_space_period", budgetSpaceId: a.budgetSpaceId })).rowCount, 4);
    const different = await fixture();
    const outcomes = await Promise.allSettled([different.confirm(), confirmBudgetCreation(different.store, different.context, { ...different.request, confirmationIdempotencyKey: randomUUID() })]);
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
    for (const failure of ["after:budget_space", "after:budget_space_membership", "after:budget_space_consent", "after:budget_space_schedule_version", "after:period:3", "after:allow_audit", "after:budget_creation_audit", "after:budget_creation_success", "after:budget_creation_idempotency", "after:proposal_confirmed", "before:commit"]) {
      const f = await fixture(failure); await assert.rejects(f.confirm(), /injected rollback/);
      for (const table of ["budget_space", "budget_space_membership", "budget_space_consent", "budget_space_schedule_version", "budget_space_period", "budget_creation_operation", "budget_creation_audit", "budget_creation_success", "budget_creation_idempotency"]) assert.equal((await client.tenantSelect({ table, budgetSpaceId: f.budgetSpaceId })).rowCount, 0);
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
