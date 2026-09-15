import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapFixture } from "@cobudget/contracts/authorization";
import type { DataAccessClient } from "@cobudget/data-access";
import { CreationAuthorizationStore } from "./transaction-store.js";
import { RouteFailure } from "../authorization/http.js";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";
import { ConfirmationError, requestDigest } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";
import type { ConfirmBudgetCreationResponse, CreationPlan } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";

void test("Primary Owner discharge and exact persisted postcondition verification", async () => {
  const input = bootstrapFixture(); const members: Record<string, unknown>[] = [];
  const budgets = [{ primary_owner_membership_id: input.bootstrap!.candidatePrimaryMembershipId, lifecycle: "live" }];
  // CBD-236 SS7: the creator's consent row is a postcondition of the same transaction. The handler writes
  // it; `verify` refuses to let a membership commit without exactly one current self_disclosure row for
  // the acting subject, carrying a registry disclosure version and digest.
  const consentRow = () => ({ membership_id: input.bootstrap!.candidatePrimaryMembershipId, account_subject_id: input.subject!.accountSubjectId,
    source: "self_disclosure", state: "current", disclosure_kind: PRIMARY_OWNER_SELF_DISCLOSURE, disclosure_version: 1, disclosure_digest: "d".repeat(64) });
  let consents: Record<string, unknown>[] = [consentRow()];
  const client = {
    tenantInsert: async (q: { values: Record<string, unknown>; budgetSpaceId: string; table: string }) => {
      assert.equal(q.budgetSpaceId, input.bootstrap!.candidateSpaceId); assert.equal(q.table, "budget_space_membership"); members.push(q.values);
    },
    tenantSelect: async (q: { table: string }) => {
      const rows = q.table === "budget_space" ? budgets : q.table === "budget_space_consent" ? consents : members;
      return { rows, rowCount: rows.length };
    },
  } as unknown as DataAccessClient;
  const store = new CreationAuthorizationStore(client, 3);
  assert.equal(await store.discharge(client, input, { kind: "create_primary_owner_membership" }), true);
  assert.equal(await store.verify(client, input, []), true);
  // The consent postcondition, failed deliberately in every way the row can be wrong.
  for (const [label, rows] of [
    ["no consent row at all", []],
    ["two current rows", [consentRow(), consentRow()]],
    ["another subject's consent", [{ ...consentRow(), account_subject_id: "foreign" }]],
    ["a source other than self_disclosure", [{ ...consentRow(), source: "invitation_acceptance" }]],
    ["another disclosure kind", [{ ...consentRow(), disclosure_kind: "invitation" }]],
    ["a disclosure version below 1", [{ ...consentRow(), disclosure_version: 0 }]],
    ["no disclosure digest", [{ ...consentRow(), disclosure_digest: "" }]],
  ] as const) {
    consents = [...rows] as Record<string, unknown>[];
    assert.equal(await store.verify(client, input, []), false, label);
  }
  consents = [consentRow()];
  members.push({ ...members[0] }); assert.equal(await store.verify(client, input, []), false); members.pop();
  members[0]!.account_subject_id = "foreign"; assert.equal(await store.verify(client, input, []), false);
  members.length = 0; assert.equal(await store.verify(client, input, []), false);
});

void test("a stale acknowledged disclosure is published as the stable CBD-233 conflict, not a generic denial", async () => {
  const order: string[] = [];
  let scoped: DataAccessClient | undefined;
  const client = { transaction: async (_options: unknown, work: (client: DataAccessClient) => Promise<unknown>) => {
    order.push("begin"); try { const result = await work(client); order.push("commit"); return result; }
    catch (e) { order.push("rollback"); throw e; }
  } } as unknown as DataAccessClient;
  const store = new CreationAuthorizationStore(client, 3);
  const result = await store.transaction<unknown>(async transaction => {
    scoped = transaction as DataAccessClient;
    // What the route does when the consent write denies inside the boundary's transaction.
    store.recordFailure(scoped, new RouteFailure(409, "stale_disclosure"));
    throw new Error("boundary denial after rollback");
  });
  assert.ok(result instanceof RouteFailure);
  assert.equal(result.status, 409);
  assert.deepEqual(result.response, { error: "stale_disclosure" });
  assert.deepEqual(order, ["begin", "rollback"]);
  assert.ok(scoped);
});
void test("concurrent committed replay exits the transactional fact recheck after rollback without policy or effect", async () => {
  const context = { environment: "test", subjectId: "subject", profileId: "profile", accountId: "account", sessionGeneration: 1 };
  const request = { proposalId: "bcp_" + "a".repeat(32), confirmationBinding: "binding", confirmationIdempotencyKey: "1111111111111111" };
  const response = { confirmationOutcomeId: "stored", budgetSpaceId: "candidate" } as ConfirmBudgetCreationResponse;
  const order: string[] = [];
  const client = { transaction: async (_options: unknown, work: (client: DataAccessClient) => Promise<unknown>) => {
    order.push("begin"); try { return await work(client); } catch (e) { order.push("rollback"); throw e; }
  }, platformSelect: async () => ({ rows: [{ candidate_budget_space_id: "candidate" }] }),
    tenantSelect: async () => ({ rows: [{ request_digest: requestDigest(request), committed_response: response }] }),
  } as unknown as DataAccessClient;
  const store = new CreationAuthorizationStore(client, 3);
  const actual = await store.transaction(async transaction => {
    // This models the adapter being invoked only after a fresh authenticated
    // session read, before the datastore facts or policy decision.
    await store.replayAfterSession(transaction as DataAccessClient, context, request);
    assert.fail("policy and effects must not run for committed replay");
  });
  assert.deepEqual(actual, response); assert.deepEqual(order, ["begin", "rollback"]);
});

