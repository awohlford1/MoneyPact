/**
 * Persistence and environment ports for the invitations module (PK-5).
 *
 * Shaped after `../targets/ports.ts`: `InvitationRepository` is what the
 * commands talk to, two adapters implement it (`InMemoryInvitationRepository`
 * for unit tests and `dataAccessInvitationRepository` over the statement set
 * `@cobudget/data-access` exposes for the PK-2 tables), and the statement set
 * is described here structurally so this package keeps its CBD-232 SS3.1
 * boundary -- no database import anywhere under `src/invitations`.
 *
 * Every write the commands make runs inside the transaction the caller
 * already holds; the repository never opens one of its own. The caller opens
 * it `serializable`, which is what makes the concurrency claims of CBD-275
 * AC03 true (`SS8` "two concurrent confirms serialize").
 *
 * `InvitationLocator` is separate from the repository and deliberately so.
 * The pre-authentication surfaces (`POST /v1/invitations/resolve`, and every
 * route addressed by ceremony id from the cookie) hold no budget-space
 * identifier, and `budget_space_invitation_code` and
 * `budget_space_invitation_ceremony` are budget-space-scoped tables whose
 * statements require one. The locator is the one closed read that answers
 * "which space does this opaque value belong to", and it answers nothing
 * else: no state, no expiry, no role. Every check still happens afterwards,
 * inside the transaction, against a re-read row.
 */
import type {
  AcceptanceConsentRecord, CeremonyRecord, CodeDisposition, ConfirmationRecord, ConfirmationState,
  DisplayIdentity, InvitationCodeRecord, InvitationProjectionState, InvitationRecord, InvitationState,
  LifecycleAuditEvent, LifecycleNotice, MembershipRecord, PrivateTerminalCause, SecurityEvent,
} from "./records.ts";

export interface Clock {
  /** The current instant as an ISO-8601 UTC string. Server time; never a request value (`IC-73-016`). */
  readonly now: () => string;
}

export interface IdGenerator {
  /** A fresh UUID for an invitation, ceremony, confirmation, membership, consent, audit, notice or outbox row. */
  readonly uuid: () => string;
}

/** The policy tuple of the allow decision that authorized the command (`PC-236-012`). Never derived here. */
export interface PolicyDecision {
  readonly policyVersion: string;
  readonly policyDigest: string;
  /** The acting membership's `authorization_version` as the decision reloaded it. */
  readonly authorizationVersion: number;
}

/** What every owner-path context carries: the space, the acting (or creating) membership, the decision tuple and the request's correlation id. */
interface OwnerContextBase {
  readonly budgetSpaceId: string;
  readonly subjectId: string;
  readonly membershipId: string;
  readonly decision: PolicyDecision;
  /** The correlation id of the request, shared by every audit row and notice the command writes. */
  readonly correlationId: string;
}

/**
 * The owner acting on a space-scoped invitation command through a route that
 * decided against a cell. `permission` is the CBD-72 permission key of that
 * cell, required in the type (`PK5FIX-F02`): SS8 step 4 requires the
 * invitation's `required_permission` to equal it at commit, so an owner
 * holding a different permission than the one the creation required cannot
 * confirm, reject or replace. A route cannot build this context without
 * naming the cell it decided; the commands still compare at run time
 * (`SEC-PK5-F02`, `R-03`) as defence in depth.
 */
export interface OwnerActorContext extends OwnerContextBase {
  readonly permission: "24" | "26";
}

/**
 * The system path: a transition nobody is acting on (`ownerFromRecord`, the
 * `TR-73-06` cancels for `sibling_accepted`, membership state and
 * `permission_lost`). It carries the record's own creator and the decision
 * tuple the record was created under, and never a decided permission -- the
 * key is absent, not `undefined`, so it can never satisfy an actor command.
 */
export interface OwnerSystemContext extends OwnerContextBase {
  readonly permission?: never;
}

/** Either context, for the commands that need no decided cell: cancel, read and list. */
export type OwnerContext = OwnerActorContext | OwnerSystemContext;

/** The invitee acting on a ceremony-scoped command. */
export interface InviteeContext {
  readonly subjectId: string;
  /** The `account_session.session_id` row identifier (`SEC-PK2-F07`): never a session token, never its verifier. */
  readonly sessionRowId: string;
  readonly environment: string;
  readonly correlationId: string;
}

