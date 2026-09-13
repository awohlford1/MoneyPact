/**
 * CBD-232-AC06 (non-authoritative, subject-scoped, versioned, expiring,
 * inaccessible-as-budget drafts, safe clearing on logout/account switch) and
 * CBD-232-AC07 (guessed IDs, cross-subject/account/profile/environment,
 * stale session, and altered payload/token cannot be read or confirmed).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOrRegenerateProposal, invalidateForContextChange, invalidateForSessionEnd, readProposal } from "./application.ts";
import type { InMemoryProposalStore } from "./in-memory-store.ts";
import { testAuthContext, testPorts } from "./support.ts";
import type { AuthenticatedSubjectContext, ProposalContextKey } from "./ports.ts";

const VALID_BODY = {
  name: "Groceries",
  timeZone: "America/New_York",
  currencyCode: "USD",
  schedule: { cadence: "weekly", anchor: "monday" },
};

function keyFor(subjectContext: AuthenticatedSubjectContext, proposalId: string): ProposalContextKey {
  return {
    environment: subjectContext.environment,
    subjectId: subjectContext.subjectId,
    accountId: subjectContext.accountId,
    profileId: subjectContext.profileId,
    sessionGeneration: subjectContext.sessionGeneration,
    proposalId,
  };
}

async function createProposal(subjectContext: AuthenticatedSubjectContext, ports: ReturnType<typeof testPorts>, key: string) {
  const outcome = await createOrRegenerateProposal({ subjectContext, idempotencyKeyHeader: key, body: VALID_BODY }, ports);
  assert.equal(outcome.kind, "created");
  if (outcome.kind !== "created") throw new Error("fixture setup failed");
  return outcome.response;
}

describe("CBD-232-AC06: drafts are explicitly non-authoritative and inaccessible as budgets", () => {
  it("the issued response carries no budget-space identity of any kind", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const response = await createProposal(subjectContext, ports, "draft-shape-key-01");
    const keys = Object.keys(response);
    assert.ok(!keys.some((k) => k.toLowerCase().includes("budgetspaceid") || k.toLowerCase() === "budgetid"));
    assert.equal(response.issuedStatus, "previewed");
    assert.equal(response.proposalId.startsWith("bcp_"), true);
  });

  it("is subject-scoped: created for one subject, invisible to a sibling subject in the same account/profile", async () => {
    const ports = testPorts();
    const ownerContext = testAuthContext({ subjectId: "owner" });
    const response = await createProposal(ownerContext, ports, "scope-key-000001");
    const siblingContext = testAuthContext({ subjectId: "sibling" });
    const read = await readProposal(keyFor(siblingContext, response.proposalId), ports);
    assert.equal(read.kind, "not_found");
  });

  it("is versioned and expiring: draftRevision starts at 1 and expiresAt is set", async () => {
    const ports = testPorts();
    const response = await createProposal(testAuthContext(), ports, "versioned-key-01");
    assert.equal(response.draftRevision, 1);
    assert.ok(response.expiresAt.length > 0);
    assert.ok(Date.parse(response.expiresAt) > Date.parse(response.issuedAt));
  });
});

describe("CBD-232-AC06: safe clearing and rebinding on logout / account switch", () => {
  it("explicit session-end invalidation marks the proposal invalidated with reason session_ended", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const response = await createProposal(subjectContext, ports, "logout-key-00001");
    const key = keyFor(subjectContext, response.proposalId);
    await invalidateForSessionEnd(key, response.draftRevision, ports);
    const read = await readProposal(key, ports);
    assert.equal(read.kind, "found");
    if (read.kind === "found") {
      assert.equal(read.response.lifecycle.status, "invalidated");
      assert.equal(read.response.lifecycle.reason, "session_ended");
    }
  });

  it("explicit account/profile-switch invalidation marks the proposal invalidated with reason context_changed", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const response = await createProposal(subjectContext, ports, "switch-key-00001");
    const key = keyFor(subjectContext, response.proposalId);
    await invalidateForContextChange(key, response.draftRevision, ports);
    const read = await readProposal(key, ports);
    assert.equal(read.kind, "found");
    if (read.kind === "found") assert.equal(read.response.lifecycle.reason, "context_changed");
  });

  it("a new session generation cannot read the old session's proposal even without explicit cleanup (lazy comparison is mandatory)", async () => {
    const subjectContext = testAuthContext({ sessionGeneration: 1 });
    const ports = testPorts();
    const response = await createProposal(subjectContext, ports, "new-session-key-01");
    const newSessionContext = testAuthContext({ sessionGeneration: 2 });
    const read = await readProposal(keyFor(newSessionContext, response.proposalId), ports);
    assert.equal(read.kind, "not_found");
  });

  it("a deliberate re-entry after context change must create a new proposal under the new context, not rebind the old one", async () => {
    const oldContext = testAuthContext({ sessionGeneration: 1 });
    const ports = testPorts();
    const oldResponse = await createProposal(oldContext, ports, "reentry-key-0001");
    await invalidateForSessionEnd(keyFor(oldContext, oldResponse.proposalId), oldResponse.draftRevision, ports);

    const newContext = testAuthContext({ sessionGeneration: 2 });
    const newOutcome = await createOrRegenerateProposal(
      { subjectContext: newContext, idempotencyKeyHeader: "reentry-key-0002", body: VALID_BODY },
      ports,
    );
    assert.equal(newOutcome.kind, "created");
    if (newOutcome.kind === "created") {
      assert.notEqual(newOutcome.response.proposalId, oldResponse.proposalId);
      assert.equal(newOutcome.response.supersedesProposalId, null);
    }
  });
});

describe("CBD-232-AC07: isolation and replay resistance", () => {
  it("a guessed proposal ID returns the uniform not-found response", async () => {
    const ports = testPorts();
    const read = await readProposal(keyFor(testAuthContext(), "bcp_00000000000000000000000000000000"), ports);
    assert.equal(read.kind, "not_found");
  });

  it("another subject's proposal cannot be read", async () => {
    const ports = testPorts();
    const response = await createProposal(testAuthContext({ subjectId: "victim" }), ports, "cross-subject-key-01");
    const attacker = testAuthContext({ subjectId: "attacker" });
    const read = await readProposal(keyFor(attacker, response.proposalId), ports);
    assert.equal(read.kind, "not_found");
  });

  it("cross-account/profile access is denied even for the same subject ID", async () => {
    const ports = testPorts();
    const owner = testAuthContext({ accountId: "account-a", profileId: "profile-a" });
    const response = await createProposal(owner, ports, "cross-account-key-01");
    const otherAccount = testAuthContext({ accountId: "account-b", profileId: "profile-a" });
    const read = await readProposal(keyFor(otherAccount, response.proposalId), ports);
    assert.equal(read.kind, "not_found");
  });

  it("a cross-environment proposal is denied", async () => {
    const ports = testPorts();
    const response = await createProposal(testAuthContext({ environment: "staging" }), ports, "cross-env-key-01");
    const read = await readProposal(keyFor(testAuthContext({ environment: "production" }), response.proposalId), ports);
    assert.equal(read.kind, "not_found");
  });

  it("a stale/revoked session generation is denied", async () => {
    const ports = testPorts();
    const response = await createProposal(testAuthContext({ sessionGeneration: 5 }), ports, "stale-session-key-01");
    const read = await readProposal(keyFor(testAuthContext({ sessionGeneration: 6 }), response.proposalId), ports);
    assert.equal(read.kind, "not_found");
  });

  it("an altered confirmation binding fails verification and fails a claim attempt", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const response = await createProposal(subjectContext, ports, "altered-binding-key-01");
    const store = ports.store as InMemoryProposalStore;
    const forgedBinding = `${response.confirmationBinding}forged`;
    await assert.rejects(() => store.claimCurrentProposal(keyFor(subjectContext, response.proposalId), forgedBinding));
    // The genuine binding does claim successfully, proving the rejection above
    // is about the alteration and not a broken fixture.
    await assert.doesNotReject(() => store.claimCurrentProposal(keyFor(subjectContext, response.proposalId), response.confirmationBinding));
  });
});
