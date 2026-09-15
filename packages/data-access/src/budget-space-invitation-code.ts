/**
 * Tenant-scoped statements for `budget_space_invitation_code` (`DR-73-02`).
 *
 * One row per dispatched real invitation. The raw bearer is never here: the
 * column this table stores is the bound one-way verifier, and the only other
 * secret-derived value is the non-reversible abuse fingerprint. Neither is
 * ever a predicate composed from a customer-supplied value -- the disposition
 * update predicates on the *current* disposition so that "invalidate an
 * active code" cannot silently re-open a consumed one. The one customer-
 * supplied predicate on this table is the `code_selector` lookup in
 * `budget-space-invitation.ts`, and a selector is a random handle that
 * encodes nothing and proves nothing (`PK5-F02`).
 */
import { instantText, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const BUDGET_SPACE_INVITATION_CODE_TABLE = "budget_space_invitation_code";

export interface BudgetSpaceInvitationCodeRow {
  readonly invitation_id: string;
  readonly budget_space_id: string;
  /** `PK5-F02` (20260915T130000Z): the opaque lookup handle; null only on rows issued before the column existed. */
  readonly code_selector: string | null;
  readonly verifier_digest: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly disposition: string;
  readonly disposition_reason_class: string | null;
  readonly disposition_at: string | null;
  readonly abuse_fingerprint: string | null;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function toRow(value: unknown): BudgetSpaceInvitationCodeRow {
  const row = value as Record<string, unknown>;
  return {
    invitation_id: textValue(row.invitation_id),
    budget_space_id: textValue(row.budget_space_id),
    code_selector: nullableText(row.code_selector),
    verifier_digest: textValue(row.verifier_digest),
    issued_at: instantText(row.issued_at),
    expires_at: instantText(row.expires_at),
    disposition: textValue(row.disposition),
    disposition_reason_class: nullableText(row.disposition_reason_class),
    disposition_at: nullableInstantText(row.disposition_at),
    abuse_fingerprint: nullableText(row.abuse_fingerprint),
  };
}

export async function readInvitationCode(
  client: TenantStatementClient, budgetSpaceId: string, invitationId: string,
): Promise<BudgetSpaceInvitationCodeRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_CODE_TABLE, budgetSpaceId,
    conditions: [{ column: "invitation_id", value: invitationId }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toRow(row);
}

export async function insertInvitationCode(client: TenantStatementClient, row: BudgetSpaceInvitationCodeRow): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({ table: BUDGET_SPACE_INVITATION_CODE_TABLE, budgetSpaceId: budget_space_id, values });
}

/** Moves the disposition only from the one the caller read. Returns rows changed. */
export async function updateInvitationCodeDisposition(
  client: TenantStatementClient, budgetSpaceId: string, invitationId: string,
  fromDisposition: string, set: Readonly<Record<string, unknown>>,
): Promise<number> {
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_INVITATION_CODE_TABLE, budgetSpaceId, set,
    conditions: [
      { column: "invitation_id", value: invitationId },
      { column: "disposition", value: fromDisposition },
    ],
  });
  return result.rowCount ?? 0;
}

/** Stamps the non-reversible fingerprint of a presented value for `TR-73-14` abuse counting. */
export async function setInvitationCodeFingerprint(
  client: TenantStatementClient, budgetSpaceId: string, invitationId: string, fingerprint: string,
): Promise<number> {
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_INVITATION_CODE_TABLE, budgetSpaceId,
    set: { abuse_fingerprint: fingerprint },
    conditions: [{ column: "invitation_id", value: invitationId }],
  });
  return result.rowCount ?? 0;
}

export function budgetSpaceInvitationCodeStatements(client: TenantStatementClient) {
  return {
    readCode: (budgetSpaceId: string, invitationId: string) => readInvitationCode(client, budgetSpaceId, invitationId),
    insertCode: (row: BudgetSpaceInvitationCodeRow) => insertInvitationCode(client, row),
    updateCode: (budgetSpaceId: string, invitationId: string, fromDisposition: string, set: Readonly<Record<string, unknown>>) =>
      updateInvitationCodeDisposition(client, budgetSpaceId, invitationId, fromDisposition, set),
    setCodeFingerprint: (budgetSpaceId: string, invitationId: string, fingerprint: string) =>
      setInvitationCodeFingerprint(client, budgetSpaceId, invitationId, fingerprint),
  };
}
