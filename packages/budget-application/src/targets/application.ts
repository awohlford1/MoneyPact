/**
 * Category and target commands and the plan query (CBD-153, CBD-30).
 *
 * Three operations: `upsertCategories` (the category set a user edits),
 * `setBaseTargets` (the standing plan for the budget's current cadence
 * context), and `readPlan` (every live category with its base target, the
 * period target budget-domain computes for one period, and that
 * computation's provenance). The arithmetic is budget-domain's
 * `fullPeriodTargets`/`prorateTransitionTargets`, called through
 * {@link computePeriodTargets}; nothing here rounds, allocates or prorates.
 *
 * Request bodies arrive as `unknown` and are parsed here into canonical
 * errors, so the HTTP adapter carries no validation of its own. Every write
 * assumes the caller's transaction; the commands are whole-set operations
 * (INV-54) and never leave a partial category or target set behind on
 * failure because the surrounding transaction rolls back.
 */
import { toISODate } from "@cobudget/budget-domain/shared";
import type { Cadence } from "@cobudget/budget-domain/schedule";
import { fullPeriodTargets, prorateTransitionTargets } from "@cobudget/budget-domain/targets";
import type { BaseTargetSet, PeriodTarget, ProrationRecord, TargetOrigin } from "@cobudget/budget-domain/targets";
import type { Clock, IdGenerator, TargetsRepository } from "./ports.ts";
import { TARGET_FORMULA_VERSION, TargetsError, compareIds, iso4217PrecisionReader, resolveMinorUnitPrecision } from "./records.ts";
import type { BaseTargetRecord, CategoryRecord, CurrencyPrecisionReader, PeriodTargetInputs, PeriodTargetRecord } from "./records.ts";

export interface TargetsDependencies {
  readonly repository: TargetsRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly currencies?: CurrencyPrecisionReader;
}

export const MAX_LABEL_LENGTH = 120;
export const MAX_CATEGORIES_PER_REQUEST = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function precisionReader(deps: TargetsDependencies): CurrencyPrecisionReader {
  return deps.currencies ?? iso4217PrecisionReader;
}

function byPositionThenId(a: CategoryRecord, b: CategoryRecord): number {
  return a.position - b.position || compareIds(a.categoryId, b.categoryId);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryUpsertItem {
  readonly categoryId: string | null;
  readonly label: string;
  readonly position: number | null;
  readonly archived: boolean;
}

/** Parse `{ categories: [{ categoryId?, label, position?, archived? }] }`; every failure is `invalid_request` naming the path. */
export function parseCategoryUpsertRequest(body: unknown): readonly CategoryUpsertItem[] {
  if (!isRecord(body) || !Array.isArray(body.categories)) throw new TargetsError("invalid_request", "categories");
  if (body.categories.length > MAX_CATEGORIES_PER_REQUEST) throw new TargetsError("invalid_request", "categories");
  return body.categories.map((item, index): CategoryUpsertItem => {
    const path = `categories[${index}]`;
    if (!isRecord(item)) throw new TargetsError("invalid_request", path);
    const categoryId = item.categoryId ?? null;
    if (categoryId !== null && !isUuid(categoryId)) throw new TargetsError("invalid_request", `${path}.categoryId`);
    if (typeof item.label !== "string") throw new TargetsError("label_invalid", `${path}.label`);
    const label = item.label.trim();
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) throw new TargetsError("label_invalid", `${path}.label`);
    const position = item.position ?? null;
    if (position !== null && (!Number.isSafeInteger(position) || (position as number) < 0)) throw new TargetsError("position_invalid", `${path}.position`);
    const archived = item.archived ?? false;
    if (typeof archived !== "boolean") throw new TargetsError("invalid_request", `${path}.archived`);
    return { categoryId, label, position: position as number | null, archived };
  });
}

export function listCategories(deps: TargetsDependencies, budgetSpaceId: string): Promise<readonly CategoryRecord[]> {
  return deps.repository.listCategories(budgetSpaceId).then((records) => [...records].sort(byPositionThenId));
}

/**
 * Create or update the listed categories by stable identity (INV-84). A
 * missing `categoryId` creates; a present one must name a category of this
 * budget. Relabelling and reordering change only label/position, so every
 * target attached to the identity stays attached (CBD-153-AC03). Categories
 * not listed are left as they are; archival is explicit (`archived: true`).
 */
