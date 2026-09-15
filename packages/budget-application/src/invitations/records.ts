/**
 * The invitation records, the canonical error vocabulary, and the uniform
 * customer outcomes (CBD-73; INVITATIONS-DESIGN-001 packet PK-5;
 * docs/cbd-234-invitations-consent-design-proposal.md SS4, SS4.6, SS8).
 *
 * The records mirror the PK-2 tables one to one in camelCase. Two columns of
 * `budget_space_invitation` are deliberately absent from `InvitationRecord`:
 * `destination_ciphertext`, and every ciphertext of the outbox row. A record
 * this module hands around therefore cannot carry a raw address, bearer or
 * challenge even by accident -- the ciphertext is passed as a separate
 * argument to the one write that needs it and is never projected by a read
 * (CBD-287-AC01 custody; `PK5-04`).
 *
 * `INVITATION_ERROR_CODES` is the whole contract PK-6 maps to HTTP. Two of
 * them are not failures of a particular record but the *uniform* answer
 * CBD-73 SS5.1 item 6 requires: `code_unusable` and `ceremony_unusable` are
 * returned identically for an unknown, malformed, expired, consumed,
 * cancelled, superseded, declined or foreign value, so that presenting a link
 * tells the presenter nothing about whether a record exists.
 */

/** The `MSG-73-003` envelope: the one message every unusable link resolves to. */
export const UNIFORM_LINK_MESSAGE_CODE = "MSG-73-003";

/** The uniform outcome for a presented code (`TR-73-14`). */
export const UNIFORM_LINK_OUTCOME = "code_unusable";

/** The uniform outcome for a presented ceremony (`SS5.2`: an out-of-order or dead ceremony). */
export const UNIFORM_CEREMONY_OUTCOME = "ceremony_unusable";

export const INVITATION_ERROR_CODES = [
  "invalid_request",
  "destination_invalid",
  "proposed_role_unsupported",
  "budget_space_not_found",
  "budget_space_not_live",
  "authorization_denied",
  "permission_mismatch",
  "invitation_not_found",
  "invitation_not_current",
  "stale_version",
  "code_unusable",
  "ceremony_unusable",
  "channel_proof_required",
  // `SEC-PK5-F01`: these two are no longer *thrown*. A wrong or exhausted
  // channel guess is a `VerifyChannelResult` outcome (`retry`, `exhausted`),
  // because throwing rolled the attempt increment and the `AE-73-09` row back
  // with the caller's transaction and left the challenge unbounded. They stay
  // in the vocabulary as the audit `reason_class` values the denial rows
  // carry and as the names PK-6 maps those two outcomes to on the wire.
  "channel_challenge_invalid",
  "channel_attempts_exhausted",
  "attachment_required",
  "already_member",
  "membership_ended_after_issue",
  "subject_ineligible",
  "stale_disclosure",
  "confirmation_not_current",
  // "conflict" follows "idempotency_key_reused" deliberately: it is short
  // enough that the secret scanner's generic-api-key rule has no value to
  // read after the key-shaped name (PK2FIX-F04).
  "idempotency_key_reused",
  "conflict",
  "retryable_conflict",
  "constraint_violation",
] as const;

export type InvitationErrorCode = (typeof INVITATION_ERROR_CODES)[number];

/**
 * A canonical application failure. `code` is the stable contract PK-6 maps;
 * `detail` is a safe field path or column name, never a value -- no address,
 * bearer, challenge, digest or another person's state ever reaches it.
 */
export class InvitationError extends Error {
  readonly code: InvitationErrorCode;
  readonly detail: string | undefined;
  constructor(code: InvitationErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "InvitationError";
    this.code = code;
    this.detail = detail;
  }
}

/** True when `error` is this module's canonical failure with the given code. */
export function isInvitationError(error: unknown, code?: InvitationErrorCode): error is InvitationError {
  return error instanceof InvitationError && (code === undefined || error.code === code);
}

export const INVITATION_KINDS = ["real", "synthetic"] as const;
export type InvitationKind = (typeof INVITATION_KINDS)[number];

export const INVITATION_STATES = [
  "created", "pending", "awaiting_confirmation", "accepted", "declined",
  "expired", "superseded", "cancelled",
  "synthetic_created", "synthetic_pending", "synthetic_inactive",
] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];

/** The active (non-terminal) real states. A record in one of these can still change. */
export const ACTIVE_INVITATION_STATES: readonly InvitationState[] = ["created", "pending", "awaiting_confirmation"];

