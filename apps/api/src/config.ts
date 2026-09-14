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
import { identityConfigFailures, identityConfigSchema } from "./identity/config.ts";
import type { IdentityConfigEnvironment } from "./identity/config.ts";

/**
 * CBD-191 session configuration (`resolveSessionConfig`) and the delivery
 * envelope key (`resolveSessionEnvelopeKeyProvider`), declared here so the
 * shared loader validates them like every other variable and
 * `.env.example`/`config/environment-inventory.json` carry them. They are
 * required only under COBUDGET_IDENTITY_PROVIDER=local; `resolveSessionConfig`
 * fails closed by name when one is absent there (PROTO-IDENTITY-API-001).
 */
export const sessionConfigSchema = {
  COBUDGET_SESSION_PEPPER: { kind: "string", required: false, description: "Base64-encoded server-side pepper (>= 32 bytes) for session verifier and CSRF digests (CBD-191 SC-191-001). Never stored in the database. Required under the local identity provider." },
  COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: { kind: "integer", required: false, description: "Idle session expiry in seconds (CBD-191 section 5.1). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: { kind: "integer", required: false, description: "Absolute session lifetime in seconds (CBD-191 section 5.1). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: { kind: "integer", required: false, description: "Fresh-assurance validity window in seconds (CBD-191 section 5.1). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: { kind: "integer", required: false, description: "Revocation propagation deadline in seconds (CBD-191 section 6.1). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: { kind: "integer", required: false, description: "Maximum accepted future skew of a provider event time in seconds (CBD-191 section 6.2). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: { kind: "integer", required: false, description: "Minimum response bucket for a session rejection in milliseconds (CBD-191 SC-191-001A). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: { kind: "integer", required: false, description: "Random jitter added to a session rejection in milliseconds (CBD-191 SC-191-001A). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: { kind: "integer", required: false, description: "Minimum sample count for the rejection-timing differential test (CBD-191 CT-191-002A). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: { kind: "integer", required: false, description: "Response bucket used when the session store times out, in milliseconds (CBD-191 SC-191-001A). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: { kind: "integer", required: false, description: "Maximum permitted timing differential between rejection classes in milliseconds (CBD-191 CT-191-002A). Required under the local identity provider.", min: 1 },
  COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: { kind: "enum", required: false, description: "Delivery-envelope key provider for sealed session delivery results (CBD-191 section 3.1). \"local\" is refused outside NODE_ENV=development/test; \"kms\" is not yet available.", values: ["local", "kms"] },
  COBUDGET_SESSION_ENVELOPE_KEY: { kind: "string", required: false, description: "Base64-encoded 32-byte key for the local delivery-envelope provider. Required when the envelope provider is \"local\". Separate custody from the session pepper and the field-encryption key." },
  COBUDGET_SESSION_ENVELOPE_KEY_VERSION: { kind: "string", required: false, description: "Key version recorded on sealed delivery envelopes. Required when the envelope provider is \"local\"." },
} as const satisfies ConfigSchema;

export const apiConfigSchema = {
  ...baseConfigSchema,
  ...fieldEncryptionConfigSchema,
  ...sessionConfigSchema,
  ...identityConfigSchema,
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

/**
 * Same gap, same closure, for the CBD-190 identity record (CBD-190-AC05):
 * under COBUDGET_IDENTITY_PROVIDER=local every value must belong to the
 * same environment row, the local adapter is refused outside
 * development/test, and the CBD-191 session variables must be present.
 */
function assertIdentityEnvironment(env: IdentityConfigEnvironment & Readonly<Record<string, string | number | undefined>>): void {
  const failures = identityConfigFailures(env);
  if (env.COBUDGET_IDENTITY_PROVIDER === "local") {
    for (const name of Object.keys(sessionConfigSchema)) {
      const value = env[name];
      if (value === undefined || value === "") failures.push({ variable: name, reason: "is required and not set when COBUDGET_IDENTITY_PROVIDER is \"local\"" });
    }
  }
  if (failures.length > 0) {
    throw new ConfigError(failures);
  }
}

export function loadApiConfig(): ApiConfig {
  const config = loadConfigFromEnvironment(apiConfigSchema);
  assertFieldEncryptionEnvironment(config);
  assertIdentityEnvironment(config);
  return config;
}

/** Pure test and embedding seam; production startup reads through loadApiConfig. */
export function loadApiConfigFrom(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const config = loadConfig(apiConfigSchema, env);
  assertFieldEncryptionEnvironment(config);
  assertIdentityEnvironment(config);
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
