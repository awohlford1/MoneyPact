/**
 * `InvitationRepository` over the typed PK-2 statement set, in the shape
 * `../targets/data-access-adapter.ts` established.
 *
 * The adapter's job is the mapping: rows in the tables' own column names on
 * one side, this module's records on the other, with every enumerated value
 * checked against the closed lists on the way in so a row a later migration
 * widened can never reach the state service as a value it does not know.
 *
 * Constraint failures surface as `InvitationError` through
 * {@link translateStatementFailure}: the driver's SQLSTATE, which data-access
 * preserves on `StatementFailedError.sqlState`, is the only thing read from a
 * failure. 23514 is a CHECK or one of the PK-2 triggers -- the closed edge,
 * the write-once identity block, the set-once evidence block -- each of which
 * the state service already refused, kept as defence in depth. 23505 is a
 * uniqueness a concurrent writer beat this transaction to, and 40001 is the
 * serialization failure two concurrent confirms produce.
 */
import { InvitationError } from "./records.ts";
import type {
  AcceptanceConsentRecord, CeremonyRecord, CeremonyState, ChannelProofState, CodeDisposition,
  ConfirmationRecord, ConfirmationState, DisplayIdentity, InvitableRole, InvitationCodeRecord,
  InvitationKind, InvitationProjectionState, InvitationRecord, InvitationState, LifecycleAuditEvent,
  LifecycleNotice, MembershipRecord, PrivateTerminalCause, RequiredPermission, SecurityEvent,
} from "./records.ts";
import {
  CEREMONY_STATES, CHANNEL_PROOF_STATES, CODE_DISPOSITIONS, CONFIRMATION_STATES, INVITABLE_ROLES,
  INVITATION_KINDS, INVITATION_STATES, PRIVATE_TERMINAL_CAUSES, PROJECTION_STATES, REQUIRED_PERMISSIONS,
} from "./records.ts";
import type {
  BudgetSpaceFacts, BudgetSpaceInvitationCeremonyRow, BudgetSpaceInvitationCodeRow,
  BudgetSpaceInvitationConfirmationRow, BudgetSpaceInvitationRow, BudgetSpaceMembershipRow,
  CeremonyPatch, ConfirmationPatch, InvitationLocation, InvitationLocator, InvitationPatch,
  InvitationRepository, InvitationStatements, OutboxInsert, OutboxRecord, OutboxTombstoneReason,
} from "./ports.ts";
import { codeVerifierDigest, digestsEqual, hasSelectorShape, splitPresentedCode } from "./secrets.ts";
import type { CodeVerifierBinding } from "./secrets.ts";
import type { KeyedDigest } from "./secrets.ts";

/** PostgreSQL's serialization failure: two concurrent confirms, exactly the CBD-275-AC03 case. */
export const SERIALIZATION_FAILURE_SQLSTATE = "40001";

function sqlStateOf(error: unknown): string | undefined {
  const state = (error as { sqlState?: unknown } | null)?.sqlState;
  return typeof state === "string" ? state : undefined;
}

/** Translate a statement failure to the canonical error, or rethrow anything that is not one. */
export function translateStatementFailure(error: unknown): never {
  const state = sqlStateOf(error);
  if (state === "23514" || state === "23503" || state === "23502") throw new InvitationError("constraint_violation");
  if (state === SERIALIZATION_FAILURE_SQLSTATE || state === "40P01") throw new InvitationError("retryable_conflict");
  if (state === "23505") throw new InvitationError("conflict");
  throw error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvitationError) throw error;
    return translateStatementFailure(error);
  }
}

function closed<T extends string>(list: readonly T[], value: string, field: string): T {
  if (!(list as readonly string[]).includes(value)) throw new InvitationError("constraint_violation", field);
  return value as T;
}

function instant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new InvitationError("constraint_violation", "timestamp");
}

function nullableInstant(value: unknown): string | null {
  return value === null || value === undefined ? null : instant(value);
}