export async function upsertCategories(deps: TargetsDependencies, budgetSpaceId: string, items: readonly CategoryUpsertItem[]): Promise<readonly CategoryRecord[]> {
  const existing = new Map((await deps.repository.listCategories(budgetSpaceId)).map((c) => [c.categoryId, c] as const));
  const seen = new Set<string>();
  const liveLabels = new Map<string, string>();
  for (const category of existing.values()) if (category.archivedAt === null) liveLabels.set(category.label.toLowerCase(), category.categoryId);
  let nextPosition = Math.max(-1, ...[...existing.values()].map((c) => c.position)) + 1;
  const now = deps.clock.now();
  for (const [index, item] of items.entries()) {
    const path = `categories[${index}]`;
    const categoryId = item.categoryId ?? deps.ids.uuid();
    if (seen.has(categoryId)) throw new TargetsError("duplicate_category", `${path}.categoryId`);
    seen.add(categoryId);
    const current = existing.get(categoryId);
    if (item.categoryId !== null && !current) throw new TargetsError("category_not_found", `${path}.categoryId`);
    const archivedAt = item.archived ? (current?.archivedAt ?? now) : null;
    const labelOwner = liveLabels.get(item.label.toLowerCase());
    if (archivedAt === null && labelOwner !== undefined && labelOwner !== categoryId) throw new TargetsError("label_taken", `${path}.label`);
    if (current?.archivedAt === null) liveLabels.delete(current.label.toLowerCase());
    if (archivedAt === null) liveLabels.set(item.label.toLowerCase(), categoryId);
    const position = item.position ?? current?.position ?? nextPosition++;
    const record: CategoryRecord = current
      ? { ...current, label: item.label, position, archivedAt, updatedAt: now }
      : { categoryId, budgetSpaceId, label: item.label, position, archivedAt, createdAt: now, updatedAt: now };
    if (current) {
      if (!await deps.repository.updateCategory(record)) throw new TargetsError("category_not_found", `${path}.categoryId`);
    } else {
      await deps.repository.insertCategory(record);
    }
    existing.set(categoryId, record);
  }
  return [...existing.values()].sort(byPositionThenId);
}

// ---------------------------------------------------------------------------
// Base targets
// ---------------------------------------------------------------------------

export interface BaseTargetItem {
  readonly categoryId: string;
  readonly amountMinorUnits: number;
}

/** Parse `{ targets: [{ categoryId, amountMinorUnits }] }` (AC04: a non-integer is `amount_invalid`, a negative one `amount_negative`). */
export function parseBaseTargetRequest(body: unknown): readonly BaseTargetItem[] {
  if (!isRecord(body) || !Array.isArray(body.targets)) throw new TargetsError("invalid_request", "targets");
  if (body.targets.length > MAX_CATEGORIES_PER_REQUEST) throw new TargetsError("invalid_request", "targets");
  return body.targets.map((item, index): BaseTargetItem => {
    const path = `targets[${index}]`;
    if (!isRecord(item) || !isUuid(item.categoryId)) throw new TargetsError("invalid_request", `${path}.categoryId`);
    const amount = item.amountMinorUnits;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount)) throw new TargetsError("amount_invalid", `${path}.amountMinorUnits`);
    if (amount < 0) throw new TargetsError("amount_negative", `${path}.amountMinorUnits`);
    return { categoryId: item.categoryId, amountMinorUnits: amount };
  });
}

export interface BaseTargetSetResult {
  readonly budgetSpaceId: string;
  readonly cadence: Cadence;
  readonly currencyCode: string;
  readonly minorUnitPrecision: number;
  readonly targets: readonly BaseTargetRecord[];
}

function currentBaseTargets(records: readonly BaseTargetRecord[]): Map<string, BaseTargetRecord> {
  const current = new Map<string, BaseTargetRecord>();
  for (const record of records) if (record.supersededAt === null) current.set(record.categoryId, record);
  return current;
}

/**
 * Set standing targets for the budget's current cadence context (INV-78: the
 * context is the schedule version's cadence, never a request field) in the
 * budget's currency (never a request field either). An unchanged amount is
 * left alone; a changed one supersedes the current row and inserts a new one,
 * so history is preserved and every period target's provenance keeps pointing
 * at the row it was computed from.
 */
