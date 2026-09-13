/**
 * CBD-191 API-side session integration seam.
 *
 * `buildSessionFactSourceAdapter` composes `@cobudget/sessions`'s store and
 * resolver behind `@cobudget/data-access`'s API-role client into the
 * `session_store` `FactSourceAdapter` `apps/api/src/authorization/facts.ts`
 * (not writable in this packet) already knows how to consume via its
 * `FactSourceAdapter` interface, and the shape `ApiAuthorizationOptions`
 * (`apps/api/src/authorization/http.ts`, also not writable) already expects
 * from `sessionLocator`+a `boundary` built with it.
 *
 * NOT DELIVERED HERE (see the final report's "not delivered because"): the
 * actual startup call that resolves `SessionConfig` from the real
 * environment and passes this adapter into `AppModule.register`'s
 * `authorization` option lives in `apps/api/src/config.ts`,
 * `apps/api/src/bootstrap.ts`, and `apps/api/src/application.ts` -- none of
 * which are in this packet's writable list (only `apps/api/src/sessions/**`
 * and one import/registration line in `app.module.ts`). This module is the
 * ready-to-wire seam; `app.module.ts` re-exports it (see that file's one
 * added line) so the integration that owns those three files can finish the
 * wiring without this packet also owning `apps/api/src/authorization/**`.
 */
import { createApiClient } from "@cobudget/data-access";
import { createSessionFactSourceAdapter, createSessionStore } from "@cobudget/sessions";
import type { MinimalFactSourceAdapter, SessionConfig } from "@cobudget/sessions";

export function buildSessionFactSourceAdapter(config: SessionConfig, environmentId: string): MinimalFactSourceAdapter {
  const client = createApiClient();
  const store = createSessionStore(client);
  return createSessionFactSourceAdapter(store, config, environmentId);
}

export { readSessionCookieValue, buildSessionCookieHeader, buildSessionCookieDeletionHeader, checkCsrf } from "@cobudget/sessions";
export { resolveSessionConfig, MissingSessionConfigError } from "@cobudget/sessions";
export { resolveSessionEnvelopeKeyProvider } from "@cobudget/sessions";
export type { SessionConfig, SessionConfigEnvironment } from "@cobudget/sessions";
export type { EnvelopeKeyProvider } from "@cobudget/sessions";
export type { EnvelopeKeyConfigEnvironment } from "@cobudget/sessions";
