/**
 * Persistence and environment ports for the targets module (CBD-153).
 *
 * `TargetsRepository` is what the commands and the plan query talk to. Two
 * adapters implement it: `InMemoryTargetsRepository` for unit tests and
 * `dataAccessTargetsRepository`, which maps the repository onto the typed
 * statement set `@cobudget/data-access` exposes for the three CBD-153 tables.
 * That statement set is described here structurally (`TargetsStatements`) so
 * this package keeps its CBD-232 §3.1 boundary -- no database import -- while
 * the composition in apps/api supplies the real statements.
 *
 * Every write the commands make runs inside the transaction the caller
 * already holds (the authorization boundary's); the repository never opens
 * one of its own.
 */
import type { BaseTargetRecord, CategoryRecord, PeriodTargetRecord, PlanContext } from "./records.ts";

export interface Clock {
  /** The current instant as an ISO-8601 UTC string. */
  readonly now: () => string;
}

export interface IdGenerator {
  /** A fresh UUID for a category, base target or period target row. */
  readonly uuid: () => string;
}

export interface TargetsRepository {
  readonly listCategories: (budgetSpaceId: string) => Promise<readonly CategoryRecord[]>;
  readonly insertCategory: (record: CategoryRecord) => Promise<void>;
  /** Updates label, position, archivedAt and updatedAt by stable identity; false when the category is not this budget's. */
  readonly updateCategory: (record: CategoryRecord) => Promise<boolean>;
  /** Every base target row of one cadence context, current and superseded. */
  readonly listBaseTargets: (budgetSpaceId: string, cadence: string) => Promise<readonly BaseTargetRecord[]>;
  readonly insertBaseTarget: (record: BaseTargetRecord) => Promise<void>;
  /** Stamps supersededAt on one current row; false when no current row of this budget matched. */
  readonly supersedeBaseTarget: (budgetSpaceId: string, baseTargetId: string, supersededAt: string) => Promise<boolean>;
  /** The plan's context for one period, or the current period when periodId is null; null when either is not this budget's. */
  readonly readPlanContext: (budgetSpaceId: string, periodId: string | null) => Promise<PlanContext | null>;
  /** Every stored version for the period, current (supersededAt null) and superseded. */
  readonly listPeriodTargets: (budgetSpaceId: string, periodId: string) => Promise<readonly PeriodTargetRecord[]>;
  /**
   * Stamps supersededAt on the period's current rows and inserts the given set as the new current versions;
   * prior rows are retained with their identifiers and provenance. Rejects with `completed_period_immutable` for a completed period.
   */
  readonly supersedePeriodTargets: (budgetSpaceId: string, periodId: string, supersededAt: string, records: readonly PeriodTargetRecord[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// The typed statement set the data-access adapter is composed from. Field
// names are the table columns; the shapes match the row types exported by
// packages/data-access/src/budget-category*.ts structurally.
// ---------------------------------------------------------------------------

export interface BudgetCategoryRow {
  readonly category_id: string;
  readonly budget_space_id: string;
  readonly label: string;
  readonly position: number;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** PROTO-HARDENING-001 (F-INCB-03): the row's own monotonic version; the table's trigger refuses an update that does not advance it. */
  readonly version: number;
}

export interface BudgetCategoryBaseTargetRow {
  readonly base_target_id: string;
  readonly budget_space_id: string;
  readonly category_id: string;
  readonly cadence: string;
  readonly currency_code: string;
  readonly minor_unit_precision: number;
  readonly amount_minor_units: number;
  readonly set_by_subject_id: string;
  readonly source: string;
  readonly created_at: string;
  readonly superseded_at: string | null;
}

export interface BudgetCategoryPeriodTargetRow {
  readonly period_target_id: string;
  readonly budget_space_id: string;
  readonly category_id: string;
  readonly period_id: string;
  readonly period_start_date: string;
  readonly period_end_date: string;
  readonly origin: string;
  readonly currency_code: string;
  readonly minor_unit_precision: number;
  readonly amount_minor_units: number;
  readonly formula_version: string;
  readonly inputs: unknown;
  readonly calculation: unknown;
  readonly computed_by_subject_id: string;
  readonly source: string;
  readonly computed_at: string;
  readonly superseded_at: string | null;
}

export interface PlanContextRow {
  readonly budget_space_id: string;
  readonly currency_code: string;
  readonly time_zone: string;
  readonly current_period_id: string;
  readonly period_id: string;
  readonly schedule_version_id: string;
  readonly period_status: string;
  readonly period_start_date: string;
  readonly period_end_date: string;
  readonly cadence_definition: unknown;
}

export interface TargetsStatements {
  readonly listCategories: (budgetSpaceId: string) => Promise<readonly BudgetCategoryRow[]>;
  readonly insertCategory: (row: BudgetCategoryRow) => Promise<void>;
  readonly updateCategory: (budgetSpaceId: string, categoryId: string, set: Pick<BudgetCategoryRow, "label" | "position" | "archived_at" | "updated_at" | "version">) => Promise<number>;
  readonly listBaseTargets: (budgetSpaceId: string, cadence: string) => Promise<readonly BudgetCategoryBaseTargetRow[]>;
  readonly insertBaseTarget: (row: Omit<BudgetCategoryBaseTargetRow, "superseded_at">) => Promise<void>;
  readonly supersedeBaseTarget: (budgetSpaceId: string, baseTargetId: string, supersededAt: string) => Promise<number>;
  readonly listPeriodTargets: (budgetSpaceId: string, periodId: string) => Promise<readonly BudgetCategoryPeriodTargetRow[]>;
  readonly insertPeriodTarget: (row: Omit<BudgetCategoryPeriodTargetRow, "superseded_at">) => Promise<void>;
  readonly supersedePeriodTarget: (budgetSpaceId: string, periodTargetId: string, supersededAt: string) => Promise<number>;
  readonly readPlanContext: (budgetSpaceId: string, periodId: string | null) => Promise<PlanContextRow | null>;
}
