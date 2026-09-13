import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { consumeAndIssue } from "./issuance.ts";
import { resolveSession } from "./resolve.ts";
import { sweepExpiredDeliveryResults } from "./sweep-worker.ts";
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

void test("CBD191-SECURITY-002 High finding 4: the sweep zeroes an expired, never-acknowledged envelope and revokes its orphan session", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const deliverUntil = new Date(Date.now() + 10);
  const delivery = await consumeAndIssue(baseCommand({ deliverUntil }), store, config, envelopeKeyProvider, new Date());

  const result = await sweepExpiredDeliveryResults(store, new Date(deliverUntil.getTime() + 1000), 10);
  assert.equal(result.swept, 1);

  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(outcome.status, "not_authenticated");

  const envelopeRow = db.tables.get("session_delivery_result")?.[0];
  assert.equal(Buffer.isBuffer(envelopeRow?.sealed_envelope) ? envelopeRow.sealed_envelope.length : -1, 0, "the envelope bytes are zeroed, not merely marked");
  assert.ok(envelopeRow?.acknowledged_at, "the row is marked acknowledged so it is never swept or replayed again");
});

void test("the sweep never touches a still-live (unexpired) delivery result", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const delivery = await consumeAndIssue(baseCommand({ deliverUntil: new Date(Date.now() + 60_000) }), store, config, envelopeKeyProvider, new Date());

  const result = await sweepExpiredDeliveryResults(store, new Date(), 10);
  assert.equal(result.swept, 0);

  const outcome = await resolveSession(delivery.cookieValue, store, config, "test", new Date());
  assert.equal(outcome.status, "resolved");
});

void test("the sweep never touches an already-acknowledged delivery result", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const deliverUntil = new Date(Date.now() + 10);
  await consumeAndIssue(baseCommand({ sessionHandoffId: "handoff-1", deliverUntil }), store, config, envelopeKeyProvider, new Date());
  await store.acknowledgeDeliveryResult("handoff-1");

  const result = await sweepExpiredDeliveryResults(store, new Date(deliverUntil.getTime() + 1000), 10);
  assert.equal(result.swept, 0, "an already-erased row is not counted again");
});
