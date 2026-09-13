import {
  loadConfig,
  loadConfigFromEnvironment,
} from "../../contracts/src/config/index.ts";
import type { ConfigOf, ConfigSchema } from "../../contracts/src/config/index.ts";

export const localDatabaseConfigSchema = {
  COBUDGET_DB_PORT: {
    kind: "integer",
    required: false,
    description: "Loopback host port for the local PostgreSQL container.",
    min: 1,
    max: 65_535,
  },
  COBUDGET_DB_NAME: {
    kind: "string",
    required: false,
    description: "Database created by the local PostgreSQL container.",
  },
  COBUDGET_DB_SUPERUSER: {
    kind: "string",
    required: false,
    description: "Bootstrap superuser for the loopback-only local PostgreSQL container.",
  },
  COBUDGET_DB_SUPERUSER_PASSWORD: {
    kind: "string",
    required: false,
    description: "Non-secret bootstrap password for the loopback-only local PostgreSQL container.",
  },
  COBUDGET_DB_MIGRATION_PASSWORD: {
    kind: "string",
    required: false,
    description: "Non-secret local password for the migration role.",
  },
  COBUDGET_DB_API_PASSWORD: {
    kind: "string",
    required: false,
    description: "Non-secret local password for the API role.",
  },
  COBUDGET_DB_WORKER_PASSWORD: {
    kind: "string",
    required: false,
    description: "Non-secret local password for the worker role.",
  },
} as const satisfies ConfigSchema;

type LoadedLocalDatabaseConfig = ConfigOf<typeof localDatabaseConfigSchema>;

export type LocalDatabaseConfig = {
  readonly port: number;
  readonly database: string;
  readonly superuser: string;
  readonly superuserPassword: string;
  readonly migrationPassword: string;
  readonly apiPassword: string;
  readonly workerPassword: string;
};

export const localDatabaseDefaults: LocalDatabaseConfig = {
  port: 5432,
  database: "cobudget_dev",
  superuser: "postgres",
  superuserPassword: "local-only-superuser",
  migrationPassword: "local-only-migration",
  apiPassword: "local-only-api",
  workerPassword: "local-only-worker",
};

function resolveLocalDatabaseConfig(config: LoadedLocalDatabaseConfig): LocalDatabaseConfig {
  return {
    port: config.COBUDGET_DB_PORT ?? localDatabaseDefaults.port,
    database: config.COBUDGET_DB_NAME ?? localDatabaseDefaults.database,
    superuser: config.COBUDGET_DB_SUPERUSER ?? localDatabaseDefaults.superuser,
    superuserPassword:
      config.COBUDGET_DB_SUPERUSER_PASSWORD ?? localDatabaseDefaults.superuserPassword,
    migrationPassword:
      config.COBUDGET_DB_MIGRATION_PASSWORD ?? localDatabaseDefaults.migrationPassword,
    apiPassword:
      config.COBUDGET_DB_API_PASSWORD ?? localDatabaseDefaults.apiPassword,
    workerPassword:
      config.COBUDGET_DB_WORKER_PASSWORD ?? localDatabaseDefaults.workerPassword,
  };
}

export function loadLocalDatabaseConfig(): LocalDatabaseConfig {
  return resolveLocalDatabaseConfig(loadConfigFromEnvironment(localDatabaseConfigSchema));
}

/** Pure seam for unit tests; production commands use the shared environment loader above. */
export function loadLocalDatabaseConfigFrom(
  environment: Readonly<Record<string, string | undefined>>,
): LocalDatabaseConfig {
  return resolveLocalDatabaseConfig(loadConfig(localDatabaseConfigSchema, environment));
}
