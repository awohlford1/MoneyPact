import {
  baseConfigSchema,
  ConfigError,
  loadConfig,
  loadConfigFromEnvironment,
} from "@cobudget/contracts/config";
import type { ConfigOf, ConfigSchema } from "@cobudget/contracts/config";
import {
  fieldEncryptionConfigFailures,
  fieldEncryptionConfigSchema,
  resolveFieldEncryptionProvider,
} from "@cobudget/data-access/encryption";
import type { FieldEncryptionEnvironment, KeyProvider } from "@cobudget/data-access/encryption";

export const workerConfigSchema = {
  ...baseConfigSchema,
  ...fieldEncryptionConfigSchema,
} as const satisfies ConfigSchema;

export type WorkerConfig = ConfigOf<typeof workerConfigSchema>;

/**
 * `workerConfigSchema`'s per-variable shape cannot express "required only
 * when COBUDGET_FIELD_ENCRYPTION_PROVIDER is local";
 * `fieldEncryptionConfigFailures` covers that gap. Running it after the
 * schema load, and throwing the same `ConfigError` the schema load itself
 * throws, makes a missing local key or key version an ordinary
 * configuration-load failure (CBD246-SECURITY-002 finding 1) rather than
 * something only a later resolver call would catch.
 */
function assertFieldEncryptionEnvironment(env: FieldEncryptionEnvironment): void {
  const failures = fieldEncryptionConfigFailures(env);
  if (failures.length > 0) {
    throw new ConfigError(failures);
  }
}

export function loadWorkerConfig(): WorkerConfig {
  const config = loadConfigFromEnvironment(workerConfigSchema);
  assertFieldEncryptionEnvironment(config);
  return config;
}

/** Pure test and embedding seam; production startup reads through loadWorkerConfig. */
export function loadWorkerConfigFrom(
  environment: Readonly<Record<string, string | undefined>>,
): WorkerConfig {
  const config = loadConfig(workerConfigSchema, environment);
  assertFieldEncryptionEnvironment(config);
  return config;
}

/**
 * Resolves the S4 field-encryption provider from an already-validated
 * `WorkerConfig` (CBD246-SECURITY-002 finding 1). `bootstrap` calls this as
 * a pre-effect startup dependency -- before starting the worker or reporting
 * readiness -- so a missing key, a missing key version, or a local-provider
 * selection outside NODE_ENV=development/test fails startup closed rather
 * than only once a repository is later built against `getWorkerDataAccess()`.
 * Pure: `config` is a parameter, so no test needs `process.env` (already
 * refused by this workspace's `eslint.config.mjs`).
 */
export function resolveWorkerFieldEncryptionProvider(config: WorkerConfig): KeyProvider {
  return resolveFieldEncryptionProvider({
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: config.COBUDGET_FIELD_ENCRYPTION_PROVIDER,
    COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: config.COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY,
    COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: config.COBUDGET_FIELD_ENCRYPTION_KEY_VERSION,
    NODE_ENV: config.NODE_ENV,
  });
}
