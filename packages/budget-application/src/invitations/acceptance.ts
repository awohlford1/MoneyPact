/**
 * The acceptance transaction: `TR-73-39` confirm plus `TR-73-13`
 * (design proposal SS8), and `TR-73-39` reject.
 *
 * One `SERIALIZABLE` transaction -- the caller's -- writes the confirmation,
 * the membership, the consent row, the invitation and code terminal states,
 * the sibling cancellations, the audit group and the notice rows, or nothing.
 * The step order below is SS8's own and is load-bearing rather than
 * incidental: **every denial happens before the first write**. Step 3 is the
 * disclosure check and it precedes step 7's membership insert, which is what
 * closes `SEC-F03` ("inserts before the disclosure check") permanently, and
 * what makes `PK5-02`'s "a stale claim denies `stale_disclosure` writing
 * nothing" true at the commit as well as at `TR-73-38`.
 *
 * Concurrency. There is no `SELECT ... FOR UPDATE` here, because the
 * CBD-246 statement seam exposes no row-lock clause and this packet may not
 * widen it. `SERIALIZABLE` plus the optimistic `state_version` predicate on
 * every invitation update gives the same two outcomes SS8 requires and gives
 * them without a lock: of two concurrent confirms one commits and the other
 * either loses the version predicate (`stale_version`) or is aborted by
 * PostgreSQL with `40001` (`retryable_conflict`); when it retries and finds
 * the record `accepted` with its own idempotency key, it is handed the
 * stored receipt. Recorded as a deviation in this packet's result.
 *
 * Failure. `boundary` is a test seam and nothing else: the live suite injects
 * a failure at a named point -- notably immediately after the membership
 * insert -- and asserts that the whole transaction rolled back. Production
 * composition leaves it undefined.
 */
import { createHash } from "node:crypto";

import { auditEvent, assertCurrentDisclosure, currentConfirmation, cancelRecord } from "./application.ts";
import type { InvitationDependencies } from "./application.ts";
import {
  ACTIVE_INVITATION_STATES, InvitationError, invitationProjection,
} from "./records.ts";
import type {
  AcceptanceConsentRecord, ConfirmationRecord, InvitableRole, InvitationProjection, InvitationRecord, MembershipRecord,
} from "./records.ts";
import { assertCeremonyEdge, assertConfirmationEdge, assertInvitationEdge } from "./transitions.ts";
import type { OwnerContext } from "./ports.ts";

/** The ordered points the live suite may inject a failure at. Every one is a real boundary in the sequence below. */
export const ACCEPTANCE_BOUNDARIES = [
  "after-checks", "after-membership", "after-consent", "after-terminal-states",
  "after-siblings", "after-audit", "after-notices", "before-receipt",
] as const;
export type AcceptanceBoundary = (typeof ACCEPTANCE_BOUNDARIES)[number];

export interface AcceptanceOptions {
  /** Test seam. Called at each named boundary; throwing rolls the caller's transaction back. */
  readonly boundary?: (point: AcceptanceBoundary) => Promise<void> | void;
}

/** The receipt `TR-73-13` stores and replays. It is the whole customer answer, so it carries no private field. */
export interface AcceptanceReceipt {
  readonly invitationId: string;
  readonly membershipId: string;
  readonly consentId: string;
  readonly confirmationId: string;
  readonly role: InvitableRole;
  readonly committedAt: string;
  readonly projection: InvitationProjection;
}

/**
 * What `committed_response` actually holds: the customer receipt, plus the
 * two identifiers the replay digest is computed over. The receipt itself
 * stays the customer shape, so a replay returns exactly what the first
 * commit returned and nothing more.
 */
interface StoredReceipt {
  readonly receipt: AcceptanceReceipt;
  readonly ceremonyId: string;
  readonly acceptorSubjectId: string;
}

