import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fullPeriodTargets } from "@cobudget/budget-domain/targets";
import { toISODate } from "@cobudget/budget-domain/shared";
import { parseBaseTargetRequest, parseCategoryUpsertRequest, readPlan, setBaseTargets, upsertCategories, listCategories, budgetSpaceDate, computePeriodTargets } from "./application.ts";
import { TARGET_FORMULA_VERSION, TargetsError, resolveMinorUnitPrecision, iso4217PrecisionReader } from "./records.ts";
import { FIXED_NOW, PERIOD_A_DONE, PERIOD_A_OPEN, SPACE_A, SPACE_B, SUBJECT_1, testWorld } from "./support.ts";

const code = (expected: string) => (error: unknown) => error instanceof TargetsError && error.code === expected;

async function seedCategories(world = testWorld()) {
  const categories = await upsertCategories(world.deps, SPACE_A, parseCategoryUpsertRequest({ categories: [{ label: "Groceries" }, { label: "Rent" }, { label: "Fun" }] }));
  return { world, categories };
}

describe("categories (CBD-153-AC03)", () => {
  it("creates with stable identities and positions in order, then relabels and reorders without changing identity", async () => {
    const { world, categories } = await seedCategories();
    assert.deepEqual(categories.map((c) => [c.label, c.position]), [["Groceries", 0], ["Rent", 1], ["Fun", 2]]);
    const [groceries, rent] = categories;
    const updated = await upsertCategories(world.deps, SPACE_A, parseCategoryUpsertRequest({ categories: [
      { categoryId: groceries!.categoryId, label: "Food", position: 5 }, { categoryId: rent!.categoryId, label: "Housing", position: 0 } ] }));
    assert.deepEqual(updated.map((c) => [c.categoryId, c.label, c.position]), [[rent!.categoryId, "Housing", 0], [categories[2]!.categoryId, "Fun", 2], [groceries!.categoryId, "Food", 5]]);
    assert.equal(updated.find((c) => c.categoryId === groceries!.categoryId)?.createdAt, groceries!.createdAt);
  });
  it("starts every category at version 1 and advances the version on each edit (F-INCB-03)", async () => {
    // PROTO-HARDENING-001: budget_category.version is what CBD-236 SS8.6.1
    // `resource.version` carries for the CBD-211 category target, and the
    // table's trigger refuses an update that does not advance it. A relabel, a
    // reorder, an archive and a restore are each an edit.
    const { world, categories } = await seedCategories();
    assert.deepEqual(categories.map((c) => c.version), [1, 1, 1]);
    const groceries = categories[0]!;
    const edit = async (item: { label: string; position?: number | null; archived?: boolean }) =>
      (await upsertCategories(world.deps, SPACE_A, [{ categoryId: groceries.categoryId, label: item.label, position: item.position ?? null, archived: item.archived ?? false }]))
        .find((c) => c.categoryId === groceries.categoryId)!.version;
    assert.equal(await edit({ label: "Food" }), 2, "relabel");
    assert.equal(await edit({ label: "Food", position: 7 }), 3, "reorder");
    assert.equal(await edit({ label: "Food", archived: true }), 4, "archive");
    assert.equal(await edit({ label: "Food" }), 5, "restore");
    // A category nobody edited is untouched: the bump is per row, not per request.
    assert.equal((await listCategories(world.deps, SPACE_A)).find((c) => c.categoryId === categories[1]!.categoryId)?.version, 1);
  });
  it("refuses an unknown identity, a duplicate identity, a taken live label and an invalid label or position", async () => {
    const { world, categories } = await seedCategories();
    const id = categories[0]!.categoryId;
    await assert.rejects(upsertCategories(world.deps, SPACE_A, [{ categoryId: "99999999-9999-4999-8999-999999999999", label: "x", position: null, archived: false }]), code("category_not_found"));
    await assert.rejects(upsertCategories(world.deps, SPACE_A, [{ categoryId: id, label: "x", position: null, archived: false }, { categoryId: id, label: "y", position: null, archived: false }]), code("duplicate_category"));
    await assert.rejects(upsertCategories(world.deps, SPACE_A, [{ categoryId: null, label: "rent", position: null, archived: false }]), code("label_taken"));
    assert.throws(() => parseCategoryUpsertRequest({ categories: [{ label: "   " }] }), code("label_invalid"));
    assert.throws(() => parseCategoryUpsertRequest({ categories: [{ label: "a", position: -1 }] }), code("position_invalid"));
    assert.throws(() => parseCategoryUpsertRequest({ categories: [{ label: "a", categoryId: "not-a-uuid" }] }), code("invalid_request"));
    assert.throws(() => parseCategoryUpsertRequest({}), code("invalid_request"));
  });
  it("archives explicitly, frees the label, and keeps the identity listed", async () => {
    const { world, categories } = await seedCategories();
    const rent = categories[1]!;
    await upsertCategories(world.deps, SPACE_A, [{ categoryId: rent.categoryId, label: rent.label, position: null, archived: true }]);
    const again = await upsertCategories(world.deps, SPACE_A, [{ categoryId: null, label: "Rent", position: null, archived: false }]);
    assert.equal(again.filter((c) => c.label === "Rent").length, 2);
    assert.equal(again.find((c) => c.categoryId === rent.categoryId)?.archivedAt, world.now);
  });
  it("keeps one space's categories invisible through another space's identifier (PROTO-PLAN-02)", async () => {
    const { world } = await seedCategories();
    assert.deepEqual(await listCategories(world.deps, SPACE_B), []);
    await assert.rejects(readPlan(world.deps, SPACE_B, PERIOD_A_OPEN, SUBJECT_1), code("period_not_found"));
  });
});

