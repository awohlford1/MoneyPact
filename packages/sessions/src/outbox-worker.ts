/**
 * §6.1/§6.3 revocation-outbox drain job.
 *
 * The packet authorizes only *defining* this as an exported job function
 * here; `apps/worker` registration (scheduling, retry cadence wiring) is an
 * explicitly named follow-up and out of this packet's writable scope
 * (`apps/worker/**` is not writable).
 *
 * `ProviderRevocationAdapter` is injected: the real Cognito global-
 * invalidation/current-browser-bound operations are provider- and
 * Security-decision-dependent (`OQ-191-002`, `OQ-191-003`) and out of this
 * document's and this packet's scope. `local-adapter.ts` supplies the
 * PROVIDERS-LOCAL-001 fixture implementation for tests.
 *
 * CBD191-CORRECTION-001 item 6 (CBD191-REVIEW-IMPL-001/CBD191-SECURITY-002
 * High findings on the outbox):
 *  - claiming is now `store.claimRevocationActions`'s atomic per-row
 *    compare-and-swap to `in_flight`, which also honors `next_attempt_at`
 *    (see `store.ts`) -- two concurrent drains can never dispatch the same
 *    action, and a deferred retry is never immediately reclaimable.
 *  - `ambiguous` actions are reconciled through `reconcileAmbiguous` --
 *    which queries the provider for the action's actual outcome -- *before*
 *    they become plainly retryable again; they are not in
 *    `store`'s retryable-state set at all.
 *  - retry backoff is capped so `next_attempt_at` never exceeds the action's
 *    own `deadline_at`.
 *  - a missed deadline is still recorded (`failed_deadline_exceeded`, so the
 *    action stops being dispatched forever) but now also invokes
 *    `onDeadlineExceeded`, a caller-supplied escalation hook -- the
 *    mechanism a future `apps/worker` registration pages or fails readiness
 *    from, since this package has no paging system of its own to call.
 */
import type { SessionStore } from "./store.ts";
import type { OutboxAttemptState, RevocationAction } from "./types.ts";

export type ProviderOperationOutcome = "succeeded" | "ambiguous" | "failed";

export interface ProviderRevocationAdapter {
  invalidateGlobal(action: RevocationAction): Promise<ProviderOperationOutcome>;
  invalidateCurrentBrowserBound(action: RevocationAction): Promise<ProviderOperationOutcome>;
  /** §6.1: "reconcile ambiguous provider results before retry." Queries the
   * provider for the action's actual outcome rather than re-attempting it
   * blindly. */
  queryStatus(action: RevocationAction): Promise<ProviderOperationOutcome>;
}

export interface DelegationRetirementAdapter {
  /** §7 `retireSubjectDelegations`; `OQ-191-004` leaves the owning package
   * unassigned, so this stays an injected port rather than a concrete
   * dependency this package cannot yet have. */
  retireSubjectDelegations(environmentId: string, accountSubjectId: string, revocationEpoch: number, cause: string): Promise<void>;
}

export interface DrainOptions {
  readonly limit: number;
  readonly now: Date;
  readonly retryBackoffMs: (attemptCount: number) => number;
  /** Invoked for every action whose deadline is missed, so a caller can page
   * or fail readiness. The action's revocation requirement is not dropped:
   * the outbox row is preserved (as `failed_deadline_exceeded`) rather than
   * deleted, so it remains visible for manual/operational follow-up. */
  readonly onDeadlineExceeded: (action: RevocationAction) => void;
}

const DEFAULT_BACKOFF = (attemptCount: number): number => Math.min(2 ** attemptCount * 1000, 5 * 60 * 1000);

function cappedNextAttempt(now: Date, backoffMs: number, deadlineAt: Date): Date {
  return new Date(Math.min(now.getTime() + backoffMs, deadlineAt.getTime()));
}

export interface DrainResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly ambiguous: number;
  readonly deadlineExceeded: number;
  readonly reconciled: number;
}

async function dispatch(action: RevocationAction, providerAdapter: ProviderRevocationAdapter, delegationAdapter: DelegationRetirementAdapter): Promise<ProviderOperationOutcome> {
  if (action.target === "delegation_retirement") {
    await delegationAdapter.retireSubjectDelegations(action.environmentId, action.accountSubjectId, action.revocationEpoch, action.cause);
    return "succeeded";
  }
  if (action.target === "provider_global_invalidation") return providerAdapter.invalidateGlobal(action);
  return providerAdapter.invalidateCurrentBrowserBound(action);
}

