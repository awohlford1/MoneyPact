/**
 * Tenant-scoped statements for `manual_transaction` (CBD-199/CBD-200/CBD-201,
 * PROTO-INCREMENT-A-001), plus the one read period assignment needs from the
 * CBD-231 period table.
 *
 * Rows are retained versions (20260914T180001Z): an edit or a removal writes a
 * new version and stamps `superseded_at` on the one that was current, which is
 * the only update the migration's trigger permits. 55000 is the stable code it
 * raises for "this row is history", which `TRANSACTION_VERSION_IMMUTABLE_SQLSTATE`
 * names so a caller maps it to a canonical error rather than matching a string.
 *
 * `listBudgetPeriods` reads `budget_space_period` through the same tenant API.
 * Period assignment (CBD-199-AC04) is decided by the application against these
 * stored rows -- the boundaries are an input, never something the transaction
 * layer derives -- and the migration's trigger re-checks the answer.
 */
import { dateText, instantText, integerValue, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const MANUAL_TRANSACTION_TABLE = "manual_transaction";
export const BUDGET_SPACE_PERIOD_TABLE = "budget_space_period";

/** Raised by the migration's trigger for a superseded version, any delete, and any change but the supersession stamp. */
export const TRANSACTION_VERSION_IMMUTABLE_SQLSTATE = "55000";

export type ManualTransactionStatementClient = TenantStatementClient;

export interface ManualTransactionRow {
  readonly transaction_version_id: string;
  readonly transaction_id: string;
  readonly budget_space_id: string;
  readonly account_id: string;
  readonly revision: number;
  readonly origin: string;
  readonly settlement_state: string;
  readonly currency_code: string;
  readonly minor_unit_precision: number;
  readonly amount_minor_units: number;
  readonly budget_date: string;
  readonly period_id: string;
  readonly period_start_date: string;
  readonly period_end_date: string;
  readonly description: string | null;
  readonly recorded_by_subject_id: string;
  readonly source: string;
  readonly removed_at: string | null;
  readonly removed_by_subject_id: string | null;
  readonly superseded_at: string | null;
  readonly created_at: string;
}

export type ManualTransactionInsert = Omit<ManualTransactionRow, "superseded_at">;

/** One budget period as the assignment rule sees it: an identity and inclusive bounds. */
export interface BudgetSpacePeriodRow {
  readonly period_id: string;
  readonly budget_space_id: string;
  readonly status: string;
  readonly period_start_date: string;
  readonly period_end_date: string;
}

function toRow(value: unknown): ManualTransactionRow {
  const row = value as Record<string, unknown>;
  return {
    transaction_version_id: textValue(row.transaction_version_id),
    transaction_id: textValue(row.transaction_id),
    budget_space_id: textValue(row.budget_space_id),
    account_id: textValue(row.account_id),
    revision: integerValue(row.revision),
    origin: textValue(row.origin),
    settlement_state: textValue(row.settlement_state),
    currency_code: textValue(row.currency_code),
    minor_unit_precision: integerValue(row.minor_unit_precision),
    amount_minor_units: integerValue(row.amount_minor_units),
    budget_date: dateText(row.budget_date),
    period_id: textValue(row.period_id),
    period_start_date: dateText(row.period_start_date),
    period_end_date: dateText(row.period_end_date),
    description: row.description === null || row.description === undefined ? null : textValue(row.description),
    recorded_by_subject_id: textValue(row.recorded_by_subject_id),
    source: textValue(row.source),
    removed_at: nullableInstantText(row.removed_at),
    removed_by_subject_id: row.removed_by_subject_id === null || row.removed_by_subject_id === undefined ? null : textValue(row.removed_by_subject_id),
    superseded_at: nullableInstantText(row.superseded_at),
    created_at: instantText(row.created_at),
  };
}

function toPeriodRow(value: unknown): BudgetSpacePeriodRow {
  const row = value as Record<string, unknown>;
  return {
    period_id: textValue(row.period_id),
    budget_space_id: textValue(row.budget_space_id),
    status: textValue(row.status),
    period_start_date: dateText(row.period_start_date),
    period_end_date: dateText(row.period_end_date),
  };
}

/** Every version of every transaction in the budget, current and historical. */
export async function listManualTransactions(client: ManualTransactionStatementClient, budgetSpaceId: string): Promise<readonly ManualTransactionRow[]> {
  const result = await client.tenantSelect({ table: MANUAL_TRANSACTION_TABLE, budgetSpaceId });
  return result.rows.map(toRow);
}

/** Every version of one transaction identity, in the order the caller sorts them (CBD-201-AC04 before/after audit). */
export async function listManualTransactionVersions(client: ManualTransactionStatementClient, budgetSpaceId: string, transactionId: string): Promise<readonly ManualTransactionRow[]> {
  const result = await client.tenantSelect({ table: MANUAL_TRANSACTION_TABLE, budgetSpaceId, conditions: [{ column: "transaction_id", value: transactionId }] });
  return result.rows.map(toRow);
}

/** Every current version assigned to one period, tombstones included; the caller filters them. */
export async function listManualTransactionsByPeriod(client: ManualTransactionStatementClient, budgetSpaceId: string, periodId: string): Promise<readonly ManualTransactionRow[]> {
  const result = await client.tenantSelect({
    table: MANUAL_TRANSACTION_TABLE,
    budgetSpaceId,
    conditions: [{ column: "period_id", value: periodId }],
  });
  return result.rows.map(toRow).filter((row) => row.superseded_at === null);
}

export async function insertManualTransaction(client: ManualTransactionStatementClient, row: ManualTransactionInsert): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({ table: MANUAL_TRANSACTION_TABLE, budgetSpaceId: budget_space_id, values });
}

/** Stamps the supersession on one current version. Returns rows changed: 0 when no current version of this budget matched. */
export async function supersedeManualTransaction(client: ManualTransactionStatementClient, budgetSpaceId: string, transactionVersionId: string, supersededAt: string): Promise<number> {
  const result = await client.tenantUpdate({
    table: MANUAL_TRANSACTION_TABLE,
    budgetSpaceId,
    set: { superseded_at: supersededAt },
    conditions: [{ column: "transaction_version_id", value: transactionVersionId }],
  });
  return result.rowCount ?? 0;
}

/** The budget's stored periods, which are the only boundaries assignment may use (CBD-199-AC04). */
export async function listBudgetPeriods(client: ManualTransactionStatementClient, budgetSpaceId: string): Promise<readonly BudgetSpacePeriodRow[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_PERIOD_TABLE,
    budgetSpaceId,
    columns: ["period_id", "budget_space_id", "status", "period_start_date", "period_end_date"],
  });
  return result.rows.map(toPeriodRow);
}

/** The statement set the application's data-access adapter is composed from. */
export function manualTransactionStatements(client: ManualTransactionStatementClient) {
  return {
    listTransactions: (budgetSpaceId: string) => listManualTransactions(client, budgetSpaceId),
    listTransactionVersions: (budgetSpaceId: string, transactionId: string) => listManualTransactionVersions(client, budgetSpaceId, transactionId),
    listTransactionsByPeriod: (budgetSpaceId: string, periodId: string) => listManualTransactionsByPeriod(client, budgetSpaceId, periodId),
    insertTransaction: (row: ManualTransactionInsert) => insertManualTransaction(client, row),
    supersedeTransaction: (budgetSpaceId: string, transactionVersionId: string, supersededAt: string) => supersedeManualTransaction(client, budgetSpaceId, transactionVersionId, supersededAt),
    listPeriods: (budgetSpaceId: string) => listBudgetPeriods(client, budgetSpaceId),
  };
}
