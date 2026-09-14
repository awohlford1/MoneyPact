import type {
  AssignmentArchiveFacts, EligibilityResult, HoldRecord, HoldTarget,
  MaintenanceAction, TimedRecordFacts,
} from "./types.ts";

const DAY_MS = 86_400_000;

function validDate(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function targetMatches(holdTarget: HoldTarget, target: HoldTarget): boolean {
  return holdTarget.record_type === target.record_type
    && holdTarget.record_id === target.record_id
    && (holdTarget.revision === undefined || holdTarget.revision === target.revision);
}

export function isHoldActive(hold: HoldRecord, now: Date): boolean {
  if (hold.status !== "active") return false;
  const expiry = validDate(hold.expires_at);
  return expiry === undefined || expiry > now.getTime();
}

export function holdApplies(holds: readonly HoldRecord[], target: HoldTarget, action: MaintenanceAction, now: Date): boolean {
  return holds.some((hold) => isHoldActive(hold, now)
    && (hold.scope === action || hold.scope === "archive_and_delete")
    && hold.targets.some((candidate) => targetMatches(candidate, target)));
}

export function evaluateAssignmentArchive(
  facts: AssignmentArchiveFacts,
  options: { now: Date; retentionDays?: number; holds?: readonly HoldRecord[] },
): EligibilityResult {
  const reasons: string[] = [];
  const retentionDays = options.retentionDays ?? 30;
  const closedAt = validDate(facts.closedAt);
  const reopenedAt = validDate(facts.reopenedAt);
  if (facts.lifecycleState !== "closed") reasons.push("assignment_not_closed");
  if (facts.closureDisposition !== "completed" && facts.closureDisposition !== "cancelled") reasons.push("invalid_closure_disposition");
  if (closedAt === undefined) reasons.push("missing_or_invalid_closed_at");
  if (closedAt !== undefined && options.now.getTime() - closedAt < retentionDays * DAY_MS) reasons.push("retention_not_elapsed");
  if (closedAt !== undefined && reopenedAt !== undefined && reopenedAt >= closedAt) reasons.push("assignment_reopened");
  if (!facts.relatedRecordsDiscoverable) reasons.push("related_records_not_discoverable");
  if (!facts.referencesResolve) reasons.push("unresolved_references");
  if (facts.unresolvedExecutions > 0) reasons.push("unresolved_executions");
  if (facts.unresolvedActions > 0) reasons.push("unresolved_actions");
  if (!facts.identitiesValid) reasons.push("invalid_identities");
  if (!facts.hashesValid) reasons.push("invalid_hashes");
  if (holdApplies(options.holds ?? [], facts.target, "archive", options.now)) reasons.push("archive_hold");
  return { eligible: reasons.length === 0, reasons };
}

function evaluateAge(facts: TimedRecordFacts, now: Date, retentionDays: number): string[] {
  const recordedAt = validDate(facts.recordedAt);
  if (recordedAt === undefined) return ["missing_or_invalid_recorded_at"];
  return now.getTime() - recordedAt < retentionDays * DAY_MS ? ["retention_not_elapsed"] : [];
}

export function evaluateRawResponseDeletion(
  facts: TimedRecordFacts,
  options: { now: Date; retentionDays?: number; holds?: readonly HoldRecord[] },
): EligibilityResult {
  const reasons = evaluateAge(facts, options.now, options.retentionDays ?? 7);
  if (facts.promotedToEvidence) reasons.push("promoted_to_durable_evidence");
  if (holdApplies(options.holds ?? [], facts.target, "delete", options.now)) reasons.push("delete_hold");
  return { eligible: reasons.length === 0, reasons };
}

export function evaluateDailyEventLogArchive(facts: TimedRecordFacts, options: { now: Date; retentionDays: number; holds?: readonly HoldRecord[] }): EligibilityResult {
  const reasons = evaluateAge(facts, options.now, options.retentionDays);
  if (holdApplies(options.holds ?? [], facts.target, "archive", options.now)) reasons.push("archive_hold");
  return { eligible: reasons.length === 0, reasons };
}

export function evaluateResolvedQuarantineArchive(facts: TimedRecordFacts, options: { now: Date; retentionDays: number; holds?: readonly HoldRecord[] }): EligibilityResult {
  const reasons = evaluateAge(facts, options.now, options.retentionDays);
  if (!facts.resolved) reasons.push("quarantine_unresolved");
  if (holdApplies(options.holds ?? [], facts.target, "archive", options.now)) reasons.push("archive_hold");
  return { eligible: reasons.length === 0, reasons };
}

export function evaluateSharedRecordArchive(facts: TimedRecordFacts, options: { now: Date; retentionDays: number; holds?: readonly HoldRecord[] }): EligibilityResult {
  const reasons = evaluateAge(facts, options.now, options.retentionDays);
  if (!facts.retired) reasons.push("shared_record_not_retired");
  if (holdApplies(options.holds ?? [], facts.target, "archive", options.now)) reasons.push("archive_hold");
  return { eligible: reasons.length === 0, reasons };
}

export function pendingDeletionEligibility(): EligibilityResult {
  return { eligible: false, reasons: ["pending_requires_concrete_reconciliation"] };
}
