import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { consumeAndIssue } from "./issuance.ts";
import { resolveSession } from "./resolve.ts";
import { bumpSubjectForCause, logout } from "./revocation.ts";
import { buildTestHarness, testConfig, testEnvelopeKeyProvider } from "./test-support/harness.ts";
import type { SessionIssueCommandV1 } from "./types.ts";

const envelopeKeyProvider = testEnvelopeKeyProvider();

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

void test("§6.1 logout: single-row revoke, sibling rows unaffected (CT-191-005)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  const a = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());
  const b = await consumeAndIssue(baseCommand({ accountSubjectId: subject }), store, config, envelopeKeyProvider, new Date());

  await logout(store, config, a.sessionRef, "test");

  const outcomeA = await resolveSession(a.cookieValue, store, config, "test", new Date());
  const outcomeB = await resolveSession(b.cookieValue, store, config, "test", new Date());
  assert.equal(outcomeA.status, "not_authenticated");
  assert.equal(outcomeB.status, "resolved");
});

void test("§6.1 logout enqueues a provider_current_browser_bound outbox action", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand(), store, config, envelopeKeyProvider, new Date());
  await logout(store, config, delivery.sessionRef, "test");
  const actions = db.tables.get("revocation_outbox") ?? [];
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.target, "provider_current_browser_bound");
  assert.equal(actions[0]?.cause, "logout");
});

void test("§6.1 logout_everywhere bumps the subject epoch and enqueues global invalidation + no delegation retirement", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  await store.currentSubjectAuthority(subject);
  const epoch = await bumpSubjectForCause(store, config, subject, randomUUID(), "test", "logout_everywhere");
  assert.equal(epoch, 2);
  const actions = db.tables.get("revocation_outbox") ?? [];
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.target, "provider_global_invalidation");
});

void test("§6.1/§7 account_deletion enqueues both global invalidation and delegation retirement", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  await bumpSubjectForCause(store, config, subject, randomUUID(), "test", "account_deletion");
  const actions = db.tables.get("revocation_outbox") ?? [];
  const targets = actions.map((a) => a.target).sort();
  assert.deepEqual(targets, ["delegation_retirement", "provider_global_invalidation"]);
});

void test("bumpSubjectForCause rejects a non-epoch-bumping cause", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  await assert.rejects(() => bumpSubjectForCause(store, config, randomUUID(), undefined, "test", "logout"), RangeError);
});

void test("OQ-191-001 branch B: this module exposes no zero-membership trigger; permission_loss must be invoked explicitly for disablement only", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const subject = randomUUID();
  // Nothing in this package fires automatically when a membership count
  // reaches zero -- the absence of such a call *is* branch B's behavior.
  // This test documents that no outbox/epoch effect exists for the subject
  // until a real disablement cause is invoked.
  assert.equal((db.tables.get("revocation_outbox") ?? []).length, 0);
  await bumpSubjectForCause(store, config, subject, undefined, "test", "permission_loss");
  const actions = db.tables.get("revocation_outbox") ?? [];
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.target, "delegation_retirement");
});