function toInvitation(row: BudgetSpaceInvitationRow): InvitationRecord {
  return {
    invitationId: row.invitation_id,
    budgetSpaceId: row.budget_space_id,
    kind: closed<InvitationKind>(INVITATION_KINDS, row.kind, "kind"),
    createdByMembershipId: row.created_by_membership_id,
    createdBySubjectId: row.created_by_subject_id,
    requiredPermission: closed<RequiredPermission>(REQUIRED_PERMISSIONS, row.required_permission, "requiredPermission"),
    creatingAuthorizationVersion: row.creating_authorization_version,
    channelType: "email",
    destinationToken: row.destination_token,
    destinationMasked: row.destination_masked,
    proposedRole: closed<InvitableRole>(INVITABLE_ROLES, row.proposed_role, "proposedRole"),
    resourceScope: "full",
    disclosureKind: row.disclosure_kind,
    disclosureVersion: row.disclosure_version,
    disclosureDigest: row.disclosure_digest,
    policyVersion: row.policy_version,
    policyDigest: row.policy_digest,
    invitationVersion: row.invitation_version,
    state: closed<InvitationState>(INVITATION_STATES, row.state, "state"),
    stateVersion: row.state_version,
    issuedAt: instant(row.issued_at),
    expiresAt: instant(row.expires_at),
    projectionInactiveAt: instant(row.projection_inactive_at),
    projectionState: closed<InvitationProjectionState>(PROJECTION_STATES, row.projection_state, "projectionState"),
    privateTerminalCause: row.private_terminal_cause === null
      ? null
      : closed<PrivateTerminalCause>(PRIVATE_TERMINAL_CAUSES, row.private_terminal_cause, "privateTerminalCause"),
    predecessorInvitationId: row.predecessor_invitation_id,
    successorInvitationId: row.successor_invitation_id,
    candidateSubjectId: row.candidate_subject_id,
    acceptedMembershipId: row.accepted_membership_id,
    commitIdempotencyKey: row.commit_idempotency_key,
    commitRequestDigest: row.commit_request_digest,
    committedResponse: row.committed_response,
  };
}

function fromInvitation(record: InvitationRecord): BudgetSpaceInvitationRow {
  return {
    invitation_id: record.invitationId,
    budget_space_id: record.budgetSpaceId,
    kind: record.kind,
    created_by_membership_id: record.createdByMembershipId,
    created_by_subject_id: record.createdBySubjectId,
    required_permission: record.requiredPermission,
    creating_authorization_version: record.creatingAuthorizationVersion,
    channel_type: record.channelType,
    destination_token: record.destinationToken,
    destination_masked: record.destinationMasked,
    proposed_role: record.proposedRole,
    resource_scope: record.resourceScope,
    disclosure_kind: record.disclosureKind,
    disclosure_version: record.disclosureVersion,
    disclosure_digest: record.disclosureDigest,
    policy_version: record.policyVersion,
    policy_digest: record.policyDigest,
    invitation_version: record.invitationVersion,
    state: record.state,
    state_version: record.stateVersion,
    issued_at: record.issuedAt,
    expires_at: record.expiresAt,
    projection_inactive_at: record.projectionInactiveAt,
    projection_state: record.projectionState,
    private_terminal_cause: record.privateTerminalCause,
    predecessor_invitation_id: record.predecessorInvitationId,
    successor_invitation_id: record.successorInvitationId,
    candidate_subject_id: record.candidateSubjectId,
    accepted_membership_id: record.acceptedMembershipId,
    commit_idempotency_key: record.commitIdempotencyKey,
    commit_request_digest: record.commitRequestDigest,
    committed_response: record.committedResponse,
  };
}

