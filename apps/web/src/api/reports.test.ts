/**
 * UI-P04 (CBD-358, contract CBD-355) unit tests: the two wire shapes round-trip through the presentation
 * helpers byte for byte against `formatMinorUnits`, the view module contains no arithmetic on a minor-unit
 * value (CBD-358-AC01), and the mock's own figures reconcile against the existing progress engine's own answer
 * for the same category and period -- proving the report introduces no new arithmetic rule, only a second
 * projection of the same numbers `mock-server.ts` already computes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatMinorUnits } from "./client.ts";
import { ApiError } from "./client.ts";
import { createMockClient, handleMockRequest } from "./mock-server.ts";
import type { MockWire } from "./mock-server.ts";
import { createReportsClient, planLabel, remainingLabel, settledLabel, toCategoryRow, toCategoryTotalsRow, toPeriodRow } from "./reports.ts";
import type { WireCategoriesReport, WireCategoryReportRow, WirePeriodReport, WirePeriodsReport } from "./reports.ts";

// --- CBD-358-AC01: the view module applies no arithmetic operator to a minor-unit value ------------------------

test("CBD-358-AC01: the reports view module contains no MinorUnits field and no arithmetic operator applied to one", () => {
  const path = fileURLToPath(new URL("../app/(app)/budgets/[id]/reports/reports-view.tsx", import.meta.url));
  const source = readFileSync(path, "utf8");
  // Every figure the view renders arrives as a pre-formatted string from reports.ts (PeriodRow/CategoryRow);
  // the view never even names a *MinorUnits field, which is the strongest form of "applies no arithmetic to
  // one" -- there is nothing of that shape to operate on.
  assert.equal(/MinorUnits/u.test(source), false, "the view module must never reference a raw minor-unit field");
  // Belt and braces: no arithmetic operator appears anywhere next to an identifier that merely mentions "amount"
  // in code (not prose), in case a future edit reintroduces a numeric field under a different name. Comment
  // lines are excluded -- this file's own JSDoc prose about money is not code applying arithmetic to it.
  const codeLines = source.split("\n").filter(line => !/^\s*(?:\/\/|\*|\/\*\*)/u.test(line));
  for (const line of codeLines) {
    if (!/\bamount\b/iu.test(line)) continue;
    assert.doesNotMatch(line, /[+\-*/]\s*[A-Za-z_][\w.]*amount|amount[A-Za-z_]*\s*[+\-*/]/iu, `possible arithmetic near a money-shaped identifier: ${line}`);
  }
});

// --- Presentation: every figure formatted once, matching `formatMinorUnits` byte for byte ----------------------

test("CBD-358-AC01: period and category rows format every figure from the wire's own field, byte for byte", () => {
  const wirePeriod: WirePeriodReport = {
    periodId: "p1", start: "2026-09-01", end: "2026-09-30", lengthInDays: 30, relation: "current",
    plannedMinorUnits: 50000, settledMinorUnits: -12345, pendingMinorUnits: 0, incomeMinorUnits: 0,
    varianceMinorUnits: 37655, remainingAfterPendingMinorUnits: 37655, adjustedAfterEnd: false, dataAsOf: "2026-09-15T12:00:00.000Z",
  };
  const row = toPeriodRow(wirePeriod, "USD", 2);
  assert.equal(row.planned, `${formatMinorUnits(50000, 2)} USD`);
  assert.equal(row.settled, `${formatMinorUnits(12345, 2)} USD spent`);
  assert.equal(row.income, `${formatMinorUnits(0, 2)} USD`);
  assert.equal(row.remainingAfterPending, `${formatMinorUnits(37655, 2)} USD remaining`);
  assert.equal(row.dataAsOf, wirePeriod.dataAsOf);

  const overspent: WireCategoryReportRow = { categoryId: "c1", label: "Groceries", plannedMinorUnits: 10000, settledMinorUnits: -12000, pendingMinorUnits: 0, varianceMinorUnits: -2000, remainingAfterSettledMinorUnits: -2000, remainingAfterPendingMinorUnits: -2000 };
  const overspentRow = toCategoryRow(overspent, "USD", 2);
  assert.equal(overspentRow.planned, `${formatMinorUnits(10000, 2)} USD`);
  assert.equal(overspentRow.settled, `${formatMinorUnits(12000, 2)} USD spent`);
  assert.equal(overspentRow.remainingAfterSettled, `over by ${formatMinorUnits(2000, 2)} USD`);
  assert.equal(overspentRow.remainingAfterPending, `over by ${formatMinorUnits(2000, 2)} USD`);

  const noActivity: WireCategoryReportRow = { categoryId: "c2", label: "Entertainment", plannedMinorUnits: 5000, settledMinorUnits: 0, pendingMinorUnits: 0, varianceMinorUnits: 5000, remainingAfterSettledMinorUnits: 5000, remainingAfterPendingMinorUnits: 5000 };
  assert.equal(toCategoryRow(noActivity, "USD", 2).settled, "no activity");

  assert.equal(planLabel(0, 2, "USD"), "0.00 USD");
  assert.equal(settledLabel(150, 2, "USD"), "1.50 USD refunded");
  assert.equal(remainingLabel(-1, 2, "USD"), "over by 0.01 USD");

  const totals = toCategoryTotalsRow({ plannedMinorUnits: 15000, settledMinorUnits: -12000, pendingMinorUnits: 0, varianceMinorUnits: 3000, remainingAfterSettledMinorUnits: 3000, remainingAfterPendingMinorUnits: 3000 }, "USD", 2);
  assert.equal(totals.remainingAfterSettled, `${formatMinorUnits(3000, 2)} USD remaining`);
});

