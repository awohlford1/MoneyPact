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
import type { ResolutionOutcome } from "./resolve.ts";
import type { SessionConfig } from "./config.ts";
import type { SessionStore, TransactionSessionStore } from "./store.ts";
import type { Environment } from "./types.ts";

export interface MinimalFactSourceAdapter {
  read(
    source: string,
    lookup: { readonly credential: unknown; readonly identityOnly?: boolean },
    transaction?: unknown,
  ): Promise<Readonly<Record<string, unknown>> | null>;
}

/**
 * Builds a `FactSourceAdapter`-shaped object for `source === "session_store"`.
 * Typed loosely (`MinimalFactSourceAdapter`) rather than importing
 * `apps/api/src/authorization/facts.ts`'s exact type, since that file is
 * outside this packet's writable scope and packages/sessions must not take a
 * compile-time dependency on `apps/api` internals; the shape matches
 * `FactSourceAdapter.read` exactly and the caller in
 * `apps/api/src/sessions/**` is what actually satisfies the real interface.
 *
 * SC-191-006 / IDLE-E05 / IDLE-D04 (corrected per REV-IDLE-1/REV-IDLE-4): three resolution shapes, chosen by
 * an explicit discriminator the caller sets, never inferred from `operation.action` or any other field a
 * route happens to shape -- an earlier revision of this dispatch sniffed `operation.action === ""`, which the
 * `apps/api` wrapper (`apps/api/src/sessions/fact-source.ts`) never actually forwarded, so every
 * non-transactional resolution silently took the read-only branch and the gate never slid at all (caught by
 * the corrected live probe, `IDLE-T03`). `lookup.identityOnly` is the one field this module reads to choose:
 *
 *   - inside a mutation's effect transaction (`transaction !== undefined`): the scoped, transaction-bound
 *     store resolves in `"wait"` mode and fences, exactly as PROTO-ACTIVATION-001 A2 proved (unchanged).
 *   - `lookup.identityOnly === true` (set only by `apps/api/src/authorization/facts.ts`'s
 *     `FactAssembler#resolveSession`, called from the preHandler session gate, and forwarded unchanged by the
 *     `apps/api` wrapper): the one non-transactional resolution that must actually slide, and it does so
 *     best-effort (`"skip_locked"`), never waiting on the session's own in-flight mutation.
 *   - every other non-transactional resolution (the precheck inside `canActivate`'s `boundary.authorize`,
 *     which resolves the same session again a few milliseconds later to assemble the full policy input): the
 *     slide is redundant with the gate's, which has already committed (autocommit) by the time this read
 *     runs, so this path is read-only (`"none"`, IDLE-D04) -- the precheck slide is removed.
 */
export function createSessionFactSourceAdapter(store: SessionStore, config: SessionConfig, environmentId: Environment, storeFor?: (transaction: unknown) => TransactionSessionStore | undefined): MinimalFactSourceAdapter {
  return {
    async read(source, lookup, transaction) {
      if (source !== "session_store") return null;
      const cookieValue = typeof lookup.credential === "string" ? lookup.credential : undefined;
      const now = new Date();
      // PROTO-ACTIVATION-001 A2 (review R02): inside a mutation transaction the session is resolved through a
      // store bound to that transaction, so the session row read and its idle-extension write are part of the
      // transaction, and the subject's revocation epoch is fenced by a conditional write on the authority row.
      // A revoke or subject-wide bump that lands between this read and the mutation's COMMIT therefore aborts
      // the mutation instead of being overtaken by it.
      const scoped = transaction !== undefined && storeFor ? storeFor(transaction) : undefined;
      let outcome: ResolutionOutcome;
      if (scoped) {
        outcome = await resolveSession(cookieValue, scoped, config, environmentId, now, "wait");
      } else if (lookup.identityOnly === true) {
        outcome = await resolveSession(cookieValue, store, config, environmentId, now, "skip_locked");
      } else {
        outcome = await resolveSession(cookieValue, store, config, environmentId, now, "none");
      }
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
