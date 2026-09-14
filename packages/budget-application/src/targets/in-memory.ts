/**
 * In-memory `TargetsRepository` for unit and route tests.
 *
 * It mirrors the migration's constraints closely enough that the commands'
 * error mapping is exercised without a database: negative amounts and
 * unsupported precisions are refused as `constraint_violation` (AC04), a
 * completed period's rows refuse supersession with
 * `completed_period_immutable` (AC02), prior versions are retained rather
 * than deleted, the one-current-per-category rule
 * holds (23505 -> `conflict`), and every read and write is keyed on the
 * budget space first, so a record of one space is unreachable through
 * another space's identifier (PROTO-PLAN-02). "Completed" is decided against
 * `today`, the in-memory stand-in for the trigger's `current_date`.
 */
import type { TargetsRepository } from "./ports.ts";
import { SUPPORTED_MINOR_UNIT_PRECISIONS, TargetsError } from "./records.ts";
import type { BaseTargetRecord, CategoryRecord, PeriodTargetRecord, PlanContext } from "./records.ts";

function key(budgetSpaceId: string, id: string): string {
  return `${budgetSpaceId}|${id}`;
}

function assertMonetary(record: { amountMinorUnits: number; minorUnitPrecision: number }): void {
  if (!Number.isSafeInteger(record.amountMinorUnits) || record.amountMinorUnits < 0) throw new TargetsError("constraint_violation", "amount_minor_units");
  if (!SUPPORTED_MINOR_UNIT_PRECISIONS.includes(record.minorUnitPrecision)) throw new TargetsError("constraint_violation", "minor_unit_precision");
}

export class InMemoryTargetsRepository implements TargetsRepository {
  readonly #today: () => string;
  readonly categories = new Map<string, CategoryRecord>();
  readonly baseTargets = new Map<string, BaseTargetRecord>();
  readonly periodTargets = new Map<string, PeriodTargetRecord>();
  readonly contexts = new Map<string, PlanContext>();

  /** `today` returns the calendar date (YYYY-MM-DD) the immutability rule compares period ends with. */
  constructor(today: () => string) {
    this.#today = today;
  }

  /** Register a budget space's period so the plan can be read for it. */
  seedPlanContext(context: PlanContext): void {
    this.contexts.set(key(context.budgetSpaceId, context.periodId), structuredClone(context));
  }

  async listCategories(budgetSpaceId: string): Promise<readonly CategoryRecord[]> {
    return [...this.categories.values()].filter((c) => c.budgetSpaceId === budgetSpaceId).map((c) => structuredClone(c));
  }

  async insertCategory(record: CategoryRecord): Promise<void> {
    const k = key(record.budgetSpaceId, record.categoryId);
    if (this.categories.has(k)) throw new TargetsError("conflict");
    this.#assertLabelFree(record);
    this.categories.set(k, structuredClone(record));
  }

  async updateCategory(record: CategoryRecord): Promise<boolean> {
    const k = key(record.budgetSpaceId, record.categoryId);
    const existing = this.categories.get(k);
    if (!existing) return false;
    this.#assertLabelFree(record);
    this.categories.set(k, { ...existing, label: record.label, position: record.position, archivedAt: record.archivedAt, updatedAt: record.updatedAt });
    return true;
  }

  #assertLabelFree(record: CategoryRecord): void {
    if (record.archivedAt !== null) return;
    for (const other of this.categories.values()) {
      if (other.budgetSpaceId === record.budgetSpaceId && other.categoryId !== record.categoryId && other.archivedAt === null && other.label.toLowerCase() === record.label.toLowerCase()) {
        throw new TargetsError("conflict", "label");
      }
    }
  }

  async listBaseTargets(budgetSpaceId: string, cadence: string): Promise<readonly BaseTargetRecord[]> {
    return [...this.baseTargets.values()].filter((t) => t.budgetSpaceId === budgetSpaceId && t.cadence === cadence).map((t) => structuredClone(t));
  }

  async insertBaseTarget(record: BaseTargetRecord): Promise<void> {
    assertMonetary(record);
    if (!this.categories.has(key(record.budgetSpaceId, record.categoryId))) throw new TargetsError("constraint_violation", "category_id");
    for (const other of this.baseTargets.values()) {
      if (other.budgetSpaceId === record.budgetSpaceId && other.categoryId === record.categoryId && other.cadence === record.cadence && other.supersededAt === null) {
        throw new TargetsError("conflict", "one_current");
      }
    }
    this.baseTargets.set(key(record.budgetSpaceId, record.baseTargetId), structuredClone({ ...record, supersededAt: null }));
  }

  async supersedeBaseTarget(budgetSpaceId: string, baseTargetId: string, supersededAt: string): Promise<boolean> {
    const k = key(budgetSpaceId, baseTargetId);
    const existing = this.baseTargets.get(k);
    if (!existing) return false;
    if (existing.supersededAt !== null) throw new TargetsError("completed_period_immutable", "superseded");
    this.baseTargets.set(k, { ...existing, supersededAt });
    return true;
  }

  async readPlanContext(budgetSpaceId: string, periodId: string | null): Promise<PlanContext | null> {
    if (periodId !== null) return structuredClone(this.contexts.get(key(budgetSpaceId, periodId)) ?? null);
    for (const context of this.contexts.values()) {
      if (context.budgetSpaceId === budgetSpaceId && context.periodId === context.currentPeriodId) return structuredClone(context);
    }
    return null;
  }

  async listPeriodTargets(budgetSpaceId: string, periodId: string): Promise<readonly PeriodTargetRecord[]> {
    return [...this.periodTargets.values()].filter((t) => t.budgetSpaceId === budgetSpaceId && t.periodId === periodId).map((t) => structuredClone(t));
  }

  async supersedePeriodTargets(budgetSpaceId: string, periodId: string, supersededAt: string, records: readonly PeriodTargetRecord[]): Promise<void> {
    const today = this.#today();
    for (const [k, existing] of this.periodTargets) {
      if (existing.budgetSpaceId !== budgetSpaceId || existing.periodId !== periodId || existing.supersededAt !== null) continue;
      if (existing.periodEnd < today) throw new TargetsError("completed_period_immutable");
      this.periodTargets.set(k, { ...existing, supersededAt });
    }
    for (const record of records) {
      assertMonetary(record);
      if (record.budgetSpaceId !== budgetSpaceId || record.periodId !== periodId || record.supersededAt !== null) throw new TargetsError("invalid_request", "periodTargets");
      const context = this.contexts.get(key(budgetSpaceId, periodId));
      if (!context || context.periodStart !== record.periodStart || context.periodEnd !== record.periodEnd) throw new TargetsError("constraint_violation", "period_id");
      if (!this.categories.has(key(budgetSpaceId, record.categoryId))) throw new TargetsError("constraint_violation", "category_id");
      if ((record.origin === "full-period") !== (record.calculation === null)) throw new TargetsError("constraint_violation", "origin");
      this.periodTargets.set(key(budgetSpaceId, record.periodTargetId), structuredClone(record));
    }
  }
}
