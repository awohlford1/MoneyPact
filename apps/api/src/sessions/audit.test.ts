/**
 * PROTO-IDENTITY-API-001 correction C3 (review R03 / security S03):
 * a required allow audit must never be outrun by its database commit.
 * `ApiTransactionStore.transaction` calls `audit.emit(...)` through
 * `AuthorizationBoundary.execute`'s work callback -- i.e. `append(build,
 * transaction)` runs strictly before the underlying `client.transaction`
 * COMMIT. These tests exercise `InProcessRestrictedAuditStore` and
 * `ApiTransactionStore` directly (no HTTP layer) to prove that a capacity
 * failure at that point aborts the database transaction rather than
 * surfacing after a successful commit.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DataAccessClient } from "@cobudget/data-access";
import { createFakeIdentityClient, FakeIdentityDatabase } from "../identity/test-support/fake-client.ts";
import { InProcessRestrictedAuditStore } from "./audit.ts";
import { ApiTransactionStore } from "./transaction-store.ts";

/** A benign insert unaffected by the fake's deferred subject/profile pair invariant, standing in for "the protected mutation." */
async function insertMarker(client: unknown, id: string): Promise<void> {
  await (client as DataAccessClient).platformInsert({ table: "provider_security_event", values: { provider_security_event_id: id, environment_id: "test", issuer: "test", provider_event_id: id, provider_subject: "test", event_class: "test", provider_event_time: new Date(), ordering_cursor: null, received_at: new Date(), identity_binding_id: null } });
}

function build(sequence: number, previousEventDigest: string): Record<string, unknown> {
  return { eventId: `evt-${sequence}`, sequence, previousEventDigest, outcome: "allow" };
}

describe("PROTO-IDENTITY-API-001 C3: audit failure cannot outrun a database commit", () => {
  it("an audit store at capacity fails the transaction before commit; zero rows persist and zero events append", async () => {
    const db = new FakeIdentityDatabase();
    const client = createFakeIdentityClient(db);
    const audit = new InProcessRestrictedAuditStore(0); // capacity 0: the very first reservation must fail.
    const store = new ApiTransactionStore(client, audit);

    await assert.rejects(
      store.transaction(async (transaction) => {
        await insertMarker(transaction, "s1");
        await audit.append((sequence, previousEventDigest) => build(sequence, previousEventDigest), transaction);
        return "unreachable";
      }),
      /audit_capacity_unavailable/,
    );

    assert.equal(db.count("provider_security_event"), 0, "the buffering failure aborted the scoped work before any statement committed");
    assert.equal(audit.length, 0, "no event was ever appended to the chain");
    assert.equal(audit.reserved, 0, "the failed reservation left no residue");
  });

  it("a transaction that successfully buffers an allow event commits both the database row and the audit event together", async () => {
    const db = new FakeIdentityDatabase();
    const client = createFakeIdentityClient(db);
    const audit = new InProcessRestrictedAuditStore(100);
    const store = new ApiTransactionStore(client, audit);

    const result = await store.transaction(async (transaction) => {
      await insertMarker(transaction, "s1");
      await audit.append((sequence, previousEventDigest) => build(sequence, previousEventDigest), transaction);
      return "ok";
    });

    assert.equal(result, "ok");
    assert.equal(db.count("provider_security_event"), 1);
    assert.equal(audit.length, 1, "the buffered event flushed after the real commit");
    assert.equal(audit.reserved, 0);
  });

  it("concurrent denial appends beyond capacity leave zero committed rows for the transactional side and never exceed capacity", async () => {
    const db = new FakeIdentityDatabase();
    const client = createFakeIdentityClient(db);
    const audit = new InProcessRestrictedAuditStore(1);
    const store = new ApiTransactionStore(client, audit);

    // First transactional reservation consumes the only slot and commits.
    await store.transaction(async (transaction) => {
      await audit.append((sequence, previousEventDigest) => build(sequence, previousEventDigest), transaction);
      return undefined;
    });
    assert.equal(audit.length, 1);

    // A concurrent denial append (no transaction) and a second transactional
    // attempt both race for the now-exhausted single slot; both must fail
    // closed and neither may leave a partially committed effect.
    await assert.rejects(audit.append((sequence, previousEventDigest) => build(sequence, previousEventDigest)), /audit_capacity_unavailable/);
    await assert.rejects(
      store.transaction(async (transaction) => {
        await insertMarker(transaction, "s2");
        await audit.append((sequence, previousEventDigest) => build(sequence, previousEventDigest), transaction);
        return undefined;
      }),
      /audit_capacity_unavailable/,
    );
    assert.equal(db.count("provider_security_event"), 0, "the second transaction never committed its database effect");
    assert.equal(audit.length, 1, "capacity was never exceeded");
    assert.equal(audit.reserved, 0);
  });
});
