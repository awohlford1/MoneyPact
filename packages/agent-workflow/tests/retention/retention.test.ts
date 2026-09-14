import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAssignmentArchive, evaluateDailyEventLogArchive, evaluateRawResponseDeletion,
  evaluateResolvedQuarantineArchive, evaluateSharedRecordArchive, pendingDeletionEligibility,
  type AssignmentArchiveFacts, type HoldRecord,
} from "../../src/retention/index.ts";

const now = new Date("2026-09-13T12:00:00.000Z");
const facts: AssignmentArchiveFacts = {
  target: { record_type: "assignment", record_id: "asn-1" },
  lifecycleState: "closed", closureDisposition: "completed",
  closedAt: "2026-08-01T00:00:00.000Z", relatedRecordsDiscoverable: true,
  referencesResolve: true, unresolvedExecutions: 0, unresolvedActions: 0,
  identitiesValid: true, hashesValid: true,
};

test("assignment eligibility applies the 30 day default and is scoped", () => {
  assert.deepEqual(evaluateAssignmentArchive(facts, { now }), { eligible: true, reasons: [] });
  const unrelated = { ...facts, target: { record_type: "assignment", record_id: "asn-bad" }, referencesResolve: false };
  assert.equal(evaluateAssignmentArchive(unrelated, { now }).eligible, false);
  assert.equal(evaluateAssignmentArchive(facts, { now }).eligible, true);
});

test("reopen and unknown outcomes prevent assignment archival", () => {
  const result = evaluateAssignmentArchive({
    ...facts, reopenedAt: "2026-08-02T00:00:00.000Z", unresolvedActions: 1,
  }, { now });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("assignment_reopened"));
  assert.ok(result.reasons.includes("unresolved_actions"));
});

test("holds block only their declared action and expire deterministically", () => {
  const hold: HoldRecord = {
    schema_version: "1.0", record_id: "hold-1", record_type: "hold",
    created_at: "2026-08-01T00:00:00.000Z", hold_id: "hold-1",
    targets: [facts.target], placed_by: { actor_id: "exec-1", actor_type: "executive" },
    reason: "audit", scope: "archive", status: "active",
  };
  assert.deepEqual(evaluateAssignmentArchive(facts, { now, holds: [hold] }).reasons, ["archive_hold"]);
  assert.equal(evaluateRawResponseDeletion({
    target: facts.target, recordedAt: "2026-08-01T00:00:00.000Z",
  }, { now, holds: [hold] }).eligible, true);
  assert.equal(evaluateAssignmentArchive(facts, { now, holds: [{ ...hold, expires_at: "2026-09-01T00:00:00.000Z" }] }).eligible, true);
});

test("raw responses default to seven days and pending never age-deletes", () => {
  assert.equal(evaluateRawResponseDeletion({
    target: { record_type: "raw-response", record_id: "raw-1" },
    recordedAt: "2026-09-05T00:00:00.000Z",
  }, { now }).eligible, true);
  assert.equal(evaluateRawResponseDeletion({
    target: { record_type: "raw-response", record_id: "raw-2" },
    recordedAt: "2026-09-05T00:00:00.000Z", promotedToEvidence: true,
  }, { now }).eligible, false);
  assert.equal(pendingDeletionEligibility().eligible, false);
});

test("daily logs, shared records, and quarantine enforce their own lifecycle gates", () => {
  const timed = { target: { record_type: "event-log", record_id: "events-2026-08-01" }, recordedAt: "2026-08-01T00:00:00Z" };
  assert.equal(evaluateDailyEventLogArchive(timed, { now, retentionDays: 30 }).eligible, true);
  assert.deepEqual(evaluateSharedRecordArchive(timed, { now, retentionDays: 30 }).reasons, ["shared_record_not_retired"]);
  assert.deepEqual(evaluateResolvedQuarantineArchive(timed, { now, retentionDays: 30 }).reasons, ["quarantine_unresolved"]);
});
