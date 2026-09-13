/**
 * CBD-191 §5.1 required versioned configuration, resolved the same way
 * CBD-246's `resolveFieldEncryptionProvider` resolves the S4 encryption
 * provider (apps/api/src/bootstrap.ts's startup pattern this packet cites):
 * pure, `env` supplied by the caller, and every absent/non-positive/unbounded
 * value fails closed by name rather than falling back to a default.
 *
 * This module deliberately never calls `loadConfigFromEnvironment` and never
 * reads `process.env` itself -- `scripts/check-environment.mjs` registers
 * exactly three call sites for the former and bans the latter everywhere
 * else in the repository. Wiring `sessionConfigSchema` into
 * `apps/api/src/config.ts`'s own schema (so its values are validated the
 * same way as every other application variable, and so `.env.example`/
 * `config/environment-inventory.json` carry them) is outside this packet's
 * writable scope -- see the final report's "not delivered because" note.
 */
export interface SessionConfigEnvironment {
  readonly COBUDGET_SESSION_PEPPER?: string | undefined;
  readonly COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS?: string | undefined;
  readonly COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS?: string | undefined;
  readonly COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS?: string | undefined;
  readonly COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS?: string | undefined;
  readonly COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS?: string | undefined;
  readonly COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS?: string | undefined;
  readonly COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS?: string | undefined;
  readonly COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT?: string | undefined;
  readonly COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS?: string | undefined;
  readonly COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS?: string | undefined;
}

export interface SessionConfig {
  readonly pepper: Buffer;
  readonly idleTimeoutSeconds: number;
  readonly absoluteLifetimeSeconds: number;
  readonly freshAssuranceWindowSeconds: number;
  readonly revocationPropagationTargetSeconds: number;
  readonly providerMaxFutureSkewSeconds: number;
  readonly rejectionTimingFloorMs: number;
  readonly rejectionTimingJitterMs: number;
  readonly rejectionTimingSampleCount: number;
  readonly rejectionTimingTimeoutBucketMs: number;
  readonly rejectionTimingMaxDifferentialMs: number;
}

export class MissingSessionConfigError extends Error {
  constructor(variable: string) {
    super(`session configuration is missing "${variable}"; there is no silent default (§5.1) -- startup fails closed`);
    this.name = "MissingSessionConfigError";
  }
}

function positiveInteger(env: SessionConfigEnvironment, key: keyof SessionConfigEnvironment): number {
  const raw = env[key];
  if (!raw) throw new MissingSessionConfigError(key);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new MissingSessionConfigError(key);
  return value;
}

/**
 * Pure: `env` is a parameter, never `process.env` read here. The pepper
 * comes from configuration only, never the database (`SC-191-001`); a
 * missing or short pepper fails closed rather than falling back to an
 * in-database value or a default constant.
 */
export function resolveSessionConfig(env: SessionConfigEnvironment): SessionConfig {
  const rawPepper = env.COBUDGET_SESSION_PEPPER;
  if (!rawPepper) throw new MissingSessionConfigError("COBUDGET_SESSION_PEPPER");
  const pepper = Buffer.from(rawPepper, "base64");
  if (pepper.byteLength < 32) throw new MissingSessionConfigError("COBUDGET_SESSION_PEPPER");

  return {
    pepper,
    idleTimeoutSeconds: positiveInteger(env, "COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS"),
    absoluteLifetimeSeconds: positiveInteger(env, "COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS"),
    freshAssuranceWindowSeconds: positiveInteger(env, "COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS"),
    revocationPropagationTargetSeconds: positiveInteger(env, "COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS"),
    providerMaxFutureSkewSeconds: positiveInteger(env, "COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS"),
    rejectionTimingFloorMs: positiveInteger(env, "COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS"),
    rejectionTimingJitterMs: positiveInteger(env, "COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS"),
    rejectionTimingSampleCount: positiveInteger(env, "COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT"),
    rejectionTimingTimeoutBucketMs: positiveInteger(env, "COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS"),
    rejectionTimingMaxDifferentialMs: positiveInteger(env, "COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS"),
  };
}

/** The cookie name §5.1 fixes; no fallback or unprefixed alias is ever read. */
export const SESSION_COOKIE_NAME = "__Host-cobudget_session";
