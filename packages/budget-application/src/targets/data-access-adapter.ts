/**
 * `TargetsRepository` over the typed CBD-153 statement set (CBD-153-AC01).
 *
 * The adapter's job is the mapping: rows in the tables' own column names and
 * scalar encodings on one side, this module's records on the other, with
 * every enumerated value (cadence, origin, source) checked against the
 * domain's closed lists on the way in so a row a later migration widened can
 * never reach the engine as a value it does not know. The cadence of a plan
 * comes from the schedule version's persisted `cadence_definition`, parsed by
 * budget-domain's own parser rather than trusted as text.
 *
 * Constraint failures surface as `TargetsError`: the driver's SQLSTATE, which
 * data-access preserves on `StatementFailedError.sqlState`, is the only thing
 * read from a failure. 55000 is the completed-period trigger (AC02); 23514 is
 * a CHECK -- the negative amount or unsupported precision the application
 * already refused, kept as defence in depth (AC04); 23505 is the one-current
 * uniqueness (base or period target) a concurrent writer beat this
 * transaction to.
 */
import { parseCadenceDefinition } from "@cobudget/budget-domain/schedule";
import type { Cadence } from "@cobudget/budget-domain/schedule";
import { TARGET_ORIGINS } from "@cobudget/budget-domain/targets";
import type { ProrationRecord, TargetOrigin } from "@cobudget/budget-domain/targets";
import type { BudgetCategoryBaseTargetRow, BudgetCategoryPeriodTargetRow, BudgetCategoryRow, PlanContextRow, TargetsRepository, TargetsStatements } from "./ports.ts";
import { TARGET_SOURCES, TargetsError } from "./records.ts";
import type { BaseTargetRecord, CategoryRecord, PeriodTargetInputs, PeriodTargetRecord, PlanContext, TargetSource } from "./records.ts";

const CADENCES: readonly Cadence[] = ["weekly", "monthly", "paycheck", "custom-fixed-length"];

export const COMPLETED_PERIOD_TARGET_SQLSTATE = "55000";

function sqlStateOf(error: unknown): string | undefined {
  const state = (error as { sqlState?: unknown } | null)?.sqlState;
  return typeof state === "string" ? state : undefined;
}

/** Translate a statement failure to the canonical error, or rethrow anything that is not one. */
export function translateStatementFailure(error: unknown): never {
  const state = sqlStateOf(error);
  if (state === COMPLETED_PERIOD_TARGET_SQLSTATE) throw new TargetsError("completed_period_immutable");
  if (state === "23514" || state === "23503" || state === "22003") throw new TargetsError("constraint_violation");
  if (state === "23505" || state === "40001" || state === "40P01") throw new TargetsError("conflict");
  throw error;
}

function cadenceOf(value: string): Cadence {
  if (!(CADENCES as readonly string[]).includes(value)) throw new TargetsError("cadence_unsupported");
  return value as Cadence;
}

function originOf(value: string): TargetOrigin {
  if (!(TARGET_ORIGINS as readonly string[]).includes(value)) throw new TargetsError("constraint_violation", "origin");
  return value as TargetOrigin;
}

function sourceOf(value: string): TargetSource {
  if (!(TARGET_SOURCES as readonly string[]).includes(value)) throw new TargetsError("constraint_violation", "source");
  return value as TargetSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBounds(value: unknown): value is { start: string; end: string } {
  return isRecord(value) && typeof value.start === "string" && typeof value.end === "string";
}

function inputsOf(value: unknown): PeriodTargetInputs {
  if (!isRecord(value) || !isBounds(value.period) || !Number.isSafeInteger(value.baseAmountMinorUnits)
    || typeof value.scheduleVersionId !== "string" || typeof value.cadence !== "string"
    || (value.baseTargetId !== null && typeof value.baseTargetId !== "string")
    || (value.basis !== null && !isBounds(value.basis))) {
    throw new TargetsError("constraint_violation", "inputs");
  }
  return {
    baseTargetId: value.baseTargetId as string | null,
    baseAmountMinorUnits: value.baseAmountMinorUnits as number,
    cadence: cadenceOf(value.cadence),
    scheduleVersionId: value.scheduleVersionId,
    period: { start: value.period.start, end: value.period.end },
    basis: value.basis === null ? null : { start: (value.basis as { start: string }).start, end: (value.basis as { end: string }).end },
  };
}

function calculationOf(value: unknown): ProrationRecord | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !Number.isSafeInteger(value.baseAmountMinorUnits) || !Number.isSafeInteger(value.transitionDays)
    || !Number.isSafeInteger(value.basisDays) || typeof value.remainderUnitAwarded !== "boolean") {
    throw new TargetsError("constraint_violation", "calculation");
  }
  return {
    baseAmountMinorUnits: value.baseAmountMinorUnits as number,
    transitionDays: value.transitionDays as number,
    basisDays: value.basisDays as number,
    remainderUnitAwarded: value.remainderUnitAwarded,
  };
}

export function categoryFromRow(row: BudgetCategoryRow): CategoryRecord {
  return { categoryId: row.category_id, budgetSpaceId: row.budget_space_id, label: row.label, position: row.position, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version };
}

export function categoryToRow(record: CategoryRecord): BudgetCategoryRow {
  return { category_id: record.categoryId, budget_space_id: record.budgetSpaceId, label: record.label, position: record.position, archived_at: record.archivedAt, created_at: record.createdAt, updated_at: record.updatedAt, version: record.version };
}

