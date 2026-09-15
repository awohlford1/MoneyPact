/**
 * `TransactionsRepository` over the typed statement sets for
 * `manual_transaction`, `transaction_allocation`, `financial_account`,
 * `budget_category` and `budget_space_period`.
 *
 * The adapter's job is the mapping and the ordering. `appendVersion` stamps
 * the superseded version *before* inserting the new one, so the partial
 * unique index on "one current version per identity" is never momentarily
 * violated, and writes the allocation rows after the version they belong to.
 * All of it runs inside the caller's transaction, which is where the deferred
 * exact-sum constraint trigger fires: a split that does not add up fails the
 * commit, not the individual insert.
 *
 * Constraint failures surface as `TransactionError` read from the SQLSTATE
 * data-access preserves on `StatementFailedError.sqlState`. 55000 is the
 * migration's "this row is history" trigger; 23514 is a CHECK or the
 * exact-sum trigger the application already refused, kept as defence in
 * depth; 23503 is a reference that does not resolve inside this budget; 23505
 * is a concurrent writer that got there first.
 */
import type {
  BudgetCategorySummaryRow,
  BudgetSpacePeriodRow,
  FinancialAccountRow,
  ManualTransactionIdempotencyRow,
  ManualTransactionRow,
  Supersession,
  TransactionAllocationRow,
  TransactionStatements,
  TransactionsRepository,
} from "./ports.ts";
import { MANUAL_TRANSACTION_ORIGIN, SETTLED_STATE, TRANSACTION_SOURCES, TransactionError } from "./records.ts";
import type { AllocationRecord, CategorySummary, IdempotencyRecord, IdempotencyScope, PeriodRecord, TransactionMutation, TransactionRecord, TransactionSnapshot, TransactionSource } from "./records.ts";
import { accountFromRow } from "../accounts/data-access-adapter.ts";
import type { AccountRecord } from "../accounts/records.ts";

export const TRANSACTION_VERSION_IMMUTABLE_SQLSTATE = "55000";

function sqlStateOf(error: unknown): string | undefined {
  const state = (error as { sqlState?: unknown } | null)?.sqlState;
  return typeof state === "string" ? state : undefined;
}

/** Translate a statement failure to the canonical error, or rethrow anything that is not one. */
export function translateTransactionStatementFailure(error: unknown): never {
  const state = sqlStateOf(error);
  if (state === TRANSACTION_VERSION_IMMUTABLE_SQLSTATE) throw new TransactionError("constraint_violation", "immutable");
  if (state === "23514" || state === "23503" || state === "22003") throw new TransactionError("constraint_violation");
  if (state === "23505" || state === "40001" || state === "40P01") throw new TransactionError("conflict");
  throw error;
}

function sourceOf(value: string): TransactionSource {
  if (!(TRANSACTION_SOURCES as readonly string[]).includes(value)) throw new TransactionError("constraint_violation", "source");
  return value as TransactionSource;
}

export function transactionFromRow(row: ManualTransactionRow): TransactionRecord {
  if (row.origin !== MANUAL_TRANSACTION_ORIGIN) throw new TransactionError("constraint_violation", "origin");
  if (row.settlement_state !== SETTLED_STATE) throw new TransactionError("constraint_violation", "settlement_state");
  return {
    transactionVersionId: row.transaction_version_id,
    transactionId: row.transaction_id,
    budgetSpaceId: row.budget_space_id,
    accountId: row.account_id,
    revision: row.revision,
    origin: row.origin,
    settlementState: row.settlement_state,
    currencyCode: row.currency_code,
    minorUnitPrecision: row.minor_unit_precision,
    amountMinorUnits: row.amount_minor_units,
    budgetDate: row.budget_date,
    periodId: row.period_id,
    periodStart: row.period_start_date,
    periodEnd: row.period_end_date,
    description: row.description,
    recordedBySubjectId: row.recorded_by_subject_id,
    source: sourceOf(row.source),
    removedAt: row.removed_at,
    removedBySubjectId: row.removed_by_subject_id,
    supersededAt: row.superseded_at,
    createdAt: row.created_at,
  };
}

export function transactionToRow(record: TransactionRecord): ManualTransactionRow {
  return {
    transaction_version_id: record.transactionVersionId,
    transaction_id: record.transactionId,
    budget_space_id: record.budgetSpaceId,
    account_id: record.accountId,
    revision: record.revision,
    origin: record.origin,
    settlement_state: record.settlementState,
    currency_code: record.currencyCode,
    minor_unit_precision: record.minorUnitPrecision,
    amount_minor_units: record.amountMinorUnits,
    budget_date: record.budgetDate,
    period_id: record.periodId,
    period_start_date: record.periodStart,
    period_end_date: record.periodEnd,
    description: record.description,
    recorded_by_subject_id: record.recordedBySubjectId,
    source: record.source,
    removed_at: record.removedAt,
    removed_by_subject_id: record.removedBySubjectId,
    superseded_at: record.supersededAt,
    created_at: record.createdAt,
  };
}

export function allocationFromRow(row: TransactionAllocationRow): AllocationRecord {
  return {
    allocationId: row.allocation_id,
    budgetSpaceId: row.budget_space_id,
    transactionVersionId: row.transaction_version_id,
    categoryId: row.category_id,
    currencyCode: row.currency_code,
    minorUnitPrecision: row.minor_unit_precision,
    amountMinorUnits: row.amount_minor_units,
    createdAt: row.created_at,
  };
}

