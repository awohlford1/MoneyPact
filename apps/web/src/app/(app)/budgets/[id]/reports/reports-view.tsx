"use client";
/**
 * Category and period reports (CBD-358, contract CBD-355; UI-BUILD-PLAN.md section 4.4).
 *
 * Every figure this view renders is a pre-formatted string built once, in `../../../../../api/reports`, from the
 * API's own field (sign spelled as a word -- section 1.4). This module holds no raw minor-unit numeric field and
 * applies no arithmetic operator to one; `reports.test.ts`'s CBD-358-AC01 test greps this file to prove it. Two
 * independent reads -- the period list and the selected period's category rows -- so a failure in one leaves
 * the other's content and focus alone (CBD-358-AC05's partial-failure requirement). Data requests, filter state
 * and status announcements require client state.
 */
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "../../../../../api/client";
import { createReportsClient, toCategoryRow, toCategoryTotalsRow, toPeriodRow } from "../../../../../api/reports";
import type { CategoryRow, CategoryTotalsRow, PeriodRow } from "../../../../../api/reports";
import { apiBase } from "@/api/runtime-mode";
import { useSession } from "../../../../../session/SessionProvider";
import { Alert } from "../../../../../components/Alert";
import { Button } from "../../../../../components/Button";
import { Select } from "../../../../../components/Select";
import { Table } from "../../../../../components/Table";
import type { Column } from "../../../../../components/Table";
// CBD-35: the polite live region, the uniform denial and the failure classifier are shared shapes.
import { DeniedState, StatusRegion, classifyFailure, useResource } from "../../../../../ui/resource";

const PERIODS_LIMIT = 12;
const LARGE_ROW_THRESHOLD = 20;
/** A report is shown as stale once its own `dataAsOf` is this far behind the moment it is read. Not a money
 * figure: comparing two instants is date arithmetic, which CBD-358-AC01 does not reach. */
const STALE_AFTER_MS = 5 * 60 * 1000;

function useReportsClient() {
  return useMemo(() => createReportsClient(apiBase), []);
}

function isStale(dataAsOf: string | undefined): boolean {
  if (!dataAsOf) return false;
  const parsed = Date.parse(dataAsOf);
  return Number.isFinite(parsed) && Date.now() - parsed > STALE_AFTER_MS;
}

/** Renders `dataAsOf` in text, per section 6.2's rule that data-as-of is a labelled value, not an implication. */
function FreshnessNotice({ dataAsOf }: { dataAsOf: string }) {
  return <p className="text-on-surface-muted">Data as of {dataAsOf}.</p>;
}

/** CBD-72 row 18: "Shared view -- not the full budget" is reserved for Viewer scope and is never emitted here.
 * This mock never returns `"limited"` (category-level scope narrowing is CBD-357, out of this packet's scope),
 * but the view renders it if it ever arrives, so the capability is not silently absent from the interface. */
function ScopeNotice({ scope }: { scope: "complete" | "limited" }) {
  if (scope !== "limited") return null;
  return <Alert>Some categories are not shown at your current access.</Alert>;
}

function PeriodFilter({ periods, selectedPeriodId, onChange }: { periods: readonly PeriodRow[]; selectedPeriodId: string; onChange(periodId: string): void }) {
  const active = periods.find(period => period.periodId === selectedPeriodId);
  return <div className="space-y-1">
    <Select id="report-period" label="Period" value={selectedPeriodId} onChange={event => onChange(event.target.value)}>
      {periods.map(period => <option key={period.periodId} value={period.periodId}>{period.start} to {period.end} ({period.relation})</option>)}
    </Select>
    <p className="text-on-surface-muted">{active ? `Showing the ${active.relation} period, ${active.start} through ${active.end}.` : "No period selected."}</p>
  </div>;
}

function CategoryFilter({ rows, value, onChange }: { rows: readonly CategoryRow[]; value: string; onChange(categoryId: string): void }) {
  return <div className="space-y-1">
    <Select id="report-category" label="Category" value={value} onChange={event => onChange(event.target.value)}>
      <option value="all">All categories</option>
      {rows.map(row => <option key={row.categoryId} value={row.categoryId}>{row.label}</option>)}
    </Select>
    <p className="text-on-surface-muted">{value === "all" ? `Showing all ${rows.length} categor${rows.length === 1 ? "y" : "ies"}.` : `Showing one category.`}</p>
  </div>;
}

