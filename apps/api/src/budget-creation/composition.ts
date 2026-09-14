/**
 * Production dependencies for the budget route modules (PROTO-ACTIVATION-001).
 *
 * The three merged route packages ship their controllers as functions of
 * explicit dependencies (`budgetApiHttp`, `targetsHttp`) and none of them
 * composes the production ports; this module does, over the API role's
 * data-access client, so `sessions/runtime.ts` can pass the modules through
 * `authorization.modules` and dispatch the boundary's transaction store by
 * action.
 *
 * Trusted subject context: the proposal and confirmation handlers receive the
 * subject the boundary resolved and ask `context(request, subject)` for the
 * CBD-232 `AuthenticatedSubjectContext`. It is resolved here from the same
 * session store and profile rows the boundary reads -- the session cookie
 * (never a body field) names the session, `sessionGeneration` is the CBD-191
 * per-session version, and the profile is the subject's one active financial
 * profile. `accountId` is the account subject identifier: CBD-190 models one
 * account subject per account and the prototype has no separate account row.
 *
 * Binding keyring: CBD-232 section 7.1 needs a server-held HMAC key for the
 * confirmation binding. No configured variable exists for it and this packet
 * may not add one to the contracts schema, so the key is derived once per
 * process with HKDF from the configured session pepper under a distinct
 * purpose label (`cobudget/cbd-232/binding/v1`); the pepper itself is never
 * used directly and the derived key is never persisted. Restarting the
 * process keeps the same key while the pepper is unchanged, so an issued
 * proposal survives a restart. Reported as an assumption for the Manager.
 */
import { hkdfSync, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import { readSessionCookieValue } from "@cobudget/sessions";
import type { MinimalFactSourceAdapter } from "@cobudget/sessions";
import { hmacSha256Base64Url } from "../../../../packages/budget-application/src/creation-proposals/canonical-json.ts";
import type { AuthenticatedSubjectContext, BindingKeyring, CurrencyContextReader, Ports } from "../../../../packages/budget-application/src/creation-proposals/ports.ts";
import { DurableProposalStore } from "../../../../packages/budget-application/src/persistence/proposal-store.ts";
import { ISO4217_MINOR_UNITS, SUPPORTED_MINOR_UNIT_PRECISIONS } from "../../../../packages/budget-application/src/targets/index.ts";
import { RouteFailure } from "../authorization/http.js";
import { listProfiles } from "../identity/store.ts";
import { budgetApiHttp } from "./modules.ts";
import { CreationAuthorizationStore } from "./transaction-store.js";
import { dataAccessTargetsDependencies, TARGET_ACTIONS, TargetsAuthorizationStore, targetsHttp } from "../targets/http.ts";

export interface BudgetCompositionOptions {
  readonly client: DataAccessClient;
  readonly environmentId: string;
  /** The session fact source: resolves the opaque cookie to the subject, session reference and version. */
  readonly sessions: MinimalFactSourceAdapter;
  /** Session pepper (>= 32 bytes) the binding key is derived from. */
  readonly pepper: Buffer;
  readonly now: () => Date;
  /** Confirmation attempt budget for serialization conflicts (1..10). */
  readonly attempts?: number;
}

const CBD231_CONSTRAINT_VERSION = "cbd-231/0.1";

/** A single HKDF-derived HMAC key under a purpose label; the pepper is never the key. */
export function deriveBindingKeyring(pepper: Buffer): BindingKeyring {
  if (pepper.length < 32) throw new Error("binding_key_material_insufficient");
  const key = Buffer.from(hkdfSync("sha256", pepper, Buffer.alloc(0), "cobudget/cbd-232/binding/v1", 32)).toString("base64url");
  const keyId = "k1";
  const version = "bcp-hmac-sha256/v1" as const;
  return {
    bindingVersion: version,
    sign: (canonical) => `${version}.${keyId}.${hmacSha256Base64Url(key, canonical)}`,
    verify: (canonical, token) => {
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== version || parts[1] !== keyId) return false;
      const expected = hmacSha256Base64Url(key, canonical);
      const actual = parts[2]!;
      if (expected.length !== actual.length) return false;
      let diff = 0;
      for (let index = 0; index < expected.length; index++) diff |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
      return diff === 0;
    },
  };
}

