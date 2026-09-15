/**
 * Category targets application module (CBD-153, PROTO-TARGETS-001): the
 * persisted records, the canonical errors, and the small currency-precision
 * catalog the module needs to size a minor unit.
 *
 * The records mirror the three CBD-153 tables one to one, in camelCase. The
 * domain types they carry (`Cadence`, `TargetOrigin`, `ProrationRecord`) are
 * budget-domain's own; nothing here re-declares arithmetic.
 */
import type { Cadence } from "@cobudget/budget-domain/schedule";
import type { ProrationRecord, TargetOrigin } from "@cobudget/budget-domain/targets";

export const TARGETS_ERROR_CODES = [
  "invalid_request",
  "budget_space_not_found",
  "period_not_found",
  "category_not_found",
  "category_archived",
  "duplicate_category",
  "label_invalid",
  "label_taken",
  "position_invalid",
  "amount_invalid",
  "amount_negative",
  "currency_unsupported",
  "currency_precision_unsupported",
  "cadence_unsupported",
  "completed_period_immutable",
  "constraint_violation",
  "conflict",
] as const;

export type TargetsErrorCode = (typeof TARGETS_ERROR_CODES)[number];

/** A canonical application failure. `code` is the stable contract; `detail` is a safe path or field name, never a value. */
export class TargetsError extends Error {
  readonly code: TargetsErrorCode;
  readonly detail: string | undefined;
  constructor(code: TargetsErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "TargetsError";
    this.code = code;
    this.detail = detail;
  }
}

/** The formula this module records on every period target it persists; bump when budget-domain's arithmetic changes shape. */
export const TARGET_FORMULA_VERSION = "budget-domain/targets/1";

/** Sources a target row may name. `system` is reserved for later automation (CBD-154/155). */
export const TARGET_SOURCES = ["user", "system"] as const;
export type TargetSource = (typeof TARGET_SOURCES)[number];

/** The minor-unit precisions the domain's single integer code path represents (proration.ts). */
export const SUPPORTED_MINOR_UNIT_PRECISIONS: readonly number[] = [0, 2, 3];

/**
 * ISO 4217 minor-unit digits for the currencies this prototype knows. A
 * currency absent here is `currency_unsupported`; one present with a
 * precision outside {@link SUPPORTED_MINOR_UNIT_PRECISIONS} (CLF, UYW) is
 * `currency_precision_unsupported`, which is CBD-153-AC04's application-level
 * half. The migration's CHECK is the other half.
 */
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

/** Resolve a currency to a supported precision or throw the canonical error (AC04). */
export function resolveMinorUnitPrecision(reader: CurrencyPrecisionReader, currencyCode: string): number {
  if (!/^[A-Z]{3}$/u.test(currencyCode)) throw new TargetsError("currency_unsupported", "currencyCode");
  const precision = reader.minorUnitPrecision(currencyCode);
  if (precision === null) throw new TargetsError("currency_unsupported", "currencyCode");
  if (!SUPPORTED_MINOR_UNIT_PRECISIONS.includes(precision)) throw new TargetsError("currency_precision_unsupported", "currencyCode");
  return precision;
}

export interface CategoryRecord {
  readonly categoryId: string;
  readonly budgetSpaceId: string;
  readonly label: string;
  readonly position: number;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * PROTO-HARDENING-001 (F-INCB-03): the category row's own monotonic version.
   * 1 on creation, advanced by one on every edit. This is what CBD-236 SS8.6.1
   * `resource.version` carries for the CBD-211 category target; it is not a
   * policy version, a disclosure version or an authorization version.
   */
  readonly version: number;
}

export interface BaseTargetRecord {
  readonly baseTargetId: string;
  readonly budgetSpaceId: string;
  readonly categoryId: string;
  readonly cadence: Cadence;
  readonly currencyCode: string;
  readonly minorUnitPrecision: number;
  readonly amountMinorUnits: number;
  readonly setBySubjectId: string;
  readonly source: TargetSource;
  readonly createdAt: string;
  readonly supersededAt: string | null;
}

/** What the engine was given, recorded so the stored result can be re-derived (INV-79). */
export interface PeriodTargetInputs {
  readonly baseTargetId: string | null;
  readonly baseAmountMinorUnits: number;
  readonly cadence: Cadence;
  readonly scheduleVersionId: string;
  readonly period: { readonly start: string; readonly end: string };
  /** Present only for a prorated transition (CBD-154/155); null for a full period. */
  readonly basis: { readonly start: string; readonly end: string } | null;
}

export interface PeriodTargetRecord {
  readonly periodTargetId: string;
  readonly budgetSpaceId: string;
  readonly categoryId: string;
  readonly periodId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly origin: TargetOrigin;
  readonly currencyCode: string;
  readonly minorUnitPrecision: number;
  readonly amountMinorUnits: number;
  readonly formulaVersion: string;
  readonly inputs: PeriodTargetInputs;
  readonly calculation: ProrationRecord | null;
  readonly computedBySubjectId: string;
  readonly source: TargetSource;
  readonly computedAt: string;
  /** null on the current version; the instant a recomputation of the open period superseded this row otherwise. */
  readonly supersededAt: string | null;
}

/** The budget and period a plan is read for. */
export interface PlanContext {
  readonly budgetSpaceId: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly currentPeriodId: string;
  readonly periodId: string;
  readonly scheduleVersionId: string;
  readonly periodStatus: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly cadence: Cadence;
}

/** Deterministic ordering on stable identity, matching budget-domain's tie-break (INV-84). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
