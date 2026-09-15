/**
 * CBD-73 SS4.2 in the application, as the prototype executes it
 * (design proposal SS4.6).
 *
 * The PK-2 trigger on `budget_space_invitation` closes the same edge set in
 * the database. That guard is the last line, not the check: a command that
 * only discovered a prohibited transition when PostgreSQL raised 23514 would
 * have already written whatever preceded it in the transaction, and would
 * answer the customer with a constraint violation instead of the canonical
 * outcome. `PK5-05` is explicit that the schema's closed edges are never
 * relied on as the only check, so every transition in this module goes
 * through {@link assertInvitationEdge} first, and the trigger then proves the
 * same answer independently.
 *
 * `Delivered` and `Failed` are absent by `IV-001`; the synthetic edges of
 * `TR-73-16`/`TR-73-17`/`TR-73-18` are present because the prototype does
 * create suppressed records.
 */
import { InvitationError } from "./records.ts";
import type { CeremonyState, CodeDisposition, ConfirmationState, InvitationState } from "./records.ts";

/** Every edge CBD-73 SS4.2 draws that this increment can execute, with the transition that draws it. */
export const INVITATION_EDGES: readonly (readonly [InvitationState, InvitationState, string])[] = [
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

const INVITATION_EDGE_SET = new Set(INVITATION_EDGES.map(([from, to]) => `${from}>${to}`));

/** The states from which nothing leaves. Reaching one of these ends the record for good. */
export const TERMINAL_INVITATION_STATES: readonly InvitationState[] = [
  "accepted", "declined", "expired", "superseded", "cancelled", "synthetic_inactive",
];

export function isTerminalInvitationState(state: InvitationState): boolean {
  return TERMINAL_INVITATION_STATES.includes(state);
}

/** The transition identifier of an edge, or undefined when CBD-73 SS4.2 does not draw it. */
export function invitationEdgeTransition(from: InvitationState, to: InvitationState): string | undefined {
  return INVITATION_EDGES.find(([a, b]) => a === from && b === to)?.[2];
}

/**
 * Refuse a transition the state model does not draw, before anything is
 * written. `invitation_not_current` is deliberately the same code a stale
 * precondition gives: a caller asking for a transition this record cannot
 * make learns only that the record is not in the state the request needs.
 */
export function assertInvitationEdge(from: InvitationState, to: InvitationState): void {
  if (from === to) throw new InvitationError("invitation_not_current", "state");
  if (!INVITATION_EDGE_SET.has(`${from}>${to}`)) throw new InvitationError("invitation_not_current", "state");
}

/** `SS4.3` rule 5: a code is usable only against a dispatched, non-terminal record. */
export const CODE_DISPOSITION_EDGES: readonly (readonly [CodeDisposition, CodeDisposition])[] = [
  ["active", "consumed"],
  ["active", "invalidated"],
];

const CODE_EDGE_SET = new Set(CODE_DISPOSITION_EDGES.map(([from, to]) => `${from}>${to}`));

export function assertCodeDispositionEdge(from: CodeDisposition, to: CodeDisposition): void {
  if (!CODE_EDGE_SET.has(`${from}>${to}`)) throw new InvitationError("code_unusable");
}

/** `SS4.4` of the design: the ceremony's own small machine. A terminal ceremony is never current again. */
export const CEREMONY_EDGES: readonly (readonly [CeremonyState, CeremonyState])[] = [
  ["open", "declined"],
  ["open", "accepted_pending_confirmation"],
  ["open", "invalidated"],
  ["accepted_pending_confirmation", "consumed"],
  ["accepted_pending_confirmation", "invalidated"],
];

const CEREMONY_EDGE_SET = new Set(CEREMONY_EDGES.map(([from, to]) => `${from}>${to}`));

export function assertCeremonyEdge(from: CeremonyState, to: CeremonyState): void {
  if (!CEREMONY_EDGE_SET.has(`${from}>${to}`)) throw new InvitationError("ceremony_unusable");
}

export const CONFIRMATION_EDGES: readonly (readonly [ConfirmationState, ConfirmationState])[] = [
  ["requested", "confirmed"],
  ["requested", "rejected"],
  ["requested", "expired"],
];

const CONFIRMATION_EDGE_SET = new Set(CONFIRMATION_EDGES.map(([from, to]) => `${from}>${to}`));

export function assertConfirmationEdge(from: ConfirmationState, to: ConfirmationState): void {
  if (!CONFIRMATION_EDGE_SET.has(`${from}>${to}`)) throw new InvitationError("confirmation_not_current", "state");
}
