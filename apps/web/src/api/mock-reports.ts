/** DEVELOPMENT ONLY (CBD-358, contract CBD-355; UI-BUILD-PLAN.md section 4.4). Registered in the mock route
 * module registry (`mock-registry.ts`); imported by `mock-server.ts` only, never by browser components.
 *
 * The two endpoints stubbed here are read entirely off the same stored fields `mock-server.ts` already keeps
 * for the progress engine (`MockSpace.categories`, `.base`, `.versions`, `.schedule`) and the same domain-engine
 * call (`fullPeriodTargets`) it already makes; no new arithmetic rule is introduced. `mock-server.ts` itself is
 * not edited beyond the registry line in `mock-registry.ts` (per the UI-P04 packet's binding correction), so the
 * per-category settle/target computation below is a deliberate, minimal re-statement of `mock-server.ts`'s own
 * `cellFor`/`settledVersions`/`planFor` logic over the same stored fields -- it is not a new formula, but it is
 * unavoidable duplication given that those helpers are private closures in a file this packet may not alter.
 * Recorded as a finding in the packet's result, not silently absorbed.
 *
 * Two mock-fidelity limits, both a consequence of "invent no new value" rather than a product choice:
 *  - `MockSpace.detail.nextPeriods` (the confirmation preview's following periods) carry no `periodId` -- only
 *    the active period does, assigned at confirmation. So `reports/periods` can honestly report only the
 *    current period; it never fabricates an id for a period the space has not reached yet. A `limit` above 1
 *    simply returns the one period that exists.
 *  - No expected-income model exists in this mock (CBD-182 is deferred -- OQ-UI-03). `incomeMinorUnits` is
 *    always 0, exactly the way `pendingMinorUnits` is always 0 for a manual transaction before imports land;
 *    the field is present and labelled so the surface is correct once income lands, per the packet's brief.
 *  - Category-level scope narrowing (CBD-357, an API concern, explicitly out of this packet's scope) is not
 *    modelled: `scope` is always `"complete"`. The wire shape carries `"limited"` for forward compatibility and
 *    the view renders it if it ever arrives, but this mock never emits it.
 *  - `subtotals` and `totals` are identical: the mock has no category grouping to subtotal by.
 */
import type { CadenceDefinition } from "@cobudget/budget-domain/schedule";
import { toISODate } from "@cobudget/budget-domain/shared";
import { fullPeriodTargets } from "@cobudget/budget-domain/targets";
import { ApiError } from "./client.ts";
import type { MockDirectory } from "./mock-invitations.ts";
import { activeMembership } from "./mock-invitations.ts";
import type { MockRouteModule } from "./mock-registry.ts";
import type { WireCategoriesReport, WireCategoryReportRow, WireCategoryReportTotals, WirePeriodReport, WirePeriodsReport } from "./reports.ts";

// The subset of `mock-server.ts`'s private `MockSpace` shape this module reads. Structural, not imported --
// `mock-server.ts` exports no such type, and this packet does not edit that file beyond the registry line.
interface ReportCategory { categoryId: string; label: string; position: number; archivedAt: string | null }
interface ReportAllocation { categoryId: string; amountMinorUnits: number }
interface ReportVersion { budgetDate: string; allocations: readonly ReportAllocation[]; removedAt: string | null; supersededAt: string | null }
interface ReportPeriod { periodId: string; start: string; end: string; lengthInDays: number }
interface ReportSpace {
  detail: { space: { budgetSpaceId: string; currencyCode: string }; activePeriod: ReportPeriod | null };
  schedule: CadenceDefinition;
  categories: readonly ReportCategory[];
  base: Map<string, number>;
  versions: readonly ReportVersion[];
}

const noStore = { "Cache-Control": "no-store" };
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...noStore, "content-type": "application/json" } });
}

function reportSpaceOf(directory: MockDirectory, accountSubjectId: string, id: string): ReportSpace {
  const spaces = directory.spaces as Map<string, ReportSpace>;
  const value = spaces.get(id);
  if (!value || !activeMembership(directory, id, accountSubjectId)) throw new ApiError(403, "authorization_denied");
  return value;
}
function liveCategories(value: ReportSpace): ReportCategory[] {
  return [...value.categories].filter(category => category.archivedAt === null).sort((a, b) => a.position - b.position);
}
/** The same call `mock-server.ts`'s `planFor` makes, over the same stored fields. */
function targetsFor(value: ReportSpace, period: { start: string; end: string }): Map<string, number> {
  const live = liveCategories(value);
  if (live.length === 0) return new Map();
  const computed = fullPeriodTargets(
    { cadence: value.schedule.cadence, currency: value.detail.space.currencyCode, targets: live.map(category => ({ categoryId: category.categoryId, amountMinorUnits: value.base.get(category.categoryId) ?? 0 })) },
    value.schedule.cadence, { start: toISODate(period.start), end: toISODate(period.end) },
  );
  return new Map(computed.map(result => [result.categoryId, result.amountMinorUnits]));
}
/** The same filter `mock-server.ts`'s `settledVersions` applies, summed for one category -- what `cellFor` calls `settledActualMinorUnits`. */
function settledFor(value: ReportSpace, period: { start: string; end: string }, categoryId: string): number {
  return value.versions
    .filter(version => version.supersededAt === null && version.removedAt === null && version.budgetDate >= period.start && version.budgetDate <= period.end)
    .flatMap(version => version.allocations.filter(allocation => allocation.categoryId === categoryId))
    .reduce((total, allocation) => total + allocation.amountMinorUnits, 0);
}

