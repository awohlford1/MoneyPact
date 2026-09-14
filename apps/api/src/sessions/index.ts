/**
 * CBD-191 API-side session integration seam.
 *
 * `buildSessionFactSourceAdapter` composes `@cobudget/sessions`'s store and
 * resolver behind `@cobudget/data-access`'s API-role client into the
 * `session_store` `FactSourceAdapter` `apps/api/src/authorization/facts.ts`
 * consumes. PROTO-IDENTITY-API-001 finished the wiring CBD191-IMPL-001 left
 * open: `runtime.ts` resolves `SessionConfig` and the envelope-key provider
 * from the validated `ApiConfig`, builds this adapter (on an injectable
 * client so tests never open a pool), composes it with the datastore and
 * idp_evidence readers in `fact-source.ts`, and hands the result to
 * `AppModule.register` from `application.ts`.
 */
import { createApiClient } from "@cobudget/data-access";
import type { DataAccessClient } from "@cobudget/data-access";
import { createSessionFactSourceAdapter, createSessionStore } from "@cobudget/sessions";
import type { MinimalFactSourceAdapter, SessionConfig } from "@cobudget/sessions";

function isDataAccessClient(value: unknown): value is DataAccessClient {
  return typeof value === "object" && value !== null && typeof (value as DataAccessClient).platformSelect === "function" && typeof (value as DataAccessClient).platformUpdate === "function";
}

/**
 * `fence` (default true): inside a boundary transaction the session store is bound to the transaction's
 * client so the session read, idle extension and the revocation-epoch fence are part of the mutation
 * (PROTO-ACTIVATION-001 A2). `false` exists only for the live test that proves the race without it.
 */
export function buildSessionFactSourceAdapter(config: SessionConfig, environmentId: string, client: DataAccessClient = createApiClient(), fence = true): MinimalFactSourceAdapter {
  const store = createSessionStore(client);
  return createSessionFactSourceAdapter(store, config, environmentId, fence ? (transaction) => isDataAccessClient(transaction) ? createSessionStore(transaction) : undefined : undefined);
}

export { readSessionCookieValue, buildSessionCookieHeader, buildSessionCookieDeletionHeader, checkCsrf } from "@cobudget/sessions";
export { resolveSessionConfig, MissingSessionConfigError } from "@cobudget/sessions";
export { resolveSessionEnvelopeKeyProvider } from "@cobudget/sessions";
export type { SessionConfig, SessionConfigEnvironment } from "@cobudget/sessions";
export type { EnvelopeKeyProvider } from "@cobudget/sessions";
export type { EnvelopeKeyConfigEnvironment } from "@cobudget/sessions";
export { composeApiRuntime } from "./runtime.ts";
export { lazyDataAccessClient } from "./runtime.ts";
export { resolveApiIdentityConfiguration } from "./runtime.ts";
export { resolveApiSessionConfiguration } from "./runtime.ts";
export type { ComposedApiRuntime, RuntimeOverrides } from "./runtime.ts";
export { createApiFactSource } from "./fact-source.ts";
export { ApiTransactionStore } from "./transaction-store.ts";
export { InProcessRestrictedAuditStore } from "./audit.ts";
