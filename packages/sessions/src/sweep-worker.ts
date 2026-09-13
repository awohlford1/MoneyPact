/**
 * §3.1/§5.3 expiry sweep (CBD191-SECURITY-002 High finding 4; Manager ruling
 * `CBD191-CORRECTION-001` item 3): "an envelope that is never replayed
 * remains recoverable indefinitely" without a sweep. This exported job
 * function zeroes expired-unacknowledged `session_delivery_result` rows and
 * revokes their orphan sessions, the same effect `issuance.ts`'s replay path
 * already performs for a handoff someone actually tries to replay after
 * expiry -- this is the counterpart for a handoff nobody ever replays.
 *
 * Like `outbox-worker.ts`'s `drainRevocationOutbox`, this packet may only
 * *define* the job here; `apps/worker` registration (scheduling) is an
 * explicitly named follow-up and out of this packet's writable scope.
 */
import type { SessionStore } from "./store.ts";

export interface SweepResult {
  readonly swept: number;
}

export async function sweepExpiredDeliveryResults(store: SessionStore, now: Date = new Date(), limit = 100): Promise<SweepResult> {
  const expired = await store.claimExpiredUnacknowledgedDeliveryResults(now, limit);
  for (const { sessionHandoffId, sessionRef } of expired) {
    await store.markRevoked(sessionRef, "orphaned_delivery_result_expiry");
    await store.acknowledgeDeliveryResult(sessionHandoffId);
  }
  return { swept: expired.length };
}
