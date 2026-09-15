/**
 * `PrimaryTransferRepository` over the structural statement set
 * (`PrimaryTransferStatements`).
 *
 * Shaped after `../invitations/data-access-adapter.ts`: it maps camelCase
 * records to the column names of the `M3` table and the rows the commit
 * touches, translates a rows-changed count into the boolean the commands read
 * as "lost the optimistic race", and imports no database module.
 *
 * `translateStatementFailure` gives a serialization failure its canonical
 * outcome. `SERIALIZABLE` plus the optimistic predicates is what stands in
 * for SS10.3's `FOR UPDATE` (see `commit.ts`), so `40001` is an ordinary,
 * expected outcome of the losing transaction and has to reach the caller as
 * `retryable_conflict` rather than as a driver error.
 */
import { PrimaryTransferError } from "./records.ts";
import type {
  PrimaryTransferRecord, TransferAuditEvent, TransferConsentInsert, TransferConsentRecord,
  TransferMembershipRecord, TransferNotice, TransferSpaceFacts, TransferState,
} from "./records.ts";
import type {
  BudgetSpacePrimaryTransferRow, ConsentSupersedePatch, PermissionInvitationRow, PermissionLostInvitation,
  PrimaryTransferRepository, PrimaryTransferStatements, TransferConsentRow, TransferMembershipRow,
  TransferPatch, TransferSpaceRow,
} from "./ports.ts";

/** PostgreSQL's serialization failure. */
export const SERIALIZATION_FAILURE_SQLSTATE = "40001";
/** PostgreSQL's deadlock detected. */
export const DEADLOCK_SQLSTATE = "40P01";
/** Unique violation: the partial unique indexes of `M3` and of the consent table. */
export const UNIQUE_VIOLATION_SQLSTATE = "23505";
/** Check violation: every closed CHECK and every trigger of the transfer schema. */
export const CHECK_VIOLATION_SQLSTATE = "23514";

/**
 * Map a driver failure to this module's vocabulary. Anything not recognised
 * is rethrown untouched: swallowing an unknown database failure into an
 * application code would turn a real fault into a customer-shaped denial.
 */
export function translateStatementFailure(error: unknown): never {
  const state = (error as { sqlState?: string } | null)?.sqlState;
  if (state === SERIALIZATION_FAILURE_SQLSTATE || state === DEADLOCK_SQLSTATE) {
    throw new PrimaryTransferError("retryable_conflict", "transaction");
  }
  if (state === UNIQUE_VIOLATION_SQLSTATE) throw new PrimaryTransferError("conflict", "unique");
  if (state === CHECK_VIOLATION_SQLSTATE) throw new PrimaryTransferError("constraint_violation", "check");
  throw error as Error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PrimaryTransferError) throw error;
    return translateStatementFailure(error);
  }
}

export function toTransferRecord(row: BudgetSpacePrimaryTransferRow): PrimaryTransferRecord {
  return {
    transferId: row.transfer_id,
    budgetSpaceId: row.budget_space_id,
    proposerMembershipId: row.proposer_membership_id,
    recipientMembershipId: row.recipient_membership_id,
    proposerAuthorizationVersion: row.proposer_authorization_version,
    recipientAuthorizationVersion: row.recipient_authorization_version,
    primaryOwnershipVersion: row.primary_ownership_version,
    recipientDisclosureKind: row.recipient_disclosure_kind,
    recipientDisclosureVersion: row.recipient_disclosure_version,
    recipientDisclosureDigest: row.recipient_disclosure_digest,
    outgoingDisclosureKind: row.outgoing_disclosure_kind,
    outgoingDisclosureVersion: row.outgoing_disclosure_version,
    outgoingDisclosureDigest: row.outgoing_disclosure_digest,
    state: row.state as TransferState,
    stateVersion: row.state_version,
    expiresAt: row.expires_at,
    recipientAcceptedAt: row.recipient_accepted_at,
    recipientAcceptedVersion: row.recipient_accepted_version,
    primaryConfirmedAt: row.primary_confirmed_at,
    primaryConfirmedVersion: row.primary_confirmed_version,
    primaryAssuranceRef: row.primary_assurance_ref,
    committedAt: row.committed_at,
    recipientConsentId: row.recipient_consent_id,
    outgoingConsentId: row.outgoing_consent_id,
    terminalEventId: row.terminal_event_id,
    policyVersion: row.policy_version,
    policyDigest: row.policy_digest,
  };
}

