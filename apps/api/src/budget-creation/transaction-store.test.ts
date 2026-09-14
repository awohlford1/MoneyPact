import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapFixture } from "@cobudget/contracts/authorization";
import type { DataAccessClient } from "@cobudget/data-access";
import { CreationAuthorizationStore } from "./transaction-store.js";
import { RouteFailure } from "../authorization/http.js";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";
import { ConfirmationError, requestDigest } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";
import type { ConfirmBudgetCreationResponse } from "../../../../packages/budget-application/src/creation-confirmation/index.ts";

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
