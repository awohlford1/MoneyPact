/**
 * @cobudget/migrations
 *
 * Forward-only PostgreSQL migrations: the .sql files that own the schema, the
 * applied-state ledger that records what has run, and the check that holds
 * both to the approved schema conventions.
 *
 * This package deliberately exports no query interface. The typed SQL layer
 * (CBD-246) reads the schema these migrations define; it does not define it,
 * and nothing here should ever grow a model that does.
 */

export { readCatalog, checksumOf } from "./catalog.ts";
export type { Catalog, MigrationFile } from "./catalog.ts";
export { apply, check, create, reset, status, usage, commandNames, commandSummaries } from "./commands.ts";
export type { Deps, Io } from "./commands.ts";
export { psqlExecutor } from "./executor.ts";
export type { Executor, ExecutionResult } from "./executor.ts";
export { buildFileName, compareNames, formatOrdinal, isValidOrdinal, parseName, toSlug } from "./naming.ts";
export type { MigrationName } from "./naming.ts";
export { applyScript, parseAppliedRows, planApply, quoteLiteral, readAppliedScript } from "./plan.ts";
export type { AppliedRow, Drift, Plan } from "./plan.ts";
export { loadPolicy, parsePolicy, policyPath, repositoryRoot } from "./policy.ts";
export type { Policy } from "./policy.ts";
