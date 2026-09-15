/**
 * Persistence and environment ports for the Primary-transfer module (PK-7A).
 *
 * Shaped after `../invitations/ports.ts`: `PrimaryTransferRepository` is what
 * the commands talk to, two adapters implement it
 * (`InMemoryPrimaryTransferRepository` for unit tests and
 * `dataAccessPrimaryTransferRepository` over the statement set
 * `@cobudget/data-access` exposes for the `M3` table and the rows the commit
 * touches), and the statement set is described here structurally so this
 * package keeps its CBD-232 SS3.1 boundary -- no database import anywhere
 * under `src/primary-transfer`.
 *
 * Every write the commands make runs inside the transaction the caller
 * already holds; the repository never opens one of its own. The caller opens
 * it `serializable`, which is what makes design SS10.3's atomicity and the
 * concurrency claims of `PK7A-01`/`PK7A-02` true.
 *
 * **Assurance is an input, never a read.** Nothing in this module reads a
 * session, a grant or an assurance level. `ActorContext.freshAssuranceRef`
 * carries the *reference* the authorizing boundary produced after it spent
 * the grant, and this module records it and compares it for equality with
 * what the workflow already stored. That is the whole of its relationship
 * with `29.transfer_primary_ownership`'s `fresh_assurance` obligation
 * (`SEC-PK4-R2`).
 */
