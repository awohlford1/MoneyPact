/**
 * Persistence and environment ports for the transactions module (CBD-199,
 * CBD-200, CBD-201, CBD-209).
 *
 * `TransactionsRepository` is what the commands and the progress query talk
 * to. Two adapters implement it: `InMemoryTransactionsRepository` for unit
 * tests, and `dataAccessTransactionsRepository`, which maps it onto the typed
 * statement sets `@cobudget/data-access` exposes for `manual_transaction`,
 * `transaction_allocation`, `financial_account`, `budget_category` and
 * `budget_space_period`. The statement set is described here structurally
 * (`TransactionStatements`) so this package keeps its CBD-232 SS3.1 boundary --
 * no database import -- while the composition in apps/api supplies the real
 * statements.
 *
 * `appendVersion` is deliberately one port operation rather than three. An
 * edit must stamp the superseded row and write the new version with its
 * allocations as one substitution; splitting that across calls would let a
 * caller leave two current versions, or a version with no allocations,
 * visible between them. The repository never opens a transaction of its own:
 * it runs inside the caller's, which is where the deferred exact-sum
 * constraint is checked.
 */
import type { AccountRecord } from "../accounts/records.ts";
import type { AllocationRecord, CategorySummary, PeriodRecord, TransactionRecord, TransactionSnapshot } from "./records.ts";

export interface Clock {
  /** The current instant as an ISO-8601 UTC string. */
  readonly now: () => string;
}

export interface IdGenerator {
  /** A fresh UUID for a transaction identity, a version row or an allocation row. */
  readonly uuid: () => string;
}

/** The supersession an append replaces, or null when this is the first version of an identity. */
export interface Supersession {
  readonly transactionVersionId: string;
  readonly supersededAt: string;
}

export interface TransactionsRepository {
  /** The budget's stored periods: the only boundaries assignment may use (CBD-199-AC04). */
  readonly listPeriods: (budgetSpaceId: string) => Promise<readonly PeriodRecord[]>;
  readonly readAccount: (budgetSpaceId: string, accountId: string) => Promise<AccountRecord | null>;
  readonly listCategories: (budgetSpaceId: string) => Promise<readonly CategorySummary[]>;
  /** Every version of one identity, current and historical, in no guaranteed order. */
  readonly listVersions: (budgetSpaceId: string, transactionId: string) => Promise<readonly TransactionRecord[]>;
  readonly listAllocations: (budgetSpaceId: string, transactionVersionId: string) => Promise<readonly AllocationRecord[]>;
  /** Current, non-removed versions assigned to one period, with their allocations. */
  readonly readPeriodLedger: (budgetSpaceId: string, periodId: string) => Promise<readonly TransactionSnapshot[]>;
  /** Stamp the superseded version (if any) and write the new version with its allocation set, atomically. */
  readonly appendVersion: (version: TransactionRecord, allocations: readonly AllocationRecord[], supersedes: Supersession | null) => Promise<void>;
}

// ---------------------------------------------------------------------------
// The typed statement set the data-access adapter is composed from. Field
// names are the tables' columns; the shapes match the row types exported by
// packages/data-access/src/{manual-transaction,transaction-allocation,
// financial-account,budget-category}.ts structurally.
// ---------------------------------------------------------------------------

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

export interface BudgetSpacePeriodRow {
  readonly period_id: string;
  readonly budget_space_id: string;
  readonly status: string;
  readonly period_start_date: string;
  readonly period_end_date: string;
}

export interface BudgetCategorySummaryRow {
  readonly category_id: string;
  readonly budget_space_id: string;
  readonly archived_at: string | null;
}

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

export interface TransactionStatements {
  readonly listPeriods: (budgetSpaceId: string) => Promise<readonly BudgetSpacePeriodRow[]>;
  readonly readAccount: (budgetSpaceId: string, accountId: string) => Promise<FinancialAccountRow | null>;
  readonly listCategories: (budgetSpaceId: string) => Promise<readonly BudgetCategorySummaryRow[]>;
  readonly listTransactionVersions: (budgetSpaceId: string, transactionId: string) => Promise<readonly ManualTransactionRow[]>;
  readonly listTransactionsByPeriod: (budgetSpaceId: string, periodId: string) => Promise<readonly ManualTransactionRow[]>;
  readonly listAllocations: (budgetSpaceId: string, transactionVersionId: string) => Promise<readonly TransactionAllocationRow[]>;
  readonly insertTransaction: (row: Omit<ManualTransactionRow, "superseded_at">) => Promise<void>;
  readonly insertAllocation: (row: TransactionAllocationRow) => Promise<void>;
  readonly supersedeTransaction: (budgetSpaceId: string, transactionVersionId: string, supersededAt: string) => Promise<number>;
}