export function baseTargetFromRow(row: BudgetCategoryBaseTargetRow): BaseTargetRecord {
  return {
    baseTargetId: row.base_target_id, budgetSpaceId: row.budget_space_id, categoryId: row.category_id, cadence: cadenceOf(row.cadence),
    currencyCode: row.currency_code, minorUnitPrecision: row.minor_unit_precision, amountMinorUnits: row.amount_minor_units,
    setBySubjectId: row.set_by_subject_id, source: sourceOf(row.source), createdAt: row.created_at, supersededAt: row.superseded_at,
  };
}

export function baseTargetToRow(record: BaseTargetRecord): BudgetCategoryBaseTargetRow {
  return {
    base_target_id: record.baseTargetId, budget_space_id: record.budgetSpaceId, category_id: record.categoryId, cadence: record.cadence,
    currency_code: record.currencyCode, minor_unit_precision: record.minorUnitPrecision, amount_minor_units: record.amountMinorUnits,
    set_by_subject_id: record.setBySubjectId, source: record.source, created_at: record.createdAt, superseded_at: record.supersededAt,
  };
}

export function periodTargetFromRow(row: BudgetCategoryPeriodTargetRow): PeriodTargetRecord {
  const origin = originOf(row.origin);
  const calculation = calculationOf(row.calculation);
  if ((origin === "full-period") !== (calculation === null)) throw new TargetsError("constraint_violation", "origin");
  return {
    periodTargetId: row.period_target_id, budgetSpaceId: row.budget_space_id, categoryId: row.category_id, periodId: row.period_id,
    periodStart: row.period_start_date, periodEnd: row.period_end_date, origin, currencyCode: row.currency_code,
    minorUnitPrecision: row.minor_unit_precision, amountMinorUnits: row.amount_minor_units, formulaVersion: row.formula_version,
    inputs: inputsOf(row.inputs), calculation, computedBySubjectId: row.computed_by_subject_id, source: sourceOf(row.source), computedAt: row.computed_at,
    supersededAt: row.superseded_at,
  };
}

export function periodTargetToRow(record: PeriodTargetRecord): BudgetCategoryPeriodTargetRow {
  return {
    period_target_id: record.periodTargetId, budget_space_id: record.budgetSpaceId, category_id: record.categoryId, period_id: record.periodId,
    period_start_date: record.periodStart, period_end_date: record.periodEnd, origin: record.origin, currency_code: record.currencyCode,
    minor_unit_precision: record.minorUnitPrecision, amount_minor_units: record.amountMinorUnits, formula_version: record.formulaVersion,
    inputs: record.inputs, calculation: record.calculation, computed_by_subject_id: record.computedBySubjectId, source: record.source, computed_at: record.computedAt,
    superseded_at: record.supersededAt,
  };
}

export function planContextFromRow(row: PlanContextRow): PlanContext {
  const parsed = parseCadenceDefinition(row.cadence_definition);
  if (!parsed.ok) throw new TargetsError("cadence_unsupported");
  return {
    budgetSpaceId: row.budget_space_id, currencyCode: row.currency_code, timeZone: row.time_zone, currentPeriodId: row.current_period_id,
    periodId: row.period_id, scheduleVersionId: row.schedule_version_id, periodStatus: row.period_status,
    periodStart: row.period_start_date, periodEnd: row.period_end_date, cadence: parsed.value.cadence,
  };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { return translateStatementFailure(error); }
}

export function dataAccessTargetsRepository(statements: TargetsStatements): TargetsRepository {
  return {
    listCategories: (budgetSpaceId) => guarded(async () => (await statements.listCategories(budgetSpaceId)).map(categoryFromRow)),
    insertCategory: (record) => guarded(() => statements.insertCategory(categoryToRow(record))),
    updateCategory: (record) => guarded(async () => (await statements.updateCategory(record.budgetSpaceId, record.categoryId, {
      label: record.label, position: record.position, archived_at: record.archivedAt, updated_at: record.updatedAt, version: record.version,
    })) === 1),
    listBaseTargets: (budgetSpaceId, cadence) => guarded(async () => (await statements.listBaseTargets(budgetSpaceId, cadence)).map(baseTargetFromRow)),
    insertBaseTarget: (record) => guarded(() => {
      const { superseded_at: _superseded, ...row } = baseTargetToRow(record);
      return statements.insertBaseTarget(row);
    }),
    supersedeBaseTarget: (budgetSpaceId, baseTargetId, supersededAt) => guarded(async () => (await statements.supersedeBaseTarget(budgetSpaceId, baseTargetId, supersededAt)) === 1),
    readPlanContext: (budgetSpaceId, periodId) => guarded(async () => {
      const row = await statements.readPlanContext(budgetSpaceId, periodId);
      return row === null ? null : planContextFromRow(row);
    }),
    listPeriodTargets: (budgetSpaceId, periodId) => guarded(async () => (await statements.listPeriodTargets(budgetSpaceId, periodId)).map(periodTargetFromRow)),
    supersedePeriodTargets: (budgetSpaceId, periodId, supersededAt, records) => guarded(async () => {
      for (const record of records) {
        if (record.budgetSpaceId !== budgetSpaceId || record.periodId !== periodId || record.supersededAt !== null) throw new TargetsError("invalid_request", "periodTargets");
      }
      // Retained versions: the current rows are stamped, never removed, in the same transaction as the new ones.
      for (const current of await statements.listPeriodTargets(budgetSpaceId, periodId)) {
        if (current.superseded_at !== null) continue;
        if ((await statements.supersedePeriodTarget(budgetSpaceId, current.period_target_id, supersededAt)) !== 1) throw new TargetsError("conflict", "periodTargetId");
      }
      for (const record of records) {
        const { superseded_at: _superseded, ...row } = periodTargetToRow(record);
        await statements.insertPeriodTarget(row);
      }
    }),
  };
}
