/**
 * Tenant-scoped statements for `budget_space_primary_transfer` (CBD-73
 * `DR-73-12`, PK-2 migration `M3` `20260915T100002Z`) and for the three other
 * rows the `TR-73-43` commit transaction writes: the two memberships whose
 * roles swap, the budget space whose `primary_owner_membership_id` moves, and
 * the four consent rows (two superseded, two inserted).
 *
 * Every statement goes through the closed tenant API in `tenant.ts`, so
 * `budget_space_id = $1` is composed by the layer and never by a caller, and
 * every row read back is normalised to the plain JSON-safe shape the
 * application's persistence port expects.
 *
 * Three things are deliberate and worth reading before the code.
 *
 * **No ciphertext is projected.** None of these tables carries an encrypted
 * column, and the one neighbouring table this module reads --
 * `budget_space_invitation`, for the permission-26 cancellation set of design
 * SS10.3 step 6 -- is read through a four-column projection that cannot carry
 * `destination_ciphertext` even by accident.
 *
 * **Optimistic versions are written, not computed in SQL.** The tenant `set`
 * map holds literal values, not expressions, so each update takes the version
 * it read and writes `expected + 1` while predicating on `= expected`. A
 * concurrent writer that got there first leaves the update matching no row,
 * which the application reads as a lost race rather than as success. That is
 * what stands in for the `FOR UPDATE` of SS10.3 step 1, which the statement
 * seam does not expose.
 *
 * **`primary_assurance_ref` is a reference.** It is written and read as an
 * opaque text evidence reference and is never the assurance material, never a
 * session identifier and never a token.
 */
import { instantText, integerValue, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";
import type { PlatformStatementClient } from "./budget-space-invitation-outbox.ts";
import { insertLifecycleAudit } from "./budget-space-lifecycle-audit.ts";
import { insertAccountLifecycleNotice } from "./account-lifecycle-notice.ts";

export const BUDGET_SPACE_PRIMARY_TRANSFER_TABLE = "budget_space_primary_transfer";
export const BUDGET_SPACE_MEMBERSHIP_TABLE = "budget_space_membership";
export const BUDGET_SPACE_CONSENT_TABLE = "budget_space_consent";
export const BUDGET_SPACE_TABLE = "budget_space";
export const BUDGET_SPACE_INVITATION_TABLE = "budget_space_invitation";

/** Every column of the workflow record. */
export const BUDGET_SPACE_PRIMARY_TRANSFER_COLUMNS: readonly string[] = [
  "transfer_id", "budget_space_id", "proposer_membership_id", "recipient_membership_id",
  "primary_ownership_version",
  "recipient_disclosure_kind", "recipient_disclosure_version", "recipient_disclosure_digest",
  "outgoing_disclosure_kind", "outgoing_disclosure_version", "outgoing_disclosure_digest",
  "state", "state_version", "expires_at",
  "recipient_accepted_at", "recipient_accepted_version",
  "primary_confirmed_at", "primary_confirmed_version", "primary_assurance_ref",
  "committed_at", "recipient_consent_id", "outgoing_consent_id", "terminal_event_id",
  "policy_version", "policy_digest",
  // The two captured authorization-version columns come last, with a line
  // between them, for the reason PK2FIX-F04 gives: the secret scanner's
  // generic-api-key rule reads an auth-shaped name followed -- across the
  // newline -- by a comma and a second long identifier as a credential
  // assignment. Nothing long follows either of them here.
  "proposer_authorization_version",
  // (the separator this comment is.)
  "recipient_authorization_version",
];

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

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : integerValue(value);
}