export function toTransferRow(record: PrimaryTransferRecord): BudgetSpacePrimaryTransferRow {
  return {
    transfer_id: record.transferId,
    budget_space_id: record.budgetSpaceId,
    proposer_membership_id: record.proposerMembershipId,
    recipient_membership_id: record.recipientMembershipId,
    proposer_authorization_version: record.proposerAuthorizationVersion,
    recipient_authorization_version: record.recipientAuthorizationVersion,
    primary_ownership_version: record.primaryOwnershipVersion,
    recipient_disclosure_kind: record.recipientDisclosureKind,
    recipient_disclosure_version: record.recipientDisclosureVersion,
    recipient_disclosure_digest: record.recipientDisclosureDigest,
    outgoing_disclosure_kind: record.outgoingDisclosureKind,
    outgoing_disclosure_version: record.outgoingDisclosureVersion,
    outgoing_disclosure_digest: record.outgoingDisclosureDigest,
    state: record.state,
    state_version: record.stateVersion,
    expires_at: record.expiresAt,
    recipient_accepted_at: record.recipientAcceptedAt,
    recipient_accepted_version: record.recipientAcceptedVersion,
    primary_confirmed_at: record.primaryConfirmedAt,
    primary_confirmed_version: record.primaryConfirmedVersion,
    primary_assurance_ref: record.primaryAssuranceRef,
    committed_at: record.committedAt,
    recipient_consent_id: record.recipientConsentId,
    outgoing_consent_id: record.outgoingConsentId,
    terminal_event_id: record.terminalEventId,
    policy_version: record.policyVersion,
    policy_digest: record.policyDigest,
  };
}

function toMembership(row: TransferMembershipRow): TransferMembershipRecord {
  return {
    membershipId: row.membership_id,
    budgetSpaceId: row.budget_space_id,
    profileId: row.profile_id,
    accountSubjectId: row.account_subject_id,
    role: row.role,
    status: row.status,
    authorizationVersion: row.authorization_version,
    endedAt: row.ended_at,
  };
}

function toSpace(row: TransferSpaceRow): TransferSpaceFacts {
  return {
    budgetSpaceId: row.budget_space_id,
    lifecycle: row.lifecycle,
    primaryOwnerMembershipId: row.primary_owner_membership_id,
    primaryOwnershipVersion: row.primary_ownership_version,
  };
}

function toConsent(row: TransferConsentRow): TransferConsentRecord {
  return {
    consentId: row.consent_id,
    budgetSpaceId: row.budget_space_id,
    membershipId: row.membership_id,
    accountSubjectId: row.account_subject_id,
    role: row.role,
    state: row.state,
    disclosureKind: row.disclosure_kind,
    supersedesConsentId: row.supersedes_consent_id,
    endedAt: row.ended_at,
    endedReasonClass: row.ended_reason_class,
    endedByEventId: row.ended_by_event_id,
    assuranceRef: row.assurance_ref,
  };
}

function toInvitation(row: PermissionInvitationRow): PermissionLostInvitation {
  return {
    invitationId: row.invitation_id,
    budgetSpaceId: row.budget_space_id,
    createdByMembershipId: row.created_by_membership_id,
    requiredPermission: row.required_permission,
    state: row.state,
  };
}

/** The column map of a {@link TransferPatch}; absent keys are not written. */
function transferSet(patch: TransferPatch): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (patch.state !== undefined) set.state = patch.state;
  if (patch.recipientAcceptedAt !== undefined) set.recipient_accepted_at = patch.recipientAcceptedAt;
  if (patch.recipientAcceptedVersion !== undefined) set.recipient_accepted_version = patch.recipientAcceptedVersion;
  if (patch.primaryConfirmedAt !== undefined) set.primary_confirmed_at = patch.primaryConfirmedAt;
  if (patch.primaryConfirmedVersion !== undefined) set.primary_confirmed_version = patch.primaryConfirmedVersion;
  if (patch.primaryAssuranceRef !== undefined) set.primary_assurance_ref = patch.primaryAssuranceRef;
  if (patch.committedAt !== undefined) set.committed_at = patch.committedAt;
  if (patch.recipientConsentId !== undefined) set.recipient_consent_id = patch.recipientConsentId;
  if (patch.outgoingConsentId !== undefined) set.outgoing_consent_id = patch.outgoingConsentId;
  if (patch.terminalEventId !== undefined) set.terminal_event_id = patch.terminalEventId;
  return set;
}