/** Currency support is the CBD-153 ISO 4217 catalog restricted to the precisions the budget domain supports. */
export const prototypeCurrencyContextReader: CurrencyContextReader = {
  currencyCatalogVersion: "iso4217-cbd153-v1",
  isSupportedCode: (code) => { const precision = ISO4217_MINOR_UNITS[code]; return precision !== undefined && SUPPORTED_MINOR_UNIT_PRECISIONS.includes(precision); },
  isCompatibleWithContext: () => true,
};

/** Inside the boundary's transaction the proposal store must join it: its own `transaction()` calls run on the scoped client instead of opening a nested one. */
function joined(scoped: DataAccessClient): DataAccessClient {
  return { ...scoped, transaction: async (_options, work) => work(scoped) };
}

function cookieOf(request: FastifyRequest): string | undefined {
  const cookie = request.headers.cookie;
  return readSessionCookieValue(typeof cookie === "string" ? cookie : undefined);
}

export function composeBudgetApi(options: BudgetCompositionOptions) {
  const { client, environmentId, sessions, now } = options;
  const attempts = options.attempts ?? 3;
  const keyring = deriveBindingKeyring(options.pepper);
  const timeZoneDataVersion = `icu-tz-${process.versions.tz ?? "unknown"}`;
  const proposals = new DurableProposalStore(client, randomUUID, () => now().toISOString());

  const context = async (request: FastifyRequest, subject: string): Promise<AuthenticatedSubjectContext> => {
    const resolved = await sessions.read("session_store", { credential: cookieOf(request) });
    const subjectId = resolved?.["subject.accountSubjectId"];
    const sessionVersion = resolved?.["subject.sessionVersion"];
    if (typeof subjectId !== "string" || subjectId !== subject || typeof sessionVersion !== "number") throw new RouteFailure(401, "not_authenticated");
    const profile = (await listProfiles(client, subjectId)).find((candidate) => candidate.profileState === "active");
    if (!profile) throw new RouteFailure(401, "not_authenticated");
    return { environment: environmentId, subjectId, accountId: subjectId, profileId: profile.profileId, sessionGeneration: sessionVersion };
  };
  const ports = async (_context: AuthenticatedSubjectContext, scoped: DataAccessClient = client): Promise<Ports> => ({
    clock: { now }, idGenerator: { proposalId: () => "bcp_" + randomUUID().replaceAll("-", "") }, bindingKeyring: keyring,
    currencyContextReader: prototypeCurrencyContextReader, constraintReader: { currentConstraintVersion: () => CBD231_CONSTRAINT_VERSION },
    store: scoped === client ? proposals : new DurableProposalStore(joined(scoped), randomUUID, () => now().toISOString()), timeZoneDataVersion,
  });

  const creationStore = new CreationAuthorizationStore(client, attempts);
  const budget = budgetApiHttp(
    { client, proposals, transactions: creationStore, persistence: { attempts, reload: async (scoped, reloaded) => ({ context: reloaded, ports: await ports(reloaded, scoped) }), authorize: async () => { throw new Error("authorize is supplied by the route"); }, allowAudit: async () => { throw new Error("allowAudit is supplied by the route"); } }, context },
    { context, ports: (subjectContext, transaction) => ports(subjectContext, transaction as DataAccessClient | undefined) },
    { client, clock: { now } },
  );
  const targets = targetsHttp(dataAccessTargetsDependencies(client));
  const targetsStore = new TargetsAuthorizationStore(client);
  return {
    modules: [...budget.modules, targets.module],
    candidates: budget.candidates,
    facts: budget.facts,
    stores: [
      { actions: ["space.create"], store: creationStore },
      { actions: Object.values(TARGET_ACTIONS), store: targetsStore },
    ],
  };
}
