/**
 * CBD-232-AC08 concurrency evidence: two independent previews, simultaneous
 * `replaceCurrent` attempts against the same predecessor, and atomic
 * successor/idempotency/predecessor mutation (exactly one winner).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOrRegenerateProposal } from "./application.ts";
import { testAuthContext, testPorts } from "./test-support.ts";

const VALID_BODY = {
  name: "Groceries",
  timeZone: "America/New_York",
  currencyCode: "USD",
  schedule: { cadence: "weekly", anchor: "monday" },
};

describe("CBD-232-AC08: two independent previews", () => {
  it("concurrent independent drafts each start at draftRevision 1 with distinct IDs", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const [first, second] = await Promise.all([
      createOrRegenerateProposal({ subjectContext, idempotencyKeyHeader: "independent-key-01", body: VALID_BODY }, ports),
      createOrRegenerateProposal(
        { subjectContext, idempotencyKeyHeader: "independent-key-02", body: { ...VALID_BODY, name: "Second Draft" } },
        ports,
      ),
    ]);
    assert.equal(first.kind, "created");
    assert.equal(second.kind, "created");
    if (first.kind === "created" && second.kind === "created") {
      assert.equal(first.response.draftRevision, 1);
      assert.equal(second.response.draftRevision, 1);
      assert.notEqual(first.response.proposalId, second.response.proposalId);
    }
  });
});

describe("CBD-232-AC08: simultaneous replaceCurrent attempts on the same predecessor", () => {
  it("exactly one of two simultaneous edits against the same predecessor succeeds; the other conflicts", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "race-key-0000000", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;

    const [attemptA, attemptB] = await Promise.all([
      createOrRegenerateProposal(
        {
          subjectContext,
          idempotencyKeyHeader: "race-key-A0000000",
          body: { ...VALID_BODY, name: "Edit A", supersedesProposalId: created.response.proposalId },
        },
        ports,
      ),
      createOrRegenerateProposal(
        {
          subjectContext,
          idempotencyKeyHeader: "race-key-B0000000",
          body: { ...VALID_BODY, name: "Edit B", supersedesProposalId: created.response.proposalId },
        },
        ports,
      ),
    ]);

    const outcomes = [attemptA, attemptB];
    const winners = outcomes.filter((o) => o.kind === "created");
    const losers = outcomes.filter((o) => o.kind === "predecessor_not_found");
    assert.equal(winners.length, 1, "exactly one concurrent replace must win");
    assert.equal(losers.length, 1, "the other concurrent replace must be rejected, not silently applied");
  });
});