const CATEGORY_COLUMNS: readonly Column[] = [
  { key: "label", label: "Category" },
  { key: "planned", label: "Planned", numeric: true },
  { key: "settled", label: "Settled", numeric: true },
  // REV-UIP04-3: pending was previously implied only through "remaining after pending"; AC03 names it as its
  // own labelled state, so it gets its own column, reading "no pending activity" today (always zero for a
  // manual transaction) exactly as correctly as "no activity" reads for settled.
  { key: "pending", label: "Pending", numeric: true },
  { key: "remainingAfterSettled", label: "Remaining after settled", numeric: true },
  { key: "remainingAfterPending", label: "Remaining after pending", numeric: true },
];

/** The category breakdown for one period. Large result sets scroll within their own region (never the page in
 * two dimensions -- section 6.1.2); the totals row is marked "Total" in text, not by colour or position alone. */
function ReportTable({ caption, rows, totals, loading, error }: { caption: string; rows: readonly CategoryRow[]; totals: CategoryTotalsRow | null; loading: boolean; error?: string }) {
  const tableRows: Record<string, ReactNode>[] = rows.map(row => ({ label: row.label, planned: row.planned, settled: row.settled, pending: row.pending, remainingAfterSettled: row.remainingAfterSettled, remainingAfterPending: row.remainingAfterPending }));
  if (totals && rows.length > 0) tableRows.push({ label: <strong>Total, all categories</strong>, planned: totals.planned, settled: totals.settled, pending: totals.pending, remainingAfterSettled: totals.remainingAfterSettled, remainingAfterPending: totals.remainingAfterPending });
  const large = rows.length > LARGE_ROW_THRESHOLD;
  const table = <Table caption={caption} columns={CATEGORY_COLUMNS} rows={tableRows} loading={loading} error={error} emptyMessage="No categories yet. Add a category from the plan to see it here." />;
  return large ? <div className="max-h-[32rem] overflow-y-auto" data-testid="reports-category-scroll-region">
    <p className="text-on-surface-muted">Showing {rows.length} categories. Scroll within this table to see more.</p>
    {table}
  </div> : table;
}

function PeriodsSection({ result, rows, selectedPeriodId, onSelectPeriod }: {
  result: ReturnType<typeof useResource<{ currencyCode: string; minorUnitPrecision: number; periods: readonly unknown[] }>>;
  rows: readonly PeriodRow[]; selectedPeriodId: string; onSelectPeriod(periodId: string): void;
}) {
  const loading = !result.value && !result.error;
  return <section className="space-y-4" aria-labelledby="reports-periods-heading">
    <h2 id="reports-periods-heading" className="text-2xl font-semibold">Periods</h2>
    {result.error ? <RegionFailure error={result.error} retry={result.refresh} label="periods" />
      : loading ? <Alert loading>Loading periods…</Alert>
      : rows.length === 0 ? <Alert>No periods to report on yet.</Alert>
      : <>
        <PeriodFilter periods={rows} selectedPeriodId={selectedPeriodId} onChange={onSelectPeriod} />
        <Table caption="Periods for this budget" columns={[
          { key: "range", label: "Period" }, { key: "planned", label: "Planned", numeric: true },
          { key: "settled", label: "Settled", numeric: true },
          // REV-UIP04-3: pending, its own labelled column, not just implied through remaining-after-pending.
          { key: "pending", label: "Pending", numeric: true },
          { key: "income", label: "Income", numeric: true },
          { key: "remainingAfterPending", label: "Remaining after pending", numeric: true },
          // REV-UIP04-2: adjustedAfterEnd is on the wire and named by AC03 as a required labelled state; a
          // word on the row, not a colour or an omission, for every period -- "Not adjusted" is itself a fact.
          { key: "adjustment", label: "Adjustment" },
        ]} rows={rows.map(row => ({
          range: `${row.start} to ${row.end} (${row.relation})`, planned: row.planned, settled: row.settled,
          pending: row.pending, income: row.income, remainingAfterPending: row.remainingAfterPending,
          adjustment: row.adjustedAfterEnd ? "Adjusted after period end" : "Not adjusted",
        }))} />
      </>}
  </section>;
}

