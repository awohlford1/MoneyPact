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

export const apiConfigSchema = {
  ...baseConfigSchema,
  ...fieldEncryptionConfigSchema,
  API_LISTEN_ADDRESS: {
    kind: "ip",
    required: false,
    description: "Interface to bind the API to. Omit for defaults: 127.0.0.1 in development/test, 0.0.0.0 in production.",
  },
  API_PORT: {
    kind: "integer",
    required: true,
    description: "TCP port on which the API listens. Must be between 1 and 65535.",
    min: 1,
    max: 65_535,
  },
} as const satisfies ConfigSchema;

export type ApiConfig = ConfigOf<typeof apiConfigSchema>;

export function resolveApiListenAddress(config: ApiConfig): string {
  return config.API_LISTEN_ADDRESS ?? (config.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
}

/**
 * `apiConfigSchema`'s per-variable shape cannot express "required only when
 * COBUDGET_FIELD_ENCRYPTION_PROVIDER is local"; `fieldEncryptionConfigFailures`
 * covers that gap. Running it after the schema load, and throwing the same
 * `ConfigError` the schema load itself throws, makes a missing local key or
 * key version an ordinary configuration-load failure (CBD246-SECURITY-002
 * finding 1) rather than something only a later resolver call would catch.
 */
function assertFieldEncryptionEnvironment(env: FieldEncryptionEnvironment): void {
  const failures = fieldEncryptionConfigFailures(env);
  if (failures.length > 0) {
    throw new ConfigError(failures);
  }
}

export function loadApiConfig(): ApiConfig {
  const config = loadConfigFromEnvironment(apiConfigSchema);
  assertFieldEncryptionEnvironment(config);
  return config;
}

/** Pure test and embedding seam; production startup reads through loadApiConfig. */
export function loadApiConfigFrom(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const config = loadConfig(apiConfigSchema, env);
  assertFieldEncryptionEnvironment(config);
  return config;
}

/**
 * Resolves the S4 field-encryption provider from an already-validated
 * `ApiConfig` (CBD246-SECURITY-002 finding 1). `runApiBootstrap` calls this
 * as a pre-effect startup dependency -- before constructing the application
 * or opening the listener -- so a missing key, a missing key version, or a
 * local-provider selection outside NODE_ENV=development/test fails startup
 * closed rather than only once a repository is later built against
 * `getApiDataAccess()`. Pure: `config` is a parameter, so no test needs
 * `process.env` (already refused by this workspace's `eslint.config.mjs`).
 */
export function resolveApiFieldEncryptionProvider(config: ApiConfig): KeyProvider {
  return resolveFieldEncryptionProvider({
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: config.COBUDGET_FIELD_ENCRYPTION_PROVIDER,
    COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: config.COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY,
    COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: config.COBUDGET_FIELD_ENCRYPTION_KEY_VERSION,
    NODE_ENV: config.NODE_ENV,
  });
}
