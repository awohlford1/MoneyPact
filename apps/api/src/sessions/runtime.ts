/**
 * Startup composition for the session and identity halves of the API
 * (PROTO-IDENTITY-API-001, PROTO-WIRE-01/02).
 *
 * `composeApiRuntime` turns an already-validated `ApiConfig` into the
 * `ApiAuthorizationOptions` `AppModule.register` consumes:
 *
 *   - `unavailable` (or absent) identity provider: the fail-closed
 *     `unavailableApiAuthorization` boundary, exactly as before this packet,
 *     with no identity route mounted;
 *   - `local` provider: the real CBD-191 session fact source
 *     (`buildSessionFactSourceAdapter`), the real transaction store over the
 *     CBD-246 seam, the in-process restricted audit stream, and the CBD-190
 *     ceremony over the local Cognito-shaped issuer.
 *
 * PROTO-ACTIVATION-001 joins the merged islands on the local path: the
 * budget-creation, proposal, budget-space and targets route modules are
 * composed through `authorization.modules` with production dependencies
 * (`budget-creation/composition.ts`); the boundary's transaction store
 * dispatches by action to the creation, targets and general stores
 * (`dispatch.ts`); the fact source layers the budget-space, proposal and
 * consent facts (`budget-facts.ts`) over the subject/profile leaves; and the
 * fact assembler carries the configured environment so the p2 subject-scoped
 * cells assemble (CBD-236 section 4.4).
 *
 * Nothing here reads `process.env`; the data-access client is created
 * lazily on first statement so composition (and the surface inventory
 * discovery) never opens a database connection by itself.
 */
import { HttpException } from "@nestjs/common";
import { createApiClient } from "@cobudget/data-access";
import type { DataAccessClient } from "@cobudget/data-access";
import { createSessionStore, readSessionCookieValue, resolveSessionConfig, resolveSessionEnvelopeKeyProvider } from "@cobudget/sessions";
import type { EnvelopeKeyProvider, SessionConfig } from "@cobudget/sessions";
import { RestrictedAudit } from "../authorization/audit.js";
import { AuthorizationBoundary } from "../authorization/boundary.js";
import { FactAssembler } from "../authorization/facts.js";
import { unavailableApiAuthorization } from "../authorization/http.js";
import type { ApiAuthorizationOptions } from "../authorization/http.js";
import type { ApiSurfaceGate } from "../rate-limit/http.js";
import type { ApiConfig } from "../config.js";
import { ChallengeStore } from "../identity/challenge.ts";
import { IdentityCeremony } from "../identity/ceremony.ts";
import type { IdentityEvidence, IdentityEvidenceSink } from "../identity/ceremony.ts";
import { resolveIdentityConfig } from "../identity/config.ts";
import type { IdentityConfig, LocalIdentityConfig } from "../identity/config.ts";
import { identityHttp } from "../identity/http.ts";
import type { IdentityHttp, IdentityRuntime } from "../identity/http.ts";
import { LocalIssuer } from "../identity/local-issuer.ts";
import type { ProviderTransport } from "../identity/local-issuer.ts";
import type { MappingHooks } from "../identity/mapping.ts";
import type { ReliabilitySink } from "../telemetry.js";
import { composeBudgetApi } from "../budget-creation/composition.ts";
import { InProcessRestrictedAuditStore } from "./audit.ts";
import { budgetFactReader } from "./budget-facts.ts";
import { DispatchingTransactionStore } from "./dispatch.ts";
import { createApiFactSource } from "./fact-source.ts";
import type { FactReader } from "./fact-source.ts";
import { buildSessionFactSourceAdapter } from "./index.js";
import { ApiTransactionStore } from "./transaction-store.ts";

/** The composed boundary options `AppModule.register` consumes. */
type Wiring = ApiAuthorizationOptions;

/** Prototype governance references for the in-process restricted audit stream; revisited before any hosted environment. */
const PROTOTYPE_AUDIT_GOVERNANCE = Object.freeze({
  retentionClass: "restricted_security_evidence:in_process_prototype",
  deletionPolicyVersion: "prototype-in-process-v1",
  retentionApprovalRef: "PROTOTYPE-SLICE-001",
  reasonVocabularyApprovalRef: "CBD236-P1-RELEASE-001",
});

