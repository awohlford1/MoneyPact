import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthorizationBoundary } from "../authorization/boundary.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import { FactAssembler } from "../authorization/facts.js";
import { Harness } from "../authorization/test-support.js";

void test("caller-supplied candidates are ignored for ordinary space creation", async () => {
  const h = new Harness();
  const lookup = { ...h.lookup(), candidates: { spaceId: "caller-space", membershipId: "caller-membership" } };
  const first = await h.boundary.authorize(lookup);
  const second = await h.boundary.authorize(lookup);
  assert.notEqual(first.input.bootstrap!.candidateSpaceId, lookup.candidates.spaceId);
  assert.notEqual(first.input.bootstrap!.candidatePrimaryMembershipId, lookup.candidates.membershipId);
  assert.notEqual(first.input.bootstrap!.candidateSpaceId, second.input.bootstrap!.candidateSpaceId);
});

void test("resolved proposal provider owns candidates and commit retains the same identities", async () => {
  const h = new Harness();
  const persisted = { spaceId: "persisted-space", membershipId: "persisted-membership" };
  let calls = 0;
  const assembler = new FactAssembler("api", h.source, () => new Date(h.input.evaluation.evaluatedAt), 5_000, async (operation) => {
    assert.equal(operation.proposalReference, "server-resolved-reference");
    calls++;
    return persisted;
  });
  const boundary = new AuthorizationBoundary(assembler, h.store, h.audit);
  const lookup = h.lookup();
  const context = await boundary.authorize({ ...lookup,
    operation: { ...lookup.operation, proposalReference: "server-resolved-reference" },
    candidates: { spaceId: "caller-space", membershipId: "caller-membership" },
  });
  assert.equal(context.input.bootstrap!.candidateSpaceId, persisted.spaceId);
  assert.equal(context.input.bootstrap!.candidatePrimaryMembershipId, persisted.membershipId);
  await boundary.execute(context, async ({ input, transaction }) => {
    assert.equal(input.bootstrap!.candidateSpaceId, persisted.spaceId);
    (transaction as typeof h.state).spaces.push(input.bootstrap!.candidateSpaceId);
  });
  assert.equal(calls, 1);
  assert.deepEqual(h.state.spaces, [persisted.spaceId]);
  assert.deepEqual(h.state.memberships, [persisted.membershipId]);
});

void test("unresolved proposal reference fails closed without fresh-identifier fallback", async () => {
  const h = new Harness();
  const lookup = h.lookup();
  await assert.rejects(h.boundary.authorize({ ...lookup, operation: { ...lookup.operation, proposalReference: "unresolved" } }), AuthorizationDenied);
  assert.deepEqual(h.state.spaces, []);
  assert.deepEqual(h.state.memberships, []);
});
