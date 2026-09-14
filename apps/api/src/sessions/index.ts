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

export function buildSessionFactSourceAdapter(config: SessionConfig, environmentId: string, client: DataAccessClient = createApiClient()): MinimalFactSourceAdapter {
  const store = createSessionStore(client);
  return createSessionFactSourceAdapter(store, config, environmentId);
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
