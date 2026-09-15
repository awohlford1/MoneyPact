/**
 * The closed transfer state machine of CBD-73 SS12, as the prototype executes
 * it (design proposal SS10.1).
 *
 * The `M3` trigger `forbid_budget_space_primary_transfer_mutation` closes the
 * same edge set in the database. That guard is the last line, not the check:
 * a command that only discovered a prohibited transition when PostgreSQL
 * raised 23514 would already have written whatever preceded it in the
 * transaction and would answer the customer with a constraint violation
 * instead of the canonical outcome. Every transition in this module therefore
 * goes through {@link assertTransferEdge} first, and the trigger then proves
 * the same answer independently -- the same discipline `PK5-05` states for
 * the invitation record.
 */
import { PrimaryTransferError } from "./records.ts";
import type { TransferState } from "./records.ts";

/** Every edge the `M3` trigger admits, with the CBD-73 transition that draws it. */
export const TRANSFER_EDGES: readonly (readonly [TransferState, TransferState, string])[] = [
  ["proposed", "recipient_accepted", "TR-73-41"],
  ["proposed", "primary_confirmed", "TR-73-42"],
  ["proposed", "declined", "TR-73-44"],
  ["proposed", "withdrawn", "TR-73-45"],
  ["proposed", "expired", "TR-73-46"],
  ["proposed", "invalidated", "TR-73-46"],
  ["recipient_accepted", "ready", "TR-73-42"],
  // The trigger admits this edge; no command in this increment draws it,
  // because a Primary confirming a recipient-accepted workflow completes the
  // pair and goes straight to `ready`. Listed so the application's edge set
  // and the database's stay the same set rather than merely compatible.
  ["recipient_accepted", "primary_confirmed", "TR-73-42"],
  ["recipient_accepted", "declined", "TR-73-44"],
  ["recipient_accepted", "withdrawn", "TR-73-45"],
  ["recipient_accepted", "expired", "TR-73-46"],
  ["recipient_accepted", "invalidated", "TR-73-46"],
  ["primary_confirmed", "ready", "TR-73-41"],
  ["primary_confirmed", "declined", "TR-73-44"],
  ["primary_confirmed", "withdrawn", "TR-73-45"],
  ["primary_confirmed", "expired", "TR-73-46"],
  ["primary_confirmed", "invalidated", "TR-73-46"],
  ["ready", "committed", "TR-73-43"],
  ["ready", "expired", "TR-73-46"],
  ["ready", "invalidated", "TR-73-46"],
];

const TRANSFER_EDGE_SET = new Set(TRANSFER_EDGES.map(([from, to]) => `${from}>${to}`));

/** The transition identifier of an edge, or undefined when CBD-73 SS12 does not draw it. */
export function transferEdgeTransition(from: TransferState, to: TransferState): string | undefined {
  return TRANSFER_EDGES.find(([a, b]) => a === from && b === to)?.[2];
}

/**
 * Refuse a transition the state model does not draw, before anything is
 * written. `transfer_not_current` is deliberately the same code a stale
 * precondition gives: a caller asking for a transition this workflow cannot
 * make learns only that it is not in the state the request needs.
 */
export function assertTransferEdge(from: TransferState, to: TransferState): void {
  if (from === to) throw new PrimaryTransferError("transfer_not_current", "state");
  if (!TRANSFER_EDGE_SET.has(`${from}>${to}`)) throw new PrimaryTransferError("transfer_not_current", "state");
}

/** True when CBD-73 SS12 draws the edge. Used by the tests that prove the set equals the trigger's. */
export function isTransferEdge(from: TransferState, to: TransferState): boolean {
  return TRANSFER_EDGE_SET.has(`${from}>${to}`);
}
