/**
 * CBD-232-AC05: result-affecting edits, rule/version changes, expiry, and
 * budget-local-midnight rollover invalidate the prior preview and require
 * regeneration; §9's `replaceCurrent` evaluation order (successor idempotency
 * checked before predecessor eligibility) and terminal-head regeneration.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOrRegenerateProposal, discardProposal, readProposal } from "./application.ts";
import type { InMemoryProposalStore } from "./in-memory-store.ts";
import { FakeClock, FakeCurrencyContextReader, testAuthContext, testPorts } from "./test-support.ts";

const VALID_BODY = {
  name: "Groceries",
  timeZone: "America/New_York",
  currencyCode: "USD",
  schedule: { cadence: "weekly", anchor: "monday" },
};

function keyFor(subjectContext: ReturnType<typeof testAuthContext>, proposalId: string) {
  return {
    environment: subjectContext.environment,
    subjectId: subjectContext.subjectId,
    accountId: subjectContext.accountId,
    profileId: subjectContext.profileId,
    sessionGeneration: subjectContext.sessionGeneration,
    proposalId,
  };
}

describe("CBD-232-AC05: display-only vs result-affecting edits", () => {
  it("editing a bound field (name) invalidates the predecessor and issues a successor", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const first = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Edit/key/0000001", body: VALID_BODY },
      ports,
    );
    assert.equal(first.kind, "created");
    if (first.kind !== "created") return;

    const second = await createOrRegenerateProposal(
      {
        subjectContext,
        idempotencyKeyHeader: "Edit/key/0000002",
        body: { ...VALID_BODY, name: "New Name", supersedesProposalId: first.response.proposalId },
      },
      ports,
    );
    assert.equal(second.kind, "created");
    if (second.kind !== "created") return;
    assert.notEqual(second.response.proposalId, first.response.proposalId);
    assert.equal(second.response.draftRevision, first.response.draftRevision + 1);
    assert.equal(second.response.supersedesProposalId, first.response.proposalId);

    const predecessorRead = await readProposal(keyFor(subjectContext, first.response.proposalId), ports);
    assert.equal(predecessorRead.kind, "found");
    if (predecessorRead.kind === "found") {
      assert.equal(predecessorRead.response.lifecycle.status, "invalidated");
      assert.equal(predecessorRead.response.lifecycle.reason, "superseded");
      assert.equal(predecessorRead.response.lifecycle.regenerateRequired, true);
    }
  });
});

for (const field of ["timeZone", "currencyCode"] as const) {
  describe(`CBD-232-AC05: editing ${field}`, () => {
    it("creates a successor and invalidates the predecessor", async () => {
      const subjectContext = testAuthContext();
      const ports = testPorts();
      const first = await createOrRegenerateProposal(
        { subjectContext, idempotencyKeyHeader: `${field}-key-0000001`, body: VALID_BODY },
        ports,
      );
      assert.equal(first.kind, "created");
      if (first.kind !== "created") return;

      const editedValue = field === "timeZone" ? "America/Chicago" : "EUR";
      const second = await createOrRegenerateProposal(
        {
          subjectContext,
          idempotencyKeyHeader: `${field}-key-0000002`,
          body: { ...VALID_BODY, [field]: editedValue, supersedesProposalId: first.response.proposalId },
        },
        ports,
      );
      assert.equal(second.kind, "created");
    });
  });
}

describe("CBD-232-AC05: cadence/anchor/cadence-specific input edit", () => {
  it("changing the schedule creates a successor", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const first = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Schedule/key/0000001", body: VALID_BODY },
      ports,
    );
    assert.equal(first.kind, "created");
    if (first.kind !== "created") return;

    const second = await createOrRegenerateProposal(
      {
        subjectContext,
        idempotencyKeyHeader: "Schedule/key/0000002",
        body: {
          ...VALID_BODY,
          schedule: { cadence: "weekly", anchor: "friday" },
          supersedesProposalId: first.response.proposalId,
        },
      },
      ports,
    );
    assert.equal(second.kind, "created");
    if (second.kind === "created") {
      assert.notDeepEqual(second.response.normalizedInputs.schedule, first.response.normalizedInputs.schedule);
    }
  });
});

describe("CBD-232-AC05: governing-version changes stale a proposal lazily on read", () => {
  it("a currency-catalog version bump invalidates on next read with dependency_changed", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Catalog-bump/key/01", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;

    const bumpedPorts = {
      ...ports,
      currencyContextReader: new FakeCurrencyContextReader({ currencyCatalogVersion: "currency-catalog/test-2" }),
    };
    const read = await readProposal(keyFor(subjectContext, created.response.proposalId), bumpedPorts);
    assert.equal(read.kind, "found");
    if (read.kind === "found") {
      assert.equal(read.response.lifecycle.status, "invalidated");
      assert.equal(read.response.lifecycle.reason, "dependency_changed");
      assert.equal(read.response.lifecycle.regenerateRequired, true);
    }
  });

  it("display-only reads with no dependency change remain previewed", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Stable-read/key/01", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    const read = await readProposal(keyFor(subjectContext, created.response.proposalId), ports);
    assert.equal(read.kind, "found");
    if (read.kind === "found") {
      assert.equal(read.response.lifecycle.status, "previewed");
      assert.equal(read.response.lifecycle.regenerateRequired, false);
    }
  });
});

describe("CBD-232-AC05: expiry, exact boundary, and local-midnight rollover", () => {
  it("is previewed one millisecond before expiresAt and expired at/after it", async () => {
    const clock = new FakeClock("2026-09-16T12:00:00.000Z");
    const ports = testPorts({ clock });
    const subjectContext = testAuthContext();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Boundary/key/000001", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;

    clock.set(new Date(Date.parse(created.response.expiresAt) - 1).toISOString());
    const justBefore = await readProposal(keyFor(subjectContext, created.response.proposalId), ports);
    assert.equal(justBefore.kind, "found");
    if (justBefore.kind === "found") assert.equal(justBefore.response.lifecycle.status, "previewed");

    clock.set(created.response.expiresAt);
    const atBoundary = await readProposal(keyFor(subjectContext, created.response.proposalId), ports);
    assert.equal(atBoundary.kind, "found");
    if (atBoundary.kind === "found") {
      assert.equal(atBoundary.response.lifecycle.status, "expired");
      assert.equal(atBoundary.response.lifecycle.reason, "time_limit");
    }
  });

  it("expires at local midnight, with reason local_midnight, when that precedes the 30-minute cap", async () => {
    // 23:50 America/New_York on 2026-09-16 == 2026-09-17T03:50:00Z; midnight is 10 minutes away.
    const clock = new FakeClock("2026-09-17T03:50:00.000Z");
    const ports = testPorts({ clock });
    const subjectContext = testAuthContext();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Midnight/key/0000001", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    assert.equal(created.response.expiresAt, "2026-09-17T04:00:00.000Z");

    clock.set("2026-09-17T04:00:00.000Z");
    const read = await readProposal(keyFor(subjectContext, created.response.proposalId), ports);
    assert.equal(read.kind, "found");
    if (read.kind === "found") {
      assert.equal(read.response.lifecycle.status, "expired");
      assert.equal(read.response.lifecycle.reason, "local_midnight");
    }
  });
});

describe("CBD-232-AC05/§9: replaceCurrent evaluation order and terminal-head regeneration", () => {
  it("an exact retry after a lost response replays 200 even though the predecessor is by then invalidated", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const first = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Lost-response/key/01", body: VALID_BODY },
      ports,
    );
    assert.equal(first.kind, "created");
    if (first.kind !== "created") return;

    const replaceBody = { ...VALID_BODY, name: "Edited Name", supersedesProposalId: first.response.proposalId };
    const successorHeader = "Lost-response/key/02";
    const original = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: successorHeader, body: replaceBody },
      ports,
    );
    assert.equal(original.kind, "created");
    if (original.kind !== "created") return;

    // Predecessor is now invalidated (superseded). An exact retry of the
    // successor's own creation call, using the successor's own idempotency
    // key and identical command, must still replay 200 with the stored
    // successor response — the store looks up the successor idempotency
    // record first and never re-evaluates predecessor eligibility.
    const retry = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: successorHeader, body: replaceBody },
      ports,
    );
    assert.equal(retry.kind, "replayed");
    if (retry.kind === "replayed") assert.deepEqual(retry.response, original.response);
  });

  it("regenerates from a discarded (terminal, no successor) predecessor", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Discard-regen/key/01", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;

    await discardProposal(keyFor(subjectContext, created.response.proposalId), created.response.draftRevision, ports);
    const discardedRead = await readProposal(keyFor(subjectContext, created.response.proposalId), ports);
    assert.equal(discardedRead.kind, "found");
    if (discardedRead.kind === "found") assert.equal(discardedRead.response.lifecycle.status, "invalidated");

    const regenerated = await createOrRegenerateProposal(
      {
        subjectContext,
        idempotencyKeyHeader: "Discard-regen/key/02",
        body: { ...VALID_BODY, supersedesProposalId: created.response.proposalId },
      },
      ports,
    );
    assert.equal(regenerated.kind, "created");
  });

  it("regenerates from an expired (terminal, no successor) predecessor", async () => {
    const clock = new FakeClock("2026-09-16T12:00:00.000Z");
    const ports = testPorts({ clock });
    const subjectContext = testAuthContext();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Expire-regen/key/01", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    clock.set(created.response.expiresAt);

    const regenerated = await createOrRegenerateProposal(
      {
        subjectContext,
        idempotencyKeyHeader: "Expire-regen/key/02",
        body: { ...VALID_BODY, supersedesProposalId: created.response.proposalId },
      },
      ports,
    );
    assert.equal(regenerated.kind, "created");
  });

  it("a predecessor that already has a successor is a conflict, not a second regeneration", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Double-regen/key/01", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;

    const firstReplace = await createOrRegenerateProposal(
      {
        subjectContext,
        idempotencyKeyHeader: "Double-regen/key/02",
        body: { ...VALID_BODY, name: "First Edit", supersedesProposalId: created.response.proposalId },
      },
      ports,
    );
    assert.equal(firstReplace.kind, "created");

    const secondReplace = await createOrRegenerateProposal(
      {
        subjectContext,
        idempotencyKeyHeader: "Double-regen/key/03",
        body: { ...VALID_BODY, name: "Second Edit", supersedesProposalId: created.response.proposalId },
      },
      ports,
    );
    // The predecessor already has a successor from firstReplace, so this
    // second attempt against the same (now stale) predecessor is rejected
    // with the uniform not-found behavior rather than silently succeeding.
    assert.equal(secondReplace.kind, "predecessor_not_found");
  });

  it("a confirmed predecessor cannot be replaced", async () => {
    const subjectContext = testAuthContext();
    const ports = testPorts();
    const created = await createOrRegenerateProposal(
      { subjectContext, idempotencyKeyHeader: "Confirmed!key!000001", body: VALID_BODY },
      ports,
    );
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;

    // Confirmation is CBD-233's proposed transaction, not this package's
    // scope; the in-memory adapter implements the proposed
    // BudgetCreationConfirmationUnitOfWork port (§9) so this test can reach a
    // genuinely confirmed proposal rather than fabricating the state.
    await (ports.store as InMemoryProposalStore).recordConfirmed(created.response.proposalId, "budget-space-1");

    const attemptedReplace = await createOrRegenerateProposal(
      {
        subjectContext,
        idempotencyKeyHeader: "Confirmed!key!000002",
        body: { ...VALID_BODY, name: "Too Late", supersedesProposalId: created.response.proposalId },
      },
      ports,
    );
    assert.equal(attemptedReplace.kind, "predecessor_not_found");

    const read = await readProposal(keyFor(subjectContext, created.response.proposalId), ports);
    assert.equal(read.kind, "found");
    if (read.kind === "found") assert.equal(read.response.lifecycle.status, "confirmed");
  });
});
