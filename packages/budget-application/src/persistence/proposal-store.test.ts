import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlatformSelectQuery } from "@cobudget/data-access";
import type { DataAccessClient } from "@cobudget/data-access";
import type { ProposalRecord } from "../creation-proposals/ports.ts";
import type { ProposalContextKey } from "../creation-proposals/ports.ts";
import { DurableProposalStore, proposalUuid } from "./proposal-store.ts";

const proposalContext: ProposalContextKey = {
  proposalId: "bcp_0123456789abcdef0123456789abcdef", subjectId: "subject-a",
  accountId: "account", profileId: "profile", environment: "test", sessionGeneration: 1,
};
void test("durable proposal locator composes subject/environment predicates; foreign contexts see nothing", async () => {
  const queries: PlatformSelectQuery[] = [];
  const record = { ...proposalContext, status: "previewed" } as ProposalRecord;
  const client = { platformSelect: async (query: PlatformSelectQuery) => {
    queries.push(query);
    const conditions = Object.fromEntries(query.conditions!.map((condition) => [condition.column, condition.value]));
    assert.ok(Object.hasOwn(conditions, "account_subject_id"));
    assert.ok(Object.hasOwn(conditions, "environment"));
    return { rows: conditions.account_subject_id === proposalContext.subjectId && conditions.environment === proposalContext.environment
      ? [{ proposal_payload: record, candidate_budget_space_id: "durable-candidate", lifecycle_revision: 1 }] : [], rowCount: 1 };
  } } as unknown as DataAccessClient;
  const store = new DurableProposalStore(client, () => { throw new Error("read must not allocate"); }, () => "2026-09-13T12:00:00Z");
  assert.equal((await store.locate(proposalContext))?.candidateBudgetSpaceId, "durable-candidate");
  for (const other of [
    { ...proposalContext, subjectId: "foreign" }, { ...proposalContext, environment: "foreign" },
    { ...proposalContext, profileId: "foreign" }, { ...proposalContext, accountId: "foreign" }, { ...proposalContext, sessionGeneration: 2 },
  ]) assert.equal(await store.loadForContext(other), null);
  const reopened = new DurableProposalStore(client, () => "new-candidate", () => "2026-09-13T12:00:00Z");
  assert.equal((await reopened.locate(proposalContext))?.candidateBudgetSpaceId, "durable-candidate");
  const count = queries.length;
  assert.equal(await store.locate({ ...proposalContext, proposalId: "malformed" }), null);
  assert.equal(queries.length, count);
  assert.equal(queries[0]?.conditions?.[2]?.value, "01234567-89ab-cdef-0123-456789abcdef");
});

void test("proposal UUID encoding retains all 128 identifier bits and rejects caller SQL", () => {
  assert.equal(proposalUuid(proposalContext.proposalId).replaceAll("-", ""), proposalContext.proposalId.slice(4));
  assert.throws(() => proposalUuid("'; select 1"), /invalid proposal identifier/);
});