export interface RuntimeOverrides {
  readonly client?: DataAccessClient | undefined;
  readonly rateLimit?: ApiSurfaceGate | undefined;
  readonly now?: (() => Date) | undefined;
  readonly evidence?: IdentityEvidenceSink | undefined;
  readonly transport?: ProviderTransport | undefined;
  readonly mappingHooks?: MappingHooks | undefined;
  readonly extendFacts?: FactReader | undefined;
}

export interface ComposedApiRuntime {
  readonly authorization: Wiring;
  readonly identity: IdentityHttp;
  readonly identityConfig: IdentityConfig;
  readonly runtime: IdentityRuntime | undefined;
  readonly audit: InProcessRestrictedAuditStore | undefined;
  readonly evidence: readonly IdentityEvidence[];
  readonly localIssuer: LocalIssuer | undefined;
}

/** Defers pool construction to the first statement so composition never connects. */
export function lazyDataAccessClient(factory: () => DataAccessClient): DataAccessClient {
  let instance: DataAccessClient | undefined;
  const client = (): DataAccessClient => (instance ??= factory());
  return {
    transaction: (options, work) => client().transaction(options, work),
    readOwnBudgetMemberships: (subject) => { const c = client(); if (!c.readOwnBudgetMemberships) throw new Error("membership statements unavailable"); return c.readOwnBudgetMemberships(subject); },
    tenantSelect: (query) => client().tenantSelect(query),
    tenantInsert: (query) => client().tenantInsert(query),
    tenantUpdate: (query) => client().tenantUpdate(query),
    tenantDelete: (query) => client().tenantDelete(query),
    platformSelect: (query) => client().platformSelect(query),
    platformInsert: (query) => client().platformInsert(query),
    platformUpdate: (query) => client().platformUpdate(query),
    platformDelete: (query) => client().platformDelete(query),
    profileSelect: (query) => { const c = client(); if (!c.profileSelect) throw new Error("profile statements unavailable"); return c.profileSelect(query); },
    profileInsert: (query) => { const c = client(); if (!c.profileInsert) throw new Error("profile statements unavailable"); return c.profileInsert(query); },
    profileUpdate: (query) => { const c = client(); if (!c.profileUpdate) throw new Error("profile statements unavailable"); return c.profileUpdate(query); },
    profileDelete: (query) => { const c = client(); if (!c.profileDelete) throw new Error("profile statements unavailable"); return c.profileDelete(query); },
  };
}

