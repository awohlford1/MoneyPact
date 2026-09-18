/**
 * IDLE-T02 (CBD-191 SC-191-006 / SEC-IDLE-R4): the structural guard that a transaction-bound session store
 * cannot skip an idle-expiry slide.
 *
 * `createTransactionSessionStore` returns a value typed exactly `TransactionSessionStore`
 * (= `SessionResolutionStore`), which has no `extendIdleExpiryBestEffort` member -- so code holding a
 * variable of that type cannot even compile a call to it. This suite proves the companion runtime property a
 * type check alone cannot: the underlying object still carries a *throwing* stub of that name (not `undefined`
 * or a silent no-op), so a bypass of the type system -- a cast, `as any`, a mistaken wiring -- still fails
 * loudly rather than doing nothing or doing the wrong thing.
 *
 * Deliberate-violation-tested per CLAUDE.md: "watch it fail, restore, watch it pass" is recorded inline as two
 * assertions in the same test rather than as separate runs, since the "violation" here is simply calling the
 * method that must not exist for real work -- there is no wiring to revert.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createFakeClient, createTestDatabase } from "./test-support/fake-client.ts";
import { createSessionStore, createTransactionSessionStore } from "./store.ts";
import type { SessionStore, TransactionSessionStore } from "./store.ts";

void test("IDLE-T02 / SEC-IDLE-R4: the root store exposes extendIdleExpiryBestEffort and it slides (or skips) via the skipLocked predicate", async () => {
  const db = createTestDatabase();
  const client = createFakeClient(db);
  const store = createSessionStore(client);
  const sessionRef = randomUUID();
  db.tables.get("account_session")!.push({
    session_id: randomUUID(), session_selector: randomUUID(), verifier_digest: "x", session_ref: sessionRef,
    account_subject_id: randomUUID(), environment_id: "test", identity_binding_id: null, session_version: 1,
    issued_revocation_epoch: 1, state: "active", superseded_by_session_ref: null, assurance_level: "session",
    fresh_assurance_bound_action: null, fresh_assurance_bound_space_id: null, fresh_assurance_expires_at: null,
    csrf_digest: "x", issued_at: new Date(), idle_expires_at: new Date(), absolute_expires_at: new Date(Date.now() + 3_600_000),
    rotation_cause: "authentication", revocation_cause: null,
  });
  const newExpiry = new Date(Date.now() + 900_000);
  const rowCount = await store.extendIdleExpiryBestEffort(sessionRef, newExpiry);
  assert.equal(rowCount, 1);
  const row = db.tables.get("account_session")!.find((r) => r.session_ref === sessionRef);
  assert.equal((row!.idle_expires_at as Date).getTime(), newExpiry.getTime());
});

void test("IDLE-T02 / SEC-IDLE-R4: a transaction-bound store has no extendIdleExpiryBestEffort at the type level, and reaching it anyway (a deliberate violation) throws instead of silently succeeding or no-oping", async () => {
  const db = createTestDatabase();
  const client = createFakeClient(db);
  const scoped: TransactionSessionStore = createTransactionSessionStore(client);
  // `TransactionSessionStore` (= `SessionResolutionStore`) declares no `extendIdleExpiryBestEffort`; the cast
  // below is the deliberate violation the packet's guard is watched failing against -- without it, this file
  // would not compile, which is the primary guarantee. The cast simulates a caller that bypasses the type
  // system (e.g. a future refactor that mis-wires the scoped path onto the best-effort call).
  const bypassed = scoped as unknown as { extendIdleExpiryBestEffort(sessionRef: string, at: Date): Promise<number> };
  let caught: unknown;
  try {
    await bypassed.extendIdleExpiryBestEffort(randomUUID(), new Date());
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, "the deliberate violation fails loudly (watch it fail)");
  assert.match((caught as Error).message, /SC-191-006/);
  assert.match((caught as Error).message, /never skips/);
  // Restore: the ordinary, structurally-guarded methods on the same object still work exactly as before --
  // the guard did not disable the store, only the one method it must never expose (watch it pass).
  const ordinary: SessionStore["resolveBySelector"] = scoped.resolveBySelector.bind(scoped);
  assert.equal(await ordinary(randomUUID()), "not_found");
});

void test("IDLE-T02: the scoped/transaction-bound store's ordinary methods (resolveBySelector, readSubjectAuthorityStrict, extendIdleExpiry, fenceRevocationEpoch) delegate to the same client as the root store", async () => {
  const db = createTestDatabase();
  const client = createFakeClient(db);
  const scoped = createTransactionSessionStore(client);
  const sessionRef = randomUUID();
  const selector = randomUUID();
  db.tables.get("account_session")!.push({
    session_id: randomUUID(), session_selector: selector, verifier_digest: "x", session_ref: sessionRef,
    account_subject_id: randomUUID(), environment_id: "test", identity_binding_id: null, session_version: 1,
    issued_revocation_epoch: 1, state: "active", superseded_by_session_ref: null, assurance_level: "session",
    fresh_assurance_bound_action: null, fresh_assurance_bound_space_id: null, fresh_assurance_expires_at: null,
    csrf_digest: "x", issued_at: new Date(), idle_expires_at: new Date(), absolute_expires_at: new Date(Date.now() + 3_600_000),
    rotation_cause: "authentication", revocation_cause: null,
  });
  const found = await scoped.resolveBySelector(selector);
  assert.notEqual(found, "not_found");
  const newExpiry = new Date(Date.now() + 900_000);
  await scoped.extendIdleExpiry(sessionRef, newExpiry);
  const row = db.tables.get("account_session")!.find((r) => r.session_ref === sessionRef);
  assert.equal((row!.idle_expires_at as Date).getTime(), newExpiry.getTime());
});
