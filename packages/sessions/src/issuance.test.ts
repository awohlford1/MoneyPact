import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { consumeAndIssue, IssuanceRejectedError, UnsupportedUnderV03Error } from "./issuance.ts";
import { resolveSession } from "./resolve.ts";
import { bumpSubjectForCause } from "./revocation.ts";
import { buildTestHarness, testConfig, testEnvelopeKeyProvider } from "./test-support/harness.ts";
import { StaleEpochError } from "./types.ts";
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

void test("CT-191-003: authentication issues a new session and resolves live (CBD-191-AC01/AC03)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const command = baseCommand();
  const delivery = await consumeAndIssue(command, store, config, envelopeKeyProvider, new Date());
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(outcome.status, "resolved");
});

void test("CBD-191-SECURITY-002 High finding 2: sessionRef is an independent random value, never a cookie half", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  const [selector, verifier] = delivery.cookieValue.split(".");
  assert.notEqual(delivery.sessionRef, selector);
  assert.notEqual(delivery.sessionRef, verifier);
  assert.notEqual(delivery.sessionRef, delivery.cookieValue);
});

void test("CT-191-003/CT-191-004: v0.3 authentication never rotates a sibling device's row (no bound-context branch)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  const first = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());
  const second = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());

  const firstOutcome = await resolveSession(first.cookieValue, store, config, "test", new Date());
  const secondOutcome = await resolveSession(second.cookieValue, store, config, "test", new Date());
  // Both remain live: without the additive CBD-190 bound-context input
  // (OQ-191-007), this implementation cannot distinguish "the same browser
  // re-authenticating" from "a second device logging in," so it never
  // rotates a row it cannot prove is this browser's own (§4/§9: rotating on
  // a bare subject lookup would incorrectly kill sibling devices).
  assert.equal(firstOutcome.status, "resolved");
  assert.equal(secondOutcome.status, "resolved");
});

void test("CT-191-003: recovery is rejected under v0.3 (OQ-191-007 fails closed)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  await assert.rejects(() => consumeAndIssue(baseCommand({ rotationCause: "recovery" }), store, config, envelopeKeyProvider, new Date()), UnsupportedUnderV03Error);
});

void test("CT-191-003: a bound current-session context is rejected under v0.3", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  await assert.rejects(
    () => consumeAndIssue(baseCommand({ rotationCause: "authentication", boundCurrentSessionRef: randomUUID() }), store, config, envelopeKeyProvider, new Date()),
    UnsupportedUnderV03Error,
  );
});

void test("CT-191-003: assurance_elevation without a fresh assurance result is rejected", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  const base = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());
  await assert.rejects(
    () => consumeAndIssue(baseCommand({ accountSubjectId: subject, rotationCause: "assurance_elevation", boundCurrentSessionRef: base.sessionRef }), store, config, envelopeKeyProvider, new Date()),
    IssuanceRejectedError,
  );
});

void test("CT-191-003: assurance_elevation without boundCurrentSessionRef is rejected", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  await assert.rejects(
    () => consumeAndIssue(baseCommand({ rotationCause: "assurance_elevation", freshAssurance: { boundAction: "withdraw", boundSpaceId: undefined } }), store, config, envelopeKeyProvider, new Date()),
    IssuanceRejectedError,
  );
});

void test("CT-191-003: assurance_elevation with a fresh assurance result rotates the current session and issues a fresh-level session", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  const base = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());
  const command = baseCommand({
    accountSubjectId: subject,
    rotationCause: "assurance_elevation",
    boundCurrentSessionRef: base.sessionRef,
    freshAssurance: { boundAction: "withdraw", boundSpaceId: randomUUID() },
  });
  const delivery = await consumeAndIssue(command, store, config, envelopeKeyProvider, new Date());
  const baseOutcome = await resolveSession(base.cookieValue, store, config, "test", new Date());
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(baseOutcome.status, "not_authenticated");
  assert.equal(outcome.status, "resolved");
  if (outcome.status === "resolved") assert.equal(outcome.assurance.level, "fresh");
});

void test("CBD191-REVIEW-IMPL-001 Medium finding: assurance_elevation's bound session must be in the resolving environment and at the current epoch", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  const base = await consumeAndIssue(baseCommand({ accountSubjectId: subject, environmentId: "test" }), store, config, envelopeKeyProvider, new Date());
  // A revocation-epoch bump after issuance makes the bound row's own
  // issuedRevocationEpoch stale relative to the subject's current epoch.
  await bumpSubjectForCause(store, config, subject, undefined, "test", "logout_everywhere");
  await assert.rejects(
    () =>
      consumeAndIssue(
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
      ),
    IssuanceRejectedError,
  );
});