export async function setBaseTargets(deps: TargetsDependencies, budgetSpaceId: string, actorSubjectId: string, items: readonly BaseTargetItem[]): Promise<BaseTargetSetResult> {
  const context = await deps.repository.readPlanContext(budgetSpaceId, null);
  if (!context) throw new TargetsError("budget_space_not_found");
  const precision = resolveMinorUnitPrecision(precisionReader(deps), context.currencyCode);
  const categories = new Map((await deps.repository.listCategories(budgetSpaceId)).map((c) => [c.categoryId, c] as const));
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const path = `targets[${index}]`;
    const category = categories.get(item.categoryId);
    if (!category) throw new TargetsError("category_not_found", `${path}.categoryId`);
    if (category.archivedAt !== null) throw new TargetsError("category_archived", `${path}.categoryId`);
    if (seen.has(item.categoryId)) throw new TargetsError("duplicate_category", `${path}.categoryId`);
    seen.add(item.categoryId);
  }
  const current = currentBaseTargets(await deps.repository.listBaseTargets(budgetSpaceId, context.cadence));
  const now = deps.clock.now();
  for (const item of items) {
    const existing = current.get(item.categoryId);
    if (existing && existing.amountMinorUnits === item.amountMinorUnits && existing.currencyCode === context.currencyCode) continue;
    if (existing) {
      if (!await deps.repository.supersedeBaseTarget(budgetSpaceId, existing.baseTargetId, now)) throw new TargetsError("conflict", "baseTargetId");
    }
    const record: BaseTargetRecord = {
      baseTargetId: deps.ids.uuid(), budgetSpaceId, categoryId: item.categoryId, cadence: context.cadence, currencyCode: context.currencyCode,
      minorUnitPrecision: precision, amountMinorUnits: item.amountMinorUnits, setBySubjectId: actorSubjectId, source: "user", createdAt: now, supersededAt: null,
    };
    await deps.repository.insertBaseTarget(record);
    current.set(item.categoryId, record);
  }
  return { budgetSpaceId, cadence: context.cadence, currencyCode: context.currencyCode, minorUnitPrecision: precision, targets: [...current.values()].sort((a, b) => compareIds(a.categoryId, b.categoryId)) };
}

// ---------------------------------------------------------------------------
// The plan for one period
// ---------------------------------------------------------------------------

export interface PeriodComputation {
  readonly baseTargets: BaseTargetSet;
  readonly scheduleCadence: Cadence;
  readonly period: { readonly start: string; readonly end: string };
  /** The complete new-schedule natural period containing a transition (INV-35); null for a full period. */
  readonly basis: { readonly start: string; readonly end: string } | null;
}

/** The one seam to budget-domain's target engine: a full period or a prorated transition, never a reimplementation. */
export function computePeriodTargets(computation: PeriodComputation): readonly PeriodTarget[] {
  const period = { start: toISODate(computation.period.start), end: toISODate(computation.period.end) };
  if (computation.basis === null) return fullPeriodTargets(computation.baseTargets, computation.scheduleCadence, period);
  const basis = { start: toISODate(computation.basis.start), end: toISODate(computation.basis.end) };
  return prorateTransitionTargets(computation.baseTargets, computation.scheduleCadence, period, basis);
}

/** The calendar date at `instant` in `timeZone`, as YYYY-MM-DD; the budget-space date INV-55 speaks of. */
export function budgetSpaceDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface PlanCategory {
  readonly categoryId: string;
  readonly label: string;
  readonly position: number;
  readonly baseTarget: { readonly baseTargetId: string; readonly amountMinorUnits: number; readonly setBySubjectId: string; readonly source: string; readonly createdAt: string } | null;
  readonly periodTarget: {
    readonly periodTargetId: string | null;
    readonly amountMinorUnits: number;
    readonly origin: TargetOrigin;
    readonly calculation: ProrationRecord | null;
    readonly provenance: {
      readonly formulaVersion: string;
      readonly inputs: PeriodTargetInputs;
      readonly computedAt: string | null;
      readonly computedBySubjectId: string | null;
      readonly source: string | null;
      /** false only for a completed period that never had this category's target stored; nothing is written then. */
      readonly persisted: boolean;
    };
  };
}

export interface Plan {
  readonly budgetSpaceId: string;
  readonly period: { readonly periodId: string; readonly start: string; readonly end: string; readonly status: string; readonly completed: boolean };
  readonly cadence: Cadence;
  readonly currencyCode: string;
  readonly minorUnitPrecision: number;
  readonly formulaVersion: string;
  readonly categories: readonly PlanCategory[];
}

function sameStoredTarget(stored: PeriodTargetRecord, fresh: PeriodTargetRecord): boolean {
  return stored.amountMinorUnits === fresh.amountMinorUnits && stored.origin === fresh.origin && stored.formulaVersion === fresh.formulaVersion
    && stored.currencyCode === fresh.currencyCode && stored.minorUnitPrecision === fresh.minorUnitPrecision
    && stored.periodStart === fresh.periodStart && stored.periodEnd === fresh.periodEnd
    && JSON.stringify(stored.inputs) === JSON.stringify(fresh.inputs) && JSON.stringify(stored.calculation) === JSON.stringify(fresh.calculation);
}

