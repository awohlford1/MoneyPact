export type {
  BaseTargetRecord,
  CategoryRecord,
  CurrencyPrecisionReader,
  PeriodTargetInputs,
  PeriodTargetRecord,
  PlanContext,
  TargetSource,
  TargetsErrorCode,
} from "./records.ts";
export {
  ISO4217_MINOR_UNITS,
  SUPPORTED_MINOR_UNIT_PRECISIONS,
  TARGET_FORMULA_VERSION,
  TARGET_SOURCES,
  TARGETS_ERROR_CODES,
  TargetsError,
  iso4217PrecisionReader,
  resolveMinorUnitPrecision,
} from "./records.ts";

export type {
  BudgetCategoryBaseTargetRow,
  BudgetCategoryPeriodTargetRow,
  BudgetCategoryRow,
  Clock,
  IdGenerator,
  PlanContextRow,
  TargetsRepository,
  TargetsStatements,
} from "./ports.ts";

export type {
  BaseTargetItem,
  BaseTargetSetResult,
  CategoryUpsertItem,
  PeriodComputation,
  Plan,
  PlanCategory,
  TargetsDependencies,
} from "./application.ts";
export {
  MAX_CATEGORIES_PER_REQUEST,
  MAX_LABEL_LENGTH,
  budgetSpaceDate,
  computePeriodTargets,
  listCategories,
  parseBaseTargetRequest,
  parseCategoryUpsertRequest,
  readPlan,
  setBaseTargets,
  upsertCategories,
} from "./application.ts";

export { InMemoryTargetsRepository } from "./in-memory.ts";
export {
  COMPLETED_PERIOD_TARGET_SQLSTATE,
  dataAccessTargetsRepository,
  translateStatementFailure,
} from "./data-access-adapter.ts";