/**
 * What the invitation state service needs to know about a budget space before
 * it writes to it, plus the space's name for the post-attachment disclosure
 * (PK8-F06). The name is never read on a surface served before attachment.
 */
export interface BudgetSpaceFacts {
  readonly budgetSpaceId: string;
  readonly name: string;
  readonly lifecycle: string;
}

export interface InvitationPatch {
  readonly state?: InvitationState;
  readonly projectionState?: InvitationProjectionState;
  readonly privateTerminalCause?: PrivateTerminalCause | null;
  readonly successorInvitationId?: string | null;
  readonly candidateSubjectId?: string | null;
  readonly acceptedMembershipId?: string | null;
  readonly commitIdempotencyKey?: string | null;
  readonly commitRequestDigest?: string | null;
  readonly committedResponse?: unknown;
}

export interface CeremonyPatch {
  readonly isCurrent?: boolean;
  readonly channelProofState?: CeremonyRecord["channelProofState"];
  readonly channelChallengeDigest?: string | null;
  readonly channelAttempts?: number;
  readonly channelProvedAt?: string | null;
  readonly attachedSubjectId?: string | null;
  readonly attachedSessionRef?: string | null;
  readonly attachedAt?: string | null;
  readonly primaryContactMatch?: boolean | null;
  readonly acceptanceActionAt?: string | null;
  readonly acceptedDisclosureVersion?: number | null;
  readonly state?: CeremonyRecord["state"];
}

export interface ConfirmationPatch {
  readonly state?: ConfirmationState;
  readonly decidedByMembershipId?: string | null;
  readonly decidedBySubjectId?: string | null;
  readonly decidedAt?: string | null;
  readonly decidedAuthorizationVersion?: number | null;
  readonly committedConsentId?: string | null;
}

export interface OutboxInsert {
  readonly outboxId: string;
  readonly invitationId: string;
  readonly budgetSpaceId: string;
  readonly channelType: "email";
  /** The raw address, bearer and challenge. The adapter encrypts all three; none is ever stored in the clear. */
  readonly destination: string;
  readonly bearer: string;
  readonly challenge: string;
  readonly custodyDeadline: string;
}

export interface OutboxRecord {
  readonly outboxId: string;
  readonly invitationId: string;
  readonly channelType: "email";
  readonly fidelityLabel: string;
  readonly deliveryState: "pending" | "rendered" | "tombstoned";
  readonly renderedAt: string | null;
  readonly custodyDeadline: string;
  readonly tombstonedAt: string | null;
  readonly tombstoneReasonClass: string | null;
}

export type OutboxTombstoneReason = "code_consumed" | "code_invalidated" | "custody_deadline";

/** One code row's binding material, the input to the constant-time presented-code match. Never a raw value. */
export interface LiveCodeBinding {
  readonly budgetSpaceId: string;
  readonly invitationId: string;
  readonly invitationVersion: number;
  readonly destinationToken: string;
  readonly verifierDigest: string;
  /** `PK5-F02`: the opaque lookup handle, or null for a row issued before the selector existed. */
  readonly codeSelector: string | null;
}

/** The simulated delivery adapter's read of the six-digit channel challenge (SS5.3). */
export interface ChannelChallengeReader {
  /** The challenge for one invitation, decrypted from its outbox row, or null when the row is tombstoned. */
  (invitationId: string): Promise<string | null>;
}

/** Where an opaque pre-authentication value lives, and nothing more. */
export interface InvitationLocation {
  readonly budgetSpaceId: string;
  readonly invitationId: string;
}

export interface InvitationLocator {
  /**
   * The record one presented raw bearer belongs to, or null.
   *
   * The stored verifier is an HMAC bound to `(invitationId, invitationVersion,
   * destinationToken)`, so it cannot be recomputed from the raw value alone
   * and the secret cannot be a database predicate. `PK5-F02`: the bearer is
   * therefore `<selector>.<secret>`, where the selector is an opaque random
   * handle that encodes nothing (`IC-73-002` still holds: not the space, not
   * the record, not the recipient) and is the one indexed lookup. The adapter
   * looks the row up by selector, then recomputes the bound verifier over the
   * secret half and compares in constant time, doing the same fixed-shape
   * work whether or not a row was found. A presented value without a
   * separator is the pre-selector shape and is answered by the scan over the
   * rows that have no selector, run to completion. This answers location
   * only: no state, no expiry, no role, and every check still happens
   * afterwards against a re-read row.
   */
  readonly locateByPresentedCode: (presentedCode: string) => Promise<InvitationLocation | null>;
  /** The record one ceremony id belongs to, or null. Answers location only. */
  readonly locateByCeremony: (ceremonyId: string) => Promise<(InvitationLocation & { readonly ceremonyId: string }) | null>;
}

