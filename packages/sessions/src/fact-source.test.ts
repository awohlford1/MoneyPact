/**
 * IDLE-T02 (CBD-191 SC-191-006 / IDLE-E05 / IDLE-D04): `createSessionFactSourceAdapter`'s three-way dispatch.
 *
 * `apps/api/src/sessions/fact-source.test.ts` (the API-level `createApiFactSource` wrapper) exercises only
 * the `idp_evidence` producer; the session-store dispatch this proposal changes lives entirely in this
 * package's `fact-source.ts`, which had no test file of its own before this packet (deviation noted in the
 * final report: the proposal's `IDLE-T02` file list names the API-level file, which does not cover this
 * logic).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { consumeAndIssue } from "./issuance.ts";
import { resolveSession } from "./resolve.ts";
import { createSessionFactSourceAdapter } from "./fact-source.ts";
import { createTransactionSessionStore } from "./store.ts";
import { createFakeClient } from "./test-support/fake-client.ts";
import { buildTestHarness, testConfig, testEnvelopeKeyProvider } from "./test-support/harness.ts";
import type { SessionIssueCommandV1 } from "./types.ts";

const envelopeKeyProvider = testEnvelopeKeyProvider();

function baseCommand(overrides: Partial<SessionIssueCommandV1> = {}): SessionIssueCommandV1 {
  return {
    contractVersion: 1, sessionHandoffId: randomUUID(), accountSubjectId: randomUUID(), environmentId: "test",
    identityBindingId: randomUUID(), rotationCause: "authentication", previousSessionId: undefined,
    boundCurrentSessionRef: undefined, preparedRevocationEpoch: undefined, freshAssurance: undefined,
    deliverUntil: new Date(Date.now() + 60_000), ...overrides,
  };
}

void test("IDLE-E05: the gate's identity-only resolution (empty operation.action, no transaction) uses the best-effort slide", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  let bestEffortCalled = false; let waitCalled = false;
  const originalBestEffort = store.extendIdleExpiryBestEffort.bind(store);
  const originalWait = store.extendIdleExpiry.bind(store);
  store.extendIdleExpiryBestEffort = async (...args: Parameters<typeof originalBestEffort>) => { bestEffortCalled = true; return originalBestEffort(...args); };
  store.extendIdleExpiry = async (...args: Parameters<typeof originalWait>) => { waitCalled = true; return originalWait(...args); };
  try {
    const adapter = createSessionFactSourceAdapter(store, config, "test");
    const facts = await adapter.read("session_store", { credential: delivery.cookieValue, operation: { action: "" } });
    assert.ok(facts, "the gate resolution succeeds");
    assert.equal(bestEffortCalled, true, "the gate's non-transactional resolution slides best-effort");
    assert.equal(waitCalled, false);
  } finally {
    store.extendIdleExpiryBestEffort = originalBestEffort;
    store.extendIdleExpiry = originalWait;
  }
});

void test("IDLE-D04: the precheck's resolution (a real action, no transaction) is read-only -- no slide of either kind", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  let bestEffortCalled = false; let waitCalled = false;
  const originalBestEffort = store.extendIdleExpiryBestEffort.bind(store);
  const originalWait = store.extendIdleExpiry.bind(store);
  store.extendIdleExpiryBestEffort = async (...args: Parameters<typeof originalBestEffort>) => { bestEffortCalled = true; return originalBestEffort(...args); };
  store.extendIdleExpiry = async (...args: Parameters<typeof originalWait>) => { waitCalled = true; return originalWait(...args); };
  try {
    const adapter = createSessionFactSourceAdapter(store, config, "test");
    const facts = await adapter.read("session_store", { credential: delivery.cookieValue, operation: { action: "budget.create" } });
    assert.ok(facts, "the precheck resolution still succeeds (it reads, it just does not slide)");
    assert.equal(bestEffortCalled, false, "IDLE-D04: the precheck slide is removed");
    assert.equal(waitCalled, false);
  } finally {
    store.extendIdleExpiryBestEffort = originalBestEffort;
    store.extendIdleExpiry = originalWait;
  }
});

void test("PROTO-ACTIVATION-001 A2 (unchanged): the transaction-bound path waits and fences", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  let waitCalled = false;
  let fenceCalled = false;
  const scopedClientMarker = { marker: "tx-client" };
  const adapter = createSessionFactSourceAdapter(store, config, "test", (transaction) => {
    if (transaction !== scopedClientMarker) return undefined;
    // The scoped store is built over a client bound to the same fake database, standing in for a client
    // bound to the mutation's real transaction, exactly as `apps/api/src/sessions/index.ts`'s `storeFor` does.
    const scoped = createTransactionSessionStore(createFakeClient(db));
    const originalWait = scoped.extendIdleExpiry.bind(scoped);
    const originalFence = scoped.fenceRevocationEpoch.bind(scoped);
    scoped.extendIdleExpiry = async (...args: Parameters<typeof originalWait>) => { waitCalled = true; return originalWait(...args); };
    scoped.fenceRevocationEpoch = async (...args: Parameters<typeof originalFence>) => { fenceCalled = true; return originalFence(...args); };
    return scoped;
  });
  const facts = await adapter.read("session_store", { credential: delivery.cookieValue, operation: { action: "budget.create" } }, scopedClientMarker);
  assert.ok(facts, "the transactional resolution succeeds and fences");
  assert.equal(waitCalled, true, "the in-transaction slide always waits");
  assert.equal(fenceCalled, true, "the in-transaction path fences the revocation epoch (A2, unchanged)");
});

/**
 * IDLE-T02 continued: deliberate-violation-tested guard, at the level `resolve.ts` and `store.ts` actually
 * enforce it (`fact-source.ts`'s own dispatch has no runtime branch left to invert once `IDLE-E05` is wired
 * correctly -- the choice is structural, by which store type the call site holds, exactly as the proposal
 * specifies). The violation this proves: if a future refactor mis-wired the scoped/transaction-bound path
 * onto `"skip_locked"` mode instead of `"wait"`, the structural guard (`SEC-IDLE-R4`, see `store.test.ts`)
 * makes that call fail closed immediately rather than silently skip a slide inside a mutation's own
 * transaction. `resolveSession` itself never propagates the throw -- it fails closed to `store_unavailable`
 * (CT-191-009) -- so "fails" here means that outcome, not an uncaught rejection.
 */
void test("IDLE-T02: inverting the wiring (the transaction-bound store called in skip_locked mode) fails closed; restoring it to wait mode passes", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const scoped = createTransactionSessionStore(createFakeClient(db));

  // Watch it fail: the deliberate violation. `slideMode` is cast because `TransactionSessionStore` accepts
  // only "wait"/"none" by the overload-free signature's own runtime guard, not by a type-level overload here;
  // the cast is exactly the bypass a mis-wiring would be.
  const inverted = await resolveSession(delivery.cookieValue, scoped, config, "test", new Date(), "skip_locked" as unknown as "wait");
  assert.equal(inverted.status, "not_authenticated");
  assert.equal((inverted as { diagnostic?: string }).diagnostic, "store_unavailable", "the inverted wiring fails closed, never silently skips inside a transaction");

  // Watch it pass: restored to the correct mode, same store, same session.
  const restored = await resolveSession(delivery.cookieValue, scoped, config, "test", new Date(), "wait");
  assert.equal(restored.status, "resolved");
});