void test("CT-191-003: account_switch rotates the prior subject's row and issues under the new subject", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const previousSubject = randomUUID();
  const newSubject = randomUUID();
  const previous = await consumeAndIssue(baseCommand({ accountSubjectId: previousSubject }), store, config, envelopeKeyProvider, new Date());

  const switched = await consumeAndIssue(
    baseCommand({ accountSubjectId: newSubject, rotationCause: "account_switch", previousSessionId: previous.sessionRef }),
    store,
    config,
    envelopeKeyProvider,
    new Date(),
  );

  const previousOutcome = await resolveSession(previous.cookieValue, store, config, "test", new Date());
  const switchedOutcome = await resolveSession(switched.cookieValue, store, config, "test", new Date());
  assert.equal(previousOutcome.status, "not_authenticated");
  assert.equal(switchedOutcome.status, "resolved");
  if (switchedOutcome.status === "resolved") assert.equal(switchedOutcome.accountSubjectId, newSubject);
});

void test("account_switch without previous_session_id is rejected", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  await assert.rejects(() => consumeAndIssue(baseCommand({ rotationCause: "account_switch" }), store, config, envelopeKeyProvider, new Date()), IssuanceRejectedError);
});

void test("CT-191-015: replaying the same handoff while deliverUntil is live returns the byte-identical delivery, never a second session", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const command = baseCommand();
  const first = await consumeAndIssue(command, store, config, envelopeKeyProvider, new Date());
  const replayed = await consumeAndIssue(command, store, config, envelopeKeyProvider, new Date());
  assert.deepEqual(replayed, first);
  assert.equal(db.tables.get("account_session")?.length, 1);
});

void test("CT-191-015: an acknowledged handoff cannot be replayed", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const command = baseCommand();
  await consumeAndIssue(command, store, config, envelopeKeyProvider, new Date());
  await store.acknowledgeDeliveryResult(command.sessionHandoffId);
  await assert.rejects(() => consumeAndIssue(command, store, config, envelopeKeyProvider, new Date()), IssuanceRejectedError);
});

void test("CT-191-015: replay after deliverUntil expiry revokes the orphan session and fails terminally", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  // Consume while still live so a session is actually minted, then let it expire before replay.
  const almostExpired = new Date(Date.now() + 10);
  const command = baseCommand({ deliverUntil: almostExpired });
  const delivery = await consumeAndIssue(command, store, config, envelopeKeyProvider, new Date());
  await new Promise((resolve) => setTimeout(resolve, 20));
  await assert.rejects(() => consumeAndIssue(command, store, config, envelopeKeyProvider, new Date()), IssuanceRejectedError);
  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");
});

void test("CBD191-SECURITY-002 High finding 1: a never-consumed handoff whose deliverUntil has already passed mints nothing at all", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const command = baseCommand({ deliverUntil: new Date(Date.now() - 1000) });
  await assert.rejects(() => consumeAndIssue(command, store, config, envelopeKeyProvider, new Date()), IssuanceRejectedError);
  assert.equal((db.tables.get("account_session") ?? []).length, 0);
  assert.equal((db.tables.get("session_delivery_result") ?? []).length, 0);
  assert.equal((db.tables.get("account_subject_authority") ?? []).length, 0, "no authority row is even bootstrapped for a handoff rejected before any allocation");
});

void test("CT-191-014/SC-191-003A: a subject disabled after the ceremony began (but before consumption) rejects the handoff with no session minted", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  // Bootstrap the authority row and observe its epoch the way `issuance.ts` would.
  await store.currentSubjectAuthority(subject);
  await bumpSubjectForCause(store, config, subject, undefined, "test", "security_action");

  const command = baseCommand({ accountSubjectId: subject });
  await assert.rejects(() => consumeAndIssue(command, store, config, envelopeKeyProvider, new Date()), IssuanceRejectedError);
  assert.equal((db.tables.get("account_session") ?? []).filter((row) => row.account_subject_id === subject).length, 0);
});

void test("CT-191-014/SC-191-003A: an epoch bump between observation and allocation rejects consumption rather than reissuing at the new epoch", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  await store.currentSubjectAuthority(subject);

  // Simulate the race: observe the epoch (as consumeAndIssue's first step
  // does), then have a concurrent revocation bump it before allocation
  // happens. We can't literally interleave inside one call, so this proves
  // the same invariant the fenced allocator enforces directly.
  const observed = await store.currentSubjectAuthority(subject);
  await bumpSubjectForCause(store, config, subject, undefined, "test", "logout_everywhere");

  await assert.rejects(() => store.allocateSessionVersionFenced(subject, observed.revocationEpoch), StaleEpochError);
  assert.equal((db.tables.get("account_session") ?? []).length, 0);
});
