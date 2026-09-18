/**
 * UI-P04 (CBD-358, contract CBD-355): the reports client, in the shape UI-BUILD-PLAN.md section 4.4 states
 * verbatim. A separate client on purpose, following the precedent `invitations.ts` set (section 3.2): a new
 * surface gets its own client module, never an extension of `ApiClient` in `client.ts`.
 *
 * Both endpoints are reads derived by the mock from the existing progress engine (`mock-reports.ts`); this
 * module adds no arithmetic of its own beyond the same magnitude/sign-word formatting `client.ts` already uses
 * for `Progress`/`Target` (`formatMinorUnits`, sign spelled as a word). CBD-358-AC01 forbids arithmetic on a
 * minor-unit value in the *view* module (`reports-view.tsx`); every number the view module reads from here is
 * already a formatted, human-readable string, exactly like `Plan`/`Target` already are for the dashboard.
 */
import { ApiError, formatMinorUnits } from "./client.ts";

// ---------------------------------------------------------------------------
// Wire shapes -- UI-BUILD-PLAN.md section 4.4, verbatim.
// ---------------------------------------------------------------------------

export interface WirePeriodReport {
  periodId: string; start: string; end: string; lengthInDays: number; relation: string;
  plannedMinorUnits: number; settledMinorUnits: number; pendingMinorUnits: number; incomeMinorUnits: number;
  varianceMinorUnits: number; remainingAfterPendingMinorUnits: number;
  adjustedAfterEnd: boolean; dataAsOf: string;
}
export interface WirePeriodsReport {
  budgetSpaceId: string; currencyCode: string; minorUnitPrecision: number;
  periods: readonly WirePeriodReport[];
}
export interface WireCategoryReportRow {
  categoryId: string; label: string;
  plannedMinorUnits: number; settledMinorUnits: number; pendingMinorUnits: number;
  varianceMinorUnits: number; remainingAfterSettledMinorUnits: number; remainingAfterPendingMinorUnits: number;
}
export interface WireCategoryReportTotals {
  plannedMinorUnits: number; settledMinorUnits: number; pendingMinorUnits: number;
  varianceMinorUnits: number; remainingAfterSettledMinorUnits: number; remainingAfterPendingMinorUnits: number;
}
export interface WireCategoriesReport {
  budgetSpaceId: string; periodId: string; currencyCode: string; minorUnitPrecision: number; dataAsOf: string;
  scope: "complete" | "limited";
  rows: readonly WireCategoryReportRow[];
  subtotals: WireCategoryReportTotals;
  totals: WireCategoryReportTotals;
}

// ---------------------------------------------------------------------------
// Presentation: every figure formatted once, here, from the API's own field. The view renders strings only.
// ---------------------------------------------------------------------------

/** A plain magnitude: "12.00 USD". Never signed -- the sign is a word, per section 1.4. */
function magnitude(amountMinorUnits: number, precision: number, currencyCode: string): string {
  return `${formatMinorUnits(Math.abs(amountMinorUnits), precision)} ${currencyCode}`;
}
/** Settled/actual: "no activity", "N spent" (negative -- the mock's sign convention, matching `cellFor`), or "N refunded". */
export function settledLabel(amountMinorUnits: number, precision: number, currencyCode: string): string {
  if (amountMinorUnits === 0) return "no activity";
  return amountMinorUnits < 0 ? `${magnitude(amountMinorUnits, precision, currencyCode)} spent` : `${magnitude(amountMinorUnits, precision, currencyCode)} refunded`;
}
/** A remaining-after figure: "over by N" when negative, otherwise "N remaining". Never a bare minus. */
export function remainingLabel(amountMinorUnits: number, precision: number, currencyCode: string): string {
  return amountMinorUnits < 0 ? `over by ${magnitude(amountMinorUnits, precision, currencyCode)}` : `${magnitude(amountMinorUnits, precision, currencyCode)} remaining`;
}
/** A planned/target or income figure: always a plain magnitude -- no sign concept applies. */
export function planLabel(amountMinorUnits: number, precision: number, currencyCode: string): string {
  return magnitude(amountMinorUnits, precision, currencyCode);
}

export interface PeriodRow {
  periodId: string; start: string; end: string; lengthInDays: number; relation: string;
  planned: string; settled: string; income: string; remainingAfterPending: string;
  adjustedAfterEnd: boolean; dataAsOf: string;
}
export interface CategoryRow {
  categoryId: string; label: string;
  planned: string; settled: string; remainingAfterSettled: string; remainingAfterPending: string;
}
export interface CategoryTotalsRow {
  planned: string; settled: string; remainingAfterSettled: string; remainingAfterPending: string;
}

export function toPeriodRow(wire: WirePeriodReport, currencyCode: string, precision: number): PeriodRow {
  return {
    periodId: wire.periodId, start: wire.start, end: wire.end, lengthInDays: wire.lengthInDays, relation: wire.relation,
    planned: planLabel(wire.plannedMinorUnits, precision, currencyCode),
    settled: settledLabel(wire.settledMinorUnits, precision, currencyCode),
    income: planLabel(wire.incomeMinorUnits, precision, currencyCode),
    remainingAfterPending: remainingLabel(wire.remainingAfterPendingMinorUnits, precision, currencyCode),
    adjustedAfterEnd: wire.adjustedAfterEnd, dataAsOf: wire.dataAsOf,
  };
}
export function toCategoryRow(wire: WireCategoryReportRow, currencyCode: string, precision: number): CategoryRow {
  return {
    categoryId: wire.categoryId, label: wire.label,
    planned: planLabel(wire.plannedMinorUnits, precision, currencyCode),
    settled: settledLabel(wire.settledMinorUnits, precision, currencyCode),
    remainingAfterSettled: remainingLabel(wire.remainingAfterSettledMinorUnits, precision, currencyCode),
    remainingAfterPending: remainingLabel(wire.remainingAfterPendingMinorUnits, precision, currencyCode),
  };
}
export function toCategoryTotalsRow(wire: WireCategoryReportTotals, currencyCode: string, precision: number): CategoryTotalsRow {
  return {
    planned: planLabel(wire.plannedMinorUnits, precision, currencyCode),
    settled: settledLabel(wire.settledMinorUnits, precision, currencyCode),
    remainingAfterSettled: remainingLabel(wire.remainingAfterSettledMinorUnits, precision, currencyCode),
    remainingAfterPending: remainingLabel(wire.remainingAfterPendingMinorUnits, precision, currencyCode),
  };
}

// ---------------------------------------------------------------------------
// The client.
// ---------------------------------------------------------------------------

export interface ReportsClient {
  periods(budgetSpaceId: string, limit: number, signal?: AbortSignal): Promise<WirePeriodsReport>;
  categories(budgetSpaceId: string, periodId: string, signal?: AbortSignal): Promise<WireCategoriesReport>;
}

export function createReportsClient(base = "/v1", fetcher: typeof fetch = fetch): ReportsClient {
  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetcher(`${base}${path}`, {
      method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new ApiError(response.status, typeof body.error === "string" ? body.error : "request_failed");
    return body as T;
  }
  return {
    periods: (budgetSpaceId, limit, signal) =>
      get(`/budget-spaces/${encodeURIComponent(budgetSpaceId)}/reports/periods?limit=${encodeURIComponent(String(limit))}`, signal),
    categories: (budgetSpaceId, periodId, signal) =>
      get(`/budget-spaces/${encodeURIComponent(budgetSpaceId)}/reports/categories?periodId=${encodeURIComponent(periodId)}`, signal),
  };
}
