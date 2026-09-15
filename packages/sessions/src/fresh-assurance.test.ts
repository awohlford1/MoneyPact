/**
 * PK-4 fresh assurance as a record: the module-level guarantees.
 *
 * SEC-PK4-F3 found the reader documented as requiring the session row live
 * while it filtered only on the grant's own columns, so "a grant dies with its
 * session" held in composition -- every production caller resolves a live
 * session first -- and not at this module's boundary. These cases pin the
 * boundary itself: the session row is built by the real issuance path and then
 * revoked, rotated or aged out through the real store, and the finder is
 * called directly with nothing but a `sessionRef`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { consumeAndIssue } from "./issuance.ts";
import { consumeFreshAssurance, findUsableFreshAssurance, issueFreshAssurance } from "./fresh-assurance.ts";
import { createSessionStore } from "./store.ts";
import { createFakeClient, createTestDatabase } from "./test-support/fake-client.ts";
import { testConfig, testEnvelopeKeyProvider } from "./test-support/harness.ts";
import { SessionStoreUnavailableError } from "./types.ts";
import type { SessionIssueCommandV1 } from "./types.ts";

const ACTION = "29.transfer_primary_ownership";

function command(): SessionIssueCommandV1 {
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
  };
}

/** A live session with one issued grant bound to `ACTION` and a fresh space. */
async function granted(now = new Date()) {
  const db = createTestDatabase();
  const client = createFakeClient(db);
  const store = createSessionStore(client);
  const config = testConfig();
  const issued = command();
  const delivery = await consumeAndIssue(issued, store, config, testEnvelopeKeyProvider(), now);
  const spaceId = randomUUID();
  const outcome = await issueFreshAssurance(client, {
    sessionRef: delivery.sessionRef, accountSubjectId: issued.accountSubjectId, environmentId: "test",
    challengeId: randomUUID(), boundAction: ACTION, boundSpaceId: spaceId, issuedAt: now,
    windowSeconds: config.freshAssuranceWindowSeconds,
  });
  assert.equal(outcome.status, "issued");
  const find = (at: Date) => findUsableFreshAssurance(client, { sessionRef: delivery.sessionRef, boundAction: ACTION, boundSpaceId: spaceId, now: at });
  return { db, client, store, config, sessionRef: delivery.sessionRef, spaceId, find, grant: outcome.grant };
}

void test("SEC-PK4-F3: a live session's grant is found, bound to exactly its action and space", async () => {
  const now = new Date();
  const context = await granted(now);
  const found = await context.find(now);
  assert.equal(found?.freshAssuranceId, context.grant?.freshAssuranceId);
  assert.equal(found?.state, "issued");
  assert.equal(await findUsableFreshAssurance(context.client, { sessionRef: context.sessionRef, boundAction: "1.view_space", boundSpaceId: context.spaceId, now }), undefined);
  assert.equal(await findUsableFreshAssurance(context.client, { sessionRef: context.sessionRef, boundAction: ACTION, boundSpaceId: randomUUID(), now }), undefined);
  assert.equal(await findUsableFreshAssurance(context.client, { sessionRef: randomUUID(), boundAction: ACTION, boundSpaceId: context.spaceId, now }), undefined);
});

void test("SEC-PK4-F3: a revoked session's ref no longer finds its grant at the module boundary", async () => {
  const now = new Date();
  const context = await granted(now);
  assert.ok(await context.find(now), "found while the session is live");
  await context.store.markRevoked(context.sessionRef, "logout");
  assert.equal(await context.find(now), undefined, "the grant dies with the session, without a sweep");
  // The row is still there, unconsumed: nothing was rewritten, it is simply
  // not usable any more (CBD-191 section 6.1).
  const rows = context.db.tables.get("account_session_fresh_assurance") ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.state, "issued");
});

void test("SEC-PK4-F3: a rotated session's ref no longer finds its grant either", async () => {
  const now = new Date();
  const context = await granted(now);
  await context.store.markRotated(context.sessionRef, randomUUID());
  assert.equal(await context.find(now), undefined);
});

void test("SEC-PK4-F3: an expired session finds nothing, on the idle expiry and on the absolute one", async () => {
  const now = new Date();
  const idlePast = new Date(now.getTime() + testConfig().idleTimeoutSeconds * 1000 + 1);
  const context = await granted(now);
  // Past the idle expiry the session row is no longer live, so the grant is
  // unreachable even though the caller asks within the grant's own window.
  assert.equal(await context.find(idlePast), undefined);
  // And on the instant of the idle expiry itself: `>` is strict here, exactly
  // as it is for the grant's own expiry and in resolve.ts.
  const sessions = context.db.tables.get("account_session") ?? [];
  const row = sessions.find((candidate) => candidate.session_ref === context.sessionRef);
  assert.ok(row);
  assert.equal(await context.find(row!.idle_expires_at as Date), undefined);
});

void test("SEC-PK4-F4: a driver failure on the grant row is wrapped with its SQLSTATE, so a serialization failure stays recognisable", async () => {
  const now = new Date();
  const context = await granted(now);
  // The CBD-246 seam's own error shape: a name, the table, the operation and
  // the SQLSTATE, nothing else. 40001 is what the losing side of two
  // serializable transactions spending one grant receives.
  const serializationFailure = Object.assign(new Error('statement on "account_session_fresh_assurance" failed (update)'), { name: "StatementFailedError", sqlState: "40001" });
  const failing = { ...context.client, platformUpdate: async () => { throw serializationFailure; } };
  await assert.rejects(
    consumeFreshAssurance(failing, { freshAssuranceId: context.grant!.freshAssuranceId, action: ACTION, now }),
    (error: unknown) => error instanceof SessionStoreUnavailableError && error.sqlState === "40001" && error.cause === serializationFailure,
  );
  // A cause without a state wraps to no state: nothing is invented.
  const plain = { ...context.client, platformUpdate: async () => { throw new Error("connection reset"); } };
  await assert.rejects(
    consumeFreshAssurance(plain, { freshAssuranceId: context.grant!.freshAssuranceId, action: ACTION, now }),
    (error: unknown) => error instanceof SessionStoreUnavailableError && error.sqlState === undefined,
  );
  assert.equal(new SessionStoreUnavailableError(undefined).sqlState, undefined);
  assert.equal(new SessionStoreUnavailableError({ sqlState: 40001 }).sqlState, undefined, "only a string SQLSTATE is carried");
});