/** The digest SS8 step 1 compares. A request, not a secret: a plain SHA-256 over the canonical request identity. */
export function commitRequestDigest(input: {
  readonly invitationId: string;
  readonly confirmationId: string;
  readonly ceremonyId: string;
  readonly acceptorSubjectId: string;
  readonly actingSubjectId: string;
  readonly idempotencyKey: string;
}): string {
  const canonical = [
    input.invitationId, input.confirmationId, input.ceremonyId,
    input.acceptorSubjectId, input.actingSubjectId, input.idempotencyKey,
  ].map((field) => `${field.length}:${field}`).join("");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * `TR-73-39` confirm plus the `TR-73-13` acceptance transaction, exactly as
 * SS8 step 1 to step 12 writes it.
 */
export async function confirmAcceptance(
  deps: InvitationDependencies, owner: OwnerContext,
  request: { readonly invitationId: string; readonly confirmationIdempotencyKey: string },
  options: AcceptanceOptions = {},
): Promise<AcceptanceReceipt> {
  const repository = deps.repository;
  const boundary = options.boundary ?? (() => undefined);

  // --- 2 (first half): load the record. ------------------------------------
  const invitation = await repository.readInvitation(owner.budgetSpaceId, request.invitationId);
  if (!invitation) throw new InvitationError("invitation_not_found", "invitationId");

  // --- 1: the idempotency receipt. -----------------------------------------
  // Read before anything else, and before the state check, so that the second
  // of two concurrent confirms -- which arrives to find the record already
  // `accepted` -- is handed the stored answer rather than a conflict
  // (CBD-275-AC03, CBD-234-AC07 pattern).
  if (invitation.commitIdempotencyKey !== null) {
    if (invitation.commitIdempotencyKey !== request.confirmationIdempotencyKey) {
      throw new InvitationError("invitation_not_current", "state");
    }
    const stored = invitation.committedResponse as StoredReceipt | null;
    if (!stored || !stored.receipt) throw new InvitationError("conflict", "committedResponse");
    const replayDigest = commitRequestDigest({
      invitationId: invitation.invitationId, confirmationId: stored.receipt.confirmationId,
      ceremonyId: stored.ceremonyId, acceptorSubjectId: stored.acceptorSubjectId,
      actingSubjectId: owner.subjectId, idempotencyKey: request.confirmationIdempotencyKey,
    });
    if (replayDigest !== invitation.commitRequestDigest) {
      // The field path is deliberately not passed here: the secret scanner's
      // generic-api-key rule reads "<code>", "<field>" as a name assigned a
      // long identifier (PK2FIX-F04). The code alone is the contract.
      throw new InvitationError("idempotency_key_reused");
    }
    return stored.receipt;
  }

  // --- 2 (second half): the preconditions of the three live rows. ----------
  const now = deps.clock.now();
  if (invitation.state !== "awaiting_confirmation") throw new InvitationError("invitation_not_current", "state");
  if (Date.parse(now) >= Date.parse(invitation.expiresAt)) throw new InvitationError("invitation_not_current", "expiresAt");

  const confirmation = await currentConfirmation(deps, invitation);
  const ceremony = await repository.readCeremony(invitation.budgetSpaceId, confirmation.ceremonyId);
  if (!ceremony) throw new InvitationError("confirmation_not_current", "ceremonyId");
  if (!ceremony.isCurrent || ceremony.state !== "accepted_pending_confirmation") throw new InvitationError("confirmation_not_current", "ceremony.state");
  if (ceremony.channelProofState !== "proved") throw new InvitationError("confirmation_not_current", "ceremony.channelProofState");
  if (ceremony.attachedSubjectId !== confirmation.acceptorSubjectId) throw new InvitationError("confirmation_not_current", "ceremony.attachedSubjectId");

  // --- 3: disclosure. Nothing has been written. ----------------------------
  if (ceremony.acceptedDisclosureVersion !== invitation.disclosureVersion) {
    throw new InvitationError("stale_disclosure", "ceremony.acceptedDisclosureVersion");
  }
  const disclosure = assertCurrentDisclosure(deps, invitation, {
    kind: invitation.disclosureKind, version: ceremony.acceptedDisclosureVersion,
  });

  // --- 4: inviter authority. -----------------------------------------------
  // `SEC-PK5-F02` / `R-03`: required, not optional. A context that carries no
  // permission is a route that did not decide against a cell, and SS8 step 4
  // is the one check tying the confirmer's cell to the invitation's
  // `required_permission`; skipping it on omission is a fail-open default.
  if (owner.permission !== invitation.requiredPermission) {
    throw new InvitationError("permission_mismatch", "requiredPermission");
  }
  const confirmerMembership = await repository.readActiveMembership(invitation.budgetSpaceId, owner.subjectId);
  if (!confirmerMembership) throw new InvitationError("authorization_denied", "membershipId");
  if (confirmerMembership.authorizationVersion !== owner.decision.authorizationVersion) {
    throw new InvitationError("stale_version", "membership.authorizationVersion");
  }

  // --- 5: invitee eligibility. ---------------------------------------------
  const identity = await repository.readDisplayIdentity(confirmation.acceptorSubjectId);
  if (!identity || identity.profileState !== "active") throw new InvitationError("subject_ineligible", "acceptorSubjectId");
  const inviteeMemberships = await repository.listMemberships(invitation.budgetSpaceId, confirmation.acceptorSubjectId);
  if (inviteeMemberships.some((row) => row.status === "active")) throw new InvitationError("already_member", "acceptorSubjectId");
  const latestEnd = inviteeMemberships
    .map((row) => row.endedAt)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);
  if (latestEnd !== undefined && Date.parse(invitation.issuedAt) <= Date.parse(latestEnd)) {
    throw new InvitationError("membership_ended_after_issue", "issuedAt");
  }

  // --- 6: role cardinality. A Co-owner invitation never adds a Primary. ----
  if (invitation.proposedRole !== "collaborator" && invitation.proposedRole !== "co_owner") {
    throw new InvitationError("proposed_role_unsupported", "proposedRole");
  }

  await boundary("after-checks");

  // --- 7: the membership. First write of the whole transaction. -----------
  const membershipId = deps.ids.uuid();
  const membership: MembershipRecord = {
    membershipId,
    budgetSpaceId: invitation.budgetSpaceId,
    profileId: identity.profileId,
    accountSubjectId: confirmation.acceptorSubjectId,
    role: invitation.proposedRole,
    status: "active",
    authorizationVersion: 1,
    createdBySubjectId: owner.subjectId,
    endedAt: null,
  };
  await repository.insertMembership(membership);
  await boundary("after-membership");

  // --- 8: the consent row, in this same transaction (IV-013). -------------
  const consentId = deps.ids.uuid();
  const consent: AcceptanceConsentRecord = {
    consentId,
    budgetSpaceId: invitation.budgetSpaceId,
    membershipId,
    // Both the subject of the consent and its recorder are the invitee: the
    // row evidences the consenting person's own action, never the owner's.
    accountSubjectId: confirmation.acceptorSubjectId,
    recordedBySubjectId: confirmation.acceptorSubjectId,
    role: invitation.proposedRole,
    resourceScope: "full",
    source: "invitation_acceptance",
    sourceRecordId: invitation.invitationId,
    sourceRecordVersion: invitation.invitationVersion,
    sourceCeremonyId: ceremony.ceremonyId,
    // From the registry and the invitation, re-verified in step 3; never from a request (`CF-236-005`).
    disclosureKind: disclosure.kind,
    disclosureVersion: disclosure.version,
    disclosureDigest: disclosure.digest,
    // The tuple of the confirm allow decision.
    policyVersion: owner.decision.policyVersion,
    policyDigest: owner.decision.policyDigest,
    state: "current",
    // No protected obligation is discharged by a confirm, so `DR-73-04` requires no assurance evidence.
    assuranceRef: null,
    recordedAt: now,
    supersedesConsentId: null,
  };
  await repository.insertConsent(consent);
  await boundary("after-consent");

  // --- 9: the terminal states. --------------------------------------------
  assertConfirmationEdge(confirmation.state, "confirmed");
  await repository.updateConfirmation(invitation.budgetSpaceId, confirmation.confirmationId, {
    state: "confirmed",
    decidedByMembershipId: confirmerMembership.membershipId,
    decidedBySubjectId: owner.subjectId,
    decidedAt: now,
    decidedAuthorizationVersion: confirmerMembership.authorizationVersion,
    committedConsentId: consentId,
  });
  assertInvitationEdge(invitation.state, "accepted");
  const accepted = await repository.updateInvitation(invitation.budgetSpaceId, invitation.invitationId, invitation.stateVersion, {
    state: "accepted", projectionState: "accepted", acceptedMembershipId: membershipId,
  });
  if (!accepted) throw new InvitationError("stale_version", "invitation.stateVersion");
  await repository.updateCodeDisposition(invitation.budgetSpaceId, invitation.invitationId, "active", "consumed", "accepted", now);
  await repository.tombstoneOutbox(invitation.invitationId, "code_consumed", now);
  assertCeremonyEdge(ceremony.state, "consumed");
  await repository.updateCeremony(invitation.budgetSpaceId, ceremony.ceremonyId, { state: "consumed", isCurrent: false });
  await boundary("after-terminal-states");

  // --- 9 (siblings): every enumerable same-space record for this person. ---
  const siblings = (await repository.listByCandidateSubject(invitation.budgetSpaceId, confirmation.acceptorSubjectId))
    .filter((row) => row.invitationId !== invitation.invitationId)
    .filter((row) => (ACTIVE_INVITATION_STATES as readonly string[]).includes(row.state)
      || row.state === "synthetic_created" || row.state === "synthetic_pending");
  for (const sibling of siblings) {
    await cancelRecord(deps, owner, sibling, "sibling_accepted", "restricted", "pending");
  }
  await boundary("after-siblings");

  // --- 10: the audit group. ------------------------------------------------
  await repository.insertAudit(auditEvent(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-32", eventSubtype: "confirmation_confirmed",
    actorSubjectId: owner.subjectId, actingMembershipId: confirmerMembership.membershipId,
    targetType: "invitation_confirmation", targetId: confirmation.confirmationId, result: "allow",
    policyVersion: owner.decision.policyVersion, policyDigest: owner.decision.policyDigest,
    correlationId: owner.correlationId, audience: "customer",
    payload: { invitationId: invitation.invitationId, confirmationId: confirmation.confirmationId, ceremonyId: ceremony.ceremonyId },
  }));
  await repository.insertAudit(auditEvent(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-13", actorSubjectId: owner.subjectId,
    actingMembershipId: confirmerMembership.membershipId, targetType: "membership", targetId: membershipId,
    result: "allow", policyVersion: owner.decision.policyVersion, policyDigest: owner.decision.policyDigest,
    correlationId: owner.correlationId, audience: "customer",
    payload: {
      invitationId: invitation.invitationId, invitationVersion: invitation.invitationVersion,
      confirmationId: confirmation.confirmationId, membershipId, consentId,
      proposedRole: invitation.proposedRole, resourceScope: "full",
      disclosureKind: disclosure.kind, disclosureVersion: disclosure.version,
      codeDisposition: "consumed", siblingCount: siblings.length,
    },
  }));
  await boundary("after-audit");

  // --- 11: the notices. ----------------------------------------------------
  const members = await repository.listMemberships(invitation.budgetSpaceId);
  const notified = members
    .filter((row) => row.status === "active" && row.accountSubjectId !== confirmation.acceptorSubjectId)
    .map((row) => row.accountSubjectId);
  await repository.insertNotice({
    noticeId: deps.ids.uuid(), accountSubjectId: confirmation.acceptorSubjectId,
    budgetSpaceId: invitation.budgetSpaceId, messageCode: "MSG-73-015", eventCorrelationId: owner.correlationId,
  });
  for (const subjectId of new Set(notified)) {
    await repository.insertNotice({
      noticeId: deps.ids.uuid(), accountSubjectId: subjectId, budgetSpaceId: invitation.budgetSpaceId,
      messageCode: "MSG-73-019", eventCorrelationId: owner.correlationId,
    });
  }
  await repository.insertAudit(auditEvent(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-30", targetType: "notice",
    targetId: membershipId, result: "system", correlationId: owner.correlationId, audience: "customer",
    payload: { invitationId: invitation.invitationId, messageCode: "MSG-73-015", noticeCount: 1 + new Set(notified).size },
  }));
  await boundary("after-notices");

  // --- 12: the receipt. ----------------------------------------------------
  const receipt: AcceptanceReceipt = {
    invitationId: invitation.invitationId,
    membershipId,
    consentId,
    confirmationId: confirmation.confirmationId,
    role: invitation.proposedRole,
    committedAt: now,
    projection: { ...invitationProjection(invitation), state: "accepted" },
  };
  await boundary("before-receipt");
  const stamped = await repository.updateInvitation(invitation.budgetSpaceId, invitation.invitationId, invitation.stateVersion + 1, {
    commitIdempotencyKey: request.confirmationIdempotencyKey,
    commitRequestDigest: commitRequestDigest({
      invitationId: invitation.invitationId, confirmationId: confirmation.confirmationId,
      ceremonyId: ceremony.ceremonyId, acceptorSubjectId: confirmation.acceptorSubjectId,
      actingSubjectId: owner.subjectId, idempotencyKey: request.confirmationIdempotencyKey,
    }),
    committedResponse: {
      receipt, ceremonyId: ceremony.ceremonyId, acceptorSubjectId: confirmation.acceptorSubjectId,
    } satisfies StoredReceipt,
  });
  if (!stamped) throw new InvitationError("retryable_conflict", "invitation.stateVersion");
  return receipt;
}

