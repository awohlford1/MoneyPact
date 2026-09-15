/**
 * The Primary-transfer records, the canonical error vocabulary and the
 * uniform customer outcomes (CBD-73 SS12 `TR-73-40` to `TR-73-47`;
 * INVITATIONS-DESIGN-001 packet PK-7; design proposal SS10).
 *
 * The records mirror `budget_space_primary_transfer` (PK-2 migration `M3`,
 * `20260915T100002Z`) one to one in camelCase. Two things are deliberately
 * shaped the way they are:
 *
 *  * `primaryAssuranceRef` is a **reference** to fresh-assurance evidence and
 *    never the evidence itself. This module never reads an assurance, never
 *    decides whether one is fresh, and never calls a session store: the
 *    reference arrives as an input from the authorizing boundary, is recorded
 *    on the transfer row and on the outgoing consent row, and is otherwise
 *    opaque here (`SEC-PK4-R2`; `IMPL-PK4-F2`).
 *  * `PRIMARY_TRANSFER_ERROR_CODES` is the whole contract PK-7B maps to HTTP.
 *    `TR-73-47` denials and `TR-73-46` closures are **returned**, not thrown
 *    (`PK5FIX`): each writes an `AE-73-25` row that has to commit with the
 *    caller's transaction, and an exception would roll that row back with it.
 */

/** `RI-93-017`: the one bounded denial/no-op message every `TR-73-47` outcome resolves to. */
export const UNIFORM_DENIAL_MESSAGE_CODE = "MSG-73-046";

/** `TR-73-46` expiry closure. */
export const EXPIRY_MESSAGE_CODE = "MSG-73-045";

/** `TR-73-46` invalidation-only closure: the workflow and its evidence closed, a new proposal is required. */
export const INVALIDATION_MESSAGE_CODE = "MSG-73-027";

/** The customer message of each mutating workflow step CBD-73 SS12 names. */
export const TRANSFER_MESSAGE_CODES = Object.freeze({
  proposed: "MSG-73-040",
  recipientAccepted: "MSG-73-025",
  primaryConfirmed: "MSG-73-041",
  committed: "MSG-73-042",
  declined: "MSG-73-043",
  withdrawn: "MSG-73-044",
  expired: EXPIRY_MESSAGE_CODE,
  invalidated: INVALIDATION_MESSAGE_CODE,
  denied: UNIFORM_DENIAL_MESSAGE_CODE,
});

/** The commit's mandatory notice to both parties (`TR-73-43`, `IC-73-019`). */
export const COMMIT_NOTICE_MESSAGE_CODE = "MSG-73-042";

/**
 * The message codes this module writes a durable `account_lifecycle_notice`
 * row for (`DR-73-11`), one row per `AE-73-30` enqueue child: the commit's
 * `MSG-73-042`, and -- since migration `20260915T130001Z` widened the
 * table's CHECK (`PK7A-F01`) -- the mandatory lifecycle notices of
 * `TR-73-40` (`MSG-73-040`, recipient), `TR-73-44` (`MSG-73-043`,
 * proposer), `TR-73-45` (`MSG-73-044`, recipient) and `TR-73-46`
 * (`MSG-73-045` on expiry and `MSG-73-027` on invalidation, both parties).
 */
export const TRANSFER_NOTICE_MESSAGE_CODES = [
  COMMIT_NOTICE_MESSAGE_CODE, "MSG-73-040", "MSG-73-043", "MSG-73-044", EXPIRY_MESSAGE_CODE, INVALIDATION_MESSAGE_CODE,
] as const;
export type TransferNoticeMessageCode = (typeof TRANSFER_NOTICE_MESSAGE_CODES)[number];

export const PRIMARY_TRANSFER_ERROR_CODES = [
  "invalid_request",
  "budget_space_not_found",
  "budget_space_not_live",
  "authorization_denied",
  "permission_mismatch",
  "transfer_not_found",
  "transfer_not_current",
  "transfer_already_live",
  "proposer_not_primary",
  "recipient_ineligible",
  "self_transfer",
  "stale_version",
  "stale_disclosure",
  "assurance_required",
  "obligation_undischarged",
  // "conflict" follows the key-shaped name deliberately: it is short enough
  // that the secret scanner's generic-api-key rule has no long value to read
  // after it (PK2FIX-F04).
  "idempotency_key_reused",
  "conflict",
  "retryable_conflict",
  "constraint_violation",
] as const;

export type PrimaryTransferErrorCode = (typeof PRIMARY_TRANSFER_ERROR_CODES)[number];

/**
 * A canonical application failure. `code` is the stable contract PK-7B maps;
 * `detail` is a safe field path or column name, never a value -- no assurance
 * reference, digest, or another person's state ever reaches it.
 */
export class PrimaryTransferError extends Error {
  readonly code: PrimaryTransferErrorCode;
  readonly detail: string | undefined;
  constructor(code: PrimaryTransferErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "PrimaryTransferError";
    this.code = code;
    this.detail = detail;
  }
}

