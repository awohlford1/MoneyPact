/**
 * Role-separated connections (CBD-246-AC03).
 *
 * The api, worker, and migration roles are DP-105-003's contract: the names
 * come from `@cobudget/migrations`, which owns the local database and the
 * grants migration that gives each role its privileges. This module does not
 * invent a fourth way to name them; it borrows the same constants so a typo
 * cannot silently open a fourth role.
 *
 * Configuration is "through the environment contract" (CBD-246-AC03) by
 * reuse rather than by a second reader: `loadLocalDatabaseConfig` in
 * `packages/migrations/src/local-config.ts` is the one file registered with
 * `scripts/check-environment.mjs` to call `loadConfigFromEnvironment`, and it
 * already validates `COBUDGET_DB_PORT`, `COBUDGET_DB_NAME`, and each role's
 * password. This module never reads `process.env` itself -- see the README
 * "Environment wiring" section for the follow-up this implies once an
 * application config module is free to change.
 *
 * `host` is not a variable: CBD-117 pins the local database to loopback only,
 * so 127.0.0.1 is the only address that is ever correct here. A hosted
 * connection is a different decision (CBD-119) and is out of this
 * subtask's scope.
 *
 * CBD246-SECURITY-001 finding 2 and CBD246-REVIEW-001's matching AC03
 * finding: `createLocalConnections`/`DataAccessConnections` hand out all
 * three pools, including `migration`, together. Both application adapters
 * returned that whole object, so an API or worker process could reach the
 * schema-owning migration credential merely by calling `.migration.query`
 * on what it already held -- DP-105-003 restricts that role to the
 * deployment pipeline. `createApiConnection`/`createWorkerConnection` below
 * are role-specific single-pool factories: an application built from one of
 * them never has a `Pool` for any other role in scope to begin with, not
 * merely one it is asked not to use. `createLocalConnections` remains for
 * this package's own tests and `scripts/verify-live.ts`, which legitimately
 * need to set up and tear down scratch data across all three roles; neither
 * application imports it any more (see `src/index.ts` and
 * `client.ts`, which are what `apps/api` and `apps/worker` actually use).
 */
import type { PoolConfig } from "./driver.ts";
import { createPool } from "./driver.ts";
import type { Pool } from "./driver.ts";
import { loadLocalDatabaseConfig, roles } from "@cobudget/migrations/local";
import type { LocalDatabaseConfig, Role } from "@cobudget/migrations/local";

export type { Role };
export { roles };

export const LOOPBACK_HOST = "127.0.0.1";

const passwordFor = (config: LocalDatabaseConfig, role: Role): string => {
  switch (role) {
    case "migration":
      return config.migrationPassword;
    case "api":
      return config.apiPassword;
    case "worker":
      return config.workerPassword;
    default: {
      const unreachable: never = role;
      throw new Error(`unknown database role ${String(unreachable)}`);
    }
  }
};

/** A `PoolConfig` for `role`, built from an already-validated `LocalDatabaseConfig`. Pure. */
export function poolConfigFor(config: LocalDatabaseConfig, role: Role): PoolConfig {
  return {
    host: LOOPBACK_HOST,
    port: config.port,
    database: config.database,
    user: roles[role],
    password: passwordFor(config, role),
  };
}

export type DataAccessConnections = {
  readonly api: Pool;
  readonly worker: Pool;
  readonly migration: Pool;
};

/** A single role's pool, built from the real local environment. */
function createRoleConnection(role: Role): Pool {
  const config = loadLocalDatabaseConfig();
  return createPool(poolConfigFor(config, role));
}

/** The api role's pool, and only the api role's pool. What `apps/api` is built from. */
export function createApiConnection(): Pool {
  return createRoleConnection("api");
}

/** The worker role's pool, and only the worker role's pool. What `apps/worker` is built from. */
export function createWorkerConnection(): Pool {
  return createRoleConnection("worker");
}

/**
 * The migration role's pool. Deployment-pipeline and test/verification use
 * only (DP-105-003) -- never exported from `src/index.ts`, and never
 * reachable from either application's data-access client.
 */
export function createMigrationConnection(): Pool {
  return createRoleConnection("migration");
}

/**
 * One pool per role, built from the real local environment. Test and manual
 * verification use only (`no-per-customer-isolation.test.ts`,
 * `scripts/verify-live.ts`): it is what lets those callers set up and tear
 * down scratch data as the migration role while exercising the api/worker
 * roles' own restrictions. Neither application constructs its connections
 * this way any more (CBD-246-AC03 finding 2/finding on AC03) -- see
 * `createApiConnection`/`createWorkerConnection` and `client.ts`.
 */
export function createLocalConnections(): DataAccessConnections {
  return {
    api: createApiConnection(),
    worker: createWorkerConnection(),
    migration: createMigrationConnection(),
  };
}

/** Pure seam for unit tests: build pools from an explicit, already-validated config. */
export function createConnectionsFrom(config: LocalDatabaseConfig): DataAccessConnections {
  return {
    api: createPool(poolConfigFor(config, "api")),
    worker: createPool(poolConfigFor(config, "worker")),
    migration: createPool(poolConfigFor(config, "migration")),
  };
}
