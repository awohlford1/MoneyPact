/**
 * CBD-190 §3 identity configuration (application half, PROTO-IDENTITY-API-001).
 *
 * The configuration is a closed record that is valid only when every value
 * belongs to the same environment row. `identityConfigFailures` is the pure
 * validator `apps/api/src/config.ts` runs immediately after the schema load
 * (the same pattern `fieldEncryptionConfigFailures` uses), so a cross-wired
 * or incomplete identity configuration is an ordinary `ConfigError` before
 * any adapter, listener or application effect exists (CBD-190-AC05).
 *
 * `PROVIDERS-LOCAL-001`: no provider account exists. The only adapter this
 * revision can select is `local`, the Cognito-shaped local adapter, and it
 * is refused outside NODE_ENV=development/test. `cognito` is declared so the
 * activation path has a name, and it fails closed until a separate Executive
 * decision supplies credentials, limits and live evidence. `unavailable` is
 * the explicit no-identity path: the API starts with the fail-closed
 * `unavailableApiAuthorization` boundary and every protected route denies.
 *
 * Nothing here reads `process.env`; `env` is always a parameter.
 */
import type { ConfigFailure, ConfigSchema } from "@cobudget/contracts/config";

export const IDENTITY_CALLBACK_PATH = "/v1/identity/callback";
export const LOCAL_ISSUER_PATH = "/v1/identity/local";
/** Application-owned accessible result page for every non-success outcome (§7). */
export const IDENTITY_RESULT_PATH = "/identity/result";
/** §4.1: `post_result_destination_id` is an opaque server-side allowlist key, never a URL. */
// PROTO-ACTIVATION-001: `budgets` lets the web land on its authenticated budgets page after the callback.
export const POST_RESULT_DESTINATIONS: Readonly<Record<string, string>> = Object.freeze({ home: "/", budgets: "/budgets" });

export type IdentityProviderKind = "local" | "cognito" | "unavailable";
export type IdentityEnvironmentId = "development" | "test" | "staging" | "production";

export const identityConfigSchema = {
  COBUDGET_IDENTITY_PROVIDER: {
    kind: "enum",
    required: false,
    description: "Identity adapter. \"local\" is the Cognito-shaped local adapter (development/test only); \"cognito\" stays refused until PROVIDERS-LOCAL-001 is superseded; \"unavailable\" (or absent) starts the API with the fail-closed authorization boundary and no sign-in.",
    values: ["local", "cognito", "unavailable"],
  },
  COBUDGET_IDENTITY_ENVIRONMENT_ID: {
    kind: "enum",
    required: false,
    description: "Identity environment row (CBD-190 section 3). Must equal NODE_ENV under the local adapter; a cross-environment value fails startup.",
    values: ["development", "test", "staging", "production"],
  },
  COBUDGET_IDENTITY_ISSUER: {
    kind: "string",
    required: false,
    description: "Exact OIDC issuer. Under the local adapter it must be the ceremony origin plus /v1/identity/local, on loopback.",
  },
  COBUDGET_IDENTITY_CLIENT_ID: {
    kind: "string",
    required: false,
    description: "Exact OAuth client identifier the adapter sends and requires in the ID token audience. Not a secret; the client is public (PKCE only).",
  },
  COBUDGET_IDENTITY_APPLICATION_ORIGIN: {
    kind: "string",
    required: false,
    description: "The one allowed initiating application origin (scheme://host[:port]). Callbacks navigate back to it; sign-in and logout requests must carry it as their Origin.",
  },
  COBUDGET_IDENTITY_CEREMONY_ORIGIN: {
    kind: "string",
    required: false,
    description: "Origin that serves the hosted ceremony. Must differ from the application origin (CBD-190 section 8); the local adapter serves it from the API origin.",
  },
  COBUDGET_IDENTITY_CALLBACK_URI: {
    kind: "string",
    required: false,
    description: "Exact provider-registered callback URI; its path must be /v1/identity/callback. No prefix, suffix, query or fragment matching.",
  },
  COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: {
    kind: "integer",
    required: false,
    description: "Lifetime of a begin challenge (state, PKCE, nonce). Required under the local adapter.",
    min: 1,
    max: 3_600,
  },
  COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS: {
    kind: "integer",
    required: false,
    description: "Maximum lifetime of one bounded token exchange, including issuer revocation (CBD-190 section 10.1). Required under the local adapter.",
    min: 1,
    max: 60_000,
  },
  COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: {
    kind: "integer",
    required: false,
    description: "Maximum whole-transaction attempts for the identity mapping (CBD-190 section 5.2). Required under the local adapter.",
    min: 1,
    max: 20,
  },
  COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: {
    kind: "integer",
    required: false,
    description: "Lifetime of a prepared session hand-off before it becomes terminal (CBD-190 section 6). Required under the local adapter.",
    min: 1,
    max: 3_600,
  },
  COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS: {
    kind: "integer",
    required: false,
    description: "Accepted clock skew for provider token times (CBD-190 section 4.3). Required under the local adapter.",
    min: 0,
    max: 300,
  },
} as const satisfies ConfigSchema;