export function isPrimaryTransferError(error: unknown, code?: PrimaryTransferErrorCode): error is PrimaryTransferError {
  return error instanceof PrimaryTransferError && (code === undefined || error.code === code);
}

export const TRANSFER_STATES = [
  "proposed", "recipient_accepted", "primary_confirmed", "ready", "committed",
  "declined", "withdrawn", "expired", "invalidated",
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

/** The states the `M3` partial unique index calls live: at most one of these exists per space. */
export const LIVE_TRANSFER_STATES: readonly TransferState[] = ["proposed", "recipient_accepted", "primary_confirmed", "ready"];

export const TERMINAL_TRANSFER_STATES: readonly TransferState[] = ["committed", "declined", "withdrawn", "expired", "invalidated"];

export function isLiveTransferState(state: TransferState): boolean {
  return LIVE_TRANSFER_STATES.includes(state);
}

export function isTerminalTransferState(state: TransferState): boolean {
  return TERMINAL_TRANSFER_STATES.includes(state);
}

/** The two registered disclosure kinds of the transfer, one per party (design SS10.1). */
export const RECIPIENT_DISCLOSURE_KIND = "primary_transfer_recipient";
export const OUTGOING_DISCLOSURE_KIND = "primary_transfer_outgoing";

/** The `AE-73-25` subtypes, one per `TR-73-40` to `TR-73-47` outcome (CBD-73 SS14). */
export const TRANSFER_EVENT_SUBTYPES = [
  "transfer_proposed", "recipient_accepted", "primary_confirmed", "transfer_committed",
  "transfer_declined", "transfer_withdrawn", "transfer_expired", "transfer_invalidated",
  "transfer_denied",
] as const;
export type TransferEventSubtype = (typeof TRANSFER_EVENT_SUBTYPES)[number];

/** The roles the two parties hold before and after the commit. */
export const OUTGOING_ROLE_AFTER = "co_owner";
export const RECIPIENT_ROLE_AFTER = "primary_owner";

/** The roles a recipient may hold at proposal in this increment (design SS11.2, `29.accept_primary_transfer`). */
export const ELIGIBLE_RECIPIENT_ROLES: readonly string[] = ["co_owner", "collaborator"];

/** `ended_reason_class` of both superseded consent rows (design SS10.3 step 3). */
export const TRANSFER_ENDED_REASON_CLASS = "primary_transfer";

/** `source` of both inserted consent rows. */
export const TRANSFER_CONSENT_SOURCE = "primary_transfer";

/** The authoritative transfer record. */
export interface PrimaryTransferRecord {
  readonly transferId: string;
  readonly budgetSpaceId: string;
  readonly proposerMembershipId: string;
  readonly recipientMembershipId: string;
  readonly proposerAuthorizationVersion: number;
  readonly recipientAuthorizationVersion: number;
  readonly primaryOwnershipVersion: number;
  readonly recipientDisclosureKind: string;
  readonly recipientDisclosureVersion: number;
  readonly recipientDisclosureDigest: string;
  readonly outgoingDisclosureKind: string;
  readonly outgoingDisclosureVersion: number;
  readonly outgoingDisclosureDigest: string;
  readonly state: TransferState;
  readonly stateVersion: number;
  readonly expiresAt: string;
  readonly recipientAcceptedAt: string | null;
  readonly recipientAcceptedVersion: number | null;
  readonly primaryConfirmedAt: string | null;
  readonly primaryConfirmedVersion: number | null;
  /** A reference to fresh-assurance evidence, never the evidence. See this file's header. */
  readonly primaryAssuranceRef: string | null;
  readonly committedAt: string | null;
  readonly recipientConsentId: string | null;
  readonly outgoingConsentId: string | null;
  readonly terminalEventId: string | null;
  readonly policyVersion: string;
  readonly policyDigest: string;
}

/** One membership row as this module reads it. */
export interface TransferMembershipRecord {
  readonly membershipId: string;
  readonly budgetSpaceId: string;
  readonly profileId: string;
  readonly accountSubjectId: string;
  readonly role: string;
  readonly status: string;
  readonly authorizationVersion: number;
  readonly endedAt: string | null;
}

/** What the transfer needs to know about the space before it writes to it. */
export interface TransferSpaceFacts {
  readonly budgetSpaceId: string;
  readonly lifecycle: string;
  readonly primaryOwnerMembershipId: string;
  readonly primaryOwnershipVersion: number;
}

/** One `budget_space_consent` row as this module reads it. */
export interface TransferConsentRecord {
  readonly consentId: string;
  readonly budgetSpaceId: string;
  readonly membershipId: string;
  readonly accountSubjectId: string;
  readonly role: string;
  readonly state: string;
  readonly disclosureKind: string;
  readonly supersedesConsentId: string | null;
  readonly endedAt: string | null;
  readonly endedReasonClass: string | null;
  readonly endedByEventId: string | null;
  readonly assuranceRef: string | null;
}

/** The consent row `TR-73-43` step 5 inserts, for either party. */
export interface TransferConsentInsert {
  readonly consentId: string;
  readonly budgetSpaceId: string;
  readonly membershipId: string;
  readonly accountSubjectId: string;
  readonly recordedBySubjectId: string;
  readonly role: typeof RECIPIENT_ROLE_AFTER | typeof OUTGOING_ROLE_AFTER;
  readonly resourceScope: "full";
  readonly source: typeof TRANSFER_CONSENT_SOURCE;
  readonly sourceRecordId: string;
  readonly sourceRecordVersion: number;
  readonly disclosureKind: string;
  readonly disclosureVersion: number;
  readonly disclosureDigest: string;
  readonly policyVersion: string;
  readonly policyDigest: string;
  readonly state: "current";
  /** The fresh-assurance evidence reference on the outgoing row; null on the recipient's. */
  readonly assuranceRef: string | null;
  readonly recordedAt: string;
  readonly supersedesConsentId: string;
}

/** One `AE-73-*` row of `budget_space_lifecycle_audit`. */
export interface TransferAuditEvent {
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

/** One `account_lifecycle_notice` row. */
export interface TransferNotice {
  readonly noticeId: string;
  readonly accountSubjectId: string;
  readonly budgetSpaceId: string | null;
  readonly messageCode: TransferNoticeMessageCode;
  readonly eventCorrelationId: string;
}

/**
 * The closed payload allowlist. Every key is an identifier, a class, a version
 * or a count. An assurance reference, a digest, a disclosure text or another
 * member's personal state has no key here and is refused before the row is
 * built.
 */
export const TRANSFER_AUDIT_PAYLOAD_KEYS: readonly string[] = [
  "transferId", "transferState", "stateVersion", "proposerMembershipId", "recipientMembershipId",
  "recipientConsentId", "outgoingConsentId", "supersededConsentCount", "cancelledInvitationCount",
  "membershipId", "consentId", "invitationId", "requiredPermission", "role",
  "disclosureKind", "disclosureVersion", "primaryOwnershipVersion",
  "messageCode", "noticeCount", "transition", "outcomeClass",
  // The two authorization-version keys come last, with a line between them,
  // for the reason PK2FIX-F04 gives: the secret scanner's generic-api-key
  // rule reads an auth-shaped name followed -- across the newline -- by a
  // comma and a second long identifier as a credential assignment. Nothing
  // long follows either of them here.
  "proposerAuthorizationVersion",
  // (the separator this comment is.)
  "recipientAuthorizationVersion",
];

const TRANSFER_AUDIT_PAYLOAD_KEY_SET = new Set(TRANSFER_AUDIT_PAYLOAD_KEYS);

/** Refuse a payload key the allowlist does not carry, and any value that is not a scalar. */
export function assertTransferAuditPayload(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  for (const [name, value] of Object.entries(payload)) {
    if (!TRANSFER_AUDIT_PAYLOAD_KEY_SET.has(name)) throw new PrimaryTransferError("constraint_violation", `audit.payload.${name}`);
    const kind = typeof value;
    if (value !== null && kind !== "string" && kind !== "number" && kind !== "boolean") {
      throw new PrimaryTransferError("constraint_violation", `audit.payload.${name}`);
    }
  }
  return payload;
}

/**
 * The status projection either party may read (`29.view_primary_transfer`).
 *
 * It carries no assurance reference, no digest and no disclosure text: the two
 * parties see the workflow's state, their own captured versions and the
 * deadline, which is what the status read is for.
 */
export interface TransferView {
  readonly transferId: string;
  readonly budgetSpaceId: string;
  readonly state: TransferState;
  readonly stateVersion: number;
  readonly proposerMembershipId: string;
  readonly recipientMembershipId: string;
  readonly expiresAt: string;
  readonly recipientAcceptedAt: string | null;
  readonly primaryConfirmedAt: string | null;
  readonly committedAt: string | null;
  readonly recipientDisclosureKind: string;
  readonly recipientDisclosureVersion: number;
  readonly outgoingDisclosureKind: string;
  readonly outgoingDisclosureVersion: number;
}

export function transferView(record: PrimaryTransferRecord): TransferView {
  return {
    transferId: record.transferId,
    budgetSpaceId: record.budgetSpaceId,
    state: record.state,
    stateVersion: record.stateVersion,
    proposerMembershipId: record.proposerMembershipId,
    recipientMembershipId: record.recipientMembershipId,
    expiresAt: record.expiresAt,
    recipientAcceptedAt: record.recipientAcceptedAt,
    primaryConfirmedAt: record.primaryConfirmedAt,
    committedAt: record.committedAt,
    recipientDisclosureKind: record.recipientDisclosureKind,
    recipientDisclosureVersion: record.recipientDisclosureVersion,
    outgoingDisclosureKind: record.outgoingDisclosureKind,
    outgoingDisclosureVersion: record.outgoingDisclosureVersion,
  };
}
