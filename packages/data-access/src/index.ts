/**
 * @cobudget/data-access (CBD-246)
 *
 * The one path every application query takes: role-separated connections,
 * a tenant-scoped statement API, and S4 field encryption. See README.md.
 *
 * `Pool` (the type) is exported for advisory typing; no `Pool` *instance*,
 * and no factory that returns one, is exported from this entrypoint (CBD246
 * -SECURITY-001 findings 1 and 2). `apps/api`/`apps/worker` get a
 * `DataAccessClient` from `createApiClient`/`createWorkerClient` instead --
 * a closed set of tenant- and platform-scoped operations bound to that
 * role's pool, with no member that reaches the pool itself. Code that
 * legitimately needs a raw role pool (this package's own tests,
 * `scripts/verify-live.ts`) imports `connection.ts` directly, not this
 * entrypoint.
 */
export type { Pool, PoolClient, PoolConfig, QueryResult } from "./driver.ts";
export type { Role } from "./connection.ts";
export { createApiClient, createWorkerClient } from "./client.ts";
export type { DataAccessClient } from "./client.ts";
export type { TableCatalog, TableScope } from "./catalog.ts";
export {
  InvalidIdentifierError,
  MissingBudgetSpaceError,
  ReservedColumnError,
  UnknownPlatformTableError,
  UnknownTenantTableError,
} from "./tenant.ts";
export type {
  Condition,
  ComparisonOperator,
  PlatformDeleteQuery,
  PlatformInsertQuery,
  PlatformSelectQuery,
  PlatformUpdateQuery,
  TenantDeleteQuery,
  TenantInsertQuery,
  TenantSelectQuery,
  TenantUpdateQuery,
} from "./tenant.ts";
export { statementLogLine, StatementFailedError, wrapDriverError } from "./logging.ts";
export type { LogFields } from "./logging.ts";
