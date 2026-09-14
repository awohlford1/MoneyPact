/**
 * Tenant-scoped statements for `budget_category_base_target` (CBD-153,
 * PROTO-TARGETS-001).
 *
 * The table is append-only history: a change inserts a new row and stamps
 * `superseded_at` on the previous current row, which is the only update the
 * migration's trigger permits. `amount_minor_units` is a `bigint`, which the
 * driver returns as text; it is parsed here under a safe-integer check so an
 * amount outside exact arithmetic is refused at the seam rather than rounded.
 */
import { instantText, integerValue, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const BUDGET_CATEGORY_BASE_TARGET_TABLE = "budget_category_base_target";

export interface BudgetCategoryBaseTargetRow {
  readonly base_target_id: string;
  readonly budget_space_id: string;
  readonly category_id: string;
  readonly cadence: string;
  readonly currency_code: string;
  readonly minor_unit_precision: number;
  readonly amount_minor_units: number;
  readonly set_by_subject_id: string;
  readonly source: string;
  readonly created_at: string;
  readonly superseded_at: string | null;
}

export type BudgetCategoryBaseTargetInsert = Omit<BudgetCategoryBaseTargetRow, "superseded_at">;

function toRow(value: unknown): BudgetCategoryBaseTargetRow {
  const row = value as Record<string, unknown>;
  return {
    base_target_id: textValue(row.base_target_id),
    budget_space_id: textValue(row.budget_space_id),
    category_id: textValue(row.category_id),
    cadence: textValue(row.cadence),
    currency_code: textValue(row.currency_code),
    minor_unit_precision: integerValue(row.minor_unit_precision),
    amount_minor_units: integerValue(row.amount_minor_units),
    set_by_subject_id: textValue(row.set_by_subject_id),
    source: textValue(row.source),
    created_at: instantText(row.created_at),
    superseded_at: nullableInstantText(row.superseded_at),
  };
}

/** Every base target row of the budget, current and superseded, for one cadence context. */
export async function listBudgetCategoryBaseTargets(client: TenantStatementClient, budgetSpaceId: string, cadence: string): Promise<readonly BudgetCategoryBaseTargetRow[]> {
  const result = await client.tenantSelect({ table: BUDGET_CATEGORY_BASE_TARGET_TABLE, budgetSpaceId, conditions: [{ column: "cadence", value: cadence }] });
  return result.rows.map(toRow);
}

export async function insertBudgetCategoryBaseTarget(client: TenantStatementClient, row: BudgetCategoryBaseTargetInsert): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({ table: BUDGET_CATEGORY_BASE_TARGET_TABLE, budgetSpaceId: budget_space_id, values });
}

/** Stamps `superseded_at` on one current row; returns 0 when no current row of this budget matched. */
export async function supersedeBudgetCategoryBaseTarget(client: TenantStatementClient, budgetSpaceId: string, baseTargetId: string, supersededAt: string): Promise<number> {
  const result = await client.tenantUpdate({
    table: BUDGET_CATEGORY_BASE_TARGET_TABLE, budgetSpaceId, set: { superseded_at: supersededAt },
    conditions: [{ column: "base_target_id", value: baseTargetId }],
  });
  return result.rowCount ?? 0;
}

export function budgetCategoryBaseTargetStatements(client: TenantStatementClient) {
  return {
    listBaseTargets: (budgetSpaceId: string, cadence: string) => listBudgetCategoryBaseTargets(client, budgetSpaceId, cadence),
    insertBaseTarget: (row: BudgetCategoryBaseTargetInsert) => insertBudgetCategoryBaseTarget(client, row),
    supersedeBaseTarget: (budgetSpaceId: string, baseTargetId: string, supersededAt: string) => supersedeBudgetCategoryBaseTarget(client, budgetSpaceId, baseTargetId, supersededAt),
  };
}
