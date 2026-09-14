/**
 * CBD-153 live PostgreSQL proof (PROTO-TARGETS-001). Opt-in exactly like
 * packages/data-access/src/transaction.live.test.ts: a scratch database other
 * than cobudget_dev must be configured and already migrated; this test never
 * starts Docker, never resets, and cleans nothing up (every identifier is
 * fresh). It runs the real statements through the api role's client, so the
 * grants, triggers and constraints the migrations install are what is proved:
 *
 *   AC01  round trip through the data-access adapter and the application
 *   AC02  UPDATE and DELETE on a completed period's row fail with 55000; an
 *         open period's rows are replaced when the base plan changes
 *   AC03  relabel and reorder keep base and period targets attached
 *   AC04  negative amount and unsupported precision fail at the CHECK (23514)
 *   PLAN  two spaces: nothing of one is reachable through the other's id and
 *         a cross-space category reference fails the deferred FK at commit
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { bindClient } from "../../../../packages/data-access/src/binding.ts";
import { StatementFailedError } from "../../../../packages/data-access/src/logging.ts";
import { budgetCategoryStatements } from "../../../../packages/data-access/src/budget-category.ts";
import { budgetCategoryBaseTargetStatements } from "../../../../packages/data-access/src/budget-category-base-target.ts";
import { budgetCategoryPeriodTargetStatements, COMPLETED_PERIOD_TARGET_SQLSTATE } from "../../../../packages/data-access/src/budget-category-period-target.ts";
import { TARGET_FORMULA_VERSION, TargetsError, dataAccessTargetsRepository, readPlan, setBaseTargets, upsertCategories } from "../../../../packages/budget-application/src/targets/index.ts";
import type { TargetsDependencies } from "../../../../packages/budget-application/src/targets/index.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev";
const sqlState = (expected: string) => (error: unknown) => error instanceof StatementFailedError && error.sqlState === expected;
const code = (expected: string) => (error: unknown) => error instanceof TargetsError && error.code === expected;

void test("CBD-153 live: round trip, completed-period immutability, identity-driven ties, constraint rejections, tenant isolation", { skip: !configured }, async () => {
  const { createMigrationConnection, createApiConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const admin = createMigrationConnection(); const api = createApiConnection();
  const client = bindClient(api, true);
  try {
    const subject = randomUUID(); const profile = randomUUID();
    const seed = await admin.connect();
    async function budget(currency: string, cadence: unknown, periods: readonly { id: string; start: string; end: string; status: string }[]) {
      const space = randomUUID(); const membership = randomUUID(); const schedule = randomUUID();
      await seed.query("INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version, primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id) VALUES ($1,$2,'America/New_York','2026a',$3,'cbd-231/0.1',$4,$5,$5,$6,$7)",
        [space, "Live " + space.slice(0, 8), currency, membership, schedule, periods[0]!.id, subject]);
      await seed.query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','active',$4)", [membership, space, profile, subject]);
      await seed.query("INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest) VALUES ($1,$2,1,'authoritative',$3,'digest')", [schedule, space, JSON.stringify(cadence)]);
      for (const p of periods) await seed.query("INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date) VALUES ($1,$2,$3,$4,$5,$6)", [p.id, space, schedule, p.status, p.start, p.end]);
      return { space, membership, schedule };
    }
    const open = { id: randomUUID(), start: "2099-01-01", end: "2099-01-31", status: "active" };
    const done = { id: randomUUID(), start: "2020-01-01", end: "2020-01-31", status: "planned" };
    const other = { id: randomUUID(), start: "2099-01-05", end: "2099-01-11", status: "active" };
    let a: Awaited<ReturnType<typeof budget>>; let b: Awaited<ReturnType<typeof budget>>;
    try {
      await seed.query("BEGIN");
      await seed.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [subject]);
      await seed.query("INSERT INTO financial_profile (profile_id, account_subject_id, profile_state) VALUES ($1,$2,'active')", [profile, subject]);
      a = await budget("USD", { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } }, [open, done]);
      b = await budget("USD", { cadence: "weekly", anchor: "monday" }, [other]);
      await seed.query("COMMIT");
    } catch (error) { await seed.query("ROLLBACK"); throw error; } finally { seed.release(); }

    const statements = { ...budgetCategoryStatements(client), ...budgetCategoryBaseTargetStatements(client), ...budgetCategoryPeriodTargetStatements(client) };
    const repository = dataAccessTargetsRepository(statements);
    let instant = "2099-01-10T12:00:00.000Z";
    const deps: TargetsDependencies = { repository, clock: { now: () => instant }, ids: { uuid: randomUUID } };

    // AC01: categories, base targets and the plan, written through the application and read back field for field.
    const categories = await upsertCategories(deps, a.space, [{ categoryId: null, label: "Groceries", position: null, archived: false }, { categoryId: null, label: "Rent", position: null, archived: false }]);
    const [groceries, rent] = categories;
    assert.deepEqual(await repository.listCategories(a.space), categories);
    const set = await setBaseTargets(deps, a.space, subject, [{ categoryId: groceries!.categoryId, amountMinorUnits: 40001 }, { categoryId: rent!.categoryId, amountMinorUnits: 150000 }]);
    assert.equal(set.cadence, "monthly"); assert.equal(set.minorUnitPrecision, 2);
    assert.deepEqual(await repository.listBaseTargets(a.space, "monthly"), set.targets);
    const plan = await readPlan(deps, a.space, null, subject);
    assert.equal(plan.period.periodId, open.id); assert.equal(plan.period.completed, false);
    const stored = await repository.listPeriodTargets(a.space, open.id);
    assert.equal(stored.length, 2);
    for (const row of stored) {
      const category = plan.categories.find((c) => c.categoryId === row.categoryId)!;
      assert.equal(row.periodTargetId, category.periodTarget.periodTargetId);
      assert.equal(row.budgetSpaceId, a.space); assert.equal(row.periodId, open.id); assert.equal(row.periodStart, open.start); assert.equal(row.periodEnd, open.end);
      assert.equal(row.currencyCode, "USD"); assert.equal(row.minorUnitPrecision, 2); assert.equal(row.origin, "full-period"); assert.equal(row.calculation, null);
      assert.equal(row.formulaVersion, TARGET_FORMULA_VERSION); assert.equal(row.amountMinorUnits, category.periodTarget.amountMinorUnits);
      assert.deepEqual(row.inputs, category.periodTarget.provenance.inputs);
      assert.equal(row.inputs.baseTargetId, category.baseTarget?.baseTargetId); assert.equal(row.inputs.scheduleVersionId, a.schedule);
      assert.equal(row.computedBySubjectId, subject); assert.equal(row.source, "user"); assert.equal(row.computedAt, instant);
    }
    assert.equal(plan.categories.find((c) => c.categoryId === groceries!.categoryId)?.periodTarget.amountMinorUnits, 40001);
    const again = await readPlan(deps, a.space, open.id, subject);
    assert.deepEqual(again, plan, "a repeated read returns the stored rows unchanged");

    // AC03: relabel and reorder by identity; every tie survives.
    await upsertCategories(deps, a.space, [{ categoryId: groceries!.categoryId, label: "Food", position: 9, archived: false }]);
    assert.equal((await repository.listCategories(a.space)).find((c) => c.categoryId === groceries!.categoryId)?.label, "Food");
    assert.equal((await repository.listBaseTargets(a.space, "monthly")).filter((t) => t.categoryId === groceries!.categoryId && t.supersededAt === null).length, 1);
    assert.equal((await repository.listPeriodTargets(a.space, open.id)).filter((t) => t.categoryId === groceries!.categoryId).length, 1);
    await assert.rejects(client.tenantUpdate({ table: "budget_category", budgetSpaceId: a.space, set: { category_id: randomUUID() }, conditions: [{ column: "category_id", value: groceries!.categoryId }] }), sqlState("23514"));

    // AC02: the open period is recomputed after a base change; the completed period never changes.
    instant = "2099-01-11T12:00:00.000Z";
    await setBaseTargets(deps, a.space, subject, [{ categoryId: groceries!.categoryId, amountMinorUnits: 50000 }]);
    const recomputed = await readPlan(deps, a.space, open.id, subject);
    assert.equal(recomputed.categories.find((c) => c.categoryId === groceries!.categoryId)?.periodTarget.amountMinorUnits, 50000);
    assert.equal((await repository.listBaseTargets(a.space, "monthly")).length, 3, "the superseded row is history, not overwritten");
    const completed = await readPlan(deps, a.space, done.id, subject);
    assert.equal(completed.period.completed, true);
    assert.equal(completed.categories.every((c) => c.periodTarget.provenance.persisted === false), true, "nothing is written into a completed period's history");
    // Rows written while the period was open are what the trigger protects; write them directly, then try to change them.
    const historic = randomUUID();
    await client.tenantInsert({ table: "budget_category_period_target", budgetSpaceId: a.space, values: { period_target_id: historic, category_id: rent!.categoryId, period_id: done.id, period_start_date: done.start, period_end_date: done.end,
      origin: "full-period", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: 7, formula_version: TARGET_FORMULA_VERSION, inputs: JSON.stringify({ baseTargetId: null, baseAmountMinorUnits: 7, cadence: "monthly", scheduleVersionId: a.schedule, period: { start: done.start, end: done.end }, basis: null }), calculation: null, computed_by_subject_id: subject, source: "user" } });
    await assert.rejects(client.tenantUpdate({ table: "budget_category_period_target", budgetSpaceId: a.space, set: { amount_minor_units: 8 }, conditions: [{ column: "period_target_id", value: historic }] }), sqlState(COMPLETED_PERIOD_TARGET_SQLSTATE));
    await assert.rejects(client.tenantDelete({ table: "budget_category_period_target", budgetSpaceId: a.space, conditions: [{ column: "period_id", value: done.id }] }), sqlState(COMPLETED_PERIOD_TARGET_SQLSTATE));
    await assert.rejects(repository.replacePeriodTargets(a.space, done.id, []), code("completed_period_immutable"));
    const kept = await readPlan(deps, a.space, done.id, subject);
    assert.equal(kept.categories.find((c) => c.categoryId === rent!.categoryId)?.periodTarget.amountMinorUnits, 7);
    assert.equal(kept.categories.find((c) => c.categoryId === rent!.categoryId)?.periodTarget.provenance.persisted, true);
    // An open period's row can be updated and its set replaced (the same statements the trigger refused above).
    const openRow = (await repository.listPeriodTargets(a.space, open.id))[0]!;
    assert.equal((await client.tenantUpdate({ table: "budget_category_period_target", budgetSpaceId: a.space, set: { source: "system" }, conditions: [{ column: "period_target_id", value: openRow.periodTargetId }] })).rowCount, 1);
    // The period a row names must be this budget's, with these dates.
    await assert.rejects(client.tenantInsert({ table: "budget_category_period_target", budgetSpaceId: a.space, values: { period_target_id: randomUUID(), category_id: rent!.categoryId, period_id: open.id, period_start_date: open.start, period_end_date: "2099-02-28",
      origin: "full-period", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: 1, formula_version: TARGET_FORMULA_VERSION, inputs: "{}", calculation: null, computed_by_subject_id: subject, source: "user" } }), sqlState("23503"));

    // AC04: the constraints, reached directly and through the adapter.
    const negative = { base_target_id: randomUUID(), category_id: rent!.categoryId, cadence: "weekly", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: -1, set_by_subject_id: subject, source: "user", created_at: instant };
    await assert.rejects(client.tenantInsert({ table: "budget_category_base_target", budgetSpaceId: a.space, values: negative }), sqlState("23514"));
    await assert.rejects(client.tenantInsert({ table: "budget_category_base_target", budgetSpaceId: a.space, values: { ...negative, amount_minor_units: 1, minor_unit_precision: 4 } }), sqlState("23514"));
    await assert.rejects(repository.insertBaseTarget({ baseTargetId: randomUUID(), budgetSpaceId: a.space, categoryId: rent!.categoryId, cadence: "weekly", currencyCode: "USD", minorUnitPrecision: 2, amountMinorUnits: -1, setBySubjectId: subject, source: "user", createdAt: instant, supersededAt: null }), code("constraint_violation"));

    // PROTO-PLAN-02 at the statement layer: space B sees nothing of A, and cannot tie a target to A's category.
    assert.deepEqual(await repository.listCategories(b.space), []);
    assert.deepEqual(await repository.listBaseTargets(b.space, "monthly"), []);
    assert.equal(await repository.readPlanContext(b.space, open.id), null);
    assert.equal((await repository.readPlanContext(b.space, null))?.cadence, "weekly");
    await assert.rejects(client.transaction({ isolation: "serializable" }, async (tx) => {
      await tx.tenantInsert({ table: "budget_category_base_target", budgetSpaceId: b.space, values: { ...negative, amount_minor_units: 1 } });
    }), (error: unknown) => error instanceof StatementFailedError && error.operation === "commit" && error.sqlState === "23503");
    await assert.rejects(setBaseTargets(deps, b.space, subject, [{ categoryId: rent!.categoryId, amountMinorUnits: 1 }]), code("category_not_found"));
  } finally {
    await api.end(); await admin.end();
  }
});