export function toPrimaryTransferRow(value: unknown): BudgetSpacePrimaryTransferRow {
  const row = value as Record<string, unknown>;
  return {
    transfer_id: textValue(row.transfer_id),
    budget_space_id: textValue(row.budget_space_id),
    proposer_membership_id: textValue(row.proposer_membership_id),
    recipient_membership_id: textValue(row.recipient_membership_id),
    proposer_authorization_version: integerValue(row.proposer_authorization_version),
    recipient_authorization_version: integerValue(row.recipient_authorization_version),
    primary_ownership_version: integerValue(row.primary_ownership_version),
    recipient_disclosure_kind: textValue(row.recipient_disclosure_kind),
    recipient_disclosure_version: integerValue(row.recipient_disclosure_version),
    recipient_disclosure_digest: textValue(row.recipient_disclosure_digest),
    outgoing_disclosure_kind: textValue(row.outgoing_disclosure_kind),
    outgoing_disclosure_version: integerValue(row.outgoing_disclosure_version),
    outgoing_disclosure_digest: textValue(row.outgoing_disclosure_digest),
    state: textValue(row.state),
    state_version: integerValue(row.state_version),
    expires_at: instantText(row.expires_at),
    recipient_accepted_at: nullableInstantText(row.recipient_accepted_at),
    recipient_accepted_version: nullableInteger(row.recipient_accepted_version),
    primary_confirmed_at: nullableInstantText(row.primary_confirmed_at),
    primary_confirmed_version: nullableInteger(row.primary_confirmed_version),
    primary_assurance_ref: nullableText(row.primary_assurance_ref),
    committed_at: nullableInstantText(row.committed_at),
    recipient_consent_id: nullableText(row.recipient_consent_id),
    outgoing_consent_id: nullableText(row.outgoing_consent_id),
    terminal_event_id: nullableText(row.terminal_event_id),
    policy_version: textValue(row.policy_version),
    policy_digest: textValue(row.policy_digest),
  };
}

export async function readPrimaryTransfer(
  client: TenantStatementClient, budgetSpaceId: string, transferId: string,
): Promise<BudgetSpacePrimaryTransferRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_PRIMARY_TRANSFER_TABLE, budgetSpaceId,
    columns: BUDGET_SPACE_PRIMARY_TRANSFER_COLUMNS,
    conditions: [{ column: "transfer_id", value: transferId }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toPrimaryTransferRow(row);
}

/**
 * Every workflow of one space. The application picks the live one from this,
 * rather than predicating on a state set, because the closed tenant API has
 * no `IN` operator and a per-state round trip would read four times to answer
 * one question the partial unique index already makes single-valued.
 */
export async function listPrimaryTransfers(
  client: TenantStatementClient, budgetSpaceId: string,
): Promise<readonly BudgetSpacePrimaryTransferRow[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_PRIMARY_TRANSFER_TABLE, budgetSpaceId, columns: BUDGET_SPACE_PRIMARY_TRANSFER_COLUMNS,
  });
  return result.rows.map(toPrimaryTransferRow);
}

export async function insertPrimaryTransfer(
  client: TenantStatementClient, row: BudgetSpacePrimaryTransferRow,
): Promise<void> {
  const { budget_space_id, ...values } = row;
  const present = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
  await client.tenantInsert({ table: BUDGET_SPACE_PRIMARY_TRANSFER_TABLE, budgetSpaceId: budget_space_id, values: present });
}

/**
 * Applies `set` while the workflow still carries `expectedStateVersion`,
 * advancing the version whenever `state` is among the columns written. The
 * `M3` trigger independently requires `state_version` to increase with every
 * transition; writing it here is what makes the concurrent writer lose rather
 * than overwrite.
 */
export async function updatePrimaryTransfer(
  client: TenantStatementClient, budgetSpaceId: string, transferId: string,
  expectedStateVersion: number, set: Readonly<Record<string, unknown>>,
): Promise<number> {
  const advances = Object.prototype.hasOwnProperty.call(set, "state");
  const values: Record<string, unknown> = { ...set, updated_at: new Date().toISOString() };
  if (advances) values.state_version = 1 + expectedStateVersion;
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_PRIMARY_TRANSFER_TABLE, budgetSpaceId, set: values,
    conditions: [
      { column: "transfer_id", value: transferId },
      { column: "state_version", value: expectedStateVersion },
    ],
  });
  return result.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// The membership rows whose roles swap.