export interface InvitationRepository {
  // --- the invitation record -------------------------------------------------
  readonly readInvitation: (budgetSpaceId: string, invitationId: string) => Promise<InvitationRecord | null>;
  /** The one dispatched real record for a destination, if there is one (SS4.1 partial unique index). */
  readonly findDispatchedByDestination: (budgetSpaceId: string, destinationToken: string) => Promise<InvitationRecord | null>;
  /** Every enumerable same-space record bound to this candidate subject; the sibling set of SS8 step 9. */
  readonly listByCandidateSubject: (budgetSpaceId: string, candidateSubjectId: string) => Promise<readonly InvitationRecord[]>;
  readonly insertInvitation: (record: InvitationRecord, destinationCiphertext: Uint8Array) => Promise<void>;
  /**
   * Applies `patch` to the record only while its `state_version` still equals
   * `expectedStateVersion`, advancing the version when `state` changes.
   * Returns false when no row matched, which is a lost optimistic race and
   * never a silent no-op.
   */
  readonly updateInvitation: (
    budgetSpaceId: string, invitationId: string, expectedStateVersion: number, patch: InvitationPatch,
  ) => Promise<boolean>;

  // --- the code --------------------------------------------------------------
  readonly readCode: (budgetSpaceId: string, invitationId: string) => Promise<InvitationCodeRecord | null>;
  readonly insertCode: (record: InvitationCodeRecord) => Promise<void>;
  readonly updateCodeDisposition: (
    budgetSpaceId: string, invitationId: string, from: CodeDisposition,
    to: CodeDisposition, reasonClass: string, at: string,
  ) => Promise<boolean>;
  readonly stampAbuseFingerprint: (budgetSpaceId: string, invitationId: string, fingerprint: string) => Promise<void>;

  // --- the ceremony ----------------------------------------------------------
  readonly readCeremony: (budgetSpaceId: string, ceremonyId: string) => Promise<CeremonyRecord | null>;
  readonly listCeremonies: (budgetSpaceId: string, invitationId: string) => Promise<readonly CeremonyRecord[]>;
  readonly insertCeremony: (record: CeremonyRecord) => Promise<void>;
  readonly updateCeremony: (budgetSpaceId: string, ceremonyId: string, patch: CeremonyPatch) => Promise<boolean>;

  // --- the confirmation ------------------------------------------------------
  readonly readConfirmation: (budgetSpaceId: string, confirmationId: string) => Promise<ConfirmationRecord | null>;
  readonly listConfirmations: (budgetSpaceId: string, invitationId: string) => Promise<readonly ConfirmationRecord[]>;
  readonly insertConfirmation: (record: ConfirmationRecord) => Promise<void>;
  readonly updateConfirmation: (budgetSpaceId: string, confirmationId: string, patch: ConfirmationPatch) => Promise<boolean>;

  // --- the simulated delivery outbox ----------------------------------------
  readonly insertOutbox: (row: OutboxInsert) => Promise<void>;
  readonly readOutbox: (invitationId: string) => Promise<OutboxRecord | null>;
  readonly tombstoneOutbox: (invitationId: string, reason: OutboxTombstoneReason, at: string) => Promise<void>;

  // --- membership, consent and identity -------------------------------------
  readonly readActiveMembership: (budgetSpaceId: string, accountSubjectId: string) => Promise<MembershipRecord | null>;
  readonly listMemberships: (budgetSpaceId: string, accountSubjectId?: string) => Promise<readonly MembershipRecord[]>;
  readonly insertMembership: (record: MembershipRecord) => Promise<void>;
  readonly insertConsent: (record: AcceptanceConsentRecord) => Promise<void>;
  /** `display_name` and the profile version only. Never a contact, never another space (SS9, `PK5-04`). */
  readonly readDisplayIdentity: (accountSubjectId: string) => Promise<DisplayIdentity | null>;
  /** Sets `display_name` and advances `financial_profile.version` in the same statement (`SEC-PK2-F08`). */
  readonly writeDisplayName: (accountSubjectId: string, displayName: string | null, expectedVersion: number) => Promise<number | null>;