export interface IdentityConfigEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly COBUDGET_IDENTITY_PROVIDER?: string | undefined;
  readonly COBUDGET_IDENTITY_ENVIRONMENT_ID?: string | undefined;
  readonly COBUDGET_IDENTITY_ISSUER?: string | undefined;
  readonly COBUDGET_IDENTITY_CLIENT_ID?: string | undefined;
  readonly COBUDGET_IDENTITY_APPLICATION_ORIGIN?: string | undefined;
  readonly COBUDGET_IDENTITY_CEREMONY_ORIGIN?: string | undefined;
  readonly COBUDGET_IDENTITY_CALLBACK_URI?: string | undefined;
  readonly COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS?: string | number | undefined;
  readonly COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS?: string | number | undefined;
  readonly COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS?: string | number | undefined;
  readonly COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS?: string | number | undefined;
  readonly COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS?: string | number | undefined;
}

/** The resolved local-adapter configuration. Never contains a secret value. */
export interface LocalIdentityConfig {
  readonly adapterKind: "local";
  readonly environmentId: "development" | "test";
  readonly issuer: string;
  readonly clientId: string;
  readonly applicationOrigin: string;
  readonly ceremonyOrigin: string;
  readonly callbackUri: string;
  readonly authorizationEndpoint: string;
  readonly allowedAlgorithms: readonly ["RS256"];
  readonly scopes: readonly ["openid"];
  readonly challengeLifetimeSeconds: number;
  readonly exchangeLifetimeMs: number;
  readonly mappingMaxAttempts: number;
  readonly handoffLifetimeSeconds: number;
  readonly clockSkewSeconds: number;
  readonly postResultDestinations: Readonly<Record<string, string>>;
  readonly resultPath: string;
}

export type IdentityConfig = LocalIdentityConfig | { readonly adapterKind: "unavailable" };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOCAL_NODE_ENVS = new Set(["development", "test"]);

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** §3 rule 1: HTTPS, or an explicit loopback-only local-development profile. Rule 4: no wildcard. */
function urlFailure(variable: string, value: string | undefined, expectations: { readonly origin?: boolean; readonly path?: string }): ConfigFailure | undefined {
  if (!value) return { variable, reason: "is required and not set when COBUDGET_IDENTITY_PROVIDER is \"local\"" };
  if (value.includes("*")) return { variable, reason: "must not contain a wildcard" };
  const url = parseUrl(value);
  if (!url) return { variable, reason: "must be an absolute URL" };
  if (url.username || url.password) return { variable, reason: "must not carry credentials" };
  if (url.search || url.hash || value.endsWith("#") || value.endsWith("?")) return { variable, reason: "must not carry a query or fragment" };
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    return { variable, reason: "must use https, or http on a loopback host for the local-development profile" };
  }
  // Section 3 rule 3 for the local profile: the local adapter's environment row is loopback only, so a hosted
  // (production/staging) origin, issuer or callback in a local configuration is a cross-environment value.
  if (!LOOPBACK_HOSTS.has(url.hostname)) return { variable, reason: "belongs to a hosted environment row; the local adapter accepts loopback hosts only (CBD-190 section 3 rule 3)" };
  if (expectations.origin && (url.pathname !== "/" || value.endsWith("/"))) return { variable, reason: "must be an origin (scheme://host[:port]) with no path" };
  if (expectations.path !== undefined && url.pathname !== expectations.path) return { variable, reason: `must have the exact path ${expectations.path}` };
  return undefined;
}

