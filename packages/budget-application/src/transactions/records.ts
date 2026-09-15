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
  "stale_version",
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

/** The version the client named as its basis, and the one that is current instead (CBD-200-AC04). */
export interface VersionBasis {
  readonly transactionVersionId: string;
  readonly revision: number;
}

/**
 * A mutation whose stated basis is not the current version (CBD-200-AC04).
 *
 * Carries the current version so the refusal is a reload-and-retry result
 * and not just a code: the client learns what it should have been looking at
 * without a second round trip. Nothing has been written when this is thrown.
 */
export class StaleVersionError extends TransactionError {
  readonly current: VersionBasis;
  constructor(current: VersionBasis, detail = "expectedTransactionVersionId") {
    super("stale_version", detail);
    this.name = "StaleVersionError";
    this.current = current;
  }
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

/** The three manual-transaction actions an Idempotency-Key can name (CBD-200-AC05). */
export const IDEMPOTENT_TRANSACTION_ACTIONS = ["create", "edit", "remove"] as const;
export type IdempotentTransactionAction = (typeof IDEMPOTENT_TRANSACTION_ACTIONS)[number];

/** The idempotency scope: one committed response per key, per action, per acting membership, per budget. */
export interface IdempotencyScope {
  readonly budgetSpaceId: string;
  readonly membershipId: string;
  readonly action: IdempotentTransactionAction;
  readonly idempotencyKey: string;
}

/** The row `manual_transaction_idempotency` (20260915T140000Z, widened 20260915T160000Z) keeps for one accepted key. */
export interface IdempotencyRecord extends IdempotencyScope {
  /** SHA-256 hex over the canonical form of the parsed request. */
  readonly requestDigest: string;
  /** The current version the committed response names; the row is bound to it. */
  readonly transactionVersionId: string;
  readonly committedResponse: TransactionMutation;
  /** SEC-C200-F1: the acting membership's authorization_version at write time. A replay is refused when this is behind the membership's current authorization_version. */
  readonly authorizationVersion: number;
  readonly createdAt: string;
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
