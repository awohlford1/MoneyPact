/**
 * §6.2 `SC-191-004` provider-initiated revocation processing
 * (`recordProviderEvent`, CBD-191-AC05).
 *
 * CBD191-CORRECTION-001 item 6 (CBD191-REVIEW-IMPL-001/CBD191-SECURITY-002
 * High findings: "provider replay and ordering effects are not atomic"):
 * the canonical event row is now inserted FIRST (claiming the dedupe key),
 * and only a non-duplicate insert may proceed to affect the authority row,
 * closing the "two concurrent deliveries of the same provider_event_id both
 * bump" race. The subtler race -- two *different* concurrently-processed
 * events racing on the same cursor watermark -- is closed by deciding and
 * committing the epoch bump and the watermark advance in one
 * `store.applyProviderEffect` compare-and-swap (see `store.ts`): the
 * pre-insert cursor check is only ever used to decide the *safe* outcome
 * ("superseded" against an already-observed watermark, which can only be
 * stale-low, never stale-high, so it is never wrong); every event that
 * looks eligible to apply is re-checked against the *current* watermark
 * inside the same atomic step that would commit its bump, and is corrected
 * to `superseded` after the fact if a concurrent higher-cursor event won
 * first. `resolveIdentityBinding` is an injected dependency: CBD-190's
 * `identity_binding` table does not exist in this wave (see the migration
 * headers' "DEFERRED IDENTITY FK" notes), and this packet may not create
 * identity tables.
 *
 * CBD191-SECURITY-002 Medium finding 7 / CBD191-SECURITY-003 finding 2
 * (Refuted -> fixed): `processProviderEvent` takes an
 * `AuthenticatedProviderEvent` (`local-adapter.ts`), but a TypeScript
 * parameter type alone is erased at runtime and does not stop a
 * runtime-constructed forgery. `isAuthenticated` is the actual runtime
 * check -- see `local-adapter.ts`'s module header -- and this function
 * calls it itself, first, before touching any field of the event, so a
 * direct `{ event: forgedEvent }` object or a directly-constructed
 * `AuthenticatedProviderEvent` (bypassing `authenticate`) is refused with
 * `UnauthenticatedProviderEventError` rather than reaching the epoch-bump
 * path.
 */
import { isAuthenticated } from "./local-adapter.ts";
import { UnauthenticatedProviderEventError } from "./local-adapter.ts";
import type { AuthenticatedProviderEvent } from "./local-adapter.ts";
import { providerEventClassToCause } from "./types.ts";
import type { SessionConfig } from "./config.ts";
import type { SessionStore } from "./store.ts";
import type { AccountSubjectId, Environment } from "./types.ts";

export interface IdentityBindingLookup {
  readonly accountSubjectId: AccountSubjectId;
  readonly identityBindingId: string;
}

export type ResolveIdentityBinding = (issuer: string, providerSubject: string) => Promise<IdentityBindingLookup | undefined>;

export type ProviderEventResult =
  | { readonly outcome: "duplicate"; readonly processingState: string }
  | { readonly outcome: "rejected"; readonly reason: "cross_environment" | "unknown_binding" }
  | { readonly outcome: "applied"; readonly revocationEpoch: number }
  | { readonly outcome: "applied_pending_reconciliation"; readonly revocationEpoch: number }
  | { readonly outcome: "superseded" };

