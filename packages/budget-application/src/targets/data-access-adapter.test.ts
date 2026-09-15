import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseTargetFromRow, baseTargetToRow, categoryFromRow, categoryToRow, dataAccessTargetsRepository, periodTargetFromRow, periodTargetToRow, planContextFromRow, translateStatementFailure } from "./data-access-adapter.ts";
import type { BudgetCategoryBaseTargetRow, BudgetCategoryPeriodTargetRow, BudgetCategoryRow, PlanContextRow, TargetsStatements } from "./ports.ts";
import { TARGET_FORMULA_VERSION, TargetsError } from "./records.ts";
import type { BaseTargetRecord, CategoryRecord, PeriodTargetRecord } from "./records.ts";
import { PERIOD_A_OPEN, SCHEDULE_A, SPACE_A, SUBJECT_1 } from "./support.ts";

const CATEGORY = "aaaaaaaa-0000-4000-8000-000000000001";
const category: CategoryRecord = { categoryId: CATEGORY, budgetSpaceId: SPACE_A, label: "Groceries", position: 3, archivedAt: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", version: 1 };
const baseTarget: BaseTargetRecord = { baseTargetId: "bbbbbbbb-0000-4000-8000-000000000001", budgetSpaceId: SPACE_A, categoryId: CATEGORY, cadence: "monthly", currencyCode: "USD", minorUnitPrecision: 2, amountMinorUnits: 40000, setBySubjectId: SUBJECT_1, source: "user", createdAt: "2026-09-01T00:00:00.000Z", supersededAt: null };
const periodTarget: PeriodTargetRecord = {
  periodTargetId: "cccccccc-0000-4000-8000-000000000001", budgetSpaceId: SPACE_A, categoryId: CATEGORY, periodId: PERIOD_A_OPEN, periodStart: "2026-09-17", periodEnd: "2026-09-30",
  origin: "prorated-transition", currencyCode: "USD", minorUnitPrecision: 2, amountMinorUnits: 18667, formulaVersion: TARGET_FORMULA_VERSION,
  inputs: { baseTargetId: baseTarget.baseTargetId, baseAmountMinorUnits: 40000, cadence: "monthly", scheduleVersionId: SCHEDULE_A, period: { start: "2026-09-17", end: "2026-09-30" }, basis: { start: "2026-09-01", end: "2026-09-30" } },
  calculation: { baseAmountMinorUnits: 40000, transitionDays: 14, basisDays: 30, remainderUnitAwarded: true }, computedBySubjectId: SUBJECT_1, source: "user", computedAt: "2026-09-17T00:00:00.000Z",
  supersededAt: null,
};

describe("data-access adapter mapping (CBD-153-AC01)", () => {
  it("round-trips every field of the three records through the table row shapes", () => {
    assert.deepEqual(categoryFromRow(categoryToRow(category)), category);
    assert.deepEqual(baseTargetFromRow(baseTargetToRow(baseTarget)), baseTarget);
    assert.deepEqual(periodTargetFromRow(periodTargetToRow(periodTarget)), periodTarget);
    const full: PeriodTargetRecord = { ...periodTarget, origin: "full-period", calculation: null, inputs: { ...periodTarget.inputs, basis: null } };
    assert.deepEqual(periodTargetFromRow(periodTargetToRow(full)), full);
    // jsonb comes back parsed; a JSON round trip of the row must not change the record either.
    assert.deepEqual(periodTargetFromRow(JSON.parse(JSON.stringify(periodTargetToRow(periodTarget)))), periodTarget);
  });
  it("refuses rows outside the domain's closed vocabularies or with a mismatched origin/calculation pair", () => {
    const code = (expected: string) => (error: unknown) => error instanceof TargetsError && error.code === expected;
    assert.throws(() => baseTargetFromRow({ ...baseTargetToRow(baseTarget), cadence: "fortnightly" }), code("cadence_unsupported"));
    assert.throws(() => baseTargetFromRow({ ...baseTargetToRow(baseTarget), source: "import" }), code("constraint_violation"));
    assert.throws(() => periodTargetFromRow({ ...periodTargetToRow(periodTarget), origin: "guess" }), code("constraint_violation"));
    assert.throws(() => periodTargetFromRow({ ...periodTargetToRow(periodTarget), calculation: null }), code("constraint_violation"));
    assert.throws(() => periodTargetFromRow({ ...periodTargetToRow(periodTarget), inputs: { period: "no" } }), code("constraint_violation"));
  });
  it("parses the plan context's cadence through budget-domain's parser", () => {
    const row: PlanContextRow = { budget_space_id: SPACE_A, currency_code: "USD", time_zone: "America/New_York", current_period_id: PERIOD_A_OPEN, period_id: PERIOD_A_OPEN, schedule_version_id: SCHEDULE_A, period_status: "active", period_start_date: "2026-09-01", period_end_date: "2026-09-30", cadence_definition: { cadence: "weekly", anchor: "monday" } };
    assert.equal(planContextFromRow(row).cadence, "weekly");
    assert.throws(() => planContextFromRow({ ...row, cadence_definition: { cadence: "weekly", anchor: "someday" } }), (e: unknown) => e instanceof TargetsError && e.code === "cadence_unsupported");
  });
  it("maps SQLSTATEs to canonical errors and rethrows anything else", () => {
    const failure = (sqlState: string) => Object.assign(new Error("statement failed"), { sqlState });
    assert.throws(() => translateStatementFailure(failure("55000")), (e: unknown) => e instanceof TargetsError && e.code === "completed_period_immutable");
    assert.throws(() => translateStatementFailure(failure("23514")), (e: unknown) => e instanceof TargetsError && e.code === "constraint_violation");
    assert.throws(() => translateStatementFailure(failure("23505")), (e: unknown) => e instanceof TargetsError && e.code === "conflict");
    assert.throws(() => translateStatementFailure(new RangeError("other")), RangeError);
  });
  it("composes the repository over the statement set, replacing a period's rows and superseding by identity", async () => {
    const categories: BudgetCategoryRow[] = []; const bases: BudgetCategoryBaseTargetRow[] = []; const periods: BudgetCategoryPeriodTargetRow[] = [];
    const statements: TargetsStatements = {
      listCategories: async (space) => categories.filter((r) => r.budget_space_id === space),
      insertCategory: async (row) => { categories.push(row); },
      updateCategory: async (space, id, set) => { const i = categories.findIndex((r) => r.budget_space_id === space && r.category_id === id); if (i < 0) return 0; categories[i] = { ...categories[i]!, ...set }; return 1; },
      listBaseTargets: async (space, cadence) => bases.filter((r) => r.budget_space_id === space && r.cadence === cadence),
      insertBaseTarget: async (row) => { bases.push({ ...row, superseded_at: null }); },
      supersedeBaseTarget: async (space, id, at) => { const i = bases.findIndex((r) => r.budget_space_id === space && r.base_target_id === id); if (i < 0) return 0; bases[i] = { ...bases[i]!, superseded_at: at }; return 1; },
      listPeriodTargets: async (space, period) => periods.filter((r) => r.budget_space_id === space && r.period_id === period),
      insertPeriodTarget: async (row) => { periods.push({ ...row, superseded_at: null }); },
      supersedePeriodTarget: async (space, id, at) => { const i = periods.findIndex((r) => r.budget_space_id === space && r.period_target_id === id); if (i < 0) return 0; periods[i] = { ...periods[i]!, superseded_at: at }; return 1; },
      readPlanContext: async () => null,
    };
    const repository = dataAccessTargetsRepository(statements);
    await repository.insertCategory(category);
    // PROTO-HARDENING-001 (F-INCB-03): version crosses the port in both directions.
    assert.equal(await repository.updateCategory({ ...category, label: "Food", version: 2 }), true);
    assert.equal(await repository.updateCategory({ ...category, budgetSpaceId: "other", version: 2 }), false);
    assert.deepEqual(await repository.listCategories(SPACE_A), [{ ...category, label: "Food", version: 2 }]);
    await repository.insertBaseTarget(baseTarget);
    assert.equal(await repository.supersedeBaseTarget(SPACE_A, baseTarget.baseTargetId, "2026-09-03T00:00:00.000Z"), true);
    assert.deepEqual(await repository.listBaseTargets(SPACE_A, "monthly"), [{ ...baseTarget, supersededAt: "2026-09-03T00:00:00.000Z" }]);
    await repository.supersedePeriodTargets(SPACE_A, PERIOD_A_OPEN, "2026-09-17T00:00:00.000Z", [periodTarget]);
    await repository.supersedePeriodTargets(SPACE_A, PERIOD_A_OPEN, "2026-09-18T00:00:00.000Z", [{ ...periodTarget, periodTargetId: "cccccccc-0000-4000-8000-000000000002" }]);
    assert.deepEqual((await repository.listPeriodTargets(SPACE_A, PERIOD_A_OPEN)).map((t) => [t.periodTargetId, t.supersededAt]),
      [["cccccccc-0000-4000-8000-000000000001", "2026-09-18T00:00:00.000Z"], ["cccccccc-0000-4000-8000-000000000002", null]], "the prior version is retained and stamped, never removed");
    await assert.rejects(repository.supersedePeriodTargets(SPACE_A, PERIOD_A_OPEN, "2026-09-19T00:00:00.000Z", [{ ...periodTarget, budgetSpaceId: "other" }]), (e: unknown) => e instanceof TargetsError && e.code === "invalid_request");
    assert.equal(periods.filter((r) => r.superseded_at === null).length, 1, "a refused set leaves the current version current");
    assert.equal(await repository.readPlanContext(SPACE_A, null), null);
  });
});
