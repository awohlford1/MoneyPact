/**
 * The membership and consent writes of the acceptance transaction
 * (design proposal SS8 steps 5, 7, 8; `IV-013`).
 *
 * The pattern is `consent-store.ts`'s and is reused deliberately
 * (CBD-234-AC03/AC07): the application module decides *what* the consent row
 * contains with no database in sight, and this module is the CBD-246 seam
 * that writes it, on the transaction's own client, in the same transaction as
 * the membership it references.
 *
 * Three facts about the consent row are worth naming here because the schema
 * enforces each of them at COMMIT and a caller that got one wrong would
 * otherwise see only a constraint violation:
 *
 *  * `account_subject_id` **and** `recorded_by_subject_id` are both the
 *    invitee. A consent row evidences the consenting person's own explicit
 *    action, for every source; the other party's action lives on the
 *    confirmation record (`DR-73-13`), never here. The M1 trigger refuses
 *    inequality.
 *  * `state` is `current`, and it is the only current row for the membership:
 *    the deferred activation trigger of `20260914T170000Z` proves exactly one
 *    at COMMIT.
 *  * `source_ceremony_id` is the ceremony the consent came from
 *    (design SS17 item 7), which is what ties the evidence back to the
 *    ceremony the person actually ran.
 *
 * `listSpaceMemberships` is the read both the eligibility checks and the
 * members list use. It returns the membership facts and never touches
 * `financial_profile`: the display identity is a separate, subject-scoped
 * read (`financial-profile.ts`), so a members list cannot accidentally widen
 * into personal state.
 */
import type { DataAccessClient } from "@cobudget/data-access";
import { instantText, integerValue, nullableInstantText, textValue } from "../../../data-access/src/budget-category.ts";
import type { BudgetSpaceMembershipRow } from "../invitations/ports.ts";

export const BUDGET_SPACE_MEMBERSHIP_TABLE = "budget_space_membership";
export const BUDGET_SPACE_CONSENT_TABLE = "budget_space_consent";

// The version column is last for the reason PK2FIX-F04 gives: the secret
// scanner's generic-api-key rule reads an auth-shaped name followed by another
// long identifier as a credential assignment.
const MEMBERSHIP_COLUMNS: readonly string[] = [
  "membership_id", "budget_space_id", "profile_id", "account_subject_id",
  "role", "status", "created_by_subject_id", "ended_at", "authorization_version",
];

function toMembershipRow(value: unknown): BudgetSpaceMembershipRow {
  const row = value as Record<string, unknown>;
  return {
    membership_id: textValue(row.membership_id),
    budget_space_id: textValue(row.budget_space_id),
    profile_id: textValue(row.profile_id),
    account_subject_id: textValue(row.account_subject_id),
    role: textValue(row.role),
    status: textValue(row.status),
    authorization_version: integerValue(row.authorization_version),
    created_by_subject_id: textValue(row.created_by_subject_id),
    ended_at: nullableInstantText(row.ended_at),
  };
}

/** Every membership of one space, or of one subject in it. Membership facts only. */
export async function listSpaceMemberships(
  client: DataAccessClient, budgetSpaceId: string, accountSubjectId?: string,
): Promise<readonly BudgetSpaceMembershipRow[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_MEMBERSHIP_TABLE, budgetSpaceId, columns: MEMBERSHIP_COLUMNS,
    ...(accountSubjectId === undefined ? {} : { conditions: [{ column: "account_subject_id", value: accountSubjectId }] }),
  });
  return result.rows.map(toMembershipRow);
}

/** SS8 step 7. `authorization_version` starts at 1; a later change to the role must advance it. */
export async function insertSpaceMembership(client: DataAccessClient, row: BudgetSpaceMembershipRow): Promise<void> {
  const { budget_space_id, ended_at, ...values } = row;
  await client.tenantInsert({
    table: BUDGET_SPACE_MEMBERSHIP_TABLE, budgetSpaceId: budget_space_id,
    values: { ...values, ...(ended_at === null ? {} : { ended_at }) },
  });
}

/** SS8 step 8. Written on the transaction's own client, immediately after the membership it references. */
export async function insertAcceptanceConsent(
  client: DataAccessClient, budgetSpaceId: string, values: Readonly<Record<string, unknown>>,
): Promise<void> {
  await client.tenantInsert({ table: BUDGET_SPACE_CONSENT_TABLE, budgetSpaceId, values });
}

/** One membership's current consent rows, for the live suite's coherence assertions. */
export async function listMembershipConsents(
  client: DataAccessClient, budgetSpaceId: string, membershipId: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_CONSENT_TABLE, budgetSpaceId,
    conditions: [{ column: "membership_id", value: membershipId }],
  });
  return result.rows as readonly Readonly<Record<string, unknown>>[];
}

/** The statement subset the invitation adapter is composed from for these two tables. */
export function membershipStatements(client: DataAccessClient) {
  return {
    listMemberships: (budgetSpaceId: string, accountSubjectId?: string) => listSpaceMemberships(client, budgetSpaceId, accountSubjectId),
    insertMembership: (row: BudgetSpaceMembershipRow) => insertSpaceMembership(client, row),
    insertConsent: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) => insertAcceptanceConsent(client, budgetSpaceId, values),
  };
}

export { instantText };
