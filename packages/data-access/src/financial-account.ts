/**
 * Tenant-scoped statements for `financial_account` (CBD-196,
 * PROTO-INCREMENT-A-001).
 *
 * Every statement goes through the closed tenant API in `tenant.ts`, so
 * `budget_space_id = $1` is composed by the layer and never by a caller, and
 * an account of another budget is unreachable through this budget's
 * identifier. Rows are normalised to the plain JSON-safe shape the
 * application's persistence port expects -- identifiers as strings, instants
 * as ISO-8601 strings, never a driver `Date` -- and the row shape is named
 * for the table's columns so a reviewer can check it against
 * 20260914T180000Z.
 *
 * `updateFinancialAccount` is a compare-and-set on `version`: the caller
 * passes the version it read, the statement matches on it, and a row count of
 * zero means either "not this budget's account" or "someone else advanced it
 * first". The migration's trigger refuses any update that does not advance
 * `version` at all, so the two halves of CBD-196-AC03 -- a previous and a
 * resulting version for audit -- cannot come apart.
 */
import { instantText, integerValue, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const FINANCIAL_ACCOUNT_TABLE = "financial_account";

export type FinancialAccountStatementClient = TenantStatementClient;

export interface FinancialAccountRow {
  readonly account_id: string;
  readonly budget_space_id: string;
  readonly origin: string;
  readonly account_type: string;
  readonly label: string;
  readonly currency_code: string;
  readonly minor_unit_precision: number;
  readonly opening_balance_minor_units: number;
  readonly owner_subject_id: string;
  readonly created_by_subject_id: string;
  readonly archived_at: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The columns an edit, archive or restore may change. `version` always advances. */
export interface FinancialAccountUpdate {
  readonly account_type: string;
  readonly label: string;
  readonly opening_balance_minor_units: number;
  readonly owner_subject_id: string;
  readonly archived_at: string | null;
  readonly version: number;
  readonly updated_at: string;
}

function toRow(value: unknown): FinancialAccountRow {
  const row = value as Record<string, unknown>;
  return {
    account_id: textValue(row.account_id),
    budget_space_id: textValue(row.budget_space_id),
    origin: textValue(row.origin),
    account_type: textValue(row.account_type),
    label: textValue(row.label),
    currency_code: textValue(row.currency_code),
    minor_unit_precision: integerValue(row.minor_unit_precision),
    opening_balance_minor_units: integerValue(row.opening_balance_minor_units),
    owner_subject_id: textValue(row.owner_subject_id),
    created_by_subject_id: textValue(row.created_by_subject_id),
    archived_at: nullableInstantText(row.archived_at),
    version: integerValue(row.version),
    created_at: instantText(row.created_at),
    updated_at: instantText(row.updated_at),
  };
}

/** Every account of the budget, archived ones included: archival is lifecycle, not disappearance (CBD-196-AC04). */
export async function listFinancialAccounts(client: FinancialAccountStatementClient, budgetSpaceId: string): Promise<readonly FinancialAccountRow[]> {
  const result = await client.tenantSelect({ table: FINANCIAL_ACCOUNT_TABLE, budgetSpaceId });
  return result.rows.map(toRow);
}

export async function readFinancialAccount(client: FinancialAccountStatementClient, budgetSpaceId: string, accountId: string): Promise<FinancialAccountRow | null> {
  const result = await client.tenantSelect({ table: FINANCIAL_ACCOUNT_TABLE, budgetSpaceId, conditions: [{ column: "account_id", value: accountId }] });
  const first = result.rows[0];
  return first === undefined ? null : toRow(first);
}

export async function insertFinancialAccount(client: FinancialAccountStatementClient, row: FinancialAccountRow): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({ table: FINANCIAL_ACCOUNT_TABLE, budgetSpaceId: budget_space_id, values });
}

/**
 * Compare-and-set on the version the caller read. Returns the number of rows
 * changed: 0 when the account is not this budget's, or when its version has
 * moved on since.
 */
export async function updateFinancialAccount(
  client: FinancialAccountStatementClient,
  budgetSpaceId: string,
  accountId: string,
  previousVersion: number,
  set: FinancialAccountUpdate,
): Promise<number> {
  const result = await client.tenantUpdate({
    table: FINANCIAL_ACCOUNT_TABLE,
    budgetSpaceId,
    set: { ...set },
    conditions: [
      { column: "account_id", value: accountId },
      { column: "version", value: previousVersion },
    ],
  });
  return result.rowCount ?? 0;
}

/** The statement set the application's data-access adapter is composed from. */
export function financialAccountStatements(client: FinancialAccountStatementClient) {
  return {
    listAccounts: (budgetSpaceId: string) => listFinancialAccounts(client, budgetSpaceId),
    readAccount: (budgetSpaceId: string, accountId: string) => readFinancialAccount(client, budgetSpaceId, accountId),
    insertAccount: (row: FinancialAccountRow) => insertFinancialAccount(client, row),
    updateAccount: (budgetSpaceId: string, accountId: string, previousVersion: number, set: FinancialAccountUpdate) =>
      updateFinancialAccount(client, budgetSpaceId, accountId, previousVersion, set),
  };
}