/** Lexical max of two watermark values, treating `""` (no cursor applied yet) as the bottom. */
function maxCursor(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * §6.2 steps 1-8. `servingEnvironmentId` is the adapter's own trusted
 * configuration, never event content (already true of
 * `event.environmentId`, but this function also cross-checks it against the
 * environment actually serving the request, matching §3.3's
 * other-environment isolation rule for sessions).
 */
export async function processProviderEvent(
  authenticated: AuthenticatedProviderEvent,
  servingEnvironmentId: Environment,
  store: SessionStore,
  config: SessionConfig,
  resolveIdentityBinding: ResolveIdentityBinding,
): Promise<ProviderEventResult> {
  // Runtime authenticity check (CBD191-SECURITY-003 finding 2): checked
  // before anything else, including before reading any field of
  // `authenticated`, so a forged object never reaches even the
  // cross-environment check below with attacker-controlled content.
  if (!isAuthenticated(authenticated)) throw new UnauthenticatedProviderEventError();
  const event = authenticated.event;
  // Step 3: cross-environment. No authority effect; dedupe-protected insert
  // still claims the key first so a duplicate rejected delivery is also
  // idempotent.
  if (event.environmentId !== servingEnvironmentId) {
    const inserted = await store.insertProviderEvent(event.environmentId, event, { processingState: "rejected", rejectionReason: "cross_environment", identityBindingId: undefined });
    if (inserted.status === "duplicate") return { outcome: "duplicate", processingState: String(inserted.row.processing_state) };
    return { outcome: "rejected", reason: "cross_environment" };
  }

  // Step 4: unresolvable binding.
  const binding = await resolveIdentityBinding(event.issuer, event.providerSubject);
  if (!binding) {
    const inserted = await store.insertProviderEvent(event.environmentId, event, { processingState: "rejected", rejectionReason: "unknown_binding", identityBindingId: undefined });
    if (inserted.status === "duplicate") return { outcome: "duplicate", processingState: String(inserted.row.processing_state) };
    return { outcome: "rejected", reason: "unknown_binding" };
  }

  const cause = providerEventClassToCause(event.eventClass);
  const nowMs = Date.now();
  const maxFutureSkewMs = config.providerMaxFutureSkewSeconds * 1000;
  const isFutureSkewed = event.providerEventTime.getTime() - nowMs > maxFutureSkewMs;

  // Step 6, pre-insert: a cursor at or below an *already-observed* watermark
  // is always safely superseded -- the real watermark can only be the same
  // or higher by the time this insert commits, since it is monotonic and
  // this is the only path that ever advances it. This is why "superseded"
  // never needs the post-insert re-check: it cannot be an over-eager
  // decision that a concurrent writer somehow invalidates.
  const authoritySnapshot = event.orderingCursor ? await store.currentSubjectAuthority(binding.accountSubjectId) : undefined;
  const preInsertSuperseded = Boolean(event.orderingCursor && authoritySnapshot && event.orderingCursor <= authoritySnapshot.latestAppliedCursor);

  const initialProcessingState = preInsertSuperseded ? "superseded" : isFutureSkewed ? "applied_pending_reconciliation" : "applied";

  const inserted = await store.insertProviderEvent(event.environmentId, event, {
    processingState: initialProcessingState,
    rejectionReason: undefined,
    identityBindingId: binding.identityBindingId,
  });
  if (inserted.status === "duplicate") {
    // §6.2 step 1: exactly one effect. The winner of the insert race already
    // performed (or will perform) any bump; this delivery does nothing more.
    return { outcome: "duplicate", processingState: String(inserted.row.processing_state) };
  }

  if (preInsertSuperseded) {
    return { outcome: "superseded" };
  }

  const providerSecurityEventId = String(inserted.row.provider_security_event_id);

  // Steps 7/8: commit the epoch bump and the cursor watermark advance in one
  // compare-and-swap against the *current* authority row. If a concurrent
  // higher-cursor event already advanced the watermark past this one, the
  // decision below detects it against a fresh read and performs no write;
  // the already-inserted row is then corrected to `superseded`.
  const decision = await store.applyProviderEffect(binding.accountSubjectId, (current) => {
    if (event.orderingCursor && event.orderingCursor <= current.latestAppliedCursor) {
      return { result: "lost_race" as const };
    }
    return {
      write: {
        revocationEpoch: current.revocationEpoch + 1,
        bumpCause: cause,
        ...(event.orderingCursor ? { latestAppliedCursor: maxCursor(current.latestAppliedCursor, event.orderingCursor) } : {}),
      },
      result: "applied" as const,
    };
  });

  if (decision === "lost_race") {
    await store.correctProviderEventToSuperseded(providerSecurityEventId);
    return { outcome: "superseded" };
  }

  const revocationEpoch = (await store.currentSubjectAuthority(binding.accountSubjectId)).revocationEpoch;
  return isFutureSkewed ? { outcome: "applied_pending_reconciliation", revocationEpoch } : { outcome: "applied", revocationEpoch };
}

/** Reconciliation: transitions a quarantined row to `applied` once its ordering is confirmed (§6.2 step 7). */
export async function reconcileProviderEvent(store: SessionStore, providerSecurityEventId: string): Promise<void> {
  await store.reconcilePendingEvent(providerSecurityEventId);
}
