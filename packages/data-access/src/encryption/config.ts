/**
 * S4 field-encryption provider selection (CBD-246-AC04): "an absent provider
 * configuration fails startup naming the variable. There is no silent
 * default."
 *
 * `fieldEncryptionConfigSchema` is declared with `@cobudget/contracts`'s
 * `ConfigSchema` shape so an application that adopts it gets the same
 * validated-environment guarantees every other configuration value in this
 * repository gets. This module deliberately does not call
 * `loadConfigFromEnvironment` itself: `scripts/check-environment.mjs` allows
 * exactly three registered call sites (`apps/api/src/config.ts`,
 * `apps/worker/src/config.ts`, `packages/migrations/src/local-config.ts`).
 * `apiConfigSchema` and `workerConfigSchema` now spread this schema in (see
 * the README's "Environment wiring" section), so `loadApiConfig`/
 * `loadWorkerConfig` validate these variables the same way as every other
 * one, and each application's `src/data-access/index.ts` calls
 * `resolveFieldEncryptionProvider` with that loaded config during startup
 * (CBD246-SECURITY-001 finding 5). `resolveFieldEncryptionProvider` itself
 * stays pure -- `env` is a parameter, never `process.env` read here -- so it
 * remains fully unit-tested independent of either application's bootstrap.
 *
 * CBD246-SECURITY-001 finding 6: the local provider is a development/test
 * convenience, never a hosted secret store (see local-provider.ts and
 * PROVIDERS-LOCAL-001). `resolveFieldEncryptionProvider` refuses to select
 * it when `NODE_ENV` is not `development` or `test` -- enforced here, not
 * only documented -- so a hosted runtime cannot end up running on an
 * environment-held key merely because the operator forgot to configure KMS.
 */
import type { ConfigFailure, ConfigSchema } from "../../../contracts/src/config/index.ts";
import type { KeyProvider } from "./provider.ts";
import { createLocalKeyProvider } from "./local-provider.ts";
import { createKmsKeyProvider, type KmsClient } from "./kms-provider.ts";

export const fieldEncryptionConfigSchema = {
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: {
    kind: "enum",
    required: true,
    description: "S4 field-encryption key provider. \"local\" for development; \"kms\" once CBD-120 delivers a client.",
    values: ["local", "kms"],
  },
  COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: {
    kind: "string",
    required: false,
    description: "Base64-encoded 32-byte AES-256 key for the local field-encryption provider. Required when the provider is \"local\".",
  },
  COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: {
    kind: "string",
    required: false,
    description: "Key version recorded on ciphertext written by the local provider. Required when the provider is \"local\".",
  },
} as const satisfies ConfigSchema;

/**
 * `ConfigSchema`'s per-variable shape (`@cobudget/contracts`, not writable
 * from this package) has no way to express "required only when
 * COBUDGET_FIELD_ENCRYPTION_PROVIDER is local". This pure check closes that
 * gap without editing the shared schema type: `apiConfigSchema`'s and
 * `workerConfigSchema`'s owning loaders (`apps/api/src/config.ts` and
 * `apps/worker/src/config.ts`) call it immediately after
 * `loadConfigFromEnvironment`/`loadConfig` and throw the same `ConfigError`
 * the shared loader throws for any other failing variable when the result is
 * non-empty (CBD246-SECURITY-002 finding 1). That makes a missing local key
 * or key version a configuration-load failure -- before any resolver,
 * adapter, or bootstrap step runs -- rather than something only
 * `resolveFieldEncryptionProvider` catches once called.
 */
export interface FieldEncryptionEnvironment {
  readonly COBUDGET_FIELD_ENCRYPTION_PROVIDER?: string | undefined;
  readonly COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY?: string | undefined;
  readonly COBUDGET_FIELD_ENCRYPTION_KEY_VERSION?: string | undefined;
}

export function fieldEncryptionConfigFailures(
  env: FieldEncryptionEnvironment,
): ConfigFailure[] {
  if (env.COBUDGET_FIELD_ENCRYPTION_PROVIDER !== "local") {
    return [];
  }

  const failures: ConfigFailure[] = [];
  if (!env.COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY) {
    failures.push({
      variable: "COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY",
      reason: "is required and not set when COBUDGET_FIELD_ENCRYPTION_PROVIDER is \"local\"",
    });
  }
  if (!env.COBUDGET_FIELD_ENCRYPTION_KEY_VERSION) {
    failures.push({
      variable: "COBUDGET_FIELD_ENCRYPTION_KEY_VERSION",
      reason: "is required and not set when COBUDGET_FIELD_ENCRYPTION_PROVIDER is \"local\"",
    });
  }
  return failures;
}

export class MissingFieldEncryptionConfigError extends Error {
  constructor(variable: string) {
    super(`field-encryption configuration is missing "${variable}"; there is no silent default (CBD-246-AC04)`);
    this.name = "MissingFieldEncryptionConfigError";
  }
}

export class LocalProviderNotAllowedError extends Error {
  constructor(nodeEnv: string | undefined) {
    super(
      `the local field-encryption provider is refused outside NODE_ENV=development or NODE_ENV=test `
        + `(got ${nodeEnv === undefined ? "undefined" : JSON.stringify(nodeEnv)}); `
        + "configure the kms provider for a hosted environment (CBD-246-AC04 finding 6).",
    );
    this.name = "LocalProviderNotAllowedError";
  }
}

const LOCAL_PROVIDER_ALLOWED_NODE_ENVS = new Set(["development", "test"]);

/**
 * Pure: `env` is a parameter, never `process.env` read by this module.
 * Fails naming the missing variable rather than falling back to an
 * unencrypted or ad hoc path. `env` is expected to carry `NODE_ENV` (both
 * `apiConfigSchema` and `workerConfigSchema` already require it through
 * `baseConfigSchema`), which is what makes the local-provider restriction
 * below an enforced deployment-mode check rather than a caller's promise.
 */
export function resolveFieldEncryptionProvider(
  env: Readonly<Record<string, string | undefined>>,
  kmsClient?: KmsClient,
): KeyProvider {
  const provider = env.COBUDGET_FIELD_ENCRYPTION_PROVIDER;
  if (!provider) throw new MissingFieldEncryptionConfigError("COBUDGET_FIELD_ENCRYPTION_PROVIDER");

  if (provider === "kms") {
    return createKmsKeyProvider(kmsClient);
  }

  if (provider !== "local") {
    throw new MissingFieldEncryptionConfigError("COBUDGET_FIELD_ENCRYPTION_PROVIDER");
  }

  if (!LOCAL_PROVIDER_ALLOWED_NODE_ENVS.has(env.NODE_ENV ?? "")) {
    throw new LocalProviderNotAllowedError(env.NODE_ENV);
  }

  const encodedMaterial = env["COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY"];
  if (!encodedMaterial) throw new MissingFieldEncryptionConfigError("COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY");
  const version = env["COBUDGET_FIELD_ENCRYPTION_KEY_VERSION"];
  if (!version) throw new MissingFieldEncryptionConfigError("COBUDGET_FIELD_ENCRYPTION_KEY_VERSION");

  return createLocalKeyProvider({ key: Buffer.from(encodedMaterial, "base64"), keyVersion: version });
}
