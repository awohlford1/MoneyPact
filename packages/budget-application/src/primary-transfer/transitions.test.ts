import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TRANSFER_EDGES, assertTransferEdge, isTransferEdge, transferEdgeTransition } from "./transitions.ts";
import { PrimaryTransferError, TRANSFER_STATES, isLiveTransferState, isTerminalTransferState } from "./records.ts";
import type { TransferState } from "./records.ts";

void test("PK7A-02: the edge set is exactly the one the M3 trigger admits", () => {
  // The trigger is the independent guard, not the source of the answer
  // (`PK5-05`). Reading it here is what keeps the two from drifting: an edge
  // the application allows and the database refuses would fail at COMMIT with
  // a constraint violation instead of the canonical outcome, and an edge the
  // database allows and the application refuses would be dead schema.
  const sql = readFileSync(
    new URL("../../../migrations/migrations/20260915T100002Z__create_budget_space_primary_transfer.sql", import.meta.url),
    "utf8",
  );
  const body = sql.slice(sql.indexOf("IF NEW.state IS DISTINCT FROM OLD.state"), sql.indexOf("state_version must increase"));
  const fromTrigger = new Set<string>();
  const clause = /\(OLD\.state = '(\w+)' AND NEW\.state IN \(([^)]*)\)\)/g;
  for (const match of body.matchAll(clause)) {
    const from = match[1] as string;
    for (const quoted of (match[2] as string).matchAll(/'(\w+)'/g)) fromTrigger.add(`${from}>${quoted[1] as string}`);
  }
  const fromApplication = new Set(TRANSFER_EDGES.map(([from, to]) => `${from}>${to}`));
  assert.deepEqual([...fromApplication].sort(), [...fromTrigger].sort());
});

void test("PK7A-02: a transition the model does not draw is refused before anything is written", () => {
  assert.throws(() => assertTransferEdge("proposed", "committed"), (error: unknown) => {
    assert.ok(error instanceof PrimaryTransferError);
    assert.equal(error.code, "transfer_not_current");
    return true;
  });
  // Self-edges are not no-ops: a repeat of a step already taken is a stale
  // precondition, not an idempotent success.
  assert.throws(() => assertTransferEdge("ready", "ready"), PrimaryTransferError);
  // Nothing leaves a terminal state.
  for (const state of ["committed", "declined", "withdrawn", "expired", "invalidated"] as TransferState[]) {
    for (const to of TRANSFER_STATES) {
      assert.equal(isTransferEdge(state, to), false, `${state} to ${to}`);
    }
  }
});

void test("PK7A-02: only ready commits, and every live state can close", () => {
  assert.equal(transferEdgeTransition("ready", "committed"), "TR-73-43");
  for (const state of TRANSFER_STATES) {
    if (state === "ready") continue;
    assert.equal(isTransferEdge(state, "committed"), false, state);
  }
  for (const state of TRANSFER_STATES.filter(isLiveTransferState)) {
    assert.equal(transferEdgeTransition(state, "expired"), "TR-73-46");
    assert.equal(transferEdgeTransition(state, "invalidated"), "TR-73-46");
  }
  assert.deepEqual(
    TRANSFER_STATES.filter(isTerminalTransferState),
    ["committed", "declined", "withdrawn", "expired", "invalidated"],
  );
});

void test("PK7A-02: withdraw is the Primary's and decline the recipient's, from any live non-ready state", () => {
  for (const state of ["proposed", "recipient_accepted", "primary_confirmed"] as TransferState[]) {
    assert.equal(transferEdgeTransition(state, "declined"), "TR-73-44");
    assert.equal(transferEdgeTransition(state, "withdrawn"), "TR-73-45");
  }
  // A ready workflow has both parties' evidence recorded; CBD-73 SS12 leaves
  // it only the commit and the two closures.
  assert.equal(isTransferEdge("ready", "declined"), false);
  assert.equal(isTransferEdge("ready", "withdrawn"), false);
});
