/**
 * Persistence and environment ports for the accounts module (CBD-196).
 *
 * `AccountsRepository` is what the commands talk to. Two adapters implement
 * it: `InMemoryAccountsRepository` for unit tests, and
 * `dataAccessAccountsRepository`, which maps it onto the typed statement set
 * `@cobudget/data-access` exposes for `financial_account`. That statement set
 * is described here structurally (`AccountStatements`) so this package keeps
 * its CBD-232 SS3.1 boundary -- no database import -- while the composition in
 * apps/api supplies the real statements.
 *
 * Every write runs inside the transaction the caller already holds; the
 * repository never opens one of its own.
 */
import type { AccountRecord } from "./records.ts";

export interface Clock {
  /** The current instant as an ISO-8601 UTC string. */
  readonly now: () => string;
}

export interface IdGenerator {
  /** A fresh UUID for an account row. */
  readonly uuid: () => string;
}

export interface AccountsRepository {
  /** Every account of the budget, archived included: archival is lifecycle, not disappearance (CBD-196-AC04). */
  readonly listAccounts: (budgetSpaceId: string) => Promise<readonly AccountRecord[]>;
  readonly readAccount: (budgetSpaceId: string, accountId: string) => Promise<AccountRecord | null>;
  readonly insertAccount: (record: AccountRecord) => Promise<void>;
  /**
   * Compare-and-set on the version the caller read. `record.version` is the
   * resulting version and must exceed `previousVersion`. False means the
   * account is not this budget's, or its version has moved on.
   */
  readonly updateAccount: (record: AccountRecord, previousVersion: number) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// The typed statement set the data-access adapter is composed from. Field
// names are the table's columns; the shape matches the row type exported by
// packages/data-access/src/financial-account.ts structurally.
// ---------------------------------------------------------------------------

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

export type FinancialAccountUpdate = Pick<
  FinancialAccountRow,
  "account_type" | "label" | "opening_balance_minor_units" | "owner_subject_id" | "archived_at" | "version" | "updated_at"
>;

export interface AccountStatements {
  readonly listAccounts: (budgetSpaceId: string) => Promise<readonly FinancialAccountRow[]>;
  readonly readAccount: (budgetSpaceId: string, accountId: string) => Promise<FinancialAccountRow | null>;
  readonly insertAccount: (row: FinancialAccountRow) => Promise<void>;
  readonly updateAccount: (budgetSpaceId: string, accountId: string, previousVersion: number, set: FinancialAccountUpdate) => Promise<number>;
}
