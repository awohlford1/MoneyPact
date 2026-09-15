/**
 * Tenant-scoped statements for `budget_space_invitation_ceremony`
 * (`DR-73-03`).
 *
 * The ceremony row is the invitee's side of the fixed partial order of
 * CBD-73 SS5: the channel proof, the account attachment and the acceptance
 * action are all columns here, never client state. Two secret-derived columns
 * live on it -- `ceremony_secret_digest` and `channel_challenge_digest` --
 * and neither is ever selected into a predicate; the application compares
 * them in constant time after reading the row by its identifier.
 */
import { instantText, integerValue, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const BUDGET_SPACE_INVITATION_CEREMONY_TABLE = "budget_space_invitation_ceremony";

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

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : integerValue(value);
}

function toRow(value: unknown): BudgetSpaceInvitationCeremonyRow {
  const row = value as Record<string, unknown>;
  return {
    ceremony_id: textValue(row.ceremony_id),
    budget_space_id: textValue(row.budget_space_id),
    invitation_id: textValue(row.invitation_id),
    ceremony_secret_digest: textValue(row.ceremony_secret_digest),
    is_current: row.is_current === true,
    channel_proof_state: textValue(row.channel_proof_state),
    channel_challenge_digest: nullableText(row.channel_challenge_digest),
    channel_attempts: integerValue(row.channel_attempts),
    channel_proved_at: nullableInstantText(row.channel_proved_at),
    attached_subject_id: nullableText(row.attached_subject_id),
    attached_session_ref: nullableText(row.attached_session_ref),
    attached_at: nullableInstantText(row.attached_at),
    primary_contact_match: row.primary_contact_match === null || row.primary_contact_match === undefined ? null : row.primary_contact_match === true,
    disclosure_kind: textValue(row.disclosure_kind),
    disclosure_version: integerValue(row.disclosure_version),
    disclosure_digest: textValue(row.disclosure_digest),
    acceptance_action_at: nullableInstantText(row.acceptance_action_at),
    accepted_disclosure_version: nullableInteger(row.accepted_disclosure_version),
    state: textValue(row.state),
    expires_at: instantText(row.expires_at),
    environment: textValue(row.environment),
  };
}

export async function readInvitationCeremony(
  client: TenantStatementClient, budgetSpaceId: string, ceremonyId: string,
): Promise<BudgetSpaceInvitationCeremonyRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_CEREMONY_TABLE, budgetSpaceId,
    conditions: [{ column: "ceremony_id", value: ceremonyId }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toRow(row);
}

export async function listInvitationCeremonies(
  client: TenantStatementClient, budgetSpaceId: string, invitationId: string,
): Promise<readonly BudgetSpaceInvitationCeremonyRow[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_CEREMONY_TABLE, budgetSpaceId,
    conditions: [{ column: "invitation_id", value: invitationId }],
  });
  return result.rows.map(toRow);
}

export async function insertInvitationCeremony(client: TenantStatementClient, row: BudgetSpaceInvitationCeremonyRow): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({ table: BUDGET_SPACE_INVITATION_CEREMONY_TABLE, budgetSpaceId: budget_space_id, values });
}

export async function updateInvitationCeremony(
  client: TenantStatementClient, budgetSpaceId: string, ceremonyId: string, set: Readonly<Record<string, unknown>>,
): Promise<number> {
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_INVITATION_CEREMONY_TABLE, budgetSpaceId,
    set: { ...set, updated_at: new Date().toISOString() },
    conditions: [{ column: "ceremony_id", value: ceremonyId }],
  });
  return result.rowCount ?? 0;
}

export function budgetSpaceInvitationCeremonyStatements(client: TenantStatementClient) {
  return {
    readCeremony: (budgetSpaceId: string, ceremonyId: string) => readInvitationCeremony(client, budgetSpaceId, ceremonyId),
    listCeremonies: (budgetSpaceId: string, invitationId: string) => listInvitationCeremonies(client, budgetSpaceId, invitationId),
    insertCeremony: (row: BudgetSpaceInvitationCeremonyRow) => insertInvitationCeremony(client, row),
    updateCeremony: (budgetSpaceId: string, ceremonyId: string, set: Readonly<Record<string, unknown>>) =>
      updateInvitationCeremony(client, budgetSpaceId, ceremonyId, set),
  };
}