/** The dispatched states a code and a ceremony may be used against (`SS4.3` rule 5). */
export const CODE_CAPABLE_STATES: readonly InvitationState[] = ["pending"];

export const PROJECTION_STATES = ["pending", "accepted", "replaced", "cancelled", "no_longer_active"] as const;
export type InvitationProjectionState = (typeof PROJECTION_STATES)[number];

export const PRIVATE_TERMINAL_CAUSES = [
  "already_member", "self_invitation", "stale_after_membership_end", "permission_lost", "sibling_accepted",
] as const;
export type PrivateTerminalCause = (typeof PRIVATE_TERMINAL_CAUSES)[number];

/** The two roles this increment may offer (`IV-001`). */
export const INVITABLE_ROLES = ["collaborator", "co_owner"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** The exact CBD-72 permission a creation required; loss of it cancels the record. */
export const REQUIRED_PERMISSIONS = ["24", "26"] as const;
export type RequiredPermission = (typeof REQUIRED_PERMISSIONS)[number];

/** The permission each offered role requires, selected server-side from the body (`SS5.1`). */
export const ROLE_PERMISSION: Readonly<Record<InvitableRole, RequiredPermission>> = Object.freeze({
  collaborator: "24",
  co_owner: "26",
});

/** The registered disclosure kind for each offered role (`SS6`). One kind per role: the version a person saw is one digest. */
export const ROLE_DISCLOSURE_KIND: Readonly<Record<InvitableRole, string>> = Object.freeze({
  collaborator: "invitation_collaborator",
  co_owner: "invitation_co_owner",
});

export const CODE_DISPOSITIONS = ["active", "consumed", "invalidated"] as const;
export type CodeDisposition = (typeof CODE_DISPOSITIONS)[number];

export const CEREMONY_STATES = ["open", "declined", "accepted_pending_confirmation", "consumed", "invalidated"] as const;
export type CeremonyState = (typeof CEREMONY_STATES)[number];

export const CHANNEL_PROOF_STATES = ["none", "challenged", "proved", "exhausted"] as const;
export type ChannelProofState = (typeof CHANNEL_PROOF_STATES)[number];

/** The bounded attempt count the ceremony CHECK admits (`channel_attempts BETWEEN 0 AND 5`). */
export const MAX_CHANNEL_ATTEMPTS = 5;

export const CONFIRMATION_STATES = ["requested", "confirmed", "rejected", "expired"] as const;
export type ConfirmationState = (typeof CONFIRMATION_STATES)[number];

/** The binding rule `DR-73-13` names on every confirmation row. */
export const CONFIRMATION_BINDING_RULE_ID = "CBD-73-5.1";
export const CONFIRMATION_BINDING_RULE_VERSION = 1;

/** `FIDELITY_LABEL`, the same label the CBD-190 local adapter carries: this is a simulation of a delivery. */
export const DELIVERY_FIDELITY_LABEL = "simulated";

/**
 * The closed set `account_lifecycle_notice.message_code` admits: the five
 * invitation and commit notices of `M3`, plus the five Primary-transfer
 * lifecycle notices of `TR-73-40`, `TR-73-44`, `TR-73-45` and `TR-73-46`
 * that migration `20260915T130001Z` widened the CHECK by (`PK7A-F01`).
 */
export const NOTICE_MESSAGE_CODES = [
  "MSG-73-015", "MSG-73-019", "MSG-73-042", "MSG-73-050", "MSG-73-052",
  "MSG-73-040", "MSG-73-043", "MSG-73-044", "MSG-73-045", "MSG-73-027",
] as const;
export type NoticeMessageCode = (typeof NOTICE_MESSAGE_CODES)[number];

export const SECURITY_EVENT_OUTCOME_CLASSES = ["unknown_value", "malformed_value", "terminal_record", "expired_record"] as const;
export type SecurityEventOutcomeClass = (typeof SECURITY_EVENT_OUTCOME_CLASSES)[number];

/**
 * The authoritative invitation record. `destinationCiphertext` is absent on
 * purpose; see this file's header.
 */
export interface InvitationRecord {
  readonly invitationId: string;
  readonly budgetSpaceId: string;
  readonly kind: InvitationKind;
  readonly createdByMembershipId: string;
  readonly createdBySubjectId: string;
  readonly requiredPermission: RequiredPermission;
  readonly creatingAuthorizationVersion: number;
  readonly channelType: "email";
  readonly destinationToken: string;
  readonly destinationMasked: string;
  readonly proposedRole: InvitableRole;
  readonly resourceScope: "full";
  readonly disclosureKind: string;
  readonly disclosureVersion: number;
  readonly disclosureDigest: string;
  readonly policyVersion: string;
  readonly policyDigest: string;
  readonly invitationVersion: number;
  readonly state: InvitationState;
  readonly stateVersion: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly projectionInactiveAt: string;
  readonly projectionState: InvitationProjectionState;
  readonly privateTerminalCause: PrivateTerminalCause | null;
  readonly predecessorInvitationId: string | null;
  readonly successorInvitationId: string | null;
  readonly candidateSubjectId: string | null;
  readonly acceptedMembershipId: string | null;
  readonly commitIdempotencyKey: string | null;
  readonly commitRequestDigest: string | null;
  readonly committedResponse: unknown | null;
}

export interface InvitationCodeRecord {
  readonly invitationId: string;
  readonly budgetSpaceId: string;
  /** `PK5-F02`: the opaque lookup handle issued as the first half of the bearer; null only on rows issued before it existed. */
  readonly codeSelector: string | null;
  readonly verifierDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly disposition: CodeDisposition;
  readonly dispositionReasonClass: string | null;
  readonly dispositionAt: string | null;
  readonly abuseFingerprint: string | null;
}

export interface CeremonyRecord {
  readonly ceremonyId: string;
  readonly budgetSpaceId: string;
  readonly invitationId: string;
  readonly ceremonySecretDigest: string;
  readonly isCurrent: boolean;
  readonly channelProofState: ChannelProofState;
  readonly channelChallengeDigest: string | null;
  readonly channelAttempts: number;
  readonly channelProvedAt: string | null;
  readonly attachedSubjectId: string | null;
  /** The `account_session.session_id` row identifier, never a session token or its verifier (`SEC-PK2-F07`). */
  readonly attachedSessionRef: string | null;
  readonly attachedAt: string | null;
  readonly primaryContactMatch: boolean | null;
  readonly disclosureKind: string;
  readonly disclosureVersion: number;
  readonly disclosureDigest: string;
  readonly acceptanceActionAt: string | null;
  readonly acceptedDisclosureVersion: number | null;
  readonly state: CeremonyState;
  readonly expiresAt: string;
  readonly environment: string;
}

export interface ConfirmationRecord {
  readonly confirmationId: string;
  readonly budgetSpaceId: string;
  readonly invitationId: string;
  readonly ceremonyId: string;
  readonly acceptorSubjectId: string;
  readonly displayedIdentityVersion: number;
  readonly bindingRuleId: string;
  readonly bindingRuleVersion: number;
  readonly state: ConfirmationState;
  readonly expiresAt: string;
  readonly decidedByMembershipId: string | null;
  readonly decidedBySubjectId: string | null;
  readonly decidedAt: string | null;
  readonly decidedAuthorizationVersion: number | null;
  readonly committedConsentId: string | null;
}

/** One `AE-73-*` row of `budget_space_lifecycle_audit` (SS13). Payload keys are allowlisted; see `AUDIT_PAYLOAD_KEYS`. */
export interface LifecycleAuditEvent {
  readonly eventId: string;
  readonly budgetSpaceId: string;
  readonly eventCode: string;
  readonly eventSubtype: string | null;
  readonly occurredAt: string;
  readonly actorSubjectId: string | null;
  readonly actingMembershipId: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly result: "allow" | "deny" | "system";
  readonly reasonClass: string | null;
  readonly policyVersion: string | null;
  readonly policyDigest: string | null;
  readonly correlationId: string;
  readonly audience: "customer" | "restricted";
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The closed payload allowlist (CBD-276-AC06). Every key is an identifier, a
 * class, a version or a count. A raw destination, masked destination, bearer,
 * challenge, digest or another member's personal state has no key here and is
 * refused by {@link assertAuditPayload} before the row is built.
 */
export const AUDIT_PAYLOAD_KEYS: readonly string[] = [
  "invitationId", "invitationVersion", "invitationState", "predecessorInvitationId", "successorInvitationId",
  "ceremonyId", "confirmationId", "membershipId", "consentId", "codeDisposition",
  "proposedRole", "requiredPermission", "resourceScope", "disclosureKind", "disclosureVersion",
  "channelType", "attemptNumber", "attemptsRemaining", "siblingCount", "noticeCount",
  "messageCode", "projectionState", "transition", "outcomeClass",
];

const AUDIT_PAYLOAD_KEY_SET = new Set(AUDIT_PAYLOAD_KEYS);

/** Refuse a payload key the allowlist does not carry, and any value that is not a scalar. */
export function assertAuditPayload(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  for (const [key, value] of Object.entries(payload)) {
    if (!AUDIT_PAYLOAD_KEY_SET.has(key)) throw new InvitationError("constraint_violation", `audit.payload.${key}`);
    const kind = typeof value;
    if (value !== null && kind !== "string" && kind !== "number" && kind !== "boolean") {
      throw new InvitationError("constraint_violation", `audit.payload.${key}`);
    }
  }
  return payload;
}

/** The `AE-73-*` classes CBD-73 SS14 makes security scope only; the schema CHECK refuses `customer` for each. */
export const RESTRICTED_ONLY_EVENT_CODES: readonly string[] = [
  "AE-73-03", "AE-73-04", "AE-73-11", "AE-73-12", "AE-73-26", "AE-73-27",
];

export interface SecurityEvent {
  readonly eventId: string;
  readonly eventCode: "AE-73-14";
  readonly occurredAt: string;
  readonly budgetSpaceId: string | null;
  readonly outcomeClass: SecurityEventOutcomeClass;
  readonly abuseFingerprint: string | null;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface LifecycleNotice {
  readonly noticeId: string;
  readonly accountSubjectId: string;
  readonly budgetSpaceId: string | null;
  readonly messageCode: NoticeMessageCode;
  readonly eventCorrelationId: string;
}

/** The membership row `TR-73-13` step 7 inserts. */
export interface MembershipRecord {
  readonly membershipId: string;
  readonly budgetSpaceId: string;
  readonly profileId: string;
  readonly accountSubjectId: string;
  readonly role: string;
  readonly status: "active" | "revoked" | "removed";
  readonly authorizationVersion: number;
  readonly createdBySubjectId: string;
  readonly endedAt: string | null;
}

/** The consent row `TR-73-13` step 8 inserts, in the `budget_space_consent` shape. */
export interface AcceptanceConsentRecord {
  readonly consentId: string;
  readonly budgetSpaceId: string;
  readonly membershipId: string;
  readonly accountSubjectId: string;
  readonly role: InvitableRole;
  readonly resourceScope: "full";
  readonly source: "invitation_acceptance";
  readonly sourceRecordId: string;
  readonly sourceRecordVersion: number;
  readonly sourceCeremonyId: string;
  readonly disclosureKind: string;
  readonly disclosureVersion: number;
  readonly disclosureDigest: string;
  readonly policyVersion: string;
  readonly policyDigest: string;
  readonly state: "current";
  readonly assuranceRef: null;
  readonly recordedAt: string;
  readonly recordedBySubjectId: string;
  readonly supersedesConsentId: null;
}

/** The display identity of one subject (`DI-91-065`, SS9). `displayName` only -- never a contact, never another space. */
export interface DisplayIdentity {
  readonly accountSubjectId: string;
  readonly profileId: string;
  readonly profileState: string;
  readonly displayName: string | null;
  readonly version: number;
}

/** The neutral label every surface shows until a subject has chosen a display name (SS9). */
export const NEUTRAL_DISPLAY_LABEL = "A MoneyPact member";

/** The allowlisted inviter projection of one invitation. Real and synthetic records are indistinguishable here (`DR-73-10`). */
export interface InvitationProjection {
  readonly invitationId: string;
  readonly destinationMasked: string;
  readonly proposedRole: InvitableRole;
  readonly state: InvitationProjectionState;
  readonly issuedAt: string;
  readonly inactiveAt: string;
  readonly predecessorInvitationId: string | null;
}

/** The customer projection of a record. `kind`, `state` and `privateTerminalCause` never leave the server. */
export function invitationProjection(record: InvitationRecord): InvitationProjection {
  return {
    invitationId: record.invitationId,
    destinationMasked: record.destinationMasked,
    proposedRole: record.proposedRole,
    state: record.projectionState,
    issuedAt: record.issuedAt,
    inactiveAt: record.projectionInactiveAt,
    predecessorInvitationId: record.predecessorInvitationId,
  };
}