function positive(variable: string, value: string | number | undefined): ConfigFailure | undefined {
  if (value === undefined || value === "") return { variable, reason: "is required and not set when COBUDGET_IDENTITY_PROVIDER is \"local\"" };
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return { variable, reason: "must be a non-negative integer" };
  return undefined;
}

/**
 * Every §3 validation rule the local profile can express, evaluated as a
 * whole so an operator sees every failing variable at once. Returns no
 * failure for the `unavailable` path and for an absent provider (the
 * explicit no-sign-in configuration).
 */
export function identityConfigFailures(env: IdentityConfigEnvironment): ConfigFailure[] {
  const provider = env.COBUDGET_IDENTITY_PROVIDER;
  if (provider === undefined || provider === "" || provider === "unavailable") return [];
  if (provider === "cognito") {
    return [{ variable: "COBUDGET_IDENTITY_PROVIDER", reason: "\"cognito\" is not activated; no provider account or spend is authorized (PROVIDERS-LOCAL-001)" }];
  }
  if (provider !== "local") return [{ variable: "COBUDGET_IDENTITY_PROVIDER", reason: "must be one of: local, cognito, unavailable" }];

  const failures: ConfigFailure[] = [];
  const nodeEnv = env.NODE_ENV ?? "";
  if (!LOCAL_NODE_ENVS.has(nodeEnv)) {
    failures.push({ variable: "COBUDGET_IDENTITY_PROVIDER", reason: "\"local\" is refused outside NODE_ENV=development or NODE_ENV=test (CBD-190-AC05; section 3 rule 5)" });
  }
  const environmentId = env.COBUDGET_IDENTITY_ENVIRONMENT_ID;
  if (!environmentId) failures.push({ variable: "COBUDGET_IDENTITY_ENVIRONMENT_ID", reason: "is required and not set when COBUDGET_IDENTITY_PROVIDER is \"local\"" });
  else if (environmentId !== nodeEnv) failures.push({ variable: "COBUDGET_IDENTITY_ENVIRONMENT_ID", reason: "belongs to another environment row than NODE_ENV (CBD-190 section 3 rules 2 and 3)" });

  const applicationOrigin = urlFailure("COBUDGET_IDENTITY_APPLICATION_ORIGIN", env.COBUDGET_IDENTITY_APPLICATION_ORIGIN, { origin: true });
  if (applicationOrigin) failures.push(applicationOrigin);
  const ceremonyOrigin = urlFailure("COBUDGET_IDENTITY_CEREMONY_ORIGIN", env.COBUDGET_IDENTITY_CEREMONY_ORIGIN, { origin: true });
  if (ceremonyOrigin) failures.push(ceremonyOrigin);
  else if (env.COBUDGET_IDENTITY_CEREMONY_ORIGIN === env.COBUDGET_IDENTITY_APPLICATION_ORIGIN) {
    failures.push({ variable: "COBUDGET_IDENTITY_CEREMONY_ORIGIN", reason: "must be a different origin than COBUDGET_IDENTITY_APPLICATION_ORIGIN (CBD-190 section 8)" });
  }
  const issuer = urlFailure("COBUDGET_IDENTITY_ISSUER", env.COBUDGET_IDENTITY_ISSUER, { path: LOCAL_ISSUER_PATH });
  if (issuer) failures.push(issuer);
  else if (!ceremonyOrigin && env.COBUDGET_IDENTITY_ISSUER !== `${env.COBUDGET_IDENTITY_CEREMONY_ORIGIN}${LOCAL_ISSUER_PATH}`) {
    failures.push({ variable: "COBUDGET_IDENTITY_ISSUER", reason: "must be the ceremony origin plus /v1/identity/local under the local adapter; an issuer from another origin belongs to another environment row" });
  }
  const callback = urlFailure("COBUDGET_IDENTITY_CALLBACK_URI", env.COBUDGET_IDENTITY_CALLBACK_URI, { path: IDENTITY_CALLBACK_PATH });
  if (callback) failures.push(callback);
  if (!env.COBUDGET_IDENTITY_CLIENT_ID) failures.push({ variable: "COBUDGET_IDENTITY_CLIENT_ID", reason: "is required and not set when COBUDGET_IDENTITY_PROVIDER is \"local\"" });
  else if (env.COBUDGET_IDENTITY_CLIENT_ID.includes("*")) failures.push({ variable: "COBUDGET_IDENTITY_CLIENT_ID", reason: "must not contain a wildcard" });

  for (const [variable, value] of [
    ["COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS", env.COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS],
    ["COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS", env.COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS],
    ["COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS", env.COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS],
    ["COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS", env.COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS],
    ["COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS", env.COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS],
  ] as const) {
    const failure = positive(variable, value);
    if (failure) failures.push(failure);
    else if (variable !== "COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS" && Number(value) === 0) failures.push({ variable, reason: "must be positive; an absent or unbounded value fails closed (CBD-190 section 3 rule 8, section 5.2)" });
  }
  return failures;
}