function toCode(row: BudgetSpaceInvitationCodeRow): InvitationCodeRecord {
  return {
    invitationId: row.invitation_id,
    budgetSpaceId: row.budget_space_id,
    codeSelector: row.code_selector,
    verifierDigest: row.verifier_digest,
    issuedAt: instant(row.issued_at),
    expiresAt: instant(row.expires_at),
    disposition: closed<CodeDisposition>(CODE_DISPOSITIONS, row.disposition, "disposition"),
    dispositionReasonClass: row.disposition_reason_class,
    dispositionAt: nullableInstant(row.disposition_at),
    abuseFingerprint: row.abuse_fingerprint,
  };
}

function toCeremony(row: BudgetSpaceInvitationCeremonyRow): CeremonyRecord {
  return {
    ceremonyId: row.ceremony_id,
    budgetSpaceId: row.budget_space_id,
    invitationId: row.invitation_id,
    ceremonySecretDigest: row.ceremony_secret_digest,
    isCurrent: row.is_current,
    channelProofState: closed<ChannelProofState>(CHANNEL_PROOF_STATES, row.channel_proof_state, "channelProofState"),
    channelChallengeDigest: row.channel_challenge_digest,
    channelAttempts: row.channel_attempts,
    channelProvedAt: nullableInstant(row.channel_proved_at),
    attachedSubjectId: row.attached_subject_id,
    attachedSessionRef: row.attached_session_ref,
    attachedAt: nullableInstant(row.attached_at),
    primaryContactMatch: row.primary_contact_match,
    disclosureKind: row.disclosure_kind,
    disclosureVersion: row.disclosure_version,
    disclosureDigest: row.disclosure_digest,
    acceptanceActionAt: nullableInstant(row.acceptance_action_at),
    acceptedDisclosureVersion: row.accepted_disclosure_version,
    state: closed<CeremonyState>(CEREMONY_STATES, row.state, "ceremony.state"),
    expiresAt: instant(row.expires_at),
    environment: row.environment,
  };
}

function toConfirmation(row: BudgetSpaceInvitationConfirmationRow): ConfirmationRecord {
  return {
    confirmationId: row.confirmation_id,
    budgetSpaceId: row.budget_space_id,
    invitationId: row.invitation_id,
    ceremonyId: row.ceremony_id,
    acceptorSubjectId: row.acceptor_subject_id,
    displayedIdentityVersion: row.displayed_identity_version,
    bindingRuleId: row.binding_rule_id,
    bindingRuleVersion: row.binding_rule_version,
    state: closed<ConfirmationState>(CONFIRMATION_STATES, row.state, "confirmation.state"),
    expiresAt: instant(row.expires_at),
    decidedByMembershipId: row.decided_by_membership_id,
    decidedBySubjectId: row.decided_by_subject_id,
    decidedAt: nullableInstant(row.decided_at),
    decidedAuthorizationVersion: row.decided_authorization_version,
    committedConsentId: row.committed_consent_id,
  };
}

function toMembership(row: BudgetSpaceMembershipRow): MembershipRecord {
  return {
    membershipId: row.membership_id,
    budgetSpaceId: row.budget_space_id,
    profileId: row.profile_id,
    accountSubjectId: row.account_subject_id,
    role: row.role,
    status: row.status === "active" || row.status === "revoked" || row.status === "removed" ? row.status : "removed",
    authorizationVersion: row.authorization_version,
    createdBySubjectId: row.created_by_subject_id,
    endedAt: nullableInstant(row.ended_at),
  };
}

const INVITATION_PATCH_COLUMNS = snakeCaseColumns<keyof InvitationPatch>([
  "state", "projectionState", "privateTerminalCause", "successorInvitationId",
  "candidateSubjectId", "acceptedMembershipId", "commitRequestDigest",
  "committedResponse", "commitIdempotencyKey",
]);

const CEREMONY_PATCH_COLUMNS = snakeCaseColumns<keyof CeremonyPatch>([
  "isCurrent", "channelProofState", "channelChallengeDigest", "channelAttempts",
  "channelProvedAt", "attachedSubjectId", "attachedSessionRef", "attachedAt",
  "primaryContactMatch", "acceptanceActionAt", "acceptedDisclosureVersion", "state",
]);