export function allocationToRow(record: AllocationRecord): TransactionAllocationRow {
  return {
    allocation_id: record.allocationId,
    budget_space_id: record.budgetSpaceId,
    transaction_version_id: record.transactionVersionId,
    category_id: record.categoryId,
    currency_code: record.currencyCode,
    minor_unit_precision: record.minorUnitPrecision,
    amount_minor_units: record.amountMinorUnits,
    created_at: record.createdAt,
  };
}

export function periodFromRow(row: BudgetSpacePeriodRow): PeriodRecord {
  return {
    periodId: row.period_id,
    budgetSpaceId: row.budget_space_id,
    status: row.status,
    periodStart: row.period_start_date,
    periodEnd: row.period_end_date,
  };
}

/** The stored response is the `TransactionMutation` the route returned; a row that does not carry one is a stored-state defect, not a replay. */
export function idempotencyFromRow(row: ManualTransactionIdempotencyRow): IdempotencyRecord {
  const response = row.committed_response;
  if (typeof response !== "object" || response === null || !("current" in response)) throw new TransactionError("constraint_violation", "committed_response");
  return {
    budgetSpaceId: row.budget_space_id,
    membershipId: row.membership_id,
    action: row.action,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_digest,
    transactionVersionId: row.transaction_version_id,
    committedResponse: response as TransactionMutation,
    authorizationVersion: row.authorization_version,
    createdAt: row.created_at,
  };
}

export function idempotencyToRow(record: IdempotencyRecord): Omit<ManualTransactionIdempotencyRow, "idempotency_id"> {
  return {
    budget_space_id: record.budgetSpaceId,
    membership_id: record.membershipId,
    action: record.action,
    idempotency_key: record.idempotencyKey,
    request_digest: record.requestDigest,
    transaction_version_id: record.transactionVersionId,
    committed_response: record.committedResponse,
    authorization_version: record.authorizationVersion,
    created_at: record.createdAt,
  };
}

export function categorySummaryFromRow(row: BudgetCategorySummaryRow): CategorySummary {
  return { categoryId: row.category_id, budgetSpaceId: row.budget_space_id, archivedAt: row.archived_at };
}

function accountRecordFromRow(row: FinancialAccountRow): AccountRecord {
  return accountFromRow(row);
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof TransactionError) throw error;
    return translateTransactionStatementFailure(error);
  }
}

export function dataAccessTransactionsRepository(statements: TransactionStatements): TransactionsRepository {
  async function allocationsOf(budgetSpaceId: string, transactionVersionId: string): Promise<readonly AllocationRecord[]> {
    return (await statements.listAllocations(budgetSpaceId, transactionVersionId)).map(allocationFromRow);
  }

  return {
    listPeriods: (budgetSpaceId) => guarded(async () => (await statements.listPeriods(budgetSpaceId)).map(periodFromRow)),
    readAccount: (budgetSpaceId, accountId) => guarded(async () => {
      const row = await statements.readAccount(budgetSpaceId, accountId);
      return row === null ? null : accountRecordFromRow(row);
    }),
    listCategories: (budgetSpaceId) => guarded(async () => (await statements.listCategories(budgetSpaceId)).map(categorySummaryFromRow)),
    listVersions: (budgetSpaceId, transactionId) => guarded(async () => (await statements.listTransactionVersions(budgetSpaceId, transactionId)).map(transactionFromRow)),
    listAllocations: (budgetSpaceId, transactionVersionId) => guarded(() => allocationsOf(budgetSpaceId, transactionVersionId)),
    readPeriodLedger: (budgetSpaceId, periodId) => guarded(async () => {
      const rows = await statements.listTransactionsByPeriod(budgetSpaceId, periodId);
      const snapshots: TransactionSnapshot[] = [];
      for (const row of rows) {
        const version = transactionFromRow(row);
        if (version.supersededAt !== null || version.removedAt !== null) continue;
        snapshots.push({ version, allocations: await allocationsOf(budgetSpaceId, version.transactionVersionId) });
      }
      return snapshots;
    }),
    appendVersion: (version, allocations, supersedes: Supersession | null) => guarded(async () => {
      if (supersedes !== null) {
        // Stamp first: the partial unique index admits exactly one current
        // version per identity, so the new row cannot land while the old one
        // is still unstamped.
        if ((await statements.supersedeTransaction(version.budgetSpaceId, supersedes.transactionVersionId, supersedes.supersededAt)) !== 1) {
          throw new TransactionError("conflict", "transactionVersionId");
        }
      }
      const { superseded_at: _superseded, ...row } = transactionToRow(version);
      await statements.insertTransaction(row);
      for (const allocation of allocations) {
        if (allocation.transactionVersionId !== version.transactionVersionId || allocation.budgetSpaceId !== version.budgetSpaceId) {
          throw new TransactionError("invalid_request", "allocations");
        }
        await statements.insertAllocation(allocationToRow(allocation));
      }
    }),
    readIdempotency: (scope: IdempotencyScope) => guarded(async () => {
      if (statements.readIdempotency === undefined) throw new TransactionError("constraint_violation", "idempotency_unavailable");
      const row = await statements.readIdempotency(scope);
      return row === null ? null : idempotencyFromRow(row);
    }),
    recordIdempotency: (record) => guarded(async () => {
      if (statements.insertIdempotency === undefined) throw new TransactionError("constraint_violation", "idempotency_unavailable");
      await statements.insertIdempotency(idempotencyToRow(record));
    }),
  };
}
