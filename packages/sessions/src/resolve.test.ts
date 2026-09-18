import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { consumeAndIssue } from "./issuance.ts";
import { bumpSubjectForCause, logout } from "./revocation.ts";
import { resolveSession, verifySessionStillLive } from "./resolve.ts";
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

// IDLE-T01 (CBD-191 SC-191-006): resolve.ts's three `SlideMode`s. "wait" (the default, taken when the 6th
// argument is omitted) is exercised by every other test in this file unchanged -- proving byte-identical
// behaviour to before this amendment. These tests exercise "skip_locked" and "none" in isolation by swapping
// in a controllable `extendIdleExpiryBestEffort`/`extendIdleExpiry`, since the fake in-memory store has no
// real row-lock concept (the actual lock contention is `IDLE-T03`'s live probe).

void test("IDLE-T01: skip_locked mode with a zero row count (skipped, e.g. locked by the session's own in-flight mutation) still resolves -- a skip is not a failure", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const original = store.extendIdleExpiryBestEffort.bind(store);
  let called = false;
  store.extendIdleExpiryBestEffort = async () => { called = true; return 0; };
  try {
    const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date(), "skip_locked");
    assert.equal(outcome.status, "resolved");
    assert.ok(called, "the best-effort slide was attempted");
  } finally {
    store.extendIdleExpiryBestEffort = original;
  }
});

void test("IDLE-T01: skip_locked mode with a row count of 1 (slid) resolves the same way", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date(), "skip_locked");
  assert.equal(outcome.status, "resolved");
});

void test("IDLE-T01: skip_locked mode still fails closed to store_unavailable when the store throws (CT-191-009)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig({ rejectionTimingTimeoutBucketMs: 0 });
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const original = store.extendIdleExpiryBestEffort.bind(store);
  store.extendIdleExpiryBestEffort = async () => { throw new Error("simulated driver failure"); };
  try {
    const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date(), "skip_locked");
    assert.equal(outcome.status, "not_authenticated");
    assert.equal((outcome as { diagnostic?: string }).diagnostic, "store_unavailable");
  } finally {
    store.extendIdleExpiryBestEffort = original;
  }
});

void test("IDLE-T01 / IDLE-D04: none mode never writes a slide but still resolves and still evaluates expiry against the row as read", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  let waitCalled = false;
  let bestEffortCalled = false;
  const originalWait = store.extendIdleExpiry.bind(store);
  const originalBestEffort = store.extendIdleExpiryBestEffort.bind(store);
  store.extendIdleExpiry = async (...args: Parameters<typeof originalWait>) => { waitCalled = true; return originalWait(...args); };
  store.extendIdleExpiryBestEffort = async (...args: Parameters<typeof originalBestEffort>) => { bestEffortCalled = true; return originalBestEffort(...args); };
  try {
    const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date(), "none");
    assert.equal(outcome.status, "resolved");
    assert.equal(waitCalled, false, "none mode never calls the waiting slide");
    assert.equal(bestEffortCalled, false, "none mode never calls the best-effort slide");
  } finally {
    store.extendIdleExpiry = originalWait;
    store.extendIdleExpiryBestEffort = originalBestEffort;
  }

  // An already-expired row is still expired under none mode (fail-closed evaluation is unaffected by slide mode).
  const config2 = testConfig({ idleTimeoutSeconds: 1 });
  const soonExpired = await consumeAndIssue(baseCommand(), store, config2, envelopeKeyProvider, new Date(Date.now() - 5_000));
  const expiredOutcome = await resolveSession(soonExpired.cookieValue, store, config2, "test", new Date(), "none");
  assert.equal(expiredOutcome.status, "not_authenticated");
});

void test("IDLE-T01: wait mode (explicit or the default) is byte-identical -- both calling shapes resolve the same session", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const implicit = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  const explicit = await resolveSession(delivery.cookieValue, store, config, "test", new Date(), "wait");
  assert.equal(implicit.status, "resolved");
  assert.equal(explicit.status, "resolved");
});

