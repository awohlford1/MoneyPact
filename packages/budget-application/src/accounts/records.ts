/**
 * Manual accounts application module (CBD-196, PROTO-INCREMENT-A-001): the
 * persisted record, the canonical errors, and the monetary rules both this
 * module and `../transactions` are built on.
 *
 * The record mirrors `financial_account` (20260914T180000Z) one to one, in
 * camelCase. The currency catalog is this increment's own copy rather than a
 * reach into `../targets`: a target refuses a negative amount and an account
 * must not, so sharing the module would mean sharing an error vocabulary that
 * says the wrong thing for half its callers. The ISO 4217 data is the same
 * data, and both copies are checked against the same migration CHECK.
 */

export const ACCOUNT_ERROR_CODES = [
  "invalid_request",
  "label_invalid",
  "label_taken",
  "account_type_unsupported",
  "currency_unsupported",
  "currency_precision_unsupported",
  "amount_not_integer",
  "amount_overflow",
  "owner_invalid",
  "account_not_found",
  "account_archived",
  "account_not_archived",
  "version_conflict",
  "constraint_violation",
  "conflict",
] as const;

export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

/** A canonical application failure. `code` is the stable contract; `detail` is a field path or rule name, never a customer value. */
export class AccountError extends Error {
  readonly code: AccountErrorCode;
  readonly detail: string | undefined;
  constructor(code: AccountErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AccountError";
    this.code = code;
    this.detail = detail;
  }
}

/** The account types the migration's CHECK admits. CBD-9 widens both together. */
export const ACCOUNT_TYPES = ["checking", "savings", "cash", "credit-card", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** The only origin this increment can produce (CBD-196-AC01, CBD-199-AC02). */
export const MANUAL_ORIGIN = "manual";

export const MAX_ACCOUNT_LABEL_LENGTH = 120;

/**
 * The exact-integer bound. PostgreSQL's bigint is wider, but a value beyond
 * this cannot survive a JSON round trip through the API without silently
 * changing, so it is refused at the application edge rather than stored and
 * mis-read later (CBD-196-AC02 overflow, CBD-199-AC03 overflow).
 */
export const MAX_MINOR_UNITS = Number.MAX_SAFE_INTEGER;

/** The minor-unit precisions the integer code path represents; the migration's CHECK is the other half. */
export const SUPPORTED_MINOR_UNIT_PRECISIONS: readonly number[] = [0, 2, 3];

/** ISO 4217 minor-unit digits for the currencies this prototype knows. */
export const ISO4217_MINOR_UNITS: Readonly<Record<string, number>> = Object.freeze({
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, CHF: 2, MXN: 2, BRL: 2, INR: 2, CNY: 2, SEK: 2, NOK: 2, DKK: 2, PLN: 2, ZAR: 2, SGD: 2, HKD: 2,
  JPY: 0, KRW: 0, ISK: 0, CLP: 0, VND: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, IQD: 3, LYD: 3,
  CLF: 4, UYW: 4,
});

export interface CurrencyPrecisionReader {
  /** Minor-unit digits for an ISO 4217 code, or null when the currency is unknown. */
  readonly minorUnitPrecision: (currencyCode: string) => number | null;
}

export const iso4217PrecisionReader: CurrencyPrecisionReader = {
  minorUnitPrecision: (currencyCode) => ISO4217_MINOR_UNITS[currencyCode] ?? null,
};

/** Resolve a currency to a supported precision or throw the canonical error. */
export function resolveAccountPrecision(reader: CurrencyPrecisionReader, currencyCode: unknown, path: string): number {
  if (typeof currencyCode !== "string" || !/^[A-Z]{3}$/u.test(currencyCode)) throw new AccountError("currency_unsupported", path);
  const precision = reader.minorUnitPrecision(currencyCode);
  if (precision === null) throw new AccountError("currency_unsupported", path);
  if (!SUPPORTED_MINOR_UNIT_PRECISIONS.includes(precision)) throw new AccountError("currency_precision_unsupported", path);
  return precision;
}

/**
 * A signed minor-unit amount. Fractional and non-numeric values are refused
 * as `amount_not_integer` and anything beyond the exact-integer range as
 * `amount_overflow`, so "12.5 cents" and "10^20 cents" are different
 * failures rather than one vague one (CBD-196-AC02, CBD-199-AC03).
 */
export function parseSignedMinorUnits(value: unknown, path: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) throw new AccountError("amount_not_integer", path);
  if (!Number.isFinite(value) || Math.abs(value) > MAX_MINOR_UNITS) throw new AccountError("amount_overflow", path);
  if (!Number.isInteger(value)) throw new AccountError("amount_not_integer", path);
  return value;
}

export interface AccountRecord {
  readonly accountId: string;
  readonly budgetSpaceId: string;
  readonly origin: string;
  readonly accountType: AccountType;
  readonly label: string;
  readonly currencyCode: string;
  readonly minorUnitPrecision: number;
  readonly openingBalanceMinorUnits: number;
  readonly ownerSubjectId: string;
  readonly createdBySubjectId: string;
  readonly archivedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What an accepted write reports for audit: the version before and the record after (CBD-196-AC03). */
export interface AccountMutation {
  readonly previousVersion: number | null;
  readonly account: AccountRecord;
}

/** Deterministic ordering on stable identity. */
export function compareAccountIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