function planCategory(category: CategoryRecord, base: BaseTargetRecord | undefined, target: PeriodTargetRecord, persisted: boolean): PlanCategory {
  return {
    categoryId: category.categoryId, label: category.label, position: category.position,
    baseTarget: base ? { baseTargetId: base.baseTargetId, amountMinorUnits: base.amountMinorUnits, setBySubjectId: base.setBySubjectId, source: base.source, createdAt: base.createdAt } : null,
    periodTarget: {
      periodTargetId: persisted ? target.periodTargetId : null, amountMinorUnits: target.amountMinorUnits, origin: target.origin, calculation: target.calculation,
      provenance: {
        formulaVersion: target.formulaVersion, inputs: target.inputs,
        computedAt: persisted ? target.computedAt : null, computedBySubjectId: persisted ? target.computedBySubjectId : null, source: persisted ? target.source : null, persisted,
      },
    },
  };
}

/**
 * Assemble the plan for one period (`periodId` null = the current period).
 *
 * Every live category is in the set, contributing zero when it has no base
 * target (INV-54 "all current zero-or-positive base targets"). The engine
 * runs over the stored base targets and the stored period; for an open
 * period the result is persisted as a new version -- the current rows are
 * superseded, never removed, and only when the result differs from what is
 * stored, so a plain read is idempotent -- and for a completed period the
 * stored rows are returned untouched (INV-79) and any category that never had
 * one is reported computed-but-not-persisted rather than written into
 * history now.
 */
export async function readPlan(deps: TargetsDependencies, budgetSpaceId: string, periodId: string | null, actorSubjectId: string): Promise<Plan> {
  const context = await deps.repository.readPlanContext(budgetSpaceId, periodId);
  if (!context) throw new TargetsError(periodId === null ? "budget_space_not_found" : "period_not_found");
  const precision = resolveMinorUnitPrecision(precisionReader(deps), context.currencyCode);
  const categories = (await deps.repository.listCategories(budgetSpaceId)).filter((c) => c.archivedAt === null).sort(byPositionThenId);
  const base = currentBaseTargets(await deps.repository.listBaseTargets(budgetSpaceId, context.cadence));
  const now = deps.clock.now();
  const completed = context.periodEnd < budgetSpaceDate(now, context.timeZone);
  const period = { periodId: context.periodId, start: context.periodStart, end: context.periodEnd, status: context.periodStatus, completed };
  const plan = { budgetSpaceId, period, cadence: context.cadence, currencyCode: context.currencyCode, minorUnitPrecision: precision, formulaVersion: TARGET_FORMULA_VERSION };
  if (categories.length === 0) return { ...plan, categories: [] };

  const computed = computePeriodTargets({
    baseTargets: { cadence: context.cadence, currency: context.currencyCode, targets: categories.map((c) => ({ categoryId: c.categoryId, amountMinorUnits: base.get(c.categoryId)?.amountMinorUnits ?? 0 })) },
    scheduleCadence: context.cadence, period: { start: context.periodStart, end: context.periodEnd }, basis: null,
  });
  const fresh = new Map(computed.map((target): [string, PeriodTargetRecord] => [target.categoryId, {
    periodTargetId: deps.ids.uuid(), budgetSpaceId, categoryId: target.categoryId, periodId: context.periodId,
    periodStart: context.periodStart, periodEnd: context.periodEnd, origin: target.origin, currencyCode: target.currency, minorUnitPrecision: precision,
    amountMinorUnits: target.amountMinorUnits, formulaVersion: TARGET_FORMULA_VERSION,
    inputs: {
      baseTargetId: base.get(target.categoryId)?.baseTargetId ?? null, baseAmountMinorUnits: base.get(target.categoryId)?.amountMinorUnits ?? 0,
      cadence: context.cadence, scheduleVersionId: context.scheduleVersionId, period: { start: context.periodStart, end: context.periodEnd }, basis: null,
    },
    calculation: target.calculation, computedBySubjectId: actorSubjectId, source: "user", computedAt: now, supersededAt: null,
  }]));
  const stored = new Map((await deps.repository.listPeriodTargets(budgetSpaceId, context.periodId)).filter((t) => t.supersededAt === null).map((t) => [t.categoryId, t] as const));

  if (completed) {
    return { ...plan, categories: categories.map((c) => {
      const row = stored.get(c.categoryId);
      return row ? planCategory(c, base.get(c.categoryId), row, true) : planCategory(c, base.get(c.categoryId), fresh.get(c.categoryId)!, false);
    }) };
  }
  const unchanged = stored.size === fresh.size && [...fresh].every(([categoryId, record]) => { const row = stored.get(categoryId); return row !== undefined && sameStoredTarget(row, record); });
  const effective = unchanged ? stored : fresh;
  if (!unchanged) await deps.repository.supersedePeriodTargets(budgetSpaceId, context.periodId, now, [...fresh.values()]);
  return { ...plan, categories: categories.map((c) => planCategory(c, base.get(c.categoryId), effective.get(c.categoryId)!, true)) };
}