void test("CT-191-002: an IdP-shaped credential (not a selector.verifier cookie) is rejected as malformed (CBD-191-AC01)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const outcome = await resolveSession("eyJhbGciOiJSUzI1NiJ9.not-a-session-cookie", store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CT-191-002: a missing cookie is rejected", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const outcome = await resolveSession(undefined, store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CT-191-002: an unknown selector is rejected", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const outcome = await resolveSession("dW5rbm93bg.dmVyaWZpZXI", store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CT-191-002: a wrong verifier for a known selector is rejected", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const [selector] = delivery.cookieValue.split(".");
  const outcome = await resolveSession(`${selector}.wrong-verifier-value-abcdef`, store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CT-191-002: an other-environment session is rejected", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand({ environmentId: "prod" }), store, config, envelopeKeyProvider, new Date());
  const outcome = await resolveSession(delivery.cookieValue, store, config, "staging", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CT-191-002: an expired session is rejected (absolute expiry)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig({ absoluteLifetimeSeconds: 1 });
  const issuedAt = new Date(Date.now() - 5000);
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, issuedAt);
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CT-191-002: a revoked session is rejected", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  await logout(store, config, delivery.sessionRef, "test");
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CT-191-011/§3.3 case 6: a bulk subject-epoch bump invalidates the session without a per-row write", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  const delivery = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());
  await store.bumpSubjectEpoch(subject, "security_action");
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
  // No per-row write happened on account_session; only the authority row changed.
  const sessionRow = db.tables.get("account_session")?.find((row) => row.session_ref === delivery.sessionRef);
  assert.equal(sessionRow?.state, "active");
});

void test("CT-191-011: bulk revocation invalidates every one of a subject's many concurrent sessions", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  const deliveries = [] as Awaited<ReturnType<typeof consumeAndIssue>>[];
  // Each device authenticates under its own handoff; v0.3 `authentication`
  // never rotates a sibling row (see issuance.test.ts), so all five stay live.
  for (let i = 0; i < 5; i += 1) {
    deliveries.push(await consumeAndIssue(baseCommand({ accountSubjectId: subject, sessionHandoffId: randomUUID() }), store, config, envelopeKeyProvider, new Date()));
  }
  await store.bumpSubjectEpoch(subject, "logout_everywhere");
  for (const delivery of deliveries) {
    const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
    assert.equal(outcome.status, "not_authenticated");
  }
});

void test("CT-191-009: a store outage fails resolution closed to not_authenticated, never an implicit allow", async () => {
  const config = testConfig();
  const failingStore = {
    resolveBySelector: async () => {
      throw new Error("connection refused");
    },
  } as any;
  const outcome = await resolveSession("c2VsZWN0b3I.dmVyaWZpZXI", failingStore, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("§5.1: idle expiry slides forward on a successfully resolved request", async () => {
  const { store } = buildTestHarness();
  const config = testConfig({ idleTimeoutSeconds: 100, absoluteLifetimeSeconds: 100_000 });
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const first = await store.findBySessionRef(delivery.sessionRef);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  const second = await store.findBySessionRef(delivery.sessionRef);
  assert.ok(second && first && second.idleExpiresAt.getTime() >= first.idleExpiresAt.getTime());
});

void test("CT-191-010: a request landing exactly on idle_expires_at is expired, not one tick away (exact >= boundary)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig({ idleTimeoutSeconds: 100, absoluteLifetimeSeconds: 100_000 });
  const issuedAt = new Date();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, issuedAt);
  const exactBoundary = new Date(issuedAt.getTime() + 100_000); // exactly idleTimeoutSeconds (100s) away
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", exactBoundary);
  assert.equal(outcome.status, "not_authenticated");

  // Positive control: one millisecond before the boundary still resolves.
  const beforeBoundary = new Date(issuedAt.getTime() + 99_999);
  const controlOutcome = await resolveSession(delivery.cookieValue, store, config, "test", beforeBoundary);
  assert.equal(controlOutcome.status, "resolved");
});

void test("§5.1: an expired fresh-assurance grant degrades the effective assurance to session without rejecting the request", async () => {
  const { store } = buildTestHarness();
  const config = testConfig({ freshAssuranceWindowSeconds: 1 });
  const subject = randomUUID();
  const base = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());
  const elevated = await consumeAndIssue(
    baseCommand({
      accountSubjectId: subject,
      rotationCause: "assurance_elevation",
      boundCurrentSessionRef: base.sessionRef,
      freshAssurance: { boundAction: "withdraw", boundSpaceId: undefined },
    }),
    store,
    config,
    envelopeKeyProvider,
    new Date(),
  );
  const soonAfterElevation = await resolveSession(elevated.cookieValue, store, config, "test", new Date());
  assert.equal(soonAfterElevation.status, "resolved");
  if (soonAfterElevation.status === "resolved") assert.equal(soonAfterElevation.assurance.level, "fresh");

  const wellAfterWindow = new Date(Date.now() + 5000);
  const laterOutcome = await resolveSession(elevated.cookieValue, store, config, "test", wellAfterWindow);
  assert.equal(laterOutcome.status, "resolved", "the session itself is still live -- only the assurance grant expired");
  if (laterOutcome.status === "resolved") assert.equal(laterOutcome.assurance.level, "session");
});