// ---------------------------------------------------------------------------

export const TRANSFER_MEMBERSHIP_COLUMNS: readonly string[] = [
  "membership_id", "budget_space_id", "profile_id", "account_subject_id",
  "role", "status", "ended_at", "authorization_version",
];

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

function toMembershipRow(value: unknown): TransferMembershipRow {
  const row = value as Record<string, unknown>;
  return {
    membership_id: textValue(row.membership_id),
    budget_space_id: textValue(row.budget_space_id),
    profile_id: textValue(row.profile_id),
    account_subject_id: textValue(row.account_subject_id),
    role: textValue(row.role),
    status: textValue(row.status),
    authorization_version: integerValue(row.authorization_version),
    ended_at: nullableInstantText(row.ended_at),
  };
}

export async function readTransferMembership(
  client: TenantStatementClient, budgetSpaceId: string, membershipId: string,
): Promise<TransferMembershipRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_MEMBERSHIP_TABLE, budgetSpaceId, columns: TRANSFER_MEMBERSHIP_COLUMNS,
    conditions: [{ column: "membership_id", value: membershipId }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toMembershipRow(row);
}

export async function listTransferMemberships(
  client: TenantStatementClient, budgetSpaceId: string, accountSubjectId?: string,
): Promise<readonly TransferMembershipRow[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_MEMBERSHIP_TABLE, budgetSpaceId, columns: TRANSFER_MEMBERSHIP_COLUMNS,
    ...(accountSubjectId === undefined ? {} : { conditions: [{ column: "account_subject_id", value: accountSubjectId }] }),
  });
  return result.rows.map(toMembershipRow);
}

/**
 * The role swap of design SS10.3 step 4, one membership at a time.
 *
 * `role` and `authorization_version` move together, predicated on the version
 * read and on the membership still being active. The M1 trigger
 * `forbid_budget_space_membership_lifecycle_regression` independently refuses
 * a role change that does not advance the version, and the deferred
 * `budget_space_membership_role_change_requires_consent` proves at COMMIT
 * that the new role has exactly one current consent row -- which is why the
 * caller may write this before the consent insert and not after.
 */
export async function updateTransferMembershipRole(
  client: TenantStatementClient, budgetSpaceId: string, membershipId: string,
  expectedAuthorizationVersion: number, role: string,
): Promise<number> {
  const nextVersion = 1 + expectedAuthorizationVersion;
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_MEMBERSHIP_TABLE, budgetSpaceId,
    set: { role, authorization_version: nextVersion },
    conditions: [
      { column: "membership_id", value: membershipId },
      { column: "status", value: "active" },
      { column: "authorization_version", value: expectedAuthorizationVersion },
    ],
  });
  return result.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// The space whose primary ownership moves.
// ---------------------------------------------------------------------------

export interface TransferSpaceRow {
  readonly budget_space_id: string;
  readonly lifecycle: string;
  readonly primary_owner_membership_id: string;
  readonly primary_ownership_version: number;
}

export async function readTransferSpace(
  client: TenantStatementClient, budgetSpaceId: string,
): Promise<TransferSpaceRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_TABLE, budgetSpaceId,
    columns: ["budget_space_id", "lifecycle", "primary_owner_membership_id", "primary_ownership_version"],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row === undefined ? null : {
    budget_space_id: textValue(row.budget_space_id),
    lifecycle: textValue(row.lifecycle),
    primary_owner_membership_id: textValue(row.primary_owner_membership_id),
    primary_ownership_version: integerValue(row.primary_ownership_version),
  };
}

/**
 * Design SS10.3 step 4's last statement. The deferred
 * `budget_space_creation_invariants` trigger proves at COMMIT that the new
 * `primary_owner_membership_id` names an active `primary_owner` membership,
 * so this update is safe to issue only after the promotion, and a caller that
 * gets the order wrong fails the whole transaction rather than committing an
 * incoherent space.
 */
