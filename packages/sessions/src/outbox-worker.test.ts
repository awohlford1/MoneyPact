import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ControllableLocalProviderAdapter } from "./local-adapter.ts";
import { drainRevocationOutbox } from "./outbox-worker.ts";
import { consumeAndIssue } from "./issuance.ts";
import { bumpSubjectForCause, logout } from "./revocation.ts";
import { buildTestHarness, testConfig, testEnvelopeKeyProvider } from "./test-support/harness.ts";
import type { SessionIssueCommandV1 } from "./types.ts";

function baseCommand(overrides: Partial<SessionIssueCommandV1> = {}): SessionIssueCommandV1 {
  return {
    contractVersion: 1,
    sessionHandoffId: randomUUID(),
    accountSubjectId: randomUUID(),
    environmentId: "test",
    identityBindingId: randomUUID(),
    rotationCause: "authentication",
    previousSessionId: undefined,
    boundCurrentSessionRef: undefined,
    preparedRevocationEpoch: undefined,
    freshAssurance: undefined,
    deliverUntil: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

const envelopeKeyProvider = testEnvelopeKeyProvider();

function delegationAdapter() {
  const calls: unknown[] = [];
  return {
    calls,
    async retireSubjectDelegations(environmentId: string, accountSubjectId: string, revocationEpoch: number, cause: string) {
      calls.push({ environmentId, accountSubjectId, revocationEpoch, cause });
    },
  };
}

void test("CT-191-012: a successful global invalidation is claimed and marked succeeded", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  await bumpSubjectForCause(store, config, subject, undefined, "test", "security_action");

  const provider = new ControllableLocalProviderAdapter();
  const delegation = delegationAdapter();
  const result = await drainRevocationOutbox(store, provider, delegation);

  assert.equal(result.claimed, 2); // provider_global_invalidation + delegation_retirement
  assert.equal(result.succeeded, 2);
  assert.equal(provider.globalInvocations.length, 1);
  assert.equal(delegation.calls.length, 1);
});

void test("CT-191-012: current-browser-bound logout and global invalidation are separate operations, never sharing a success label", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  await logout(store, config, delivery.sessionRef, "test");

  const provider = new ControllableLocalProviderAdapter();
  const delegation = delegationAdapter();
  const result = await drainRevocationOutbox(store, provider, delegation);

  assert.equal(result.claimed, 1);
  assert.equal(provider.currentBrowserInvocations.length, 1, "logout dispatches the current-browser-bound operation");
  assert.equal(provider.globalInvocations.length, 0, "logout never invokes the global operation");
});

void test("CT-191-008: an ambiguous provider result is reconciled (queried) before it is ever treated as retryable or terminal", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  await bumpSubjectForCause(store, config, subject, undefined, "test", "logout_everywhere");

  const provider = new ControllableLocalProviderAdapter();
  provider.setGlobalMode("ambiguous");
  const delegation = delegationAdapter();
  const first = await drainRevocationOutbox(store, provider, delegation);
  assert.equal(first.ambiguous, 1);
  assert.equal(provider.globalInvocations.length, 1);

  // An ambiguous action is not directly claimable: a drain in between must
  // not re-invoke the operation blindly, only `queryStatus`.
  const between = await drainRevocationOutbox(store, provider, delegation, { now: new Date(Date.now() + 5_000) });
  assert.equal(between.claimed, 0, "ambiguous actions are excluded from ordinary claiming");
  assert.equal(provider.globalInvocations.length, 1, "the underlying operation was not re-invoked");
  assert.equal(provider.queryInvocations.length, 1, "reconciliation queried the action's real status instead");

  // Still ambiguous after the query: stays ambiguous, not silently promoted.
  assert.equal(between.reconciled, 0);
  const outboxAfterQuery = db.tables.get("revocation_outbox") ?? [];
  assert.equal(outboxAfterQuery[0]?.attempt_state, "ambiguous");

  // Now the provider resolves the ambiguity: reconciliation records the real outcome.
  provider.setQueryMode("succeed");
  const resolved = await drainRevocationOutbox(store, provider, delegation, { now: new Date(Date.now() + 10_000) });
  assert.equal(resolved.reconciled, 1);
  assert.equal(resolved.succeeded, 1);
  const outboxAfterResolve = db.tables.get("revocation_outbox") ?? [];
  assert.equal(outboxAfterResolve[0]?.attempt_state, "succeeded");
});