void test("application failure is transported only after rollback and is never committed", async () => {
  const order: string[] = [];
  const client = { transaction: async (_options: unknown, work: (client: DataAccessClient) => Promise<unknown>) => {
    order.push("begin"); try { const result = await work(client); order.push("commit"); return result; }
    catch (e) { order.push("rollback"); throw e; }
  } } as unknown as DataAccessClient;
  const store = new CreationAuthorizationStore(client, 3);
  const result = await store.transaction<unknown>(async () => { throw new ConfirmationError("confirmation_stale"); });
  assert.ok(result instanceof RouteFailure); assert.equal(result.status, 409); assert.deepEqual(order, ["begin", "rollback"]);
});

/**
 * H2-F02 (PROTO-HARDENING-002-RESULT finding H2-F02; PROTO-API-HARDENING-003).
 * `packages/sessions`-adjacent `ApiTransactionStore` (SEC-PK4-F4) observes the
 * SQLSTATE of every statement on the scoped handle so a serialization failure
 * swallowed inside a commit-time fact read still retries the attempt; this
 * store carries the identical helper and predicate.
 */
void test("H2-F02: a serialization failure swallowed inside the fact read (a higher layer's own fail-closed answer) is still retried", async () => {
  const context = { environment: "test", subjectId: "subject", profileId: "profile", accountId: "account", sessionGeneration: 1 };
  const request = { proposalId: "bcp_" + "a".repeat(32), confirmationBinding: "binding", confirmationIdempotencyKey: "2222222222222222" };
  const plan = { context, request } as unknown as CreationPlan;
  const serialization = () => Object.assign(new Error("statement failed"), { name: "StatementFailedError", sqlState: "40001" });

  // Nothing this fake `work` does ever actually persists an idempotency row, so `lookupConfirmation`
  // (called both in the catch block's commit-conflict check and after a clean commit) never finds one --
  // the point here is only whether the swallowed statement failure buys the attempt a retry, never a
  // fabricated "it committed" outcome.
  function clientWhoseFactReadFails(failures: () => Error | undefined) {
    let attempts = 0;
    const scoped = {
      tenantSelect: async (q: { table: string }) => {
        if (q.table === "budget_space") { const failure = failures(); if (failure) throw failure; }
        return { rows: [], rowCount: 0 };
      },
      platformSelect: async () => ({ rows: [] }),
    };
    const client = {
      ...scoped,
      transaction: async <T>(_options: unknown, work: (transaction: DataAccessClient) => Promise<T>): Promise<T> => { attempts++; return work(scoped as unknown as DataAccessClient); },
    } as unknown as DataAccessClient;
    return { client, attempts: () => attempts };
  }
  // Failed once, then the statement succeeds: two attempts, not one -- the swallowed 40001 bought a retry.
  // (Before H2-F02, `state` came only from the thrown error's own `sqlState`, which this plain `Error`
  // never carries, so the first attempt would have fallen straight to the un-retried throw below.)
  let remaining = 1;
  const once = clientWhoseFactReadFails(() => remaining-- > 0 ? serialization() : undefined);
  const store1 = new CreationAuthorizationStore(once.client, 3);
  const result1 = await store1.transaction<unknown>(async (transaction) => {
    const scoped = transaction as DataAccessClient;
    store1.recordPlan(scoped, plan);
    try { await scoped.tenantSelect({ table: "budget_space", budgetSpaceId: "candidate" } as never); }
    catch { throw new Error("input_invalid"); } // what a higher layer (the assembler) reduces the swallowed 40001 to; no sqlState anywhere on it
    return { confirmationOutcomeId: "unreached" };
  });
  assert.ok(result1 instanceof RouteFailure, "nothing this fake work ever persists, so the honest answer once retries are exhausted is the same retryable_conflict a real concurrent loser gets");
  assert.equal(result1.response.error, "retryable_conflict");
  assert.equal(once.attempts(), 2, "one failed attempt (the swallowed 40001), one retry");

  // Always fails: retried up to the cap, then the same graceful answer -- never an unhandled throw.
  const always = clientWhoseFactReadFails(serialization);
  const store2 = new CreationAuthorizationStore(always.client, 3);
  const result2 = await store2.transaction<unknown>(async (transaction) => {
    const scoped = transaction as DataAccessClient;
    store2.recordPlan(scoped, plan);
    try { await scoped.tenantSelect({ table: "budget_space", budgetSpaceId: "candidate" } as never); }
    catch { throw new Error("input_invalid"); }
    return { confirmationOutcomeId: "unreached" };
  });
  assert.ok(result2 instanceof RouteFailure);
  assert.equal(result2.response.error, "retryable_conflict");
  assert.equal(always.attempts(), 3, "bounded: two retries, then gives up on the third");
});
