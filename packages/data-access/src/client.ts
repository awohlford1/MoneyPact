/**
 * The application-facing client (CBD246-SECURITY-001 findings 1 and 2;
 * CBD246-REVIEW-001's matching AC02/AC03 findings).
 *
 * `apps/api` and `apps/worker` never receive a `Pool` -- raw or otherwise.
 * A caller holding a `Pool` can call `.query()` directly and bypass every
 * guarantee this package makes, no matter how safe the typed statement
 * builders in `tenant.ts` are. `createApiClient`/`createWorkerClient`
 * construct a role-specific pool internally (see `connection.ts`) and
 * return only closed client surfaces already bound to that pool. The API's
 * `DataAccessClient` also exposes subject-scoped profile operations; the
 * worker's `WorkerDataAccessClient` deliberately does not. Neither surface
 * has a member that reaches the underlying `Pool`.
 */
import { bindClient } from "./binding.ts";
import { createApiConnection, createWorkerConnection } from "./connection.ts";
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
import type { ProfileDeleteQuery, ProfileInsertQuery, ProfileSelectQuery, ProfileUpdateQuery } from "./profile.ts";

export interface TransactionOptions {
  readonly isolation?: "serializable" | "read committed";
}

export interface DataAccessClient {
  readonly readOwnBudgetMemberships?: (subject: string) => Promise<QueryResult>;
  readonly transaction: <T>(options: TransactionOptions, work: (scoped: DataAccessClient) => Promise<T>) => Promise<T>;
  readonly tenantSelect: (query: TenantSelectQuery) => Promise<QueryResult>;
  readonly tenantInsert: (query: TenantInsertQuery) => Promise<QueryResult>;
  readonly tenantUpdate: (query: TenantUpdateQuery) => Promise<QueryResult>;
  readonly tenantDelete: (query: TenantDeleteQuery) => Promise<QueryResult>;
  readonly platformSelect: (query: PlatformSelectQuery) => Promise<QueryResult>;
  readonly platformInsert: (query: PlatformInsertQuery) => Promise<QueryResult>;
  readonly platformUpdate: (query: PlatformUpdateQuery) => Promise<QueryResult>;
  readonly platformDelete: (query: PlatformDeleteQuery) => Promise<QueryResult>;
  readonly profileSelect?: (query: ProfileSelectQuery) => Promise<QueryResult>;
  readonly profileInsert?: (query: ProfileInsertQuery) => Promise<QueryResult>;
  readonly profileUpdate?: (query: ProfileUpdateQuery) => Promise<QueryResult>;
  readonly profileDelete?: (query: ProfileDeleteQuery) => Promise<QueryResult>;
}

/** API client surface, with all subject-scoped financial-profile operations required. */
export interface ApiDataAccessClient extends DataAccessClient {
  readonly profileSelect: (query: ProfileSelectQuery) => Promise<QueryResult>;
  readonly profileInsert: (query: ProfileInsertQuery) => Promise<QueryResult>;
  readonly profileUpdate: (query: ProfileUpdateQuery) => Promise<QueryResult>;
  readonly profileDelete: (query: ProfileDeleteQuery) => Promise<QueryResult>;
}

/** Worker client surface: the common statement operations with every profile member absent. */
export type WorkerDataAccessClient = Omit<DataAccessClient, "profileSelect" | "profileInsert" | "profileUpdate" | "profileDelete">;

/** The API application's data-access client. Backed by the api role's pool only -- never worker's, never migration's. */
export function createApiClient(): ApiDataAccessClient {
  return bindClient(createApiConnection(), true) as ApiDataAccessClient;
}

/** The worker application's data-access client. Backed by the worker role's pool only -- never api's, never migration's. */
export function createWorkerClient(): WorkerDataAccessClient {
  return bindClient(createWorkerConnection(), false);
}
