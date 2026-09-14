/**
 * `AccountsRepository` over the typed `financial_account` statement set
 * (CBD-196-AC01).
 *
 * The adapter's job is the mapping: the table's column names and scalar
 * encodings on one side, this module's records on the other, with the
 * enumerated values (origin, account type) checked against the closed lists on
 * the way in so a row a later migration widened -- CBD-9's imported accounts,
 * say -- can never reach the manual commands as a value they do not know.
 *
 * Constraint failures surface as `AccountError`: the driver's SQLSTATE, which
 * data-access preserves on `StatementFailedError.sqlState`, is the only thing
 * read from a failure. 23514 is a CHECK or the identity/version trigger --
 * the fractional amount or unsupported precision the application already
 * refused, kept as defence in depth; 23505 is the live-label index a
 * concurrent writer beat this transaction to; 23503 is a reference that does
 * not resolve inside this budget.
 */
import type { AccountStatements, AccountsRepository, FinancialAccountRow } from "./ports.ts";
import { ACCOUNT_TYPES, AccountError, MANUAL_ORIGIN } from "./records.ts";
import type { AccountRecord, AccountType } from "./records.ts";

export const ACCOUNT_IMMUTABLE_SQLSTATE = "55000";

function sqlStateOf(error: unknown): string | undefined {
  const state = (error as { sqlState?: unknown } | null)?.sqlState;
  return typeof state === "string" ? state : undefined;
}

/** Translate a statement failure to the canonical error, or rethrow anything that is not one. */
export function translateAccountStatementFailure(error: unknown): never {
  const state = sqlStateOf(error);
  if (state === ACCOUNT_IMMUTABLE_SQLSTATE) throw new AccountError("constraint_violation", "immutable");
  if (state === "23514" || state === "23503" || state === "22003") throw new AccountError("constraint_violation");
  if (state === "23505" || state === "40001" || state === "40P01") throw new AccountError("conflict");
  throw error;
}

function accountTypeOf(value: string): AccountType {
  if (!(ACCOUNT_TYPES as readonly string[]).includes(value)) throw new AccountError("account_type_unsupported", "account_type");
  return value as AccountType;
}

function originOf(value: string): string {
  if (value !== MANUAL_ORIGIN) throw new AccountError("constraint_violation", "origin");
  return value;
}

export function accountFromRow(row: FinancialAccountRow): AccountRecord {
  return {
    accountId: row.account_id,
    budgetSpaceId: row.budget_space_id,
    origin: originOf(row.origin),
    accountType: accountTypeOf(row.account_type),
    label: row.label,
    currencyCode: row.currency_code,
    minorUnitPrecision: row.minor_unit_precision,
    openingBalanceMinorUnits: row.opening_balance_minor_units,
    ownerSubjectId: row.owner_subject_id,
    createdBySubjectId: row.created_by_subject_id,
    archivedAt: row.archived_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function accountToRow(record: AccountRecord): FinancialAccountRow {
  return {
    account_id: record.accountId,
    budget_space_id: record.budgetSpaceId,
    origin: record.origin,
    account_type: record.accountType,
    label: record.label,
    currency_code: record.currencyCode,
    minor_unit_precision: record.minorUnitPrecision,
    opening_balance_minor_units: record.openingBalanceMinorUnits,
    owner_subject_id: record.ownerSubjectId,
    created_by_subject_id: record.createdBySubjectId,
    archived_at: record.archivedAt,
    version: record.version,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof AccountError) throw error;
    return translateAccountStatementFailure(error);
  }
}

export function dataAccessAccountsRepository(statements: AccountStatements): AccountsRepository {
  return {
    listAccounts: (budgetSpaceId) => guarded(async () => (await statements.listAccounts(budgetSpaceId)).map(accountFromRow)),
    readAccount: (budgetSpaceId, accountId) => guarded(async () => {
      const row = await statements.readAccount(budgetSpaceId, accountId);
      return row === null ? null : accountFromRow(row);
    }),
    insertAccount: (record) => guarded(() => statements.insertAccount(accountToRow(record))),
    updateAccount: (record, previousVersion) => guarded(async () => (await statements.updateAccount(record.budgetSpaceId, record.accountId, previousVersion, {
      account_type: record.accountType,
      label: record.label,
      opening_balance_minor_units: record.openingBalanceMinorUnits,
      owner_subject_id: record.ownerSubjectId,
      archived_at: record.archivedAt,
      version: record.version,
      updated_at: record.updatedAt,
    })) === 1),
  };
}
