/**
 * Tenant-scoped statements for `budget_space_invitation_confirmation`
 * (`DR-73-13`): the intended-recipient confirmation of CBD-73 SS5.1.
 *
 * The row is authority evidence retained under `IC-73-018`, which is why the
 * PK-2 trigger makes the decision columns set-once and why nothing here
 * offers a delete. `displayed_identity_version` is the `financial_profile`
 * version whose `display_name` was shown, so the receipt proves which display
 * identity the confirmation was given against.
 */
import { instantText, integerValue, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const BUDGET_SPACE_INVITATION_CONFIRMATION_TABLE = "budget_space_invitation_confirmation";

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

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : integerValue(value);
}

function toRow(value: unknown): BudgetSpaceInvitationConfirmationRow {
  const row = value as Record<string, unknown>;
  // Bound to a short local first for the reason PK2FIX-F04 gives.
  const decidedVersion = row.decided_authorization_version;
  return {
    confirmation_id: textValue(row.confirmation_id),
    budget_space_id: textValue(row.budget_space_id),
    invitation_id: textValue(row.invitation_id),
    ceremony_id: textValue(row.ceremony_id),
    acceptor_subject_id: textValue(row.acceptor_subject_id),
    displayed_identity_version: integerValue(row.displayed_identity_version),
    binding_rule_id: textValue(row.binding_rule_id),
    binding_rule_version: integerValue(row.binding_rule_version),
    state: textValue(row.state),
    expires_at: instantText(row.expires_at),
    decided_by_membership_id: nullableText(row.decided_by_membership_id),
    decided_by_subject_id: nullableText(row.decided_by_subject_id),
    decided_at: nullableInstantText(row.decided_at),
    decided_authorization_version: nullableInteger(decidedVersion),
    committed_consent_id: nullableText(row.committed_consent_id),
  };
}

export async function readInvitationConfirmation(
  client: TenantStatementClient, budgetSpaceId: string, confirmationId: string,
): Promise<BudgetSpaceInvitationConfirmationRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_CONFIRMATION_TABLE, budgetSpaceId,
    conditions: [{ column: "confirmation_id", value: confirmationId }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toRow(row);
}

export async function listInvitationConfirmations(
  client: TenantStatementClient, budgetSpaceId: string, invitationId: string,
): Promise<readonly BudgetSpaceInvitationConfirmationRow[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_CONFIRMATION_TABLE, budgetSpaceId,
    conditions: [{ column: "invitation_id", value: invitationId }],
  });
  return result.rows.map(toRow);
}

export async function insertInvitationConfirmation(
  client: TenantStatementClient, row: BudgetSpaceInvitationConfirmationRow,
): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({ table: BUDGET_SPACE_INVITATION_CONFIRMATION_TABLE, budgetSpaceId: budget_space_id, values });
}

/** The decision write. Predicated on `state = 'requested'`, so a decided confirmation is never re-decided. */
export async function updateInvitationConfirmation(
  client: TenantStatementClient, budgetSpaceId: string, confirmationId: string, set: Readonly<Record<string, unknown>>,
): Promise<number> {
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_INVITATION_CONFIRMATION_TABLE, budgetSpaceId, set,
    conditions: [
      { column: "confirmation_id", value: confirmationId },
      { column: "state", value: "requested" },
    ],
  });
  return result.rowCount ?? 0;
}

export function budgetSpaceInvitationConfirmationStatements(client: TenantStatementClient) {
  return {
    readConfirmation: (budgetSpaceId: string, confirmationId: string) => readInvitationConfirmation(client, budgetSpaceId, confirmationId),
    listConfirmations: (budgetSpaceId: string, invitationId: string) => listInvitationConfirmations(client, budgetSpaceId, invitationId),
    insertConfirmation: (row: BudgetSpaceInvitationConfirmationRow) => insertInvitationConfirmation(client, row),
    updateConfirmation: (budgetSpaceId: string, confirmationId: string, set: Readonly<Record<string, unknown>>) =>
      updateInvitationConfirmation(client, budgetSpaceId, confirmationId, set),
  };
}