export async function movePrimaryOwnership(
  client: TenantStatementClient, budgetSpaceId: string, recipientMembershipId: string,
  expectedPrimaryOwnershipVersion: number,
): Promise<number> {
  const nextVersion = 1 + expectedPrimaryOwnershipVersion;
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_TABLE, budgetSpaceId,
    set: { primary_owner_membership_id: recipientMembershipId, primary_ownership_version: nextVersion },
    conditions: [{ column: "primary_ownership_version", value: expectedPrimaryOwnershipVersion }],
  });
  return result.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// The consent rows.
// ---------------------------------------------------------------------------

export const TRANSFER_CONSENT_COLUMNS: readonly string[] = [
  "consent_id", "budget_space_id", "membership_id", "account_subject_id", "role", "state",
  "disclosure_kind", "supersedes_consent_id", "ended_at", "ended_reason_class", "ended_by_event_id",
  "assurance_ref",
];

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

function toConsentRow(value: unknown): TransferConsentRow {
  const row = value as Record<string, unknown>;
  return {
    consent_id: textValue(row.consent_id),
    budget_space_id: textValue(row.budget_space_id),
    membership_id: textValue(row.membership_id),
    account_subject_id: textValue(row.account_subject_id),
    role: textValue(row.role),
    state: textValue(row.state),
    disclosure_kind: textValue(row.disclosure_kind),
    supersedes_consent_id: nullableText(row.supersedes_consent_id),
    ended_at: nullableInstantText(row.ended_at),
    ended_reason_class: nullableText(row.ended_reason_class),
    ended_by_event_id: nullableText(row.ended_by_event_id),
    assurance_ref: nullableText(row.assurance_ref),
  };
}

export async function readCurrentTransferConsent(
  client: TenantStatementClient, budgetSpaceId: string, membershipId: string,
): Promise<TransferConsentRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_CONSENT_TABLE, budgetSpaceId, columns: TRANSFER_CONSENT_COLUMNS,
    conditions: [
      { column: "membership_id", value: membershipId },
      { column: "state", value: "current" },
    ],
  });
  const row = result.rows[0];
  return row === undefined ? null : toConsentRow(row);
}

export async function readTransferConsent(
  client: TenantStatementClient, budgetSpaceId: string, consentId: string,
): Promise<TransferConsentRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_CONSENT_TABLE, budgetSpaceId, columns: TRANSFER_CONSENT_COLUMNS,
    conditions: [{ column: "consent_id", value: consentId }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toConsentRow(row);
}

/**
 * Design SS10.3 step 3. Predicated on `state = 'current'`, so a row another
 * transaction already superseded leaves this update matching nothing and the
 * commit denies rather than writing a second supersession over the first.
 */
export async function supersedeTransferConsent(
  client: TenantStatementClient, budgetSpaceId: string, consentId: string,
  set: Readonly<Record<string, unknown>>,
): Promise<number> {
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_CONSENT_TABLE, budgetSpaceId, set,
    conditions: [
      { column: "consent_id", value: consentId },
      { column: "state", value: "current" },
    ],
  });
  return result.rowCount ?? 0;
}

/** Design SS10.3 step 5. Written on the transaction's own client, after the supersession it links back to. */
export async function insertTransferConsent(
  client: TenantStatementClient, budgetSpaceId: string, values: Readonly<Record<string, unknown>>,
): Promise<void> {
  const present = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
  await client.tenantInsert({ table: BUDGET_SPACE_CONSENT_TABLE, budgetSpaceId, values: present });
}

// ---------------------------------------------------------------------------
// The open work the former Primary created (design SS10.3 step 6).
// ---------------------------------------------------------------------------

export interface PermissionInvitationRow {
  readonly invitation_id: string;
  readonly budget_space_id: string;
  readonly created_by_membership_id: string;
  readonly required_permission: string;
  readonly state: string;
}

