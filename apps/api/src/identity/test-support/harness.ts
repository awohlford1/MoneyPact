/**
 * Shared fixtures for the identity tests: a complete local-adapter
 * configuration, the in-memory data-access double, and a composed runtime
 * (`composeApiRuntime`) whose ceremony can be driven either directly or
 * through the real Fastify application.
 *
 * Key material is generated per process so no literal in this package ever
 * shapes like a secret (scripts/secret_scanner.py generic-api-key rule).
 */
import { randomBytes } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import { loadApiConfigFrom } from "../../config.ts";
import type { ApiConfig } from "../../config.ts";
import { composeApiRuntime } from "../../sessions/runtime.ts";
import type { ComposedApiRuntime, RuntimeOverrides } from "../../sessions/runtime.ts";
import type { ReliabilitySink } from "../../telemetry.ts";
import type { IdentityCeremony } from "../ceremony.ts";
import type { LocalIssuer, LocalScenario } from "../local-issuer.ts";
import { createFakeIdentityClient, FakeIdentityDatabase } from "./fake-client.ts";

export const APPLICATION_ORIGIN = "http://localhost:3000";
export const CEREMONY_ORIGIN = "http://127.0.0.1:3001";
export const CALLBACK_URI = `${APPLICATION_ORIGIN}/v1/identity/callback`;
export const ISSUER = `${CEREMONY_ORIGIN}/v1/identity/local`;
export const CLIENT_ID = "cobudget-local-web";

export function localEnvironment(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "identity-test",
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
    COBUDGET_SESSION_PEPPER: randomBytes(32).toString("base64"),
    COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: "900", COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: "3600", COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: "300",
    COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: "60", COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: "30",
    COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: "1", COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: "1", COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: "10",
    COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: "1", COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: "50",
    COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY: randomBytes(32).toString("base64"), COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "test-v1",
    COBUDGET_IDENTITY_PROVIDER: "local", COBUDGET_IDENTITY_ENVIRONMENT_ID: "test", COBUDGET_IDENTITY_ISSUER: ISSUER, COBUDGET_IDENTITY_CLIENT_ID: CLIENT_ID,
    COBUDGET_IDENTITY_APPLICATION_ORIGIN: APPLICATION_ORIGIN, COBUDGET_IDENTITY_CEREMONY_ORIGIN: CEREMONY_ORIGIN, COBUDGET_IDENTITY_CALLBACK_URI: CALLBACK_URI,
    COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: "600", COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS: "2000", COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "4",
    COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: "120", COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS: "30",
    ...overrides,
  };
}

export function localConfig(overrides: Record<string, string | undefined> = {}): ApiConfig {
  return loadApiConfigFrom(localEnvironment(overrides));
}

export interface IdentityHarness {
  readonly config: ApiConfig;
  readonly db: FakeIdentityDatabase;
  readonly client: DataAccessClient;
  readonly runtime: ComposedApiRuntime;
  readonly ceremony: IdentityCeremony;
  readonly issuer: LocalIssuer;
  readonly events: Parameters<ReliabilitySink>[0][];
  /** REV-IDLE-5: the same clock the composed runtime (and `ceremony`) were built with, so a test-local
   * resolution (replacing the now-deleted `IdentityCeremony#view`) observes the same controllable time a
   * test that overrides `now` expects, instead of the wall clock. */
  readonly now: () => Date;
  /** Drives begin -> hosted authorize -> chooser -> callback URL for `scenario`; returns the callback URL to deliver. */
  callbackFor(scenario: LocalScenario, ceremony?: string, sessionCookie?: string): Promise<{ readonly callbackUrl: string; readonly challengeId: string }>;
  /** Delivers a callback URL to the ceremony as the browser would. */
  deliver(callbackUrl: string, context?: { readonly method?: string; readonly observedOrigin?: string; readonly path?: string; readonly receiptTime?: Date }): ReturnType<IdentityCeremony["complete"]>;
  /** Full sign-in for `scenario`. */
  signIn(scenario?: LocalScenario, ceremony?: string, sessionCookie?: string): Promise<Awaited<ReturnType<IdentityCeremony["complete"]>> & { readonly challengeId: string }>;
}

export function cookieValueFrom(setCookie: readonly string[], name: string): string | undefined {
  for (const header of setCookie) {
    const [pair] = header.split(";");
    const index = pair!.indexOf("=");
    if (pair!.slice(0, index) === name) return pair!.slice(index + 1);
  }
  return undefined;
}

export function buildHarness(overrides: RuntimeOverrides & { readonly environment?: Record<string, string | undefined> } = {}): IdentityHarness {
  const db = new FakeIdentityDatabase();
  const client = createFakeIdentityClient(db);
  const config = localConfig(overrides.environment ?? {});
  const events: Parameters<ReliabilitySink>[0][] = [];
  const { environment: _environment, ...runtimeOverrides } = overrides;
  const runtime = composeApiRuntime(config, (event) => { events.push(event); }, { client, ...runtimeOverrides });
  if (!runtime.runtime || !runtime.localIssuer) throw new Error("harness requires the local adapter");
  const ceremony = runtime.runtime.ceremony;
  const issuer = runtime.localIssuer;
  const callbackFor: IdentityHarness["callbackFor"] = async (scenario, ceremonyName = "sign_in", sessionCookie) => {
    const begun = await ceremony.begin({ ceremony: ceremonyName, postResultDestinationId: "home", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie });
    if (!begun.ok) throw new Error(`begin rejected: ${begun.reason}`);
    const authorize = new URL(begun.navigateTo);
    const query = Object.fromEntries(authorize.searchParams.entries());
    const hosted = issuer.authorize(query);
    if (!hosted.ok) throw new Error(`authorize rejected: ${hosted.error}`);
    const callbackUrl = issuer.choose(hosted.requestId, scenario);
    if (!callbackUrl) throw new Error("chooser rejected");
    return { callbackUrl, challengeId: begun.challengeId };
  };
  const deliver: IdentityHarness["deliver"] = (callbackUrl, context = {}) => {
    const url = new URL(callbackUrl);
    return ceremony.complete({ rawQuery: url.search.slice(1), method: context.method ?? "GET", observedOrigin: context.observedOrigin ?? url.origin, path: context.path ?? url.pathname, receiptTime: context.receiptTime ?? new Date() });
  };
  const signIn: IdentityHarness["signIn"] = async (scenario = "subject-a", ceremonyName = "sign_in", sessionCookie) => {
    const { callbackUrl, challengeId } = await callbackFor(scenario, ceremonyName, sessionCookie);
    return { ...(await deliver(callbackUrl)), challengeId };
  };
  const now = overrides.now ?? (() => new Date());
  return { config, db, client, runtime, ceremony, issuer, events, callbackFor, deliver, signIn, now };
}