export function dataAccessPrimaryTransferRepository(statements: PrimaryTransferStatements): PrimaryTransferRepository {
  return {
    readTransfer: (budgetSpaceId, transferId) => guarded(async () => {
      const row = await statements.readTransfer(budgetSpaceId, transferId);
      return row === null ? null : toTransferRecord(row);
    }),
    findLiveTransfer: (budgetSpaceId) => guarded(async () => {
      const rows = await statements.listTransfers(budgetSpaceId);
      const live = rows.map(toTransferRecord).find((record) =>
        record.state === "proposed" || record.state === "recipient_accepted"
        || record.state === "primary_confirmed" || record.state === "ready");
      return live ?? null;
    }),
    insertTransfer: (record) => guarded(() => statements.insertTransfer(toTransferRow(record))),
    updateTransfer: (budgetSpaceId, transferId, expectedStateVersion, patch) => guarded(async () =>
      (await statements.updateTransfer(budgetSpaceId, transferId, expectedStateVersion, transferSet(patch))) > 0),

    readMembership: (budgetSpaceId, membershipId) => guarded(async () => {
      const row = await statements.readMembership(budgetSpaceId, membershipId);
      return row === null ? null : toMembership(row);
    }),
    listMemberships: (budgetSpaceId, accountSubjectId) => guarded(async () => {
      const rows = await statements.listMemberships(budgetSpaceId, accountSubjectId);
      return rows.map(toMembership);
    }),
    updateMembershipRole: (budgetSpaceId, membershipId, expectedAuthorizationVersion, role) => guarded(async () =>
      (await statements.updateMembershipRole(budgetSpaceId, membershipId, expectedAuthorizationVersion, role)) > 0),

    readSpace: (budgetSpaceId) => guarded(async () => {
      const row = await statements.readSpace(budgetSpaceId);
      return row === null ? null : toSpace(row);
    }),
    movePrimaryOwnership: (budgetSpaceId, recipientMembershipId, expectedPrimaryOwnershipVersion) => guarded(async () =>
      (await statements.movePrimaryOwnership(budgetSpaceId, recipientMembershipId, expectedPrimaryOwnershipVersion)) > 0),

    readCurrentConsent: (budgetSpaceId, membershipId) => guarded(async () => {
      const row = await statements.readCurrentConsent(budgetSpaceId, membershipId);
      return row === null ? null : toConsent(row);
    }),
    readConsent: (budgetSpaceId, consentId) => guarded(async () => {
      const row = await statements.readConsent(budgetSpaceId, consentId);
      return row === null ? null : toConsent(row);
    }),
    supersedeConsent: (budgetSpaceId, consentId, patch: ConsentSupersedePatch) => guarded(async () =>
      (await statements.supersedeConsent(budgetSpaceId, consentId, {
        state: "superseded",
        ended_at: patch.endedAt,
        ended_reason_class: patch.endedReasonClass,
        ended_by_event_id: patch.endedByEventId,
      })) > 0),
    insertConsent: (record: TransferConsentInsert) => guarded(() => statements.insertConsent(record.budgetSpaceId, {
      consent_id: record.consentId,
      membership_id: record.membershipId,
      account_subject_id: record.accountSubjectId,
      recorded_by_subject_id: record.recordedBySubjectId,
      role: record.role,
      resource_scope: record.resourceScope,
      source: record.source,
      source_record_id: record.sourceRecordId,
      source_record_version: record.sourceRecordVersion,
      disclosure_kind: record.disclosureKind,
      disclosure_version: record.disclosureVersion,
      disclosure_digest: record.disclosureDigest,
      policy_version: record.policyVersion,
      policy_digest: record.policyDigest,
      state: record.state,
      assurance_ref: record.assuranceRef,
      recorded_at: record.recordedAt,
      supersedes_consent_id: record.supersedesConsentId,
    })),

    listPermissionInvitations: (budgetSpaceId, createdByMembershipId, requiredPermission) => guarded(async () => {
      const rows = await statements.listPermissionInvitations(budgetSpaceId, createdByMembershipId, requiredPermission);
      return rows.map(toInvitation);
    }),

    insertAudit: (event: TransferAuditEvent) => guarded(() => statements.insertAudit(event.budgetSpaceId, {
      event_id: event.eventId,
      event_code: event.eventCode,
      event_subtype: event.eventSubtype,
      occurred_at: event.occurredAt,
      actor_subject_id: event.actorSubjectId,
      acting_membership_id: event.actingMembershipId,
      target_type: event.targetType,
      target_id: event.targetId,
      result: event.result,
      reason_class: event.reasonClass,
      policy_version: event.policyVersion,
      policy_digest: event.policyDigest,
      correlation_id: event.correlationId,
      audience: event.audience,
      payload: event.payload,
    })),
    insertNotice: (notice: TransferNotice) => guarded(() => statements.insertNotice({
      notice_id: notice.noticeId,
      account_subject_id: notice.accountSubjectId,
      budget_space_id: notice.budgetSpaceId,
      message_code: notice.messageCode,
      event_correlation_id: notice.eventCorrelationId,
    })),
  };
}
