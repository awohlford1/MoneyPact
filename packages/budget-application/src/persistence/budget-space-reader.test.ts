import assert from "node:assert/strict";
import { test } from "node:test";
import type { DataAccessClient } from "@cobudget/data-access";
import { FakeClock } from "../creation-proposals/support.ts";
import { readBudgetSpaceDetail } from "./budget-space-reader.ts";

void test("detail reads use tenant and membership predicates and resolve today's complete period plus three", async () => {
  const queries: unknown[] = [];
  const client = { tenantSelect: async (query: { table: string; budgetSpaceId: string }) => {
    queries.push(query); assert.equal(query.budgetSpaceId, "space-1");
    if (query.table === "budget_space_membership") return { rows: [{}] };
    if (query.table === "budget_space") return { rows: [{ name: "Household", name_version: 1, time_zone: "America/New_York",
      currency_code: "USD", lifecycle: "live", lifecycle_version: 1, current_schedule_version_id: "schedule-2", current_period_id: "obsolete" }] };
    return { rows: [{ schedule_version_id: "schedule-2", sequence: 2, cadence_definition: { cadence: "weekly", anchor: "monday" } }] };
  } } as unknown as DataAccessClient;
  const detail = await readBudgetSpaceDetail(client, "space-1", "subject-1", "member-1", new FakeClock("2026-12-01T02:00:00.000Z"));
  assert.ok(detail); assert.equal(detail.budgetDate, "2026-11-30");
  assert.equal(detail.scheduleVersion.scheduleVersionId, "schedule-2");
  assert.equal(detail.activePeriod.start, "2026-11-30");
  assert.equal(detail.activePeriod.end, "2026-12-06");
  assert.equal(detail.nextPeriods.length, 3);
  assert.equal(detail.nextPeriods[0]?.start, "2026-12-07");
  assert.deepEqual(queries[0], { table: "budget_space_membership", budgetSpaceId: "space-1", conditions: [
    { column: "account_subject_id", value: "subject-1" }, { column: "membership_id", value: "member-1" }, { column: "status", value: "active" }] });
});

void test("detail read with no matching membership reveals no space or schedule", async () => {
  let queries = 0;
  const client = { tenantSelect: async (query: { table: string }) => {
    queries++; assert.equal(query.table, "budget_space_membership"); return { rows: [] };
  } } as unknown as DataAccessClient;
  assert.equal(await readBudgetSpaceDetail(client, "wrong-space", "other-subject", "member-1", new FakeClock("2026-09-15T12:00:00.000Z")), null);
  assert.equal(queries, 1);
});
