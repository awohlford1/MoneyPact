/**
 * Manual transactions application module (CBD-199, CBD-200, CBD-201,
 * CBD-209): the persisted records and the canonical errors.
 *
 * The records mirror `manual_transaction` and `transaction_allocation`
 * (20260914T180001Z, 20260914T180002Z) one to one, in camelCase. A
 * `TransactionRecord` is a *version*, not an identity: `transactionId` is
 * what a user refers to and what every audit path follows, and
 * `transactionVersionId` is the row that carries one particular set of facts
 * about it. Allocations hang off the version, which is what makes replacing a
 * split a single atomic substitution with the before/after set retained
 * (CBD-201-AC04).
 *
 * Monetary rules come from `../accounts/records.ts`: one copy of the ISO 4217
 * data and one definition of "an exact signed minor-unit integer" for the
 * whole increment.
 */
import { AccountError } from "../accounts/records.ts";
import type { AccountErrorCode } from "../accounts/records.ts";

export const TRANSACTION_ERROR_CODES = [
  "invalid_request",
  "account_not_found",
  "account_archived",
  "account_inaccessible",
  "amount_not_integer",
  "amount_overflow",
  "currency_unsupported",
  "currency_mismatch",
  "date_invalid",
  "description_invalid",
  "period_not_found",
  "period_ambiguous",
  "allocations_empty",
  "allocation_duplicate_category",
  "allocation_category_invalid",
  "allocation_sum_mismatch",
  "transaction_not_found",
  "transaction_removed",
  "constraint_violation",
  "conflict",
] as const;

export type TransactionErrorCode = (typeof TRANSACTION_ERROR_CODES)[number];

/** A canonical application failure. `code` is the stable contract; `detail` is a field path or rule name, never a customer value. */
export class TransactionError extends Error {
  readonly code: TransactionErrorCode;
  readonly detail: string | undefined;
  constructor(code: TransactionErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "TransactionError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Account-layer monetary failures reach a transaction caller as transaction
 * failures, with the same meaning and the same field path. The two error
 * classes stay separate so neither module's vocabulary grows the other's
 * codes; this is the one crossing, and it is explicit.
 */
const ACCOUNT_TO_TRANSACTION: Readonly<Partial<Record<AccountErrorCode, TransactionErrorCode>>> = Object.freeze({
  amount_not_integer: "amount_not_integer",
  amount_overflow: "amount_overflow",
  currency_unsupported: "currency_unsupported",
  currency_precision_unsupported: "currency_unsupported",
});

export function asTransactionError(error: unknown): never {
  if (error instanceof AccountError) {
    const mapped = ACCOUNT_TO_TRANSACTION[error.code];
    if (mapped !== undefined) throw new TransactionError(mapped, error.detail);
  }
  throw error;
}

/** The only origin and the only settlement state this increment can produce (CBD-199-AC02). */
export const MANUAL_TRANSACTION_ORIGIN = "manual";
export const SETTLED_STATE = "settled";

export const TRANSACTION_SOURCES = ["user", "system"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const MAX_DESCRIPTION_LENGTH = 200;

/** `YYYY-MM-DD`, validated as a real calendar date. */
export const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** One stored version of one transaction identity. */
export interface TransactionRecord {
  readonly transactionVersionId: string;
  readonly transactionId: string;
  readonly budgetSpaceId: string;
  readonly accountId: string;
  readonly revision: number;
  readonly origin: string;
  readonly settlementState: string;
  readonly currencyCode: string;
  readonly minorUnitPrecision: number;
  readonly amountMinorUnits: number;
  readonly budgetDate: string;
  readonly periodId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly description: string | null;
  readonly recordedBySubjectId: string;
  readonly source: TransactionSource;
  /** Set on a tombstone version: the transaction has no financial effect from this version on (CBD-200-AC03). */
  readonly removedAt: string | null;
  readonly removedBySubjectId: string | null;
  /** null on the current version; the instant a later version replaced this one otherwise. */
  readonly supersededAt: string | null;
  readonly createdAt: string;
}

/** One category's signed share of one transaction version. */
export interface AllocationRecord {
  readonly allocationId: string;
  readonly budgetSpaceId: string;
  readonly transactionVersionId: string;
  readonly categoryId: string;
  readonly currencyCode: string;
  readonly minorUnitPrecision: number;
  readonly amountMinorUnits: number;
  readonly createdAt: string;
}

/** A version with the allocation set that belongs to it. */
export interface TransactionSnapshot {
  readonly version: TransactionRecord;
  readonly allocations: readonly AllocationRecord[];
}

/** The ordered before/after pair an edit or a removal reports (CBD-201-AC04). */
export interface TransactionMutation {
  readonly previous: TransactionSnapshot | null;
  readonly current: TransactionSnapshot;
}

/** One budget period as the assignment rule sees it: an identity and inclusive bounds. */
export interface PeriodRecord {
  readonly periodId: string;
  readonly budgetSpaceId: string;
  readonly status: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** The little a transaction needs to know about a category: that it exists here and is live. */
export interface CategorySummary {
  readonly categoryId: string;
  readonly budgetSpaceId: string;
  readonly archivedAt: string | null;
}

/** Deterministic ordering on stable identity. */
export function compareTransactionIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