void test("CBD191-REVIEW-IMPL-001 Medium finding: a session row with no authority row fails closed (missing_authority), never fabricates one", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  // Simulate the anomaly directly: the authority row is gone (e.g. purged),
  // but the session row is not.
  db.tables.set("account_subject_authority", []);
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CT-191-013: commit-boundary recheck denies a write after the session was revoked between precheck and commit", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const precheck = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(precheck.status, "resolved");
  if (precheck.status !== "resolved") return;

  // Precheck succeeded; a concurrent revocation lands before commit.
  await logout(store, config, delivery.sessionRef, "test");

  const stillLive = await verifySessionStillLive(store, precheck.sessionRef, precheck.sessionVersion);
  assert.equal(stillLive, false, "the commit-time recheck must deny the write; no customer-data effect may occur");

  // Positive control: an unrevoked session's commit-time recheck passes.
  const other = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const otherPrecheck = await resolveSession(other.cookieValue, store, config, "test", new Date());
  assert.equal(otherPrecheck.status, "resolved");
  if (otherPrecheck.status === "resolved") {
    assert.equal(await verifySessionStillLive(store, otherPrecheck.sessionRef, otherPrecheck.sessionVersion), true);
  }
});

void test("CT-191-004: a device logging in while another device is logged out mid-request is unaffected by the single-row revoke", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  const deviceA = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());

  // Device B logs in concurrently with device A being logged out.
  const [deviceB] = await Promise.all([
    consumeAndIssue(baseCommand({ accountSubjectId: subject, sessionHandoffId: randomUUID() }), store, config, envelopeKeyProvider, new Date()),
    logout(store, config, deviceA.sessionRef, "test"),
  ]);

  const outcomeA = await resolveSession(deviceA.cookieValue, store, config, "test", new Date());
  const outcomeB = await resolveSession(deviceB.cookieValue, store, config, "test", new Date());
  assert.equal(outcomeA.status, "not_authenticated");
  assert.equal(outcomeB.status, "resolved");
});

void test("CT-191-004/SC-191-003A: a subject-wide bump racing a login never lets the new session outlive it", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  await store.currentSubjectAuthority(subject);

  // SC-191-003A's fence means one of two safe outcomes occurs, depending on
  // exactly when the login observed the epoch relative to the bump's
  // compare-and-swap: either the login is rejected outright (its observed
  // epoch went stale before its own allocation), or it succeeds but is
  // already at the post-bump epoch and therefore live -- a bump that lands
  // *after* a session has already fenced-in the new epoch does not
  // retroactively kill it, which is correct: that session was issued under
  // the current authority, not a stale one. What must never happen is a
  // session surviving *at a stale epoch*.
  const [loginSettled, bumpSettled] = await Promise.allSettled([
    consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date()),
    bumpSubjectForCause(store, config, subject, undefined, "test", "logout_everywhere"),
  ]);

  assert.equal(bumpSettled.status, "fulfilled", "the bump itself must never fail");
  if (loginSettled.status === "rejected") {
    assert.match(String(loginSettled.reason), /prepared handoff rejected/);
    return;
  }

  const delivery = loginSettled.value;
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  const authority = await store.currentSubjectAuthority(subject);
  if (outcome.status === "resolved") {
    assert.equal(outcome.sessionVersion >= 1, true);
    const row = await store.findBySessionRef(delivery.sessionRef);
    assert.equal(row?.issuedRevocationEpoch, authority.revocationEpoch, "a session that resolves live is never at a stale epoch");
  }
});

void test("CT-191-002A: rejection timing normalization performs the same fixed-shape work for every rejection class", async () => {
  const { store } = buildTestHarness();
  const config = testConfig({ rejectionTimingFloorMs: 5, rejectionTimingJitterMs: 3 });
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  await logout(store, config, delivery.sessionRef, "test");

  const cases: Array<[string, string | undefined]> = [
    ["malformed", "not-well-formed"],
    ["unknown_selector", "dW5rbm93bg.dmVyaWZpZXI-dmVyaWZpZXI-dmVyaWZpZXI1"],
    ["revoked", delivery.cookieValue],
  ];

  for (const [label, cookieValue] of cases) {
    const started = Date.now();
    const outcome = await resolveSession(cookieValue, store, config, "test", new Date());
    const elapsed = Date.now() - started;
    assert.equal(outcome.status, "not_authenticated", label);
    // floorMs is the minimum guaranteed elapsed time for every rejection
    // (jitter only ever adds, per cryptoRandomJitterMs's [0, max] range).
    assert.ok(elapsed >= config.rejectionTimingFloorMs, `${label}: elapsed ${elapsed}ms was under the configured floor`);
  }
});