import type { ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import type {
  PrimaryTransferRecord, TransferAuditEvent, TransferConsentInsert, TransferConsentRecord,
  TransferMembershipRecord, TransferNotice, TransferSpaceFacts, TransferState,
} from "./records.ts";

export interface Clock {
  /** The current instant as an ISO-8601 UTC string. Server time; never a request value (`IC-73-016`). */
  readonly now: () => string;
}

export interface IdGenerator {
  /** A fresh UUID for a transfer, consent, audit or notice row. */
  readonly uuid: () => string;
}

/** The policy tuple of the allow decision that authorized the command (`PC-236-012`). Never derived here. */
export interface PolicyDecision {
  readonly policyVersion: string;
  readonly policyDigest: string;
  /** The acting membership's `authorization_version` as the decision reloaded it. */
  readonly authorizationVersion: number;
}

/** The CBD-72 permission key every transfer cell is a row of. */
export const TRANSFER_PERMISSION = "29";

/** The action codes design SS10.2 maps to the six routes. */
export const TRANSFER_ACTION_CODES = [
  "29.propose_primary_transfer", "29.accept_primary_transfer", "29.decline_primary_transfer",
  "29.transfer_primary_ownership", "29.withdraw_primary_transfer", "29.view_primary_transfer",
] as const;
export type TransferActionCode = (typeof TRANSFER_ACTION_CODES)[number];

/**
 * The party acting on one transfer command.
 *
 * `permission` and `actionCode` are the cell the allow decision was taken
 * against. They are optional in the type only because the system path
 * (expiry, invalidation) acts on nobody's decision; every actor command
 * **requires** both and answers `permission_mismatch` when either is absent
 * (`SEC-PK5-F02`, `R-03`): an omitted cell is a route that did not decide,
 * not a route that was allowed.
 */
export interface ActorContext {
  readonly budgetSpaceId: string;
  readonly subjectId: string;
  readonly membershipId: string;
  readonly decision: PolicyDecision;
  readonly permission?: typeof TRANSFER_PERMISSION;
  readonly actionCode?: TransferActionCode;
  /**
   * The reference to the fresh-assurance evidence the boundary spent for
   * `29.transfer_primary_ownership`. Required on confirm and absent
   * everywhere else. Never the evidence, never a token, never a session.
   */
  readonly freshAssuranceRef?: string;
  /** The correlation id of the request, shared by every audit row and notice the command writes. */
  readonly correlationId: string;
}

export interface TransferPatch {
  readonly state?: TransferState;
  readonly recipientAcceptedAt?: string | null;
  readonly recipientAcceptedVersion?: number | null;
  readonly primaryConfirmedAt?: string | null;
  readonly primaryConfirmedVersion?: number | null;
  readonly primaryAssuranceRef?: string | null;
  readonly committedAt?: string | null;
  readonly recipientConsentId?: string | null;
  readonly outgoingConsentId?: string | null;
  readonly terminalEventId?: string | null;
}

/** The end-of-life columns a superseded consent row takes (design SS10.3 step 3). */
export interface ConsentSupersedePatch {
  readonly endedAt: string;
  readonly endedReasonClass: string;
  readonly endedByEventId: string;
}

/**
 * One active invitation the former Primary created under the permission they
 * are about to lose (design SS10.3 step 6).
 */
export interface PermissionLostInvitation {
  readonly invitationId: string;
  readonly budgetSpaceId: string;
  readonly createdByMembershipId: string;
  readonly requiredPermission: string;
  readonly state: string;
}

/**
 * The PK-5 system cancel path, supplied by composition.
 *
 * It is a port rather than a direct import so that this module never depends
 * on the invitation repository, the code custody or the delivery adapter --
 * `persistence/primary-transfer-store.ts` composes `cancelRecord` from
 * `@cobudget/budget-application/invitations` over the same transaction
 * client. Returns the identifiers cancelled, which is what `TR-73-43`'s
 * "exactly one `AE-73-06` per invitation" count is asserted against.
 *
 * `invitationIds` is the set the `invalidate` discharge captured (`R-05`):
 * the canceller acts on those and no other, so the ledger's capture is what
 * the commit acts on for this obligation exactly as for the other three. The
 * implementation still re-reads each row under the space, creator and
 * permission it was captured for and skips one that is no longer active.
 */
export interface PermissionLostInvitationCanceller {
  (input: {
    readonly budgetSpaceId: string;
    readonly createdByMembershipId: string;
    readonly requiredPermission: "26";
    readonly invitationIds: readonly string[];
    readonly correlationId: string;
  }): Promise<readonly string[]>;
}

export interface PrimaryTransferRepository {
  // --- the workflow record ---------------------------------------------------
  readonly readTransfer: (budgetSpaceId: string, transferId: string) => Promise<PrimaryTransferRecord | null>;
  /** The one live workflow of a space, if there is one (the `M3` partial unique index). */
  readonly findLiveTransfer: (budgetSpaceId: string) => Promise<PrimaryTransferRecord | null>;
  readonly insertTransfer: (record: PrimaryTransferRecord) => Promise<void>;
  /**
   * Applies `patch` only while the row still carries `expectedStateVersion`,
   * advancing the version when `state` changes. Returns false when no row
   * matched, which is a lost optimistic race and never a silent no-op.
   */
  readonly updateTransfer: (
    budgetSpaceId: string, transferId: string, expectedStateVersion: number, patch: TransferPatch,
  ) => Promise<boolean>;

  // --- memberships and the space ---------------------------------------------
  readonly readMembership: (budgetSpaceId: string, membershipId: string) => Promise<TransferMembershipRecord | null>;
  /**
   * `role` and `authorization_version` together, predicated on the version
   * read. False is a lost race. The M1 trigger independently requires the
   * version to advance with a role change.
   */
  readonly updateMembershipRole: (
    budgetSpaceId: string, membershipId: string, expectedAuthorizationVersion: number, role: string,
  ) => Promise<boolean>;
  readonly readSpace: (budgetSpaceId: string) => Promise<TransferSpaceFacts | null>;
  /**
   * Moves `primary_owner_membership_id` and bumps `primary_ownership_version`,
   * predicated on the version read. The deferred
   * `budget_space_creation_invariants` trigger proves at COMMIT that the new
   * reference is an active `primary_owner`.
   */
  readonly movePrimaryOwnership: (
    budgetSpaceId: string, recipientMembershipId: string, expectedPrimaryOwnershipVersion: number,
  ) => Promise<boolean>;

  // --- consent ----------------------------------------------------------------
  readonly readCurrentConsent: (budgetSpaceId: string, membershipId: string) => Promise<TransferConsentRecord | null>;
  readonly supersedeConsent: (budgetSpaceId: string, consentId: string, patch: ConsentSupersedePatch) => Promise<boolean>;
  readonly insertConsent: (record: TransferConsentInsert) => Promise<void>;

  // --- open work the former Primary created ----------------------------------
  readonly listPermissionInvitations: (
    budgetSpaceId: string, createdByMembershipId: string, requiredPermission: string,
  ) => Promise<readonly PermissionLostInvitation[]>;

  // --- audit and notices -------------------------------------------------------
  readonly insertAudit: (event: TransferAuditEvent) => Promise<void>;
  readonly insertNotice: (notice: TransferNotice) => Promise<void>;
}

// ---------------------------------------------------------------------------
// The typed statement set the data-access adapter is composed from. Field
// names are the table columns; the shapes match the row types exported by
// packages/data-access/src/budget-space-primary-transfer.ts structurally, so
// that this package still imports no database module.
// ---------------------------------------------------------------------------

export interface BudgetSpacePrimaryTransferRow {
  readonly transfer_id: string;
  readonly budget_space_id: string;
  readonly proposer_membership_id: string;
  readonly recipient_membership_id: string;
  readonly proposer_authorization_version: number;
  readonly recipient_authorization_version: number;
  readonly primary_ownership_version: number;
  readonly recipient_disclosure_kind: string;
  readonly recipient_disclosure_version: number;
  readonly recipient_disclosure_digest: string;
  readonly outgoing_disclosure_kind: string;
  readonly outgoing_disclosure_version: number;
  readonly outgoing_disclosure_digest: string;
  readonly state: string;
  readonly state_version: number;
  readonly expires_at: string;
  readonly recipient_accepted_at: string | null;
  readonly recipient_accepted_version: number | null;
  readonly primary_confirmed_at: string | null;
  readonly primary_confirmed_version: number | null;
  readonly primary_assurance_ref: string | null;
  readonly committed_at: string | null;
  readonly recipient_consent_id: string | null;
  readonly outgoing_consent_id: string | null;
  readonly terminal_event_id: string | null;
  readonly policy_version: string;
  readonly policy_digest: string;
}

export interface TransferMembershipRow {
  readonly membership_id: string;
  readonly budget_space_id: string;
  readonly profile_id: string;
  readonly account_subject_id: string;
  readonly role: string;
  readonly status: string;
  readonly authorization_version: number;
  readonly ended_at: string | null;
}

export interface TransferSpaceRow {
  readonly budget_space_id: string;
  readonly lifecycle: string;
  readonly primary_owner_membership_id: string;
  readonly primary_ownership_version: number;
}

export interface TransferConsentRow {
  readonly consent_id: string;
  readonly budget_space_id: string;
  readonly membership_id: string;
  readonly account_subject_id: string;
  readonly role: string;
  readonly state: string;
  readonly disclosure_kind: string;
  readonly supersedes_consent_id: string | null;
  readonly ended_at: string | null;
  readonly ended_reason_class: string | null;
  readonly ended_by_event_id: string | null;
  readonly assurance_ref: string | null;
}

export interface PermissionInvitationRow {
  readonly invitation_id: string;
  readonly budget_space_id: string;
  readonly created_by_membership_id: string;
  readonly required_permission: string;
  readonly state: string;
}

/** The whole statement surface the data-access adapter needs, one member per table operation. */
export interface PrimaryTransferStatements {
  readonly readTransfer: (budgetSpaceId: string, transferId: string) => Promise<BudgetSpacePrimaryTransferRow | null>;
  readonly listTransfers: (budgetSpaceId: string) => Promise<readonly BudgetSpacePrimaryTransferRow[]>;
  readonly insertTransfer: (row: BudgetSpacePrimaryTransferRow) => Promise<void>;
  readonly updateTransfer: (
    budgetSpaceId: string, transferId: string, expectedStateVersion: number,
    set: Readonly<Record<string, unknown>>,
  ) => Promise<number>;

  readonly readMembership: (budgetSpaceId: string, membershipId: string) => Promise<TransferMembershipRow | null>;
  readonly updateMembershipRole: (
    budgetSpaceId: string, membershipId: string, expectedAuthorizationVersion: number, role: string,
  ) => Promise<number>;

  readonly readSpace: (budgetSpaceId: string) => Promise<TransferSpaceRow | null>;
  readonly movePrimaryOwnership: (
    budgetSpaceId: string, recipientMembershipId: string, expectedPrimaryOwnershipVersion: number,
  ) => Promise<number>;

  readonly readCurrentConsent: (budgetSpaceId: string, membershipId: string) => Promise<TransferConsentRow | null>;
  readonly supersedeConsent: (
    budgetSpaceId: string, consentId: string, set: Readonly<Record<string, unknown>>,
  ) => Promise<number>;
  readonly insertConsent: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) => Promise<void>;

  readonly listPermissionInvitations: (
    budgetSpaceId: string, createdByMembershipId: string, requiredPermission: string,
  ) => Promise<readonly PermissionInvitationRow[]>;

  readonly insertAudit: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly insertNotice: (values: Readonly<Record<string, unknown>>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// The dependency bundle every command takes.
// ---------------------------------------------------------------------------

/** How long a proposed workflow stays live before `TR-73-46` expires it. */
export interface TransferLifetimes {
  readonly transferSeconds: number;
}

/** Seven days, the same order as an invitation's own lifetime. */
export const DEFAULT_TRANSFER_LIFETIMES: TransferLifetimes = Object.freeze({ transferSeconds: 7 * 24 * 60 * 60 });

export interface PrimaryTransferDependencies {
  readonly repository: PrimaryTransferRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** The approved registry. Read server-side; never a request value (`CF-236-005`). */
  readonly disclosures: ConsentDisclosureSource;
  readonly lifetimes?: TransferLifetimes;
  /**
   * The PK-5 system cancel path for design SS10.3 step 6. Absent means the
   * commit **denies** rather than silently committing a transfer that left
   * the former Primary's permission-26 invitations usable.
   */
  readonly cancelPermissionLostInvitations?: PermissionLostInvitationCanceller;
}