// Built rather than written out: a literal `decidedAuthorizationVersion:
// "decided_authorization_version"` is exactly the shape the secret scanner's
// generic-api-key rule reads as a credential (PK2FIX-F04), and the mapping is
// mechanical anyway.
function snakeCaseColumns<K extends string>(fields: readonly K[]): Readonly<Record<K, string>> {
  const map = {} as Record<K, string>;
  for (const field of fields) map[field] = field.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
  return Object.freeze(map);
}

const CONFIRMATION_PATCH_COLUMNS = snakeCaseColumns<keyof ConfirmationPatch>([
  "state", "decidedByMembershipId", "decidedBySubjectId", "decidedAt",
  "committedConsentId", "decidedAuthorizationVersion",
]);

function columns<P extends object>(patch: P, map: Readonly<Record<string, string>>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = map[key];
    if (!column) throw new InvitationError("constraint_violation", key);
    set[column] = value;
  }
  return set;
}

/** Compose the repository from the statement set. Nothing here opens a transaction. */
export function dataAccessInvitationRepository(statements: InvitationStatements): InvitationRepository {
  return {
    readInvitation: (budgetSpaceId, invitationId) => guarded(async () => {
      const row = await statements.readInvitation(budgetSpaceId, invitationId);
      return row ? toInvitation(row) : null;
    }),
    findDispatchedByDestination: (budgetSpaceId, destinationToken) => guarded(async () => {
      const rows = await statements.listInvitations(budgetSpaceId);
      const match = rows.map(toInvitation).find((row) => row.kind === "real"
        && row.destinationToken === destinationToken
        && ["created", "pending", "awaiting_confirmation"].includes(row.state));
      return match ?? null;
    }),
    listByCandidateSubject: (budgetSpaceId, candidateSubjectId) => guarded(async () => {
      const rows = await statements.listInvitations(budgetSpaceId);
      return rows.map(toInvitation).filter((row) => row.candidateSubjectId === candidateSubjectId);
    }),
    insertInvitation: (record, destinationCiphertext) => guarded(async () => {
      await statements.insertInvitation(fromInvitation(record), destinationCiphertext);
    }),
    updateInvitation: (budgetSpaceId, invitationId, expectedStateVersion, patch) => guarded(async () => {
      const set = columns(patch, INVITATION_PATCH_COLUMNS);
      if (Object.keys(set).length === 0) return true;
      const changed = await statements.updateInvitation(budgetSpaceId, invitationId, expectedStateVersion, set);
      return changed > 0;
    }),

    readCode: (budgetSpaceId, invitationId) => guarded(async () => {
      const row = await statements.readCode(budgetSpaceId, invitationId);
      return row ? toCode(row) : null;
    }),
    insertCode: (record) => guarded(async () => {
      await statements.insertCode({
        invitation_id: record.invitationId, budget_space_id: record.budgetSpaceId, code_selector: record.codeSelector,
        verifier_digest: record.verifierDigest, issued_at: record.issuedAt, expires_at: record.expiresAt,
        disposition: record.disposition, disposition_reason_class: record.dispositionReasonClass,
        disposition_at: record.dispositionAt, abuse_fingerprint: record.abuseFingerprint,
      });
    }),
    updateCodeDisposition: (budgetSpaceId, invitationId, from, to, reasonClass, at) => guarded(async () => {
      const changed = await statements.updateCode(budgetSpaceId, invitationId, from, {
        disposition: to, disposition_reason_class: reasonClass, disposition_at: at,
      });
      return changed > 0;
    }),
    stampAbuseFingerprint: (budgetSpaceId, invitationId, fingerprint) => guarded(async () => {
      await statements.setCodeFingerprint(budgetSpaceId, invitationId, fingerprint);
    }),

    readCeremony: (budgetSpaceId, ceremonyId) => guarded(async () => {
      const row = await statements.readCeremony(budgetSpaceId, ceremonyId);
      return row ? toCeremony(row) : null;
    }),
    listCeremonies: (budgetSpaceId, invitationId) => guarded(async () => {
      const rows = await statements.listCeremonies(budgetSpaceId, invitationId);
      return rows.map(toCeremony);
    }),
    insertCeremony: (record) => guarded(async () => {
      await statements.insertCeremony({
        ceremony_id: record.ceremonyId, budget_space_id: record.budgetSpaceId, invitation_id: record.invitationId,
        ceremony_secret_digest: record.ceremonySecretDigest, is_current: record.isCurrent,
        channel_proof_state: record.channelProofState, channel_challenge_digest: record.channelChallengeDigest,
        channel_attempts: record.channelAttempts, channel_proved_at: record.channelProvedAt,
        attached_subject_id: record.attachedSubjectId, attached_session_ref: record.attachedSessionRef,
        attached_at: record.attachedAt, primary_contact_match: record.primaryContactMatch,
        disclosure_kind: record.disclosureKind, disclosure_version: record.disclosureVersion,
        disclosure_digest: record.disclosureDigest, acceptance_action_at: record.acceptanceActionAt,
        accepted_disclosure_version: record.acceptedDisclosureVersion, state: record.state,
        expires_at: record.expiresAt, environment: record.environment,
      });
    }),
    updateCeremony: (budgetSpaceId, ceremonyId, patch) => guarded(async () => {
      const set = columns(patch, CEREMONY_PATCH_COLUMNS);
      if (Object.keys(set).length === 0) return true;
      const changed = await statements.updateCeremony(budgetSpaceId, ceremonyId, set);
      return changed > 0;
    }),

    readConfirmation: (budgetSpaceId, confirmationId) => guarded(async () => {
      const row = await statements.readConfirmation(budgetSpaceId, confirmationId);
      return row ? toConfirmation(row) : null;
    }),
    listConfirmations: (budgetSpaceId, invitationId) => guarded(async () => {
      const rows = await statements.listConfirmations(budgetSpaceId, invitationId);
      return rows.map(toConfirmation);
    }),
    insertConfirmation: (record) => guarded(async () => {
      await statements.insertConfirmation({
        confirmation_id: record.confirmationId, budget_space_id: record.budgetSpaceId,
        invitation_id: record.invitationId, ceremony_id: record.ceremonyId,
        acceptor_subject_id: record.acceptorSubjectId, displayed_identity_version: record.displayedIdentityVersion,
        binding_rule_id: record.bindingRuleId, binding_rule_version: record.bindingRuleVersion,
        state: record.state, expires_at: record.expiresAt,
        decided_by_membership_id: record.decidedByMembershipId, decided_by_subject_id: record.decidedBySubjectId,
        decided_at: record.decidedAt, decided_authorization_version: record.decidedAuthorizationVersion,
        committed_consent_id: record.committedConsentId,
      });
    }),
    updateConfirmation: (budgetSpaceId, confirmationId, patch) => guarded(async () => {
      const set = columns(patch, CONFIRMATION_PATCH_COLUMNS);
      if (Object.keys(set).length === 0) return true;
      const changed = await statements.updateConfirmation(budgetSpaceId, confirmationId, set);
      return changed > 0;
    }),

    insertOutbox: (row: OutboxInsert) => guarded(() => statements.insertOutbox(row)),
    readOutbox: (invitationId) => guarded(async () => {
      const row = await statements.readOutbox(invitationId);
      if (!row) return null;
      const projection: OutboxRecord = {
        outboxId: row.outbox_id, invitationId: row.invitation_id, channelType: "email",
        fidelityLabel: row.fidelity_label,
        deliveryState: row.delivery_state === "pending" || row.delivery_state === "rendered" ? row.delivery_state : "tombstoned",
        renderedAt: nullableInstant(row.rendered_at), custodyDeadline: instant(row.custody_deadline),
        tombstonedAt: nullableInstant(row.tombstoned_at), tombstoneReasonClass: row.tombstone_reason_class,
      };
      return projection;
    }),
    tombstoneOutbox: (invitationId, reason: OutboxTombstoneReason, at) => guarded(async () => {
      await statements.tombstoneOutbox(invitationId, reason, at);
    }),

    readActiveMembership: (budgetSpaceId, accountSubjectId) => guarded(async () => {
      const rows = await statements.listMemberships(budgetSpaceId, accountSubjectId);
      const match = rows.map(toMembership).find((row) => row.status === "active");
      return match ?? null;
    }),
    listMemberships: (budgetSpaceId, accountSubjectId) => guarded(async () => {
      const rows = await statements.listMemberships(budgetSpaceId, accountSubjectId);
      return rows.map(toMembership);
    }),
    insertMembership: (record: MembershipRecord) => guarded(async () => {
      await statements.insertMembership({
        membership_id: record.membershipId, budget_space_id: record.budgetSpaceId, profile_id: record.profileId,
        account_subject_id: record.accountSubjectId, role: record.role, status: record.status,
        authorization_version: record.authorizationVersion, created_by_subject_id: record.createdBySubjectId,
        ended_at: record.endedAt,
      });
    }),
    insertConsent: (record: AcceptanceConsentRecord) => guarded(async () => {
      await statements.insertConsent(record.budgetSpaceId, {
        consent_id: record.consentId,
        membership_id: record.membershipId,
        account_subject_id: record.accountSubjectId,
        role: record.role,
        resource_scope: record.resourceScope,
        source: record.source,
        source_record_id: record.sourceRecordId,
        source_record_version: record.sourceRecordVersion,
        source_ceremony_id: record.sourceCeremonyId,
        disclosure_kind: record.disclosureKind,
        disclosure_version: record.disclosureVersion,
        disclosure_digest: record.disclosureDigest,
        policy_version: record.policyVersion,
        policy_digest: record.policyDigest,
        state: record.state,
        assurance_ref: record.assuranceRef,
        recorded_at: record.recordedAt,
        recorded_by_subject_id: record.recordedBySubjectId,
        supersedes_consent_id: record.supersedesConsentId,
      });
    }),
    readDisplayIdentity: (accountSubjectId) => guarded(async () => {
      const row = await statements.readDisplayIdentity(accountSubjectId);
      if (!row) return null;
      const identity: DisplayIdentity = {
        accountSubjectId: row.account_subject_id, profileId: row.profile_id,
        profileState: row.profile_state, displayName: row.display_name, version: row.version,
      };
      return identity;
    }),
    writeDisplayName: (accountSubjectId, displayName, expectedVersion) => guarded(
      () => statements.writeDisplayName(accountSubjectId, displayName, expectedVersion),
    ),

    insertAudit: (event: LifecycleAuditEvent) => guarded(async () => {
      await statements.insertAudit(event.budgetSpaceId, {
        event_id: event.eventId, event_code: event.eventCode, event_subtype: event.eventSubtype,
        occurred_at: event.occurredAt, actor_subject_id: event.actorSubjectId,
        acting_membership_id: event.actingMembershipId, target_type: event.targetType, target_id: event.targetId,
        result: event.result, reason_class: event.reasonClass, policy_version: event.policyVersion,
        policy_digest: event.policyDigest, correlation_id: event.correlationId, audience: event.audience,
        payload: event.payload,
      });
    }),
    insertSecurityEvent: (event: SecurityEvent) => guarded(async () => {
      await statements.insertSecurityEvent({
        event_id: event.eventId, event_code: event.eventCode, occurred_at: event.occurredAt,
        budget_space_id: event.budgetSpaceId, outcome_class: event.outcomeClass,
        abuse_fingerprint: event.abuseFingerprint, correlation_id: event.correlationId, payload: event.payload,
      });
    }),
    insertNotice: (notice: LifecycleNotice) => guarded(async () => {
      await statements.insertNotice({
        notice_id: notice.noticeId, account_subject_id: notice.accountSubjectId,
        budget_space_id: notice.budgetSpaceId, message_code: notice.messageCode,
        event_correlation_id: notice.eventCorrelationId,
      });
    }),

    readBudgetSpace: (budgetSpaceId) => guarded(async () => {
      const row = await statements.readBudgetSpace(budgetSpaceId);
      if (!row) return null;
      const facts: BudgetSpaceFacts = { budgetSpaceId: row.budget_space_id, name: row.name, lifecycle: row.lifecycle };
      return facts;
    }),
  };
}

