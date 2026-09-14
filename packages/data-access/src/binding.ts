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
import { wrapDriverError } from "./logging.ts";
import { readOwnBudgetMemberships } from "./budget-memberships.ts";
import { PRODUCTION_TABLE_CATALOG } from "./catalog.ts";
import type { TableCatalog } from "./catalog.ts";
import type { Pool } from "./driver.ts";

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
import { profileDelete, profileInsert, profileSelect, profileUpdate } from "./profile.ts";
import type { ProfileDeleteQuery, ProfileInsertQuery, ProfileSelectQuery, ProfileUpdateQuery } from "./profile.ts";

import type { ApiDataAccessClient } from "./client.ts";
import type { DataAccessClient } from "./client.ts";
import type { WorkerDataAccessClient } from "./client.ts";

function bindWorkerClient(pool: Pick<Pool, "query">, transaction: DataAccessClient["transaction"], catalog: TableCatalog): WorkerDataAccessClient {
  return {
    transaction,
    tenantSelect: (query) => tenantSelect(pool, query, catalog),
    tenantInsert: (query) => tenantInsert(pool, query, catalog),
    tenantUpdate: (query) => tenantUpdate(pool, query, catalog),
    tenantDelete: (query) => tenantDelete(pool, query, catalog),
    platformSelect: (query) => platformSelect(pool, query, catalog),
    platformInsert: (query) => platformInsert(pool, query, catalog),
    platformUpdate: (query) => platformUpdate(pool, query, catalog),
    platformDelete: (query) => platformDelete(pool, query, catalog),
  };
}

function bindApiClient(pool: Pick<Pool, "query">, transaction: DataAccessClient["transaction"], catalog: TableCatalog): ApiDataAccessClient {
  const client = bindWorkerClient(pool, transaction, catalog);
  return Object.defineProperties(client, {
    readOwnBudgetMemberships: { value: (subject: string) => readOwnBudgetMemberships(pool, subject) },
    profileSelect: { value: (query: ProfileSelectQuery) => profileSelect(pool, query, catalog) },
    profileInsert: { value: (query: ProfileInsertQuery) => profileInsert(pool, query, catalog) },
    profileUpdate: { value: (query: ProfileUpdateQuery) => profileUpdate(pool, query, catalog) },
    profileDelete: { value: (query: ProfileDeleteQuery) => profileDelete(pool, query, catalog) },
  }) as ApiDataAccessClient;
}

/** Internal factory for package tests; never exported from the public entrypoint. */
export function bindClient(pool: Pool, profiles: boolean, catalog: TableCatalog = PRODUCTION_TABLE_CATALOG): DataAccessClient {
  const bind = profiles ? bindApiClient : bindWorkerClient;
  const transaction: DataAccessClient["transaction"] = async (options, work) => {
    const isolation = options.isolation ?? "serializable";
    if (isolation !== "serializable" && isolation !== "read committed") throw new RangeError("invalid transaction isolation");
    const connection = await pool.connect().catch((error: unknown) => { throw wrapDriverError("transaction", "connect", error); });
    let active = true;
    let destroyed = false;
    let statementFailure: ReturnType<typeof wrapDriverError> | undefined;
    const queryable = { query: ((text: string, values?: unknown[]) => {
      if (!active) throw new Error("transaction scope is closed");
      return connection.query(text, values).catch((error: unknown) => {
        statementFailure = wrapDriverError("transaction", "statement", error);
        throw error;
      });
    }) as Pool["query"] };
    const scoped = bind(queryable, async () => { throw new Error("nested transactions are refused"); }, catalog);
    let phase = "begin";
    try {
      await connection.query("BEGIN ISOLATION LEVEL " + isolation.toUpperCase());
      phase = "work";
      const result = await work(scoped);
      if (statementFailure) throw statementFailure;
      active = false;
      phase = "commit";
      const committed = await connection.query("COMMIT");
      if (committed.command === "ROLLBACK") throw new Error("transaction was aborted");
      return result;
    } catch (error) {
      active = false;
      try { await connection.query("ROLLBACK"); } catch { destroyed = true; }
      if (phase === "work") throw error;
      throw wrapDriverError("transaction", phase, error);
    } finally {
      active = false;
      connection.release(destroyed);
    }
  };
  return bind(pool, transaction, catalog);
}