function periodEntry(value: ReportSpace, now: number): WirePeriodReport | null {
  const period = value.detail.activePeriod;
  if (!period) return null;
  const live = liveCategories(value);
  const targets = targetsFor(value, period);
  let plannedMinorUnits = 0; let settledMinorUnits = 0;
  for (const category of live) {
    plannedMinorUnits += targets.get(category.categoryId) ?? 0;
    settledMinorUnits += settledFor(value, period, category.categoryId);
  }
  // Every manual record is settled (CBD-107): pending is always zero, so remaining-after-pending equals
  // remaining-after-settled, exactly as `cellFor`'s own comment records for one category.
  const remainingAfterPendingMinorUnits = plannedMinorUnits + settledMinorUnits;
  return {
    periodId: period.periodId, start: period.start, end: period.end, lengthInDays: period.lengthInDays, relation: "current",
    plannedMinorUnits, settledMinorUnits, pendingMinorUnits: 0, incomeMinorUnits: 0,
    varianceMinorUnits: remainingAfterPendingMinorUnits, remainingAfterPendingMinorUnits,
    adjustedAfterEnd: false, dataAsOf: new Date(now).toISOString(),
  };
}
function categoryRow(value: ReportSpace, period: { start: string; end: string }, category: ReportCategory, targetMinorUnits: number): WireCategoryReportRow {
  const settledMinorUnits = settledFor(value, period, category.categoryId);
  const remainingAfterSettledMinorUnits = targetMinorUnits + settledMinorUnits;
  return {
    categoryId: category.categoryId, label: category.label,
    plannedMinorUnits: targetMinorUnits, settledMinorUnits, pendingMinorUnits: 0,
    varianceMinorUnits: remainingAfterSettledMinorUnits,
    remainingAfterSettledMinorUnits, remainingAfterPendingMinorUnits: remainingAfterSettledMinorUnits,
  };
}
function totalsOf(rows: readonly WireCategoryReportRow[]): WireCategoryReportTotals {
  const sum = (pick: (row: WireCategoryReportRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    plannedMinorUnits: sum(row => row.plannedMinorUnits), settledMinorUnits: sum(row => row.settledMinorUnits),
    pendingMinorUnits: sum(row => row.pendingMinorUnits), varianceMinorUnits: sum(row => row.varianceMinorUnits),
    remainingAfterSettledMinorUnits: sum(row => row.remainingAfterSettledMinorUnits),
    remainingAfterPendingMinorUnits: sum(row => row.remainingAfterPendingMinorUnits),
  };
}

function handlePeriods(value: ReportSpace, url: URL, now: number): WirePeriodsReport {
  const requested = Number(url.searchParams.get("limit") ?? "12");
  const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 12;
  const entry = periodEntry(value, now);
  return {
    budgetSpaceId: value.detail.space.budgetSpaceId, currencyCode: value.detail.space.currencyCode, minorUnitPrecision: 2,
    periods: entry ? [entry].slice(0, limit) : [],
  };
}
function handleCategories(value: ReportSpace, url: URL, now: number): WireCategoriesReport {
  const periodId = url.searchParams.get("periodId") ?? "";
  const period = value.detail.activePeriod;
  if (!period || period.periodId !== periodId) throw new ApiError(404, "period_not_found");
  const live = liveCategories(value);
  const targets = targetsFor(value, period);
  const rows = live.map(category => categoryRow(value, period, category, targets.get(category.categoryId) ?? 0));
  const totals = totalsOf(rows);
  return {
    budgetSpaceId: value.detail.space.budgetSpaceId, periodId, currencyCode: value.detail.space.currencyCode, minorUnitPrecision: 2,
    dataAsOf: new Date(now).toISOString(), scope: "complete", rows, subtotals: totals, totals,
  };
}

/** CBD-35: one path prefix, `budget-spaces/{id}/reports/…`; `undefined` for anything else so the loop falls through. */
export const handleMockReportsRequest: MockRouteModule = async (directory, session, request, path, _body, now) => {
  if (!(path[0] === "budget-spaces" && path.length === 4 && path[2] === "reports" && (path[3] === "periods" || path[3] === "categories"))) return undefined;
  if (request.method !== "GET") return undefined;
  if (!session) throw new ApiError(403, "authorization_denied");
  try {
    const value = reportSpaceOf(directory, session.accountSubjectId, path[1]!);
    const url = new URL(request.url);
    return json(path[3] === "periods" ? handlePeriods(value, url, now()) : handleCategories(value, url, now()));
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code }, error.status);
    return json({ error: "request_failed" }, 503);
  }
};
