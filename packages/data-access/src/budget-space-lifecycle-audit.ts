/**
 * Tenant-scoped statements for `budget_space_lifecycle_audit` (CBD-73 SS13),
 * the `AE-73-*` events of the invitation and transfer lifecycle.
 *
 * Insert only. The table is append-only evidence: PK-2 revokes DELETE from
 * both application roles and there is no update path, so this module offers
 * neither. The payload allowlist is the application's
 * (`budget-application/src/invitations/records.ts`), enforced before a row is
 * built; the database enforces only that the payload is a JSON object, and
 * that the restricted-only classes cannot be labelled `customer`.
 */
import { instantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const BUDGET_SPACE_LIFECYCLE_AUDIT_TABLE = "budget_space_lifecycle_audit";

export interface BudgetSpaceLifecycleAuditRow {
  readonly event_id: string;
  readonly budget_space_id: string;
  readonly event_code: string;
  readonly event_subtype: string | null;
  readonly occurred_at: string;
  readonly actor_subject_id: string | null;
  readonly acting_membership_id: string | null;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly result: string;
  readonly reason_class: string | null;
  readonly policy_version: string | null;
  readonly policy_digest: string | null;
  readonly correlation_id: string;
  readonly audience: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function toRow(value: unknown): BudgetSpaceLifecycleAuditRow {
  const row = value as Record<string, unknown>;
  return {
    event_id: textValue(row.event_id),
    budget_space_id: textValue(row.budget_space_id),
    event_code: textValue(row.event_code),
    event_subtype: nullableText(row.event_subtype),
    occurred_at: instantText(row.occurred_at),
    actor_subject_id: nullableText(row.actor_subject_id),
    acting_membership_id: nullableText(row.acting_membership_id),
    target_type: textValue(row.target_type),
    target_id: nullableText(row.target_id),
    result: textValue(row.result),
    reason_class: nullableText(row.reason_class),
    policy_version: nullableText(row.policy_version),
    policy_digest: nullableText(row.policy_digest),
    correlation_id: textValue(row.correlation_id),
    audience: textValue(row.audience),
    payload: (row.payload ?? {}) as Readonly<Record<string, unknown>>,
  };
}

export async function insertLifecycleAudit(
  client: TenantStatementClient, budgetSpaceId: string, values: Readonly<Record<string, unknown>>,
): Promise<void> {
  await client.tenantInsert({
    table: BUDGET_SPACE_LIFECYCLE_AUDIT_TABLE, budgetSpaceId,
    values: { ...values, payload: JSON.stringify(values.payload ?? {}) },
  });
}

/** The audit trail of one space, for the reviewer and the live suite. Ordered by the caller. */
export async function listLifecycleAudit(
  client: TenantStatementClient, budgetSpaceId: string,
): Promise<readonly BudgetSpaceLifecycleAuditRow[]> {
  const result = await client.tenantSelect({ table: BUDGET_SPACE_LIFECYCLE_AUDIT_TABLE, budgetSpaceId });
  return result.rows.map(toRow);
}

export function budgetSpaceLifecycleAuditStatements(client: TenantStatementClient) {
  return {
    insertAudit: (budgetSpaceId: string, values: Readonly<Record<string, unknown>>) => insertLifecycleAudit(client, budgetSpaceId, values),
    listAudit: (budgetSpaceId: string) => listLifecycleAudit(client, budgetSpaceId),
  };
}