  // --- audit and notices -----------------------------------------------------
  readonly insertAudit: (event: LifecycleAuditEvent) => Promise<void>;
  readonly insertSecurityEvent: (event: SecurityEvent) => Promise<void>;
  readonly insertNotice: (notice: LifecycleNotice) => Promise<void>;

  // --- the space -------------------------------------------------------------
  readonly readBudgetSpace: (budgetSpaceId: string) => Promise<BudgetSpaceFacts | null>;
}

// ---------------------------------------------------------------------------
// The typed statement set the data-access adapter is composed from. Field
// names are the table columns; the shapes match the row types exported by
// packages/data-access/src/budget-space-invitation*.ts structurally, so that
// this package still imports no database module.
// ---------------------------------------------------------------------------

export interface BudgetSpaceInvitationRow {
  readonly invitation_id: string;
  readonly budget_space_id: string;
  readonly kind: string;
  readonly created_by_membership_id: string;
  readonly created_by_subject_id: string;
  readonly required_permission: string;
  readonly creating_authorization_version: number;
  readonly channel_type: string;
  readonly destination_token: string;
  readonly destination_masked: string;
  readonly proposed_role: string;
  readonly resource_scope: string;
  readonly disclosure_kind: string;
  readonly disclosure_version: number;
  readonly disclosure_digest: string;
  readonly policy_version: string;
  readonly policy_digest: string;
  readonly invitation_version: number;
  readonly state: string;
  readonly state_version: number;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly projection_inactive_at: string;
  readonly projection_state: string;
  readonly private_terminal_cause: string | null;
  readonly predecessor_invitation_id: string | null;
  readonly successor_invitation_id: string | null;
  readonly candidate_subject_id: string | null;
  readonly accepted_membership_id: string | null;
  readonly commit_idempotency_key: string | null;
  readonly commit_request_digest: string | null;
  readonly committed_response: unknown | null;
}

export interface BudgetSpaceInvitationCodeRow {
  readonly invitation_id: string;
  readonly budget_space_id: string;
  readonly code_selector: string | null;
  readonly verifier_digest: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly disposition: string;
  readonly disposition_reason_class: string | null;
  readonly disposition_at: string | null;
  readonly abuse_fingerprint: string | null;
}

export interface BudgetSpaceInvitationCeremonyRow {
  readonly ceremony_id: string;
  readonly budget_space_id: string;
  readonly invitation_id: string;
  readonly ceremony_secret_digest: string;
  readonly is_current: boolean;
  readonly channel_proof_state: string;
  readonly channel_challenge_digest: string | null;
  readonly channel_attempts: number;
  readonly channel_proved_at: string | null;
  readonly attached_subject_id: string | null;
  readonly attached_session_ref: string | null;
  readonly attached_at: string | null;
  readonly primary_contact_match: boolean | null;
  readonly disclosure_kind: string;
  readonly disclosure_version: number;
  readonly disclosure_digest: string;
  readonly acceptance_action_at: string | null;
  readonly accepted_disclosure_version: number | null;
  readonly state: string;
  readonly expires_at: string;
  readonly environment: string;
}

export interface BudgetSpaceInvitationConfirmationRow {
  readonly confirmation_id: string;
  readonly budget_space_id: string;
  readonly invitation_id: string;
  readonly ceremony_id: string;
  readonly acceptor_subject_id: string;
  readonly displayed_identity_version: number;
  readonly binding_rule_id: string;
  readonly binding_rule_version: number;
  readonly state: string;
  readonly expires_at: string;
  readonly decided_by_membership_id: string | null;
  readonly decided_by_subject_id: string | null;
  readonly decided_at: string | null;
  readonly decided_authorization_version: number | null;
  readonly committed_consent_id: string | null;
}

export interface BudgetSpaceInvitationOutboxRow {
  readonly outbox_id: string;
  readonly invitation_id: string;
  readonly channel_type: string;
  readonly fidelity_label: string;
  readonly delivery_state: string;
  readonly rendered_at: string | null;
  readonly custody_deadline: string;
  readonly tombstoned_at: string | null;
  readonly tombstone_reason_class: string | null;
}

export interface BudgetSpaceMembershipRow {
  readonly membership_id: string;
  readonly budget_space_id: string;
  readonly profile_id: string;
  readonly account_subject_id: string;
  readonly role: string;
  readonly status: string;
  readonly authorization_version: number;
  readonly created_by_subject_id: string;
  readonly ended_at: string | null;
}