export class IdentityConfigurationError extends Error {
  readonly failures: readonly ConfigFailure[];
  constructor(failures: readonly ConfigFailure[]) {
    super(`identity configuration rejected:\n${failures.map((failure) => `  ${failure.variable}: ${failure.reason}`).join("\n")}`);
    this.name = "IdentityConfigurationError";
    this.failures = failures;
  }
}

/**
 * Pure resolution of the closed configuration record from an environment
 * that already passed `identityConfigFailures`. Re-validates so a caller
 * that skipped the loader still fails closed rather than trusting its input.
 */
export function resolveIdentityConfig(env: IdentityConfigEnvironment): IdentityConfig {
  const failures = identityConfigFailures(env);
  if (failures.length > 0) throw new IdentityConfigurationError(failures);
  const provider = env.COBUDGET_IDENTITY_PROVIDER;
  if (provider === undefined || provider === "" || provider === "unavailable") return { adapterKind: "unavailable" };
  const issuer = env.COBUDGET_IDENTITY_ISSUER!;
  return Object.freeze({
    adapterKind: "local",
    environmentId: env.COBUDGET_IDENTITY_ENVIRONMENT_ID as "development" | "test",
    issuer,
    clientId: env.COBUDGET_IDENTITY_CLIENT_ID!,
    applicationOrigin: env.COBUDGET_IDENTITY_APPLICATION_ORIGIN!,
    ceremonyOrigin: env.COBUDGET_IDENTITY_CEREMONY_ORIGIN!,
    callbackUri: env.COBUDGET_IDENTITY_CALLBACK_URI!,
    authorizationEndpoint: `${issuer}/authorize`,
    allowedAlgorithms: ["RS256"] as const,
    scopes: ["openid"] as const,
    challengeLifetimeSeconds: Number(env.COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS),
    exchangeLifetimeMs: Number(env.COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS),
    mappingMaxAttempts: Number(env.COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS),
    handoffLifetimeSeconds: Number(env.COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS),
    clockSkewSeconds: Number(env.COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS),
    postResultDestinations: POST_RESULT_DESTINATIONS,
    resultPath: IDENTITY_RESULT_PATH,
  });
}
