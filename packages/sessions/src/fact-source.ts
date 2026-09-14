/**
 * The `session_store` `FactSourceAdapter` (apps/api/src/authorization/facts.ts,
 * not writable in this packet -- this module is the "real sessions" adapter
 * the packet asks be implemented in packages/sessions and registered by the
 * caller). `ApiAuthorizationOptions.sessionLocator(request)` already reads
 * only the opaque cookie value (apps/api/src/authorization/http.ts); this
 * adapter's `lookup.credential` is exactly that value, so an IdP token or any
 * other credential shape presented instead resolves to nothing here, which
 * is what makes CBD-191-AC01 true at this boundary too.
 *
 * The adapter interface (`FactSourceAdapter.read`) does not carry an
 * `environmentId` parameter today, so this factory closes over the serving
 * environment at construction time -- the same "adapter's own trusted
 * configuration, never request content" rule §6.2 states for provider
 * events, applied here to sessions.
 */
import { resolveSession } from "./resolve.ts";
import type { SessionConfig } from "./config.ts";
import type { SessionStore } from "./store.ts";
import type { Environment } from "./types.ts";

export interface MinimalFactSourceAdapter {
  read(source: string, lookup: { readonly credential: unknown }, transaction?: unknown): Promise<Readonly<Record<string, unknown>> | null>;
}

/**
 * Builds a `FactSourceAdapter`-shaped object for `source === "session_store"`.
 * Typed loosely (`MinimalFactSourceAdapter`) rather than importing
 * `apps/api/src/authorization/facts.ts`'s exact type, since that file is
 * outside this packet's writable scope and packages/sessions must not take a
 * compile-time dependency on `apps/api` internals; the shape matches
 * `FactSourceAdapter.read` exactly and the caller in
 * `apps/api/src/sessions/**` is what actually satisfies the real interface.
 */
export function createSessionFactSourceAdapter(store: SessionStore, config: SessionConfig, environmentId: Environment, storeFor?: (transaction: unknown) => SessionStore | undefined): MinimalFactSourceAdapter {
  return {
    async read(source, lookup, transaction) {
      if (source !== "session_store") return null;
      const cookieValue = typeof lookup.credential === "string" ? lookup.credential : undefined;
      // PROTO-ACTIVATION-001 A2 (review R02): inside a mutation transaction the session is resolved through a
      // store bound to that transaction, so the session row read and its idle-extension write are part of the
      // transaction, and the subject's revocation epoch is fenced by a conditional write on the authority row.
      // A revoke or subject-wide bump that lands between this read and the mutation's COMMIT therefore aborts
      // the mutation instead of being overtaken by it.
      const scoped = transaction !== undefined && storeFor ? storeFor(transaction) : undefined;
      const outcome = await resolveSession(cookieValue, scoped ?? store, config, environmentId, new Date());
      if (outcome.status !== "resolved") return null;
      if (scoped && !await scoped.fenceRevocationEpoch(outcome.accountSubjectId)) return null;
      return {
        "subject.accountSubjectId": outcome.accountSubjectId,
        "subject.sessionRef": outcome.sessionRef,
        "subject.sessionVersion": outcome.sessionVersion,
      };
    },
  };
}