function CategoriesSection({ result, rows, allRows, totals, scope, dataAsOf, periodLabel, categoryFilter, onCategoryFilterChange, periodsLoading, periodsEmpty }: {
  result: ReturnType<typeof useResource<unknown>>;
  rows: readonly CategoryRow[]; allRows: readonly CategoryRow[]; totals: CategoryTotalsRow | null;
  scope?: "complete" | "limited"; dataAsOf?: string; periodLabel?: PeriodRow;
  categoryFilter: string; onCategoryFilterChange(categoryId: string): void;
  /** REV-UIP04-1: whether the *periods* region has resolved yet, and whether it resolved to nothing. Neither is
   * this region's own failure -- a categories read is never even attempted until a period id exists, so this
   * region must not show its own terminal error while it is only waiting on its sibling. */
  periodsLoading: boolean; periodsEmpty: boolean;
}) {
  const caption = periodLabel ? `Categories for the period ${periodLabel.start} to ${periodLabel.end}` : "Categories for this period";
  const waitingForPeriod = periodsLoading || !periodLabel;
  const loading = !result.value && !result.error;
  let body: ReactNode;
  if (periodsEmpty) {
    // True-empty (CBD-67 §14.6), not a 404-derived terminal error: there is genuinely no active period to
    // report categories against, which is a fact about the budget, not a failed read.
    body = <Alert>This budget has no active period, so there are no categories to report on yet.</Alert>;
  } else if (waitingForPeriod) {
    body = <ReportTable caption={caption} rows={[]} totals={null} loading />;
  } else if (result.error) {
    body = <RegionFailure error={result.error} retry={result.refresh} label="categories" />;
  } else if (loading) {
    body = <ReportTable caption={caption} rows={[]} totals={null} loading />;
  } else {
    body = <>
      {scope && <ScopeNotice scope={scope} />}
      {dataAsOf && isStale(dataAsOf) && <Alert title="Report captured earlier">This report reflects data captured earlier and may not include the most recent activity.</Alert>}
      {allRows.length > 0 && <CategoryFilter rows={allRows} value={categoryFilter} onChange={onCategoryFilterChange} />}
      <ReportTable caption={caption} rows={rows} totals={totals} loading={false} />
      {dataAsOf && <FreshnessNotice dataAsOf={dataAsOf} />}
    </>;
  }
  return <section className="space-y-4" aria-labelledby="reports-categories-heading">
    <h2 id="reports-categories-heading" className="text-2xl font-semibold">Categories</h2>
    {body}
  </section>;
}

function RegionFailure({ error, retry, label }: { error: unknown; retry(): void; label: string }) {
  const kind = classifyFailure(error);
  if (kind === "denied") return <DeniedState><p>Your current session cannot see {label} for this budget.</p></DeniedState>;
  return <Alert tone="danger" title={`Unable to load ${label}`}>
    <p>{kind === "terminal" ? `This budget's ${label} cannot be opened from here.` : `We could not load ${label}. You can try again.`}</p>
    {kind !== "terminal" && <Button variant="secondary" onClick={retry}>Try again</Button>}
  </Alert>;
}