void test("CBD191-SECURITY-003 finding 1: two CONCURRENT drains reconciling the same ambiguous action never both query it, and a terminal outcome cannot regress", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  await bumpSubjectForCause(store, config, subject, undefined, "test", "logout_everywhere");

  const provider = new ControllableLocalProviderAdapter();
  provider.setGlobalMode("ambiguous");
  const delegation = delegationAdapter();

  // First drain dispatches and records the action as ambiguous.
  const first = await drainRevocationOutbox(store, provider, delegation);
  assert.equal(first.ambiguous, 1);

  // The provider now knows the operation actually succeeded. Two concurrent
  // drains race to reconcile the single ambiguous row.
  provider.setQueryMode("succeed");
  const [a, b] = await Promise.all([
    drainRevocationOutbox(store, provider, delegation, { now: new Date(Date.now() + 5_000) }),
    drainRevocationOutbox(store, provider, delegation, { now: new Date(Date.now() + 5_000) }),
  ]);

  // Exactly one drain claimed and queried the row -- ownership was exclusive.
  assert.equal(provider.queryInvocations.length, 1, "the ambiguous action was queried exactly once, never by both concurrent drains");
  assert.equal(a.reconciled + b.reconciled, 1);
  assert.equal(a.succeeded + b.succeeded, 1);

  const outbox = db.tables.get("revocation_outbox") ?? [];
  assert.equal(outbox[0]?.attempt_state, "succeeded", "the recorded terminal outcome is exactly the one real query result, never overwritten");

  // A further drain must not re-query or otherwise touch the now-terminal row.
  const after = await drainRevocationOutbox(store, provider, delegation, { now: new Date(Date.now() + 10_000) });
  assert.equal(after.claimed, 0);
  assert.equal(after.reconciled, 0);
  assert.equal(provider.queryInvocations.length, 1, "no further query after the terminal state was recorded");
  assert.equal((db.tables.get("revocation_outbox") ?? [])[0]?.attempt_state, "succeeded", "the terminal state never regresses");
});

void test("CBD191-SECURITY-003 finding 1: an ambiguous action honors next_attempt_at and is not re-queried before its backoff window", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  await bumpSubjectForCause(store, config, subject, undefined, "test", "logout_everywhere");

  const provider = new ControllableLocalProviderAdapter();
  provider.setGlobalMode("ambiguous");
  const delegation = delegationAdapter();
  await drainRevocationOutbox(store, provider, delegation, { now: new Date(0) });
  assert.equal(provider.globalInvocations.length, 1);

  const nextAttemptAt = (db.tables.get("revocation_outbox") ?? [])[0]?.next_attempt_at as Date | undefined;
  assert.ok(nextAttemptAt, "reconciliation records a backoff-capped next_attempt_at for a still-ambiguous action");

  // A drain before that time must not re-query.
  const tooSoon = await drainRevocationOutbox(store, provider, delegation, { now: new Date(nextAttemptAt!.getTime() - 1) });
  assert.equal(tooSoon.reconciled, 0);
  assert.equal(provider.queryInvocations.length, 0, "not yet due -- no query attempted");

  // At or after that time, reconciliation is attempted again.
  provider.setQueryMode("succeed");
  const due = await drainRevocationOutbox(store, provider, delegation, { now: nextAttemptAt });
  assert.equal(due.reconciled, 1);
  assert.equal(provider.queryInvocations.length, 1);
});

void test("CT-191-008: an action past its deadline is marked failed_deadline_exceeded and not retried", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig({ revocationPropagationTargetSeconds: 1 });
  const subject = randomUUID();
  await bumpSubjectForCause(store, config, subject, undefined, "test", "logout_everywhere");

  const provider = new ControllableLocalProviderAdapter();
  const delegation = delegationAdapter();
  const result = await drainRevocationOutbox(store, provider, delegation, { now: new Date(Date.now() + 60_000) });
  assert.equal(result.deadlineExceeded, 1);

  const outbox = db.tables.get("revocation_outbox") ?? [];
  assert.equal(outbox[0]?.attempt_state, "failed_deadline_exceeded");
});