describe("base targets (CBD-153-AC04)", () => {
  it("takes currency and cadence from the budget, records actor and source, and supersedes rather than overwrites", async () => {
    const { world, categories } = await seedCategories();
    const [groceries, rent] = categories;
    const first = await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries!.categoryId, amountMinorUnits: 40000 }, { categoryId: rent!.categoryId, amountMinorUnits: 150000 }]);
    assert.equal(first.cadence, "monthly"); assert.equal(first.currencyCode, "USD"); assert.equal(first.minorUnitPrecision, 2);
    assert.deepEqual(first.targets.map((t) => [t.categoryId, t.amountMinorUnits, t.setBySubjectId, t.source, t.supersededAt]).sort(),
      [[groceries!.categoryId, 40000, SUBJECT_1, "user", null], [rent!.categoryId, 150000, SUBJECT_1, "user", null]].sort());
    world.now = "2026-09-16T12:00:00.000Z";
    const second = await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries!.categoryId, amountMinorUnits: 45000 }, { categoryId: rent!.categoryId, amountMinorUnits: 150000 }]);
    const history = await world.repository.listBaseTargets(SPACE_A, "monthly");
    assert.equal(history.length, 3, "one superseded row plus two current");
    const superseded = history.find((t) => t.supersededAt !== null)!;
    assert.equal(superseded.amountMinorUnits, 40000); assert.equal(superseded.supersededAt, world.now);
    assert.equal(second.targets.find((t) => t.categoryId === rent!.categoryId)?.baseTargetId, first.targets.find((t) => t.categoryId === rent!.categoryId)?.baseTargetId, "unchanged amount keeps its row");
  });
  it("fails with stable errors for negative, non-integer, unknown category, archived category and unsupported precision", async () => {
    const { world, categories } = await seedCategories();
    const id = categories[0]!.categoryId;
    assert.throws(() => parseBaseTargetRequest({ targets: [{ categoryId: id, amountMinorUnits: -1 }] }), code("amount_negative"));
    assert.throws(() => parseBaseTargetRequest({ targets: [{ categoryId: id, amountMinorUnits: 10.5 }] }), code("amount_invalid"));
    assert.throws(() => parseBaseTargetRequest({ targets: [{ categoryId: id, amountMinorUnits: "10" }] }), code("amount_invalid"));
    assert.throws(() => parseBaseTargetRequest({ targets: [{ categoryId: "x", amountMinorUnits: 1 }] }), code("invalid_request"));
    await assert.rejects(setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: "99999999-9999-4999-8999-999999999999", amountMinorUnits: 1 }]), code("category_not_found"));
    await upsertCategories(world.deps, SPACE_A, [{ categoryId: id, label: "Groceries", position: null, archived: true }]);
    await assert.rejects(setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: id, amountMinorUnits: 1 }]), code("category_archived"));
    // The constraint half, mirrored by the in-memory adapter: a negative amount never reaches a row.
    await assert.rejects(world.repository.insertBaseTarget({ baseTargetId: world.ids.uuid(), budgetSpaceId: SPACE_A, categoryId: categories[1]!.categoryId, cadence: "monthly", currencyCode: "USD", minorUnitPrecision: 2, amountMinorUnits: -5, setBySubjectId: SUBJECT_1, source: "user", createdAt: world.now, supersededAt: null }), code("constraint_violation"));
    assert.throws(() => resolveMinorUnitPrecision(iso4217PrecisionReader, "CLF"), code("currency_precision_unsupported"));
    assert.throws(() => resolveMinorUnitPrecision(iso4217PrecisionReader, "XXX"), code("currency_unsupported"));
    assert.equal(resolveMinorUnitPrecision(iso4217PrecisionReader, "JPY"), 0);
    assert.equal(resolveMinorUnitPrecision(iso4217PrecisionReader, "BHD"), 3);
    world.repository.seedPlanContext({ ...(await world.repository.readPlanContext(SPACE_A, null))!, currencyCode: "CLF" });
    await assert.rejects(setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: categories[1]!.categoryId, amountMinorUnits: 1 }]), code("currency_precision_unsupported"));
  });
});

