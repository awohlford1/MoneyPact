/**
 * The application-facing client (CBD246-SECURITY-001 findings 1 and 2;
 * CBD246-REVIEW-001's matching AC02/AC03 findings).
 *
 * `apps/api` and `apps/worker` never receive a `Pool` -- raw or otherwise.
 * A caller holding a `Pool` can call `.query()` directly and bypass every
 * guarantee this package makes, no matter how safe the typed statement
 * builders in `tenant.ts` are. `createApiClient`/`createWorkerClient`
 * construct a role-specific pool internally (see `connection.ts`) and
 * return only a `DataAccessClient`: the closed set of tenant- and
 * platform-scoped operations, each already bound to that pool. There is no
 * member on this object that reaches the underlying `Pool`.
 */
import type { Pool } from "./driver.ts";
import { createApiConnection, createWorkerConnection } from "./connection.ts";
import {
  platformDelete,
  platformInsert,
  platformSelect,
  platformUpdate,
  tenantDelete,
  tenantInsert,
  tenantSelect,
  tenantUpdate,
} from "./tenant.ts";
import type {
  PlatformDeleteQuery,
  PlatformInsertQuery,
  PlatformSelectQuery,
  PlatformUpdateQuery,
  TenantDeleteQuery,
  TenantInsertQuery,
  TenantSelectQuery,
  TenantUpdateQuery,
} from "./tenant.ts";
import type { QueryResult } from "./driver.ts";

export interface DataAccessClient {
  readonly tenantSelect: (query: TenantSelectQuery) => Promise<QueryResult>;
  readonly tenantInsert: (query: TenantInsertQuery) => Promise<QueryResult>;
  readonly tenantUpdate: (query: TenantUpdateQuery) => Promise<QueryResult>;
  readonly tenantDelete: (query: TenantDeleteQuery) => Promise<QueryResult>;
  readonly platformSelect: (query: PlatformSelectQuery) => Promise<QueryResult>;
  readonly platformInsert: (query: PlatformInsertQuery) => Promise<QueryResult>;
  readonly platformUpdate: (query: PlatformUpdateQuery) => Promise<QueryResult>;
  readonly platformDelete: (query: PlatformDeleteQuery) => Promise<QueryResult>;
}

function bindClient(pool: Pool): DataAccessClient {
  return {
    tenantSelect: (query) => tenantSelect(pool, query),
    tenantInsert: (query) => tenantInsert(pool, query),
    tenantUpdate: (query) => tenantUpdate(pool, query),
    tenantDelete: (query) => tenantDelete(pool, query),
    platformSelect: (query) => platformSelect(pool, query),
    platformInsert: (query) => platformInsert(pool, query),
    platformUpdate: (query) => platformUpdate(pool, query),
    platformDelete: (query) => platformDelete(pool, query),
  };
}

/** The API application's data-access client. Backed by the api role's pool only -- never worker's, never migration's. */
export function createApiClient(): DataAccessClient {
  return bindClient(createApiConnection());
}

/** The worker application's data-access client. Backed by the worker role's pool only -- never api's, never migration's. */
export function createWorkerClient(): DataAccessClient {
  return bindClient(createWorkerConnection());
}
