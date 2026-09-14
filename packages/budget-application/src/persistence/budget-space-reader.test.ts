import assert from "node:assert/strict";
import { test } from "node:test";
import type { DataAccessClient } from "@cobudget/data-access";
import { FakeClock } from "../creation-proposals/support.ts";
import { readBudgetSpaceDetail } from "./budget-space-reader.ts";

const SPACE = { name: "Household", name_version: 1, time_zone: "America/New_York", currency_code: "USD", lifecycle: "live", lifecycle_version: 1, current_schedule_version_id: "schedule-2", current_period_id: "period-b" };
const SCHEDULE = { schedule_version_id: "schedule-2", sequence: 2, cadence_definition: { cadence: "weekly", anchor: "monday" } };
/** Stored rows as the driver delivers `date` columns: local-midnight Dates for two and text for the others. */
const PERIODS = [
  { period_id: "period-a", schedule_version_id: "schedule-2", status: "planned", period_start_date: new Date(2026, 10, 23), period_end_date: new Date(2026, 10, 29) },
  { period_id: "period-b", schedule_version_id: "schedule-2", status: "active", period_start_date: "2026-11-30", period_end_date: "2026-12-06" },
  { period_id: "period-c", schedule_version_id: "schedule-2", status: "planned", period_start_date: "2026-12-07", period_end_date: "2026-12-13" },
  { period_id: "period-d", schedule_version_id: "schedule-2", status: "planned", period_start_date: "2026-12-14", period_end_date: "2026-12-20" },
];

function client(queries: unknown[], periods = PERIODS, space = SPACE): DataAccessClient {
  return { tenantSelect: async (query: { table: string; budgetSpaceId: string; conditions?: { column: string; value: unknown }[] }) => {
    queries.push(query); assert.equal(query.budgetSpaceId, "space-1");
    if (query.table === "budget_space_membership") return { rows: [{}] };
    if (query.table === "budget_space") return { rows: [space] };
    if (query.table === "budget_space_period") {
      assert.deepEqual(query.conditions, [{ column: "schedule_version_id", value: "schedule-2" }], "periods are read for the current schedule version only");
      return { rows: periods };
    }
    return { rows: [SCHEDULE] };
  } } as unknown as DataAccessClient;
}

void test("ACT-06: the active period is the stored budget_space_period row containing the budget-local date, and only the three following periods are recomputed", async () => {
  const queries: unknown[] = [];
  const detail = await readBudgetSpaceDetail(client(queries), "space-1", "subject-1", "member-1", new FakeClock("2026-12-01T02:00:00.000Z"));
  assert.ok(detail); assert.equal(detail.budgetDate, "2026-11-30");
  assert.equal(detail.scheduleVersion.scheduleVersionId, "schedule-2");
  assert.deepEqual(detail.activePeriod, { periodId: "period-b", scheduleVersionId: "schedule-2", status: "active", ordinal: 0, relation: "current", start: "2026-11-30", end: "2026-12-06", lengthInDays: 7 });
  assert.deepEqual(detail.nextPeriods.map((period) => [period.ordinal, period.relation, period.start, period.end]), [[1, "following", "2026-12-07", "2026-12-13"], [2, "following", "2026-12-14", "2026-12-20"], [3, "following", "2026-12-21", "2026-12-27"]]);
  assert.deepEqual(queries[0], { table: "budget_space_membership", budgetSpaceId: "space-1", conditions: [
    { column: "account_subject_id", value: "subject-1" }, { column: "membership_id", value: "member-1" }, { column: "status", value: "active" }] });
});

void test("ACT-06: a stored row is chosen by the budget-local date even when the space's current_period_id points elsewhere; the driver's local-midnight Date columns are read as calendar dates", async () => {
  const queries: unknown[] = [];
  const detail = await readBudgetSpaceDetail(client(queries), "space-1", "subject-1", "member-1", new FakeClock("2026-11-25T12:00:00.000Z"));
  assert.ok(detail); assert.equal(detail.budgetDate, "2026-11-25");
  assert.equal(detail.activePeriod.periodId, "period-a");
  assert.equal(detail.activePeriod.start, "2026-11-23"); assert.equal(detail.activePeriod.end, "2026-11-29");
  assert.equal(detail.nextPeriods[0]?.start, "2026-11-30");
});

void test("ACT-06: when no stored row contains the budget-local date the current_period_id row is the fallback", async () => {
  const queries: unknown[] = [];
  const detail = await readBudgetSpaceDetail(client(queries), "space-1", "subject-1", "member-1", new FakeClock("2027-03-01T12:00:00.000Z"));
  assert.ok(detail);
  assert.equal(detail.activePeriod.periodId, "period-b");
  assert.equal(detail.activePeriod.start, "2026-11-30");
  assert.equal(detail.nextPeriods.length, 3);
});

void test("ACT-06: a space with no stored period row for its schedule version is reported unavailable, never silently recomputed", async () => {
  await assert.rejects(readBudgetSpaceDetail(client([], []), "space-1", "subject-1", "member-1", new FakeClock("2026-12-01T02:00:00.000Z")), /budget_space_periods_unavailable/);
});

void test("detail read with no matching membership reveals no space or schedule", async () => {
  let queries = 0;
  const client = { tenantSelect: async (query: { table: string }) => {
    queries++; assert.equal(query.table, "budget_space_membership"); return { rows: [] };
  } } as unknown as DataAccessClient;
  assert.equal(await readBudgetSpaceDetail(client, "wrong-space", "other-subject", "member-1", new FakeClock("2026-09-15T12:00:00.000Z")), null);
  assert.equal(queries, 1);
});
