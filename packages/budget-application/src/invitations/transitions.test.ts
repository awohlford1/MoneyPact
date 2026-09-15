/**
 * `PK5-05`: every state transition the prototype executes is covered by a
 * discriminating test against CBD-73 SS4.2, and the schema's closed edges are
 * never the only check.
 *
 * "Discriminating" is the point of this file. It is not enough to assert that
 * the edges the design draws are admitted; a table that admitted everything
 * would pass that. Each block below therefore pairs the admitted edge with
 * the neighbouring edge the state model refuses, and the refusal is checked
 * as the canonical application error -- raised by
 * `src/invitations/transitions.ts` before any write -- not as a database
 * constraint violation.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CEREMONY_EDGES, CONFIRMATION_EDGES, INVITATION_EDGES, TERMINAL_INVITATION_STATES,
  assertCeremonyEdge, assertCodeDispositionEdge, assertConfirmationEdge, assertInvitationEdge,
  invitationEdgeTransition, isTerminalInvitationState,
} from "./transitions.ts";
import { INVITATION_STATES, isInvitationError } from "./records.ts";
import type { CeremonyState, ConfirmationState, InvitationState } from "./records.ts";

function refused(work: () => void, code: string): void {
  assert.throws(work, (error: unknown) => isInvitationError(error) && error.code === code);
}

void test("every CBD-73 4.2 edge the prototype executes is admitted, and each names its transition", () => {
  // The whole table, read against design proposal 4.6 row by row.
  const expected: readonly (readonly [InvitationState, InvitationState, string])[] = [
    ["created", "pending", "TR-73-02"],
    ["created", "superseded", "TR-73-05"],
    ["created", "cancelled", "TR-73-06"],
    ["created", "expired", "TR-73-07"],
    ["pending", "superseded", "TR-73-05"],
    ["pending", "cancelled", "TR-73-06"],
    ["pending", "expired", "TR-73-07"],
    ["pending", "declined", "TR-73-11"],
    ["pending", "awaiting_confirmation", "TR-73-38"],
    ["awaiting_confirmation", "accepted", "TR-73-13"],
    ["awaiting_confirmation", "cancelled", "TR-73-39-reject"],
    ["awaiting_confirmation", "expired", "TR-73-07"],
    ["synthetic_created", "synthetic_pending", "TR-73-17"],
    ["synthetic_created", "synthetic_inactive", "TR-73-18"],
    ["synthetic_pending", "synthetic_inactive", "TR-73-18"],
  ];
  assert.deepEqual([...INVITATION_EDGES].map((edge) => [...edge]), expected.map((edge) => [...edge]));
  for (const [from, to, transition] of expected) {
    assert.doesNotThrow(() => assertInvitationEdge(from, to), `${from} -> ${to}`);
    assert.equal(invitationEdgeTransition(from, to), transition);
  }
});

void test("every edge the table does not draw is refused before a write, including the ones the schema also refuses", () => {
  let refusals = 0;
  for (const from of INVITATION_STATES) {
    for (const to of INVITATION_STATES) {
      const drawn = INVITATION_EDGES.some(([a, b]) => a === from && b === to);
      if (drawn) continue;
      refused(() => assertInvitationEdge(from, to), "invitation_not_current");
      refusals += 1;
    }
  }
  // 11 states, 121 ordered pairs, 15 drawn edges.
  assert.equal(refusals, INVITATION_STATES.length * INVITATION_STATES.length - INVITATION_EDGES.length);
});

void test("the four transitions CBD-73 4.2 draws that this increment does not execute are absent", () => {
  // Delivered and Failed are absent by IV-001, so neither appears as a state
  // and none of TR-73-03 / TR-73-04 has an edge. A future widening that added
  // them would have to add them here first.
  assert.ok(!(INVITATION_STATES as readonly string[]).includes("delivered"));
  assert.ok(!(INVITATION_STATES as readonly string[]).includes("failed"));
  assert.equal(invitationEdgeTransition("pending", "accepted" as InvitationState), undefined);
  assert.equal(invitationEdgeTransition("declined", "awaiting_confirmation"), undefined);
});

void test("a terminal record never leaves its state; accepted in particular is final", () => {
  for (const state of TERMINAL_INVITATION_STATES) {
    assert.ok(isTerminalInvitationState(state));
    for (const to of INVITATION_STATES) refused(() => assertInvitationEdge(state, to), "invitation_not_current");
  }
  // The two the Security round called out by name.
  refused(() => assertInvitationEdge("accepted", "awaiting_confirmation"), "invitation_not_current");
  refused(() => assertInvitationEdge("declined", "accepted"), "invitation_not_current");
});

void test("a self-edge is refused: a transition is a change, and a no-op would hide a lost race", () => {
  for (const state of INVITATION_STATES) refused(() => assertInvitationEdge(state, state), "invitation_not_current");
});

void test("the code disposition set is one-way out of active", () => {
  assert.doesNotThrow(() => assertCodeDispositionEdge("active", "consumed"));
  assert.doesNotThrow(() => assertCodeDispositionEdge("active", "invalidated"));
  refused(() => assertCodeDispositionEdge("consumed", "active"), "code_unusable");
  refused(() => assertCodeDispositionEdge("invalidated", "active"), "code_unusable");
  refused(() => assertCodeDispositionEdge("consumed", "invalidated"), "code_unusable");
});

void test("the ceremony machine admits only the five edges 4.4 draws", () => {
  const drawn: readonly (readonly [CeremonyState, CeremonyState])[] = [
    ["open", "declined"],
    ["open", "accepted_pending_confirmation"],
    ["open", "invalidated"],
    ["accepted_pending_confirmation", "consumed"],
    ["accepted_pending_confirmation", "invalidated"],
  ];
  assert.deepEqual([...CEREMONY_EDGES].map((edge) => [...edge]), drawn.map((edge) => [...edge]));
  for (const [from, to] of drawn) assert.doesNotThrow(() => assertCeremonyEdge(from, to));
  // A consumed ceremony is not re-openable, and a declined one never accepts.
  refused(() => assertCeremonyEdge("consumed", "open"), "ceremony_unusable");
  refused(() => assertCeremonyEdge("declined", "accepted_pending_confirmation"), "ceremony_unusable");
  refused(() => assertCeremonyEdge("invalidated", "consumed"), "ceremony_unusable");
  refused(() => assertCeremonyEdge("open", "consumed"), "ceremony_unusable");
});

void test("a confirmation is decided once, from requested only", () => {
  const drawn: readonly (readonly [ConfirmationState, ConfirmationState])[] = [
    ["requested", "confirmed"],
    ["requested", "rejected"],
    ["requested", "expired"],
  ];
  assert.deepEqual([...CONFIRMATION_EDGES].map((edge) => [...edge]), drawn.map((edge) => [...edge]));
  for (const [from, to] of drawn) assert.doesNotThrow(() => assertConfirmationEdge(from, to));
  refused(() => assertConfirmationEdge("confirmed", "rejected"), "confirmation_not_current");
  refused(() => assertConfirmationEdge("rejected", "confirmed"), "confirmation_not_current");
  refused(() => assertConfirmationEdge("expired", "confirmed"), "confirmation_not_current");
});