function stringOrUndefined(value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/** Pure: resolves every session-related runtime value from the validated config, failing closed by variable name. */
export function resolveApiSessionConfiguration(config: ApiConfig): { readonly session: SessionConfig; readonly sealing: EnvelopeKeyProvider } {
  const session = resolveSessionConfig({
    COBUDGET_SESSION_PEPPER: config.COBUDGET_SESSION_PEPPER,
    COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: stringOrUndefined(config.COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS),
    COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: stringOrUndefined(config.COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS),
    COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: stringOrUndefined(config.COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS),
    COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: stringOrUndefined(config.COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS),
    COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: stringOrUndefined(config.COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS),
    COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: stringOrUndefined(config.COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS),
    COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: stringOrUndefined(config.COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS),
    COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: stringOrUndefined(config.COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT),
    COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: stringOrUndefined(config.COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS),
    COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: stringOrUndefined(config.COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS),
  });
  const envelopeKeys = resolveSessionEnvelopeKeyProvider({
    NODE_ENV: config.NODE_ENV,
    COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: config.COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER,
    COBUDGET_SESSION_ENVELOPE_KEY: config.COBUDGET_SESSION_ENVELOPE_KEY,
    COBUDGET_SESSION_ENVELOPE_KEY_VERSION: config.COBUDGET_SESSION_ENVELOPE_KEY_VERSION,
  });
  return { session, sealing: envelopeKeys };
}

/**
 * Pre-effect startup resolution (`runApiBootstrap`): resolves the identity
 * configuration and, under the local adapter, the session pepper/envelope
 * key material, so a missing or cross-wired value fails startup before the
 * application or listener exists. Returns the resolved identity config.
 */
export function resolveApiIdentityConfiguration(config: ApiConfig): IdentityConfig {
  const identity = resolveIdentityConfig(config);
  if (identity.adapterKind === "local") resolveApiSessionConfiguration(config);
  return identity;
}

export function composeApiRuntime(config: ApiConfig, sink: ReliabilitySink, overrides: RuntimeOverrides = {}): ComposedApiRuntime {
  const identityConfig = resolveApiIdentityConfiguration(config);
  const failure = (): void => sink({ service: "api", version: config.SERVICE_VERSION, operation: "request", outcome: "error" });
  if (identityConfig.adapterKind !== "local") {
    // No identity routes are mounted on the unavailable path: the CBD-266 surface inventory (discovered with this
    // configuration) stays at the baseline until the identity registrations and their approved records exist
    // (apps/api/src/identity/rate-limit-proposal.json; see the final report's blocker).
    const identity = identityHttp(undefined);
    return {
      authorization: { ...unavailableApiAuthorization(failure), ...(overrides.rateLimit ? { rateLimit: overrides.rateLimit } : {}) },
      identity, identityConfig, runtime: undefined, audit: undefined, evidence: [], localIssuer: undefined,
    };
  }
  return composeLocalRuntime(config, identityConfig, sink, failure, overrides);
}

function composeLocalRuntime(config: ApiConfig, identityConfig: LocalIdentityConfig, sink: ReliabilitySink, failure: () => void, overrides: RuntimeOverrides): ComposedApiRuntime {
  const { session, sealing } = resolveApiSessionConfiguration(config);
  const now = overrides.now ?? (() => new Date());
  const client = overrides.client ?? lazyDataAccessClient(() => createApiClient());
  const sessionStore = createSessionStore(client);
  const sessions = buildSessionFactSourceAdapter(session, identityConfig.environmentId, client);
  const audit = new InProcessRestrictedAuditStore();
  const budget = composeBudgetApi({ client, environmentId: identityConfig.environmentId, sessions, pepper: session.pepper, now });
  const budgetFacts = budgetFactReader(identityConfig.environmentId);
  const extend: FactReader = async (source, lookup, scoped) => {
    const facts = { ...(await budgetFacts(source, lookup, scoped) ?? {}), ...(await overrides.extendFacts?.(source, lookup, scoped) ?? {}) };
    return Object.keys(facts).length ? facts : null;
  };
  const boundary = new AuthorizationBoundary(
    new FactAssembler("api", budget.facts(createApiFactSource({ sessions, client, extend })), now, 5_000, budget.candidates, { environmentId: identityConfig.environmentId }),
    new DispatchingTransactionStore(new ApiTransactionStore(client, audit), audit, budget.stores),
    new RestrictedAudit(audit, PROTOTYPE_AUDIT_GOVERNANCE),
    failure,
  );
  const evidence: IdentityEvidence[] = [];
  const evidenceSink: IdentityEvidenceSink = overrides.evidence ?? ((event) => { if (evidence.length < 10_000) evidence.push(event); });
  const localIssuer = overrides.transport ? undefined : new LocalIssuer({ issuer: identityConfig.issuer, clientId: identityConfig.clientId, callbackUri: identityConfig.callbackUri, now });
  const transport = overrides.transport ?? localIssuer!;
  const ceremony = new IdentityCeremony({
    config: identityConfig, client, sessionStore, sessionConfig: session, sealing, transport, challenges: new ChallengeStore(now), now,
    evidence: evidenceSink, reliability: sink, serviceVersion: config.SERVICE_VERSION, mappingHooks: overrides.mappingHooks,
  });
  const runtime: IdentityRuntime = { ceremony, localIssuer: overrides.transport ? (overrides.transport instanceof LocalIssuer ? overrides.transport : undefined) : localIssuer, sessionPepper: session.pepper };
  const identity = identityHttp(runtime);
  const authorization: Wiring = {
    modules: [identity.module, ...budget.modules],
    boundary,
    ...(overrides.rateLimit ? { rateLimit: overrides.rateLimit } : {}),
    // The rate-limit preHandler already denied any unregistered or unapproved surface before canActivate runs (CBD-266 section 8.1); this flag is that gate's duplicate notion (CBD266-COMPLETION-001 follow-up).
    surfaceApproved: async () => true,
    sessionLocator: (request) => readSessionCookieValue(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined),
    // Uniform denial pending the PR-94-003 response contract (OPEN-266-RESPONSE): one status, one body, for every denial class.
    deny: (response) => { throw new HttpException(response, 403); },
  };
  return { authorization, identity, identityConfig, runtime, audit, evidence, localIssuer: runtime.localIssuer };
}