describe("plan (PROTO-PLAN-01, CBD-153-AC01/AC02)", () => {
  it("returns every live category with base target, computed period target and provenance, matching budget-domain directly", async () => {
    const { world, categories } = await seedCategories();
    const [groceries, rent, fun] = categories;
    await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries!.categoryId, amountMinorUnits: 40000 }, { categoryId: rent!.categoryId, amountMinorUnits: 150000 }]);
    const plan = await readPlan(world.deps, SPACE_A, null, SUBJECT_1);
    assert.equal(plan.period.periodId, PERIOD_A_OPEN); assert.equal(plan.period.completed, false); assert.equal(plan.formulaVersion, TARGET_FORMULA_VERSION);
    const direct = fullPeriodTargets({ cadence: "monthly", currency: "USD", targets: [
      { categoryId: groceries!.categoryId, amountMinorUnits: 40000 }, { categoryId: rent!.categoryId, amountMinorUnits: 150000 }, { categoryId: fun!.categoryId, amountMinorUnits: 0 } ] },
      "monthly", { start: toISODate("2026-09-01"), end: toISODate("2026-09-30") });
    const byId = new Map(direct.map((t) => [t.categoryId, t]));
    assert.equal(plan.categories.length, 3);
    for (const category of plan.categories) {
      const expected = byId.get(category.categoryId)!;
      assert.equal(category.periodTarget.amountMinorUnits, expected.amountMinorUnits);
      assert.equal(category.periodTarget.origin, expected.origin);
      assert.equal(category.periodTarget.calculation, expected.calculation);
      assert.equal(category.periodTarget.provenance.persisted, true);
      assert.equal(category.periodTarget.provenance.computedBySubjectId, SUBJECT_1);
      assert.deepEqual(category.periodTarget.provenance.inputs.period, { start: "2026-09-01", end: "2026-09-30" });
      assert.equal(category.periodTarget.provenance.inputs.baseAmountMinorUnits, expected.amountMinorUnits);
    }
    const funPlan = plan.categories.find((c) => c.categoryId === fun!.categoryId)!;
    assert.equal(funPlan.baseTarget, null); assert.equal(funPlan.periodTarget.amountMinorUnits, 0); assert.equal(funPlan.periodTarget.provenance.inputs.baseTargetId, null);
    const groceriesPlan = plan.categories.find((c) => c.categoryId === groceries!.categoryId)!;
    assert.equal(groceriesPlan.periodTarget.provenance.inputs.baseTargetId, groceriesPlan.baseTarget?.baseTargetId);
    // A second read is idempotent: the stored rows are returned, not rewritten.
    const again = await readPlan(world.deps, SPACE_A, PERIOD_A_OPEN, SUBJECT_1);
    assert.deepEqual(again, plan);
    assert.equal((await world.repository.listPeriodTargets(SPACE_A, PERIOD_A_OPEN)).length, 3);
  });
  it("recomputes an open period after a base change and excludes archived categories", async () => {
    const { world, categories } = await seedCategories();
    const [groceries, rent] = categories;
    await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries!.categoryId, amountMinorUnits: 100 }]);
    const before = await readPlan(world.deps, SPACE_A, null, SUBJECT_1);
    await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries!.categoryId, amountMinorUnits: 200 }]);
    await upsertCategories(world.deps, SPACE_A, [{ categoryId: rent!.categoryId, label: "Rent", position: null, archived: true }]);
    const after = await readPlan(world.deps, SPACE_A, null, SUBJECT_1);
    assert.equal(after.categories.length, 2);
    assert.equal(after.categories.find((c) => c.categoryId === groceries!.categoryId)?.periodTarget.amountMinorUnits, 200);
    assert.notEqual(after.categories[0]!.periodTarget.periodTargetId, before.categories[0]!.periodTarget.periodTargetId);
    const versions = await world.repository.listPeriodTargets(SPACE_A, PERIOD_A_OPEN);
    assert.equal(versions.filter((v) => v.supersededAt === null).length, 2, "current versions: the two live categories");
    assert.equal(versions.length, 5, "the three prior versions are retained");
  });
  it("never rewrites a completed period: stored rows are returned and missing ones are computed but not persisted", async () => {
    const { world, categories } = await seedCategories();
    const [groceries, rent] = categories;
    await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries!.categoryId, amountMinorUnits: 100 }]);
    world.now = "2026-08-15T12:00:00.000Z";
    const august = await readPlan(world.deps, SPACE_A, PERIOD_A_DONE, SUBJECT_1);
    assert.equal(august.period.completed, false);
    world.now = "2026-09-15T12:00:00.000Z";
    await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries!.categoryId, amountMinorUnits: 999 }]);
    await upsertCategories(world.deps, SPACE_A, [{ categoryId: null, label: "New", position: null, archived: false }]);
    const later = await readPlan(world.deps, SPACE_A, PERIOD_A_DONE, SUBJECT_1);
    assert.equal(later.period.completed, true);
    const stored = later.categories.find((c) => c.categoryId === groceries!.categoryId)!;
    assert.equal(stored.periodTarget.amountMinorUnits, 100, "history keeps the amount that governed August");
    assert.equal(stored.periodTarget.provenance.persisted, true);
    assert.equal(stored.baseTarget?.amountMinorUnits, 999, "the base target shown is the current one");
    const fresh = later.categories.find((c) => c.label === "New")!;
    assert.equal(fresh.periodTarget.provenance.persisted, false); assert.equal(fresh.periodTarget.periodTargetId, null);
    assert.equal((await world.repository.listPeriodTargets(SPACE_A, PERIOD_A_DONE)).length, 3);
    await assert.rejects(world.repository.supersedePeriodTargets(SPACE_A, PERIOD_A_DONE, world.now, []), code("completed_period_immutable"));
    void rent;
  });
  it("F-REVIEW-TARGETS-001: a recomputation of an open period retains the prior period-target version with its provenance, marked superseded", async () => {
    const { world, categories } = await seedCategories();
    const groceries = categories[0]!;
    await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries.categoryId, amountMinorUnits: 100 }]);
    const first = await readPlan(world.deps, SPACE_A, null, SUBJECT_1);
    const firstRow = first.categories.find((c) => c.categoryId === groceries.categoryId)!.periodTarget;
    assert.equal(firstRow.amountMinorUnits, 100);
    world.now = "2026-09-16T12:00:00.000Z";
    await setBaseTargets(world.deps, SPACE_A, SUBJECT_1, [{ categoryId: groceries.categoryId, amountMinorUnits: 200 }]);
    const second = await readPlan(world.deps, SPACE_A, null, SUBJECT_1);
    const secondRow = second.categories.find((c) => c.categoryId === groceries.categoryId)!.periodTarget;
    assert.equal(secondRow.amountMinorUnits, 200);
    assert.notEqual(secondRow.periodTargetId, firstRow.periodTargetId);
    const versions = await world.repository.listPeriodTargets(SPACE_A, PERIOD_A_OPEN);
    const retained = versions.find((v) => v.periodTargetId === firstRow.periodTargetId);
    assert.ok(retained, "the first period-target row still exists");
    assert.equal(retained.supersededAt, world.now, "and is marked superseded at the recomputation instant");
    assert.equal(retained.amountMinorUnits, 100); assert.equal(retained.computedAt, FIXED_NOW); assert.equal(retained.computedBySubjectId, SUBJECT_1);
    assert.deepEqual(retained.inputs, firstRow.provenance.inputs); assert.equal(retained.formulaVersion, firstRow.provenance.formulaVersion);
    const current = versions.filter((v) => v.categoryId === groceries.categoryId && v.supersededAt === null);
    assert.equal(current.length, 1); assert.equal(current[0]!.periodTargetId, secondRow.periodTargetId);
    assert.equal(versions.length, 6, "three categories, two versions each; nothing deleted");
    // A plain read afterwards returns the current version without creating another.
    assert.deepEqual(await readPlan(world.deps, SPACE_A, null, SUBJECT_1), second);
    assert.equal((await world.repository.listPeriodTargets(SPACE_A, PERIOD_A_OPEN)).length, 6);
  });
  it("computes a prorated transition through budget-domain when a basis is supplied", () => {
    const targets = computePeriodTargets({ baseTargets: { cadence: "monthly", currency: "USD", targets: [{ categoryId: "a", amountMinorUnits: 3000 }, { categoryId: "b", amountMinorUnits: 1000 }] },
      scheduleCadence: "monthly", period: { start: "2026-06-17", end: "2026-06-30" }, basis: { start: "2026-06-01", end: "2026-06-30" } });
    assert.deepEqual(targets.map((t) => [t.categoryId, t.origin, t.amountMinorUnits]), [["a", "prorated-transition", 1400], ["b", "prorated-transition", 467]]);
  });
  it("derives the budget-space date in the budget's zone", () => {
    assert.equal(budgetSpaceDate("2026-09-15T03:00:00.000Z", "America/New_York"), "2026-09-14");
    assert.equal(budgetSpaceDate("2026-09-15T03:00:00.000Z", "Asia/Tokyo"), "2026-09-15");
  });
});