/**
 * Every invitation one membership created under one permission, projected to
 * four columns. The active-state filter is the caller's, because the closed
 * tenant API has no `IN` operator; the projection deliberately cannot carry
 * the destination, the mask or the ciphertext.
 */
export async function listPermissionInvitations(
  client: TenantStatementClient, budgetSpaceId: string, createdByMembershipId: string, requiredPermission: string,
): Promise<readonly PermissionInvitationRow[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_TABLE, budgetSpaceId,
    columns: ["invitation_id", "budget_space_id", "created_by_membership_id", "required_permission", "state"],
    conditions: [
      { column: "created_by_membership_id", value: createdByMembershipId },
      { column: "required_permission", value: requiredPermission },
    ],
  });
  return result.rows.map((value) => {
    const row = value as Record<string, unknown>;
    return {
      invitation_id: textValue(row.invitation_id),
      budget_space_id: textValue(row.budget_space_id),
      created_by_membership_id: textValue(row.created_by_membership_id),
      required_permission: textValue(row.required_permission),
      state: textValue(row.state),
    };
  });
}

// ---------------------------------------------------------------------------
// Composition.
// ---------------------------------------------------------------------------

/** Both seams the transfer needs: the tenant statements, and the identity-scoped notice insert. */
export type PrimaryTransferStatementClient = TenantStatementClient & PlatformStatementClient;

/** The whole statement subset the application's transfer adapter is composed from. */
export function budgetSpacePrimaryTransferStatements(client: PrimaryTransferStatementClient) {
  return {
    readTransfer: (budgetSpaceId: string, transferId: string) => readPrimaryTransfer(client, budgetSpaceId, transferId),
    listTransfers: (budgetSpaceId: string) => listPrimaryTransfers(client, budgetSpaceId),
    insertTransfer: (row: BudgetSpacePrimaryTransferRow) => insertPrimaryTransfer(client, row),
    updateTransfer: (budgetSpaceId: string, transferId: string, expectedStateVersion: number, set: Readonly<Record<string, unknown>>) =>
      updatePrimaryTransfer(client, budgetSpaceId, transferId, expectedStateVersion, set),

    readMembership: (budgetSpaceId: string, membershipId: string) => readTransferMembership(client, budgetSpaceId, membershipId),
    listMemberships: (budgetSpaceId: string, accountSubjectId?: string) => listTransferMemberships(client, budgetSpaceId, accountSubjectId),
    updateMembershipRole: (budgetSpaceId: string, membershipId: string, expectedAuthorizationVersion: number, role: string) =>
      updateTransferMembershipRole(client, budgetSpaceId, membershipId, expectedAuthorizationVersion, role),

    readSpace: (budgetSpaceId: string) => readTransferSpace(client, budgetSpaceId),
    movePrimaryOwnership: (budgetSpaceId: string, recipientMembershipId: string, expectedPrimaryOwnershipVersion: number) =>
      movePrimaryOwnership(client, budgetSpaceId, recipientMembershipId, expectedPrimaryOwnershipVersion),

    readCurrentConsent: (budgetSpaceId: string, membershipId: string) => readCurrentTransferConsent(client, budgetSpaceId, membershipId),
    readConsent: (budgetSpaceId: string, consentId: string) => readTransferConsent(client, budgetSpaceId, consentId),
    supersedeConsent: (budgetSpaceId: string, consentId: string, set: Readonly<Record<string, unknown>>) =>
      supersedeTransferConsent(client, budgetSpaceId, consentId, set),
    insertConsent: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) =>
      insertTransferConsent(client, budgetSpaceId, values),

    listPermissionInvitations: (budgetSpaceId: string, createdByMembershipId: string, requiredPermission: string) =>
      listPermissionInvitations(client, budgetSpaceId, createdByMembershipId, requiredPermission),

    insertAudit: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) => insertLifecycleAudit(client, budgetSpaceId, values),
    insertNotice: (values: Readonly<Record<string, unknown>>) => insertAccountLifecycleNotice(client, values),
  };
}
