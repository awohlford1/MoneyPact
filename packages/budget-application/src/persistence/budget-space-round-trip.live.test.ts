import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { bindClient } from "../../../data-access/src/binding.ts";
import { createOrRegenerateProposal } from "../creation-proposals/application.ts";
import { testAuthContext, testDisclosures, testPorts, FakeClock } from "../creation-proposals/support.ts";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../creation-confirmation/disclosure.ts";
import { consentDependency } from "./consent-store.ts";
import { confirmationRequest, confirmBudgetCreation } from "../creation-confirmation/index.ts";
import { DurableProposalStore } from "./proposal-store.ts";
import { DurableConfirmationStore } from "./confirmation-store.ts";
import { readBudgetSpaceDetail } from "./budget-space-reader.ts";

// Manager supplies a migrated scratch database; never reset or use cobudget_dev.
void test("PROTO persisted proposal confirmation followed by current space detail on PostgreSQL", {
  skip: loadLocalDatabaseConfig().database === "cobudget_dev",
}, async () => {
  const { createMigrationConnection, createApiConnection } = await import("../../../data-access/src/connection.ts");
  const admin = createMigrationConnection(); const api = createApiConnection();
  try {
    const context = testAuthContext({ subjectId: randomUUID(), accountId: randomUUID(), profileId: randomUUID() });
    // PROTO-HARDENING-001 (PK2-F02, CL-F02): CBD190-PROFILE-ATOMIC-001's deferred
    // constraint trigger asserts at COMMIT that a subject holds exactly one active
    // financial_profile. Two pool queries are two transactions, so the subject
    // committed alone and the invariant refused it. One connection, one
    // transaction, both rows. Fixture repair only; no assertion changed.
    const seed = await admin.connect();
    try {
      await seed.query("BEGIN");
      await seed.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [context.subjectId]);
      await seed.query("INSERT INTO financial_profile (profile_id, account_subject_id, profile_state) VALUES ($1,$2,'active')", [context.profileId, context.subjectId]);
      await seed.query("COMMIT");
    } catch (error) { await seed.query("ROLLBACK"); throw error; } finally { seed.release(); }
    const client = bindClient(api, true);
    const clock = new FakeClock("2026-09-15T12:00:00.000Z");
    const proposals = new DurableProposalStore(client, randomUUID, () => clock.now().toISOString());
    const ports = testPorts({ store: proposals, clock, idGenerator: { proposalId: () => "bcp_" + randomUUID().replaceAll("-", "") }, constraintReader: { currentConstraintVersion: () => "cbd-231/0.1" } });
    const issued = await createOrRegenerateProposal({ subjectContext: context, idempotencyKeyHeader: randomUUID(), body: {
      name: "Round trip", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "weekly", anchor: "monday" },
    } }, ports);
    assert.equal(issued.kind, "created"); if (issued.kind !== "created") throw new Error("fixture failed");
    const disclosures = testDisclosures();
    const request = confirmationRequest(issued.response.proposalId, randomUUID(), { confirmationBinding: issued.response.confirmationBinding,
      acknowledgedDisclosure: { kind: PRIMARY_OWNER_SELF_DISCLOSURE, version: disclosures.current(PRIMARY_OWNER_SELF_DISCLOSURE).version } });
    const store = new DurableConfirmationStore(client, proposals, { attempts: 3, reload: async () => ({ context, ports }),
      authorize: async () => ({ policyVersion: "p1", policyDigest: "a".repeat(64), inputSchemaVersion: 1, authorizationVersion: 1 }),
      allowAudit: async () => undefined, consent: consentDependency(disclosures, randomUUID) });
    const confirmed = await confirmBudgetCreation(store, context, request);
    const detail = await readBudgetSpaceDetail(client, confirmed.budgetSpaceId, context.subjectId, confirmed.primaryOwnerMembershipId, clock);
    assert.ok(detail); assert.equal(detail.space.name, "Round trip");
    assert.equal(detail.scheduleVersion.scheduleVersionId, confirmed.currentScheduleVersionId);
    // PROTO-HARDENING-001: `activePeriod` is a StoredPeriod and carries
    // periodId, scheduleVersionId and status on top of the preview shape (see
    // budget-space-reader.ts), so the calendar is compared on the preview
    // fields and the stored identity is asserted separately. Fixture repair
    // only; the suite still proves that what was previewed is what was stored.
    const { periodId, scheduleVersionId, status, ...activeCalendar } = detail.activePeriod;
    assert.equal(scheduleVersionId, confirmed.currentScheduleVersionId);
    assert.equal(status, "active"); assert.ok(periodId);
    assert.deepEqual([activeCalendar, ...detail.nextPeriods], issued.response.preview.periods);
    assert.equal(await readBudgetSpaceDetail(client, confirmed.budgetSpaceId, randomUUID(), confirmed.primaryOwnerMembershipId, clock), null);
  } finally { await api.end(); await admin.end(); }
});