/**
 * §6.1 "reconcile ambiguous provider results before retry": queries each
 * currently-`ambiguous` action's real outcome and only then records a
 * terminal or retryable state. An action that is still ambiguous after
 * querying is left `ambiguous` with a backoff-capped `next_attempt_at`,
 * rather than becoming immediately retryable or spun on every drain cycle.
 */
async function reconcileAmbiguous(
  store: SessionStore,
  providerAdapter: ProviderRevocationAdapter,
  now: Date,
  backoff: (attemptCount: number) => number,
  limit: number,
  onDeadlineExceeded: (action: RevocationAction) => void,
): Promise<{ reconciled: number; deadlineExceeded: number; succeeded: number; failed: number }> {
  // CBD191-SECURITY-003 finding 1: claiming (CAS ambiguous -> in_flight,
  // honoring next_attempt_at) gives exclusive ownership of each row before
  // it is ever queried, so two concurrent drains can never both reconcile
  // the same action.
  const actions = await store.claimAmbiguousForReconciliation(now, limit);
  let reconciled = 0;
  let deadlineExceeded = 0;
  let succeeded = 0;
  let failed = 0;

  for (const action of actions) {
    if (action.deadlineAt.getTime() < now.getTime()) {
      await store.recordOutboxAttempt(action.revocationActionId, "in_flight", "failed_deadline_exceeded", undefined);
      onDeadlineExceeded(action);
      deadlineExceeded += 1;
      continue;
    }
    const status = await providerAdapter.queryStatus(action);
    if (status === "succeeded") {
      await store.recordOutboxAttempt(action.revocationActionId, "in_flight", "succeeded", undefined);
      succeeded += 1;
      reconciled += 1;
    } else if (status === "failed") {
      const nextAttemptAt = cappedNextAttempt(now, backoff(action.attemptCount), action.deadlineAt);
      await store.recordOutboxAttempt(action.revocationActionId, "in_flight", "failed_will_retry", nextAttemptAt);
      failed += 1;
      reconciled += 1;
    } else {
      // Still ambiguous: return it to ambiguous (releasing the claim taken
      // above), but do not let it be re-queried again until the backoff
      // window passes.
      const nextAttemptAt = cappedNextAttempt(now, backoff(action.attemptCount), action.deadlineAt);
      await store.recordOutboxAttempt(action.revocationActionId, "in_flight", "ambiguous", nextAttemptAt);
    }
  }
  return { reconciled, deadlineExceeded, succeeded, failed };
}

/**
 * Exported job function (`packages/sessions` may only define this; see the
 * module header). Reconciles ambiguous actions, then claims and dispatches
 * ordinarily-retryable ones.
 */
export async function drainRevocationOutbox(
  store: SessionStore,
  providerAdapter: ProviderRevocationAdapter,
  delegationAdapter: DelegationRetirementAdapter,
  options: Partial<DrainOptions> = {},
): Promise<DrainResult> {
  const limit = options.limit ?? 50;
  const now = options.now ?? new Date();
  const backoff = options.retryBackoffMs ?? DEFAULT_BACKOFF;
  const onDeadlineExceeded = options.onDeadlineExceeded ?? (() => {});

  const reconciliation = await reconcileAmbiguous(store, providerAdapter, now, backoff, limit, onDeadlineExceeded);

  const actions = await store.claimRevocationActions(now, limit);
  let succeeded = reconciliation.succeeded;
  let failed = reconciliation.failed;
  let ambiguous = 0;
  let deadlineExceeded = reconciliation.deadlineExceeded;

  for (const action of actions) {
    if (action.deadlineAt.getTime() < now.getTime()) {
      await store.recordOutboxAttempt(action.revocationActionId, "in_flight", "failed_deadline_exceeded", undefined);
      onDeadlineExceeded(action);
      deadlineExceeded += 1;
      continue;
    }

    let outcome: ProviderOperationOutcome;
    try {
      outcome = await dispatch(action, providerAdapter, delegationAdapter);
    } catch {
      outcome = "failed";
    }

    const state: OutboxAttemptState = outcome === "succeeded" ? "succeeded" : outcome === "ambiguous" ? "ambiguous" : "failed_will_retry";
    const nextAttemptAt = state === "succeeded" ? undefined : cappedNextAttempt(now, backoff(action.attemptCount), action.deadlineAt);
    await store.recordOutboxAttempt(action.revocationActionId, "in_flight", state, nextAttemptAt);

    if (state === "succeeded") succeeded += 1;
    else if (state === "ambiguous") ambiguous += 1;
    else failed += 1;
  }

  return { claimed: actions.length, succeeded, failed, ambiguous, deadlineExceeded, reconciled: reconciliation.reconciled };
}