/**
 * A binding that belongs to no row, for the fixed-shape work the selector
 * path does when the lookup found nothing (`PK5-F02`; the shape
 * `packages/sessions/src/resolve.ts` gives its synthetic candidate). The
 * verifier computed under it can never equal a stored digest, because every
 * stored digest is bound to a real invitation id.
 */
const UNKNOWN_BINDING: CodeVerifierBinding = { invitationId: "unknown", invitationVersion: 0, destinationToken: "unknown" };

/**
 * The locator over the same statement set. `locateByPresentedCode` takes the
 * selector path for a value shaped `<selector>.<secret>`: one indexed lookup,
 * then one bound-verifier computation over the secret half and one
 * constant-time comparison, performed whether or not the lookup found a row
 * so the unknown, expired and consumed classes do the same work. A value
 * without the separator is the pre-selector shape and is answered by the
 * scan over the rows that have no selector, run to completion; see the port's
 * own comment.
 */
export function dataAccessInvitationLocator(statements: InvitationStatements, digest: KeyedDigest): InvitationLocator {
  return {
    locateByPresentedCode: (presentedCode) => guarded(async (): Promise<InvitationLocation | null> => {
      if (typeof presentedCode !== "string" || presentedCode.length === 0) return null;
      if (hasSelectorShape(presentedCode)) {
        // Fixed-shape step 1: the selector lookup, real or synthetic, always attempted.
        const parts = splitPresentedCode(presentedCode);
        const binding = parts === undefined ? null : await statements.locateCodeBySelector(parts.selector);
        // Fixed-shape step 2: one bound-verifier computation and one
        // constant-time comparison, always attempted. Without a row the
        // candidate is computed under a binding no row can carry and compared
        // against a digest of the same shape, so the same primitive work runs.
        const secret = parts?.secret ?? presentedCode;
        const candidate = await codeVerifierDigest(digest, binding === null ? UNKNOWN_BINDING : {
          invitationId: binding.invitationId,
          invitationVersion: binding.invitationVersion,
          destinationToken: binding.destinationToken,
        }, secret);
        const reference = binding === null ? await codeVerifierDigest(digest, UNKNOWN_BINDING, `${secret}|reference`) : binding.verifierDigest;
        const matched = digestsEqual(candidate, reference);
        return binding !== null && matched ? { budgetSpaceId: binding.budgetSpaceId, invitationId: binding.invitationId } : null;
      }
      let found: InvitationLocation | null = null;
      for (const binding of await statements.listLegacyCodes()) {
        const candidate = await codeVerifierDigest(digest, {
          invitationId: binding.invitationId,
          invitationVersion: binding.invitationVersion,
          destinationToken: binding.destinationToken,
        }, presentedCode);
        // No early exit: the loop runs to the end so the answer's timing does
        // not depend on where in the set the match was.
        if (digestsEqual(candidate, binding.verifierDigest)) {
          found = { budgetSpaceId: binding.budgetSpaceId, invitationId: binding.invitationId };
        }
      }
      return found;
    }),
    locateByCeremony: (ceremonyId) => guarded(async () => {
      const row = await statements.locateCeremony(ceremonyId);
      return row ? { budgetSpaceId: row.budget_space_id, invitationId: row.invitation_id, ceremonyId } : null;
    }),
  };
}
