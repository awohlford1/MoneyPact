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
 *         open period's rows are superseded, never removed, when the base
 *         plan changes (F-REVIEW-TARGETS-001), and the completed test uses
 *         the budget's own time zone in both directions (F-TARGETS-002)
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
import { addDays, toISODate } from "../../../../packages/budget-domain/src/shared/index.ts";
import { TARGET_FORMULA_VERSION, TargetsError, budgetSpaceDate, dataAccessTargetsRepository, readPlan, setBaseTargets, upsertCategories } from "../../../../packages/budget-application/src/targets/index.ts";
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
    async function budget(currency: string, cadence: unknown, periods: readonly { id: string; start: string; end: string; status: string }[], timeZone = "America/New_York") {
      const space = randomUUID(); const membership = randomUUID(); const schedule = randomUUID();
      await seed.query("INSERT INTO budget_space (budget_space_id, name, time_zone, time_zone_data_version, currency_code, currency_catalog_version, primary_owner_membership_id, initial_schedule_version_id, current_schedule_version_id, current_period_id, created_by_subject_id) VALUES ($1,$2,$8,'2026a',$3,'cbd-231/0.1',$4,$5,$5,$6,$7)",
        [space, "Live " + space.slice(0, 8), currency, membership, schedule, periods[0]!.id, subject, timeZone]);
      await seed.query("INSERT INTO budget_space_membership (membership_id, budget_space_id, profile_id, account_subject_id, role, status, created_by_subject_id) VALUES ($1,$2,$3,$4,'primary_owner','active',$4)", [membership, space, profile, subject]);
      await seed.query("INSERT INTO budget_space_schedule_version (schedule_version_id, budget_space_id, sequence, status, cadence_definition, proposal_preview_digest) VALUES ($1,$2,1,'authoritative',$3,'digest')", [schedule, space, JSON.stringify(cadence)]);
      for (const p of periods) await seed.query("INSERT INTO budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date) VALUES ($1,$2,$3,$4,$5,$6)", [p.id, space, schedule, p.status, p.start, p.end]);
      return { space, membership, schedule };
    }
    const open = { id: randomUUID(), start: "2099-01-01", end: "2099-01-31", status: "active" };
    const done = { id: randomUUID(), start: "2020-01-01", end: "2020-01-31", status: "planned" };
    const other = { id: randomUUID(), start: "2099-01-05", end: "2099-01-11", status: "active" };
    // F-TARGETS-002: at every instant the calendar date in Pacific/Kiritimati
    // (UTC+14) is one day ahead of Pacific/Pago_Pago (UTC-11), and the server's
    // UTC date equals one of the two. A period ending on the western date is
    // still open in the west and already completed in the east, whatever UTC
    // says, so one of the two budgets always contradicts the server clock.
    const realNow = new Date().toISOString();
    const westDate = toISODate(budgetSpaceDate(realNow, "Pacific/Pago_Pago"));
    const eastDate = toISODate(budgetSpaceDate(realNow, "Pacific/Kiritimati"));
    assert.equal(addDays(westDate, 1), eastDate);
    const westPeriod = { id: randomUUID(), start: addDays(westDate, -6), end: westDate, status: "active" };
    const eastPeriod = { id: randomUUID(), start: addDays(westDate, -6), end: westDate, status: "active" };
    let a: Awaited<ReturnType<typeof budget>>; let b: Awaited<ReturnType<typeof budget>>;
    let west: Awaited<ReturnType<typeof budget>>; let east: Awaited<ReturnType<typeof budget>>;
    try {
      await seed.query("BEGIN");
      await seed.query("INSERT INTO account_subject (account_subject_id) VALUES ($1)", [subject]);
      await seed.query("INSERT INTO financial_profile (profile_id, account_subject_id, profile_state) VALUES ($1,$2,'active')", [profile, subject]);
      a = await budget("USD", { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } }, [open, done]);
      b = await budget("USD", { cadence: "weekly", anchor: "monday" }, [other]);
      west = await budget("USD", { cadence: "weekly", anchor: "monday" }, [westPeriod], "Pacific/Pago_Pago");
      east = await budget("USD", { cadence: "weekly", anchor: "monday" }, [eastPeriod], "Pacific/Kiritimati");
      await seed.query("COMMIT");
    } catch (error) { await seed.query("ROLLBACK"); throw error; } finally { seed.release(); }

    const statements = { ...budgetCategoryStatements(client), ...budgetCategoryBaseTargetStatements(client), ...budgetCategoryPeriodTargetStatements(client) };
    const repository = dataAccessTargetsRepository(statements);
    let instant = "2099-01-10T12:00:00.000Z";
    const deps: TargetsDependencies = { repository, clock: { now: () => instant }, ids: { uuid: randomUUID } };

    // AC01: categories, base targets and the plan, written through the application and read back field for field.
    const categories = await upsertCategories(deps, a.space, [{ categoryId: null, label: "Groceries", position: null, archived: false }, { categoryId: null, label: "Rent", position: null, archived: false }]);
    const [groceries, rent] = categories;
    assert.deepEqual([...await repository.listCategories(a.space)].sort((x, y) => x.position - y.position), categories);
    const set = await setBaseTargets(deps, a.space, subject, [{ categoryId: groceries!.categoryId, amountMinorUnits: 40001 }, { categoryId: rent!.categoryId, amountMinorUnits: 150000 }]);
    assert.equal(set.cadence, "monthly"); assert.equal(set.minorUnitPrecision, 2);
    const byCategory = (x: { categoryId: string }, y: { categoryId: string }) => x.categoryId.localeCompare(y.categoryId);
    assert.deepEqual([...await repository.listBaseTargets(a.space, "monthly")].sort(byCategory), [...set.targets].sort(byCategory));
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

    // AC02 and F-REVIEW-TARGETS-001: the open period is recomputed after a base
    // change as a new version; the prior row is retained, stamped superseded,
    // with its identifier, timestamps, actor and provenance intact.
    const firstVersion = plan.categories.find((c) => c.categoryId === groceries!.categoryId)!.periodTarget;
    instant = "2099-01-11T12:00:00.000Z";
    await setBaseTargets(deps, a.space, subject, [{ categoryId: groceries!.categoryId, amountMinorUnits: 50000 }]);
    const recomputed = await readPlan(deps, a.space, open.id, subject);
    assert.equal(recomputed.categories.find((c) => c.categoryId === groceries!.categoryId)?.periodTarget.amountMinorUnits, 50000);
    assert.equal((await repository.listBaseTargets(a.space, "monthly")).length, 3, "the superseded base row is history, not overwritten");
    const versions = await repository.listPeriodTargets(a.space, open.id);
    const retained = versions.find((v) => v.periodTargetId === firstVersion.periodTargetId);
    assert.ok(retained, "the first period-target row still exists");
    assert.equal(retained.supersededAt, instant); assert.equal(retained.amountMinorUnits, 40001); assert.equal(retained.computedAt, "2099-01-10T12:00:00.000Z");
    assert.equal(retained.computedBySubjectId, subject); assert.equal(retained.source, "user");
    assert.deepEqual(retained.inputs, firstVersion.provenance.inputs); assert.equal(retained.formulaVersion, firstVersion.provenance.formulaVersion);
    assert.equal(versions.filter((v) => v.supersededAt === null).length, 2); assert.equal(versions.length, 4);
    assert.deepEqual(await readPlan(deps, a.space, open.id, subject), recomputed, "a plain read returns the current version without another");
    // A superseded row is history: its stamp cannot move and nothing else on it can change.
    await assert.rejects(client.tenantUpdate({ table: "budget_category_period_target", budgetSpaceId: a.space, set: { superseded_at: "2099-01-12T00:00:00.000Z" }, conditions: [{ column: "period_target_id", value: firstVersion.periodTargetId }] }), sqlState(COMPLETED_PERIOD_TARGET_SQLSTATE));
    const completed = await readPlan(deps, a.space, done.id, subject);
    assert.equal(completed.period.completed, true);
    assert.equal(completed.categories.every((c) => c.periodTarget.provenance.persisted === false), true, "nothing is written into a completed period's history");
    // Rows written while the period was open are what the trigger protects; write them directly, then try to change them.
    const historic = randomUUID();
    await client.tenantInsert({ table: "budget_category_period_target", budgetSpaceId: a.space, values: { period_target_id: historic, category_id: rent!.categoryId, period_id: done.id, period_start_date: done.start, period_end_date: done.end,
      origin: "full-period", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: 7, formula_version: TARGET_FORMULA_VERSION, inputs: JSON.stringify({ baseTargetId: null, baseAmountMinorUnits: 7, cadence: "monthly", scheduleVersionId: a.schedule, period: { start: done.start, end: done.end }, basis: null }), calculation: null, computed_by_subject_id: subject, source: "user" } });
    await assert.rejects(client.tenantUpdate({ table: "budget_category_period_target", budgetSpaceId: a.space, set: { amount_minor_units: 8 }, conditions: [{ column: "period_target_id", value: historic }] }), sqlState(COMPLETED_PERIOD_TARGET_SQLSTATE));
    // DELETE is revoked from the application roles (42501) and refused by the trigger for the owner too (55000), completed or open.
    await assert.rejects(client.tenantDelete({ table: "budget_category_period_target", budgetSpaceId: a.space, conditions: [{ column: "period_id", value: done.id }] }), sqlState("42501"));
    for (const periodId of [done.id, open.id]) {
      await assert.rejects(admin.query("DELETE FROM budget_category_period_target WHERE budget_space_id = $1 AND period_id = $2", [a.space, periodId]), (error: unknown) => (error as { code?: string }).code === COMPLETED_PERIOD_TARGET_SQLSTATE);
    }
    await assert.rejects(repository.supersedePeriodTargets(a.space, done.id, instant, []), code("completed_period_immutable"));
    const kept = await readPlan(deps, a.space, done.id, subject);
    assert.equal(kept.categories.find((c) => c.categoryId === rent!.categoryId)?.periodTarget.amountMinorUnits, 7);
    assert.equal(kept.categories.find((c) => c.categoryId === rent!.categoryId)?.periodTarget.provenance.persisted, true);
    // An open period's current row can be superseded (the statement the trigger refused above), and nothing else on it can change.
    const openRow = (await repository.listPeriodTargets(a.space, open.id)).find((v) => v.supersededAt === null)!;
    await assert.rejects(client.tenantUpdate({ table: "budget_category_period_target", budgetSpaceId: a.space, set: { source: "system" }, conditions: [{ column: "period_target_id", value: openRow.periodTargetId }] }), sqlState("23514"));
    assert.equal((await client.tenantUpdate({ table: "budget_category_period_target", budgetSpaceId: a.space, set: { superseded_at: "2099-01-12T00:00:00.000Z" }, conditions: [{ column: "period_target_id", value: openRow.periodTargetId }] })).rowCount, 1);

    // F-TARGETS-002: completion is the budget's date, not the server's, in both directions.
    const westRow = { period_target_id: randomUUID(), category_id: null as string | null, period_id: westPeriod.id, period_start_date: westPeriod.start, period_end_date: westPeriod.end,
      origin: "full-period", currency_code: "USD", minor_unit_precision: 2, amount_minor_units: 1, formula_version: TARGET_FORMULA_VERSION, calculation: null, computed_by_subject_id: subject, source: "user", computed_at: realNow,
      inputs: JSON.stringify({ baseTargetId: null, baseAmountMinorUnits: 1, cadence: "weekly", scheduleVersionId: west.schedule, period: { start: westPeriod.start, end: westPeriod.end }, basis: null }) };
    const westCategory = (await upsertCategories(deps, west.space, [{ categoryId: null, label: "West", position: null, archived: false }]))[0]!;
    const eastCategory = (await upsertCategories(deps, east.space, [{ categoryId: null, label: "East", position: null, archived: false }]))[0]!;
    await client.tenantInsert({ table: "budget_category_period_target", budgetSpaceId: west.space, values: { ...westRow, category_id: westCategory.categoryId } });
    const eastRow = { ...westRow, period_target_id: randomUUID(), category_id: eastCategory.categoryId, period_id: eastPeriod.id };
    await client.tenantInsert({ table: "budget_category_period_target", budgetSpaceId: east.space, values: eastRow });
    assert.equal((await client.tenantUpdate({ table: "budget_category_period_target", budgetSpaceId: west.space, set: { superseded_at: realNow }, conditions: [{ column: "period_target_id", value: westRow.period_target_id }] })).rowCount, 1, "open in the budget's zone: supersession admitted whatever UTC says");
    await assert.rejects(client.tenantUpdate({ table: "budget_category_period_target", budgetSpaceId: east.space, set: { superseded_at: realNow }, conditions: [{ column: "period_target_id", value: eastRow.period_target_id }] }), sqlState(COMPLETED_PERIOD_TARGET_SQLSTATE), "completed in the budget's zone: refused whatever UTC says");
    const realDeps: TargetsDependencies = { ...deps, clock: { now: () => realNow } };
    assert.equal((await readPlan(realDeps, west.space, null, subject)).period.completed, false, "still today in Pago Pago (the application agrees with the trigger)");
    assert.equal((await readPlan(realDeps, east.space, null, subject)).period.completed, true, "already yesterday in Kiritimati");
    assert.notEqual(new Date(realNow).toISOString().slice(0, 10) === westDate, new Date(realNow).toISOString().slice(0, 10) === eastDate, "the server's UTC date matches exactly one of the two budgets, so one of them contradicted current_date");
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