export function ReportsView({ id }: { id: string }) {
  const { session } = useSession();
  const api = useReportsClient();

  const loadPeriods = useCallback((signal: AbortSignal) => api.periods(id, PERIODS_LIMIT, signal), [api, id]);
  const periods = useResource(`${session.sessionRef}:${session.sessionVersion}:${id}:periods`, loadPeriods);

  const periodsLoading = !periods.value && !periods.error;
  const periodsEmpty = Boolean(periods.value && periods.value.periods.length === 0);

  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  // The last period id actually seen, kept across a periods refresh's own momentary loading gap (`periods.value`
  // is briefly undefined then) so a "Refresh reports" click does not bounce the categories read's identity to
  // empty and back -- which would cost a spurious extra read against the CBD-266 read budget and could race a
  // recoverable retry's own refetch (section 6.3.5's frugal-reads rule).
  const [knownPeriodId, setKnownPeriodId] = useState("");
  const freshPeriodId = periods.value?.periods[0]?.periodId;
  if (freshPeriodId && freshPeriodId !== knownPeriodId) setKnownPeriodId(freshPeriodId);
  const periodRowsForValidation = periods.value?.periods ?? [];
  // REV-UIP04-9: a selection that no longer names a period in the current list (a stale selection from before a
  // refresh changed what is available) falls back to the last known-good period rather than pointing at nothing.
  const selectedPeriodValid = selectedPeriodId !== "" && periodRowsForValidation.some(period => period.periodId === selectedPeriodId);
  const activePeriodId = selectedPeriodValid ? selectedPeriodId : knownPeriodId;

  // REV-UIP04-1: the categories read is never attempted until a real period id exists. Before that, `identity`
  // stays constant (no network call fires: `enabled` short-circuits before the fetcher runs), so this region
  // shows its own loading/true-empty state instead of a 404-derived terminal failure while it only waits on
  // its sibling region to resolve.
  const categoriesEnabled = activePeriodId !== "";
  const loadCategories = useCallback((signal: AbortSignal) => {
    if (!categoriesEnabled) return new Promise<never>(() => { /* never resolves; discarded by the next identity change or unmount */ });
    return api.categories(id, activePeriodId, signal);
  }, [api, id, activePeriodId, categoriesEnabled]);
  const categories = useResource(`${session.sessionRef}:${session.sessionVersion}:${id}:categories:${activePeriodId}`, loadCategories);

  const [categoryFilter, setCategoryFilter] = useState("all");
  // REV-UIP04-8: a period switch can leave the filter pointing at a category the new period does not have (or
  // does not plan the same way); reset to "All categories" whenever the person picks a different period. Reset
  // during render (the same "adjusting state when a prop changes" pattern `knownPeriodId` above already uses),
  // not in an effect, so the reset commits in the same pass as the period change rather than one render later.
  const [categoryFilterFor, setCategoryFilterFor] = useState(selectedPeriodId);
  if (selectedPeriodId !== categoryFilterFor) { setCategoryFilterFor(selectedPeriodId); setCategoryFilter("all"); }

  const currencyCode = periods.value?.currencyCode ?? categories.value?.currencyCode ?? "USD";
  const precision = periods.value?.minorUnitPrecision ?? categories.value?.minorUnitPrecision ?? 2;

  const periodRows = useMemo(() => periods.value ? periods.value.periods.map(period => toPeriodRow(period, currencyCode, precision)) : [], [periods.value, currencyCode, precision]);
  const categoryRows = useMemo(() => categories.value ? categories.value.rows.map(row => toCategoryRow(row, currencyCode, precision)) : [], [categories.value, currencyCode, precision]);
  const totalsRow = useMemo(() => categories.value ? toCategoryTotalsRow(categories.value.totals, currencyCode, precision) : null, [categories.value, currencyCode, precision]);
  const visibleCategoryRows = categoryFilter === "all" ? categoryRows : categoryRows.filter(row => row.categoryId === categoryFilter);
  const visibleTotals = categoryFilter === "all" ? totalsRow : null;

  const denied = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403);
  if (denied(periods.error) || denied(categories.error)) {
    return <section className="space-y-6"><h1 className="font-display text-3xl font-semibold">Reports</h1>
      <DeniedState><p>Your current session cannot open reports for this budget.</p></DeniedState>
    </section>;
  }

  return <section className="space-y-6" aria-labelledby="reports-heading">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 id="reports-heading" className="font-display text-3xl font-semibold">Reports</h1>
      <Button variant="secondary" onClick={() => { periods.refresh(); categories.refresh(); }}>Refresh reports</Button>
    </div>
    <StatusRegion id="reports" message={periods.refreshed || categories.refreshed ? "Reports refreshed." : ""} />
    <PeriodsSection result={periods} rows={periodRows} selectedPeriodId={activePeriodId} onSelectPeriod={setSelectedPeriodId} />
    <CategoriesSection
      result={categories} rows={visibleCategoryRows} allRows={categoryRows} totals={visibleTotals}
      scope={categories.value?.scope} dataAsOf={categories.value?.dataAsOf}
      periodLabel={periodRows.find(row => row.periodId === activePeriodId)}
      categoryFilter={categoryFilter} onCategoryFilterChange={setCategoryFilter}
      periodsLoading={periodsLoading} periodsEmpty={periodsEmpty}
    />
  </section>;
}