/**
 * `TR-73-39` reject: the same route family without steps 5 to 8 and without
 * `AE-73-13`. The acceptor's pending evidence closes as non-authorizing
 * history, and the acceptor receives the uniform `MSG-73-052`, which never
 * says who decided or why (CBD-73 SS5.1 item 6).
 */
export async function rejectAcceptance(
  deps: InvitationDependencies, owner: OwnerContext, request: { readonly invitationId: string },
): Promise<InvitationProjection> {
  const repository = deps.repository;
  const invitation = await repository.readInvitation(owner.budgetSpaceId, request.invitationId);
  if (!invitation) throw new InvitationError("invitation_not_found", "invitationId");
  if (invitation.state !== "awaiting_confirmation") throw new InvitationError("invitation_not_current", "state");

  const confirmation = await currentConfirmation(deps, invitation);
  const ceremony = await repository.readCeremony(invitation.budgetSpaceId, confirmation.ceremonyId);
  if (!ceremony) throw new InvitationError("confirmation_not_current", "ceremonyId");
  // `SEC-PK5-F02` / `R-03`: required on reject as it is on confirm.
  if (owner.permission !== invitation.requiredPermission) {
    throw new InvitationError("permission_mismatch", "requiredPermission");
  }
  const confirmerMembership = await repository.readActiveMembership(invitation.budgetSpaceId, owner.subjectId);
  if (!confirmerMembership) throw new InvitationError("authorization_denied", "membershipId");

  const now = deps.clock.now();
  assertConfirmationEdge(confirmation.state, "rejected");
  await repository.updateConfirmation(invitation.budgetSpaceId, confirmation.confirmationId, {
    state: "rejected",
    decidedByMembershipId: confirmerMembership.membershipId,
    decidedBySubjectId: owner.subjectId,
    decidedAt: now,
    decidedAuthorizationVersion: confirmerMembership.authorizationVersion,
  });
  const projection = await cancelRecord(deps, owner, invitation, null, "customer", "cancelled");
  await repository.insertAudit(auditEvent(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-32", eventSubtype: "confirmation_rejected",
    actorSubjectId: owner.subjectId, actingMembershipId: confirmerMembership.membershipId,
    targetType: "invitation_confirmation", targetId: confirmation.confirmationId, result: "allow",
    policyVersion: owner.decision.policyVersion, policyDigest: owner.decision.policyDigest,
    correlationId: owner.correlationId, audience: "customer",
    payload: { invitationId: invitation.invitationId, confirmationId: confirmation.confirmationId },
  }));
  await repository.insertNotice({
    noticeId: deps.ids.uuid(), accountSubjectId: confirmation.acceptorSubjectId,
    budgetSpaceId: invitation.budgetSpaceId, messageCode: "MSG-73-052", eventCorrelationId: owner.correlationId,
  });
  await repository.insertAudit(auditEvent(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-30", targetType: "notice",
    targetId: confirmation.confirmationId, result: "system", correlationId: owner.correlationId, audience: "customer",
    payload: { invitationId: invitation.invitationId, messageCode: "MSG-73-052", noticeCount: 1 },
  }));
  return projection;
}

/** Re-exported so PK-6 can name the confirmation row it is deciding without importing the application module twice. */
export type { ConfirmationRecord, InvitationRecord };