// --- Over the mock: the report reconciles against the existing progress engine's own answer ---------------------

function csrfFetcher(mock: MockWire, origin = "http://localhost"): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(input), origin);
    const headers = new Headers(init?.headers);
    headers.set("origin", origin); headers.set("sec-fetch-site", "same-origin");
    const request = new Request(target, { method: init?.method ?? "GET", headers, ...(init?.body === undefined ? {} : { body: init.body }) });
    return handleMockRequest(mock, request, target.pathname.replace(/^\/v1\//, "").split("/"));
  }) as typeof fetch;
}

async function setUpBudget(clock: () => number) {
  const client = createMockClient(clock);
  await client.me(); // bootstraps the CSRF value the mutations below need, as client-idempotency.test.ts does.
  const proposal = await client.createProposal(
    { name: "Household", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } },
    "proposal-key-0000000001",
  );
  const confirmed = await client.confirmProposal(proposal.proposalId, proposal.confirmationBinding, "confirm-key-0000000001", { kind: "primary_owner_self", version: 1 });
  const budgetSpaceId = confirmed.budgetSpaceId;
  const category = await client.addCategory(budgetSpaceId, "Groceries");
  await client.saveTarget(budgetSpaceId, category.id, "100.00", 2);
  const account = await client.addAccount(budgetSpaceId, { label: "Checking", accountType: "checking", currencyCode: "USD", openingBalance: "0.00" });
  const budget = await client.budget(budgetSpaceId);
  const periodId = budget.activePeriod!.id;
  await client.recordExpense(budgetSpaceId, { accountId: account.id, amount: "42.50", budgetDate: budget.updatedAt, description: "Groceries run", allocations: [{ categoryId: category.id, amount: "42.50" }] }, 2, "expense-key-0000000001");
  return { client, mock: client.mock, budgetSpaceId, periodId, categoryId: category.id };
}

test("CBD-358: reports/periods and reports/categories reconcile against the progress engine's own cells for the same period", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId, periodId, categoryId } = await setUpBudget(clock);
  const reports = createReportsClient("/v1", csrfFetcher(mock));

  // The raw wire progress the mock's own progress engine answers -- numeric fields, not the client's
  // already-formatted `Progress` -- is the baseline the report must reconcile against.
  const progress = mock.progress(budgetSpaceId, periodId);
  const cell = progress.cells.find(entry => entry.categoryId === categoryId)!;

  const periodsReport: WirePeriodsReport = await reports.periods(budgetSpaceId, 12);
  assert.equal(periodsReport.periods.length, 1, "the mock has no periodId for an unreached future period, so it reports only the current one");
  const [periodEntry] = periodsReport.periods;
  assert.equal(periodEntry!.periodId, periodId);
  assert.equal(periodEntry!.relation, "current");
  assert.equal(periodEntry!.pendingMinorUnits, 0);
  assert.equal(periodEntry!.incomeMinorUnits, 0, "no expected-income model exists in this mock yet (CBD-182 deferred)");
  assert.equal(periodEntry!.settledMinorUnits, cell.settledActualMinorUnits, "the period aggregate is the same settled figure the progress engine already computed, summed across categories");

  const categoriesReport: WireCategoriesReport = await reports.categories(budgetSpaceId, periodId);
  assert.equal(categoriesReport.scope, "complete");
  const row = categoriesReport.rows.find(entry => entry.categoryId === categoryId)!;
  assert.equal(row.plannedMinorUnits, cell.targetMinorUnits, "the category row's planned figure is exactly the progress engine's own target");
  assert.equal(row.settledMinorUnits, cell.settledActualMinorUnits, "CBD-358-AC01: the category row's settled figure is exactly the progress engine's own settledActualMinorUnits");
  assert.equal(row.remainingAfterSettledMinorUnits, cell.remainingAfterSettledMinorUnits);
  assert.equal(row.pendingMinorUnits, 0);
  assert.equal(row.remainingAfterPendingMinorUnits, cell.remainingAfterPendingMinorUnits);
  assert.equal(categoriesReport.totals.settledMinorUnits, cell.settledActualMinorUnits, "one category: the total is that category's own figure");
});

test("CBD-358: an unrecognised period id is refused 404, and a subject with no membership is refused 403", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId } = await setUpBudget(clock);
  const reports = createReportsClient("/v1", csrfFetcher(mock));
  await assert.rejects(() => reports.categories(budgetSpaceId, "not-a-real-period"), (error: unknown) => error instanceof ApiError && error.status === 404);

  const outsider = createMockClient(clock);
  const outsiderReports = createReportsClient("/v1", csrfFetcher(outsider.mock));
  await assert.rejects(() => outsiderReports.periods(budgetSpaceId, 12), (error: unknown) => error instanceof ApiError && error.status === 403);
});