export interface FinancialProfileDisplayRow {
  readonly profile_id: string;
  readonly account_subject_id: string;
  readonly profile_state: string;
  readonly display_name: string | null;
  readonly version: number;
}

export interface BudgetSpaceFactsRow {
  readonly budget_space_id: string;
  readonly name: string;
  readonly lifecycle: string;
}

/** The whole statement surface the data-access adapter needs, one member per table operation. */
export interface InvitationStatements {
  readonly readInvitation: (budgetSpaceId: string, invitationId: string) => Promise<BudgetSpaceInvitationRow | null>;
  readonly listInvitations: (budgetSpaceId: string) => Promise<readonly BudgetSpaceInvitationRow[]>;
  readonly insertInvitation: (row: BudgetSpaceInvitationRow, destinationCiphertext: Uint8Array) => Promise<void>;
  readonly updateInvitation: (
    budgetSpaceId: string, invitationId: string, expectedStateVersion: number,
    set: Readonly<Record<string, unknown>>,
  ) => Promise<number>;

  readonly readCode: (budgetSpaceId: string, invitationId: string) => Promise<BudgetSpaceInvitationCodeRow | null>;
  readonly insertCode: (row: BudgetSpaceInvitationCodeRow) => Promise<void>;
  readonly updateCode: (
    budgetSpaceId: string, invitationId: string, fromDisposition: string, set: Readonly<Record<string, unknown>>,
  ) => Promise<number>;
  readonly setCodeFingerprint: (budgetSpaceId: string, invitationId: string, fingerprint: string) => Promise<number>;

  readonly readCeremony: (budgetSpaceId: string, ceremonyId: string) => Promise<BudgetSpaceInvitationCeremonyRow | null>;
  readonly listCeremonies: (budgetSpaceId: string, invitationId: string) => Promise<readonly BudgetSpaceInvitationCeremonyRow[]>;
  readonly insertCeremony: (row: BudgetSpaceInvitationCeremonyRow) => Promise<void>;
  readonly updateCeremony: (budgetSpaceId: string, ceremonyId: string, set: Readonly<Record<string, unknown>>) => Promise<number>;

  readonly readConfirmation: (budgetSpaceId: string, confirmationId: string) => Promise<BudgetSpaceInvitationConfirmationRow | null>;
  readonly listConfirmations: (budgetSpaceId: string, invitationId: string) => Promise<readonly BudgetSpaceInvitationConfirmationRow[]>;
  readonly insertConfirmation: (row: BudgetSpaceInvitationConfirmationRow) => Promise<void>;
  readonly updateConfirmation: (budgetSpaceId: string, confirmationId: string, set: Readonly<Record<string, unknown>>) => Promise<number>;

  readonly insertOutbox: (row: OutboxInsert) => Promise<void>;
  readonly readOutbox: (invitationId: string) => Promise<BudgetSpaceInvitationOutboxRow | null>;
  readonly tombstoneOutbox: (invitationId: string, reasonClass: string, at: string) => Promise<number>;
  /** `PK5-F02`: the one code row carrying this selector, with its binding material, or null. Never a raw bearer. */
  readonly locateCodeBySelector: (codeSelector: string) => Promise<LiveCodeBinding | null>;
  /** The code rows issued before the selector existed, the only set the presented-code scan still runs over. Never a raw bearer. */
  readonly listLegacyCodes: () => Promise<readonly LiveCodeBinding[]>;
  readonly locateCeremony: (ceremonyId: string) => Promise<{ readonly budget_space_id: string; readonly invitation_id: string } | null>;

  readonly listMemberships: (budgetSpaceId: string, accountSubjectId?: string) => Promise<readonly BudgetSpaceMembershipRow[]>;
  readonly insertMembership: (row: BudgetSpaceMembershipRow) => Promise<void>;
  readonly insertConsent: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) => Promise<void>;

  readonly readDisplayIdentity: (accountSubjectId: string) => Promise<FinancialProfileDisplayRow | null>;
  readonly writeDisplayName: (accountSubjectId: string, displayName: string | null, expectedVersion: number) => Promise<number | null>;

  readonly insertAudit: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly insertSecurityEvent: (values: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly insertNotice: (values: Readonly<Record<string, unknown>>) => Promise<void>;

  readonly readBudgetSpace: (budgetSpaceId: string) => Promise<BudgetSpaceFactsRow | null>;
}
