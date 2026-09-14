/**
 * Tenant-scoped statements for `budget_category_period_target` (CBD-153,
 * PROTO-TARGETS-001), plus the one read the plan needs from the CBD-231
 * schedule tables: the budget's currency and time zone, the period's bounds,
 * and the cadence of the schedule version that produced the period.
 *
 * Rows are retained versions (20260913T130003Z): INV-54's whole-set
 * recomputation of an open period stamps `superseded_at` on the current rows
 * and inserts new ones, which is the only update the trigger permits. The
 * trigger refuses any change to a completed period's rows, any delete, and
 * any change to a superseded row with SQLSTATE 55000, which
 * `COMPLETED_PERIOD_TARGET_SQLSTATE` names so callers map it to a canonical
 * error rather than a string match.
 */
import { dateText, instantText, integerValue, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const BUDGET_CATEGORY_PERIOD_TARGET_TABLE = "budget_category_period_target";

/** Raised by the migration's trigger when a completed period's row, a superseded row, or any row's deletion is attempted (CBD-153-AC02). */
export const COMPLETED_PERIOD_TARGET_SQLSTATE = "55000";

export type PeriodTargetStatementClient = TenantStatementClient;

export interface BudgetCategoryPeriodTargetRow {
  readonly period_target_id: string;
  readonly budget_space_id: string;
  readonly category_id: string;
  readonly period_id: string;
  readonly period_start_date: string;
  readonly period_end_date: string;
  readonly origin: string;
  readonly currency_code: string;
  readonly minor_unit_precision: number;
  readonly amount_minor_units: number;
  readonly formula_version: string;
  readonly inputs: unknown;
  readonly calculation: unknown;
  readonly computed_by_subject_id: string;
  readonly source: string;
  readonly computed_at: string;
  readonly superseded_at: string | null;
}

export type BudgetCategoryPeriodTargetInsert = Omit<BudgetCategoryPeriodTargetRow, "superseded_at">;

/** What the plan read needs to know about the budget and one of its periods. */
export interface PlanContextRow {
  readonly budget_space_id: string;
  readonly currency_code: string;
  readonly time_zone: string;
  readonly current_period_id: string;
  readonly period_id: string;
  readonly schedule_version_id: string;
  readonly period_status: string;
  readonly period_start_date: string;
  readonly period_end_date: string;
  readonly cadence_definition: unknown;
}

function toRow(value: unknown): BudgetCategoryPeriodTargetRow {
  const row = value as Record<string, unknown>;
  return {
    period_target_id: textValue(row.period_target_id),
    budget_space_id: textValue(row.budget_space_id),
    category_id: textValue(row.category_id),
    period_id: textValue(row.period_id),
    period_start_date: dateText(row.period_start_date),
    period_end_date: dateText(row.period_end_date),
    origin: textValue(row.origin),
    currency_code: textValue(row.currency_code),
    minor_unit_precision: integerValue(row.minor_unit_precision),
    amount_minor_units: integerValue(row.amount_minor_units),
    formula_version: textValue(row.formula_version),
    inputs: row.inputs,
    calculation: row.calculation ?? null,
    computed_by_subject_id: textValue(row.computed_by_subject_id),
    source: textValue(row.source),
    computed_at: instantText(row.computed_at),
    superseded_at: nullableInstantText(row.superseded_at),
  };
}

/** Every row of one period, current and superseded. */
export async function listBudgetCategoryPeriodTargets(client: PeriodTargetStatementClient, budgetSpaceId: string, periodId: string): Promise<readonly BudgetCategoryPeriodTargetRow[]> {
  const result = await client.tenantSelect({ table: BUDGET_CATEGORY_PERIOD_TARGET_TABLE, budgetSpaceId, conditions: [{ column: "period_id", value: periodId }] });
  return result.rows.map(toRow);
}

export async function insertBudgetCategoryPeriodTarget(client: PeriodTargetStatementClient, row: BudgetCategoryPeriodTargetInsert): Promise<void> {
  const { budget_space_id, inputs, calculation, ...rest } = row;
  // jsonb columns take the serialised document; the driver would otherwise
  // send an array as a PostgreSQL array literal.
  const values = { ...rest, inputs: JSON.stringify(inputs), calculation: calculation === null ? null : JSON.stringify(calculation) };
  await client.tenantInsert({ table: BUDGET_CATEGORY_PERIOD_TARGET_TABLE, budgetSpaceId: budget_space_id, values });
}

/** Stamps `superseded_at` on one current row; returns 0 when no row of this budget matched. The trigger refuses a completed period's row and an already superseded row (55000). */
export async function supersedeBudgetCategoryPeriodTarget(client: PeriodTargetStatementClient, budgetSpaceId: string, periodTargetId: string, supersededAt: string): Promise<number> {
  const result = await client.tenantUpdate({
    table: BUDGET_CATEGORY_PERIOD_TARGET_TABLE, budgetSpaceId, set: { superseded_at: supersededAt },
    conditions: [{ column: "period_target_id", value: periodTargetId }],
  });
  return result.rowCount ?? 0;
}

/**
 * The plan's context. `periodId` null selects the budget's current period.
 * Three tenant reads rather than a join: the tenant API composes
 * `budget_space_id = $1` on each, so a period or schedule version of another
 * budget cannot be reached through this budget's identifier.
 */
export async function readPlanContext(client: PeriodTargetStatementClient, budgetSpaceId: string, periodId: string | null): Promise<PlanContextRow | null> {
  const spaces = await client.tenantSelect({ table: "budget_space", budgetSpaceId, columns: ["currency_code", "time_zone", "current_period_id"] });
  const space = spaces.rows[0] as Record<string, unknown> | undefined;
  if (!space) return null;
  const currentPeriodId = textValue(space.current_period_id);
  const periods = await client.tenantSelect({
    table: "budget_space_period", budgetSpaceId,
    columns: ["period_id", "schedule_version_id", "status", "period_start_date", "period_end_date"],
    conditions: [{ column: "period_id", value: periodId ?? currentPeriodId }],
  });
  const period = periods.rows[0] as Record<string, unknown> | undefined;
  if (!period) return null;
  const scheduleVersionId = textValue(period.schedule_version_id);
  const versions = await client.tenantSelect({
    table: "budget_space_schedule_version", budgetSpaceId, columns: ["cadence_definition"],
    conditions: [{ column: "schedule_version_id", value: scheduleVersionId }],
  });
  const version = versions.rows[0] as Record<string, unknown> | undefined;
  if (!version) return null;
  return {
    budget_space_id: budgetSpaceId,
    currency_code: textValue(space.currency_code),
    time_zone: textValue(space.time_zone),
    current_period_id: currentPeriodId,
    period_id: textValue(period.period_id),
    schedule_version_id: scheduleVersionId,
    period_status: textValue(period.status),
    period_start_date: dateText(period.period_start_date),
    period_end_date: dateText(period.period_end_date),
    cadence_definition: version.cadence_definition,
  };
}

export function budgetCategoryPeriodTargetStatements(client: PeriodTargetStatementClient) {
  return {
    listPeriodTargets: (budgetSpaceId: string, periodId: string) => listBudgetCategoryPeriodTargets(client, budgetSpaceId, periodId),
    insertPeriodTarget: (row: BudgetCategoryPeriodTargetInsert) => insertBudgetCategoryPeriodTarget(client, row),
    supersedePeriodTarget: (budgetSpaceId: string, periodTargetId: string, supersededAt: string) => supersedeBudgetCategoryPeriodTarget(client, budgetSpaceId, periodTargetId, supersededAt),
    readPlanContext: (budgetSpaceId: string, periodId: string | null) => readPlanContext(client, budgetSpaceId, periodId),
  };
}
