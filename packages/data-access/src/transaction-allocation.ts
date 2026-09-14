/**
 * Tenant-scoped statements for `transaction_allocation` (CBD-201,
 * PROTO-INCREMENT-A-001).
 *
 * Allocations belong to a transaction *version*, so there is deliberately no
 * update and no delete here: replacing a split writes a new version with a new
 * allocation set, and the migration revokes DELETE and refuses UPDATE outright
 * (SQLSTATE 55000). The exact-sum rule is a deferred constraint trigger, which
 * means a multi-row split is written one statement at a time and checked once
 * at commit; a caller therefore sees the mismatch as a failure of the
 * surrounding transaction, not of the statement that happened to be last.
 */
import { instantText, integerValue, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";

export const TRANSACTION_ALLOCATION_TABLE = "transaction_allocation";

/** Raised by the migration's trigger for any attempt to change or delete an allocation. */
export const ALLOCATION_IMMUTABLE_SQLSTATE = "55000";

export type TransactionAllocationStatementClient = TenantStatementClient;

export interface TransactionAllocationRow {
  readonly allocation_id: string;
  readonly budget_space_id: string;
  readonly transaction_version_id: string;
  readonly category_id: string;
  readonly currency_code: string;
  readonly minor_unit_precision: number;
  readonly amount_minor_units: number;
  readonly created_at: string;
}

function toRow(value: unknown): TransactionAllocationRow {
  const row = value as Record<string, unknown>;
  return {
    allocation_id: textValue(row.allocation_id),
    budget_space_id: textValue(row.budget_space_id),
    transaction_version_id: textValue(row.transaction_version_id),
    category_id: textValue(row.category_id),
    currency_code: textValue(row.currency_code),
    minor_unit_precision: integerValue(row.minor_unit_precision),
    amount_minor_units: integerValue(row.amount_minor_units),
    created_at: instantText(row.created_at),
  };
}

/** The allocation set of one transaction version. */
export async function listTransactionAllocations(client: TransactionAllocationStatementClient, budgetSpaceId: string, transactionVersionId: string): Promise<readonly TransactionAllocationRow[]> {
  const result = await client.tenantSelect({
    table: TRANSACTION_ALLOCATION_TABLE,
    budgetSpaceId,
    conditions: [{ column: "transaction_version_id", value: transactionVersionId }],
  });
  return result.rows.map(toRow);
}

/** Every allocation of the budget, of every version; the progress query joins these to the versions it already read. */
export async function listAllTransactionAllocations(client: TransactionAllocationStatementClient, budgetSpaceId: string): Promise<readonly TransactionAllocationRow[]> {
  const result = await client.tenantSelect({ table: TRANSACTION_ALLOCATION_TABLE, budgetSpaceId });
  return result.rows.map(toRow);
}

export async function insertTransactionAllocation(client: TransactionAllocationStatementClient, row: TransactionAllocationRow): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({ table: TRANSACTION_ALLOCATION_TABLE, budgetSpaceId: budget_space_id, values });
}

/** The statement set the application's data-access adapter is composed from. */
export function transactionAllocationStatements(client: TransactionAllocationStatementClient) {
  return {
    listAllocations: (budgetSpaceId: string, transactionVersionId: string) => listTransactionAllocations(client, budgetSpaceId, transactionVersionId),
    listAllAllocations: (budgetSpaceId: string) => listAllTransactionAllocations(client, budgetSpaceId),
    insertAllocation: (row: TransactionAllocationRow) => insertTransactionAllocation(client, row),
  };
}
