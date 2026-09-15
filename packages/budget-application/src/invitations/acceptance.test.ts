/**
 * The acceptance transaction against the in-memory adapter: the SS8 write
 * set, the denial ordering, the receipt, the sibling cancellations and the
 * reject path.
 *
 * The in-memory adapter has no isolation, so the atomicity claim of `PK5-01`
 * is not provable here and is not claimed here -- the live suite injects the
 * failure after the membership insert against a real transaction. What this
 * file proves is the half that is the application's: that every denial in
 * SS8 happens before the first write, and that the write set is exactly the
 * one SS8 names.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { acceptInvitation, attachAccount, createInvitation, parseCreateInvitationRequest, resolveCode, verifyChannel } from "./application.ts";
import { ACCEPTANCE_BOUNDARIES, confirmAcceptance, rejectAcceptance } from "./acceptance.ts";
import { isInvitationError } from "./records.ts";
import type { InvitationErrorCode } from "./records.ts";
import { ENVIRONMENT, INVITEE_SUBJECT, OWNER_MEMBERSHIP, OWNER_SUBJECT, SPACE, ownerWithoutPermission, testWorld } from "./support.ts";
import type { TestWorld } from "./support.ts";

function request(destination = "invitee@example.com", role: "collaborator" | "co_owner" = "collaborator") {
  return parseCreateInvitationRequest({
    channel: "email", destination, proposedRole: role, idempotencyKey: `key-${destination}-${role}`,
  });
}

/** A world with one invitation carried all the way to `awaiting_confirmation`. */
async function awaitingConfirmation(world: TestWorld, destination = "invitee@example.com", role: "collaborator" | "co_owner" = "collaborator") {
  const created = await createInvitation(world.deps, world.owner, request(destination, role));
  const invitationId = created.projection.invitationId;
  const delivery = world.delivery(invitationId);
  const resolved = await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: world.owner.correlationId });
  if (resolved.outcome !== "resolved") throw new Error("unreachable");
  const ceremonyRequest = { ceremonyId: resolved.ceremonyId, ceremonySecret: resolved.ceremonySecret, correlationId: world.owner.correlationId };
  await verifyChannel(world.deps, { ...ceremonyRequest, channelCode: delivery.challenge });
  await attachAccount(world.deps, world.invitee, ceremonyRequest);
  await acceptInvitation(world.deps, world.invitee, {
    ...ceremonyRequest,
    acknowledgedDisclosure: { kind: role === "collaborator" ? "invitation_collaborator" : "invitation_co_owner", version: 1 },
  });
  return { invitationId, ceremonyId: resolved.ceremonyId };
}

void test("SS8 writes exactly the set it names: confirmation, membership, consent, terminal states, audit group and notices", async () => {
  const world = testWorld();
  const { invitationId, ceremonyId } = await awaitingConfirmation(world);
  const receipt = await confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "k1" });

  const record = world.repository.invitations.get(invitationId);
  assert.equal(record?.state, "accepted");
  assert.equal(record?.projectionState, "accepted");
  assert.equal(record?.acceptedMembershipId, receipt.membershipId);
  assert.equal(world.repository.codes.get(invitationId)?.disposition, "consumed");
  assert.equal(world.repository.outbox.get(invitationId)?.deliveryState, "tombstoned");
  assert.equal(world.repository.ceremonies.get(ceremonyId)?.state, "consumed");
  assert.equal(world.repository.ceremonies.get(ceremonyId)?.isCurrent, false);

  const confirmation = [...world.repository.confirmations.values()][0];
  assert.equal(confirmation?.state, "confirmed");
  assert.equal(confirmation?.decidedBySubjectId, OWNER_SUBJECT);
  assert.equal(confirmation?.decidedByMembershipId, OWNER_MEMBERSHIP);
  assert.equal(confirmation?.decidedAuthorizationVersion, 1);
  assert.equal(confirmation?.committedConsentId, receipt.consentId);

  const membership = (await world.repository.listMemberships(SPACE, INVITEE_SUBJECT))[0];
  assert.equal(membership?.role, "collaborator");
  assert.equal(membership?.status, "active");
  assert.equal(membership?.authorizationVersion, 1);
  assert.equal(membership?.createdBySubjectId, OWNER_SUBJECT);

  // IV-013: the consent row evidences the invitee's own action, on both columns.
  const consent = world.repository.consents[0];
  assert.equal(consent?.membershipId, receipt.membershipId);
  assert.equal(consent?.accountSubjectId, INVITEE_SUBJECT);
  assert.equal(consent?.recordedBySubjectId, INVITEE_SUBJECT);
  assert.equal(consent?.source, "invitation_acceptance");
  assert.equal(consent?.sourceRecordId, invitationId);
  assert.equal(consent?.sourceCeremonyId, ceremonyId);
  assert.equal(consent?.state, "current");
  assert.equal(consent?.assuranceRef, null);
  assert.equal(consent?.disclosureKind, "invitation_collaborator");
  assert.equal(consent?.disclosureVersion, 1);
  assert.equal(consent?.disclosureDigest, "a".repeat(64), "from the registry, never from the request");
  assert.equal(consent?.policyVersion, "p5", "the tuple of the confirm allow decision");

  const codes = world.repository.audits.map((row) => `${row.eventCode}${row.eventSubtype ? `:${row.eventSubtype}` : ""}`);
  assert.deepEqual(codes.slice(-3), ["AE-73-32:confirmation_confirmed", "AE-73-13", "AE-73-30"]);
  assert.ok(world.repository.notices.some((row) => row.messageCode === "MSG-73-015" && row.accountSubjectId === INVITEE_SUBJECT));
  assert.ok(world.repository.notices.some((row) => row.messageCode === "MSG-73-019" && row.accountSubjectId === OWNER_SUBJECT));
});

void test("PK5-01/PK5-02: every denial before step 7 writes nothing", async () => {
  // Each case names a precondition SS8 checks before the membership insert.
  const cases: readonly (readonly [string, (world: TestWorld, invitationId: string) => Promise<void>, InvitationErrorCode])[] = [
    ["step 2, state", async (world, invitationId) => {
      await confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "first" });
    }, "invitation_not_current"],
    ["step 3, disclosure", async (world, invitationId) => {
      const moved = {
        ...world.deps,
        disclosures: { current: () => ({ kind: "invitation_collaborator", version: 2, digest: "d".repeat(64), text: { heading: "", items: [], acknowledgement: "" } }) },
      };
      await confirmAcceptance(moved, world.owner, { invitationId, confirmationIdempotencyKey: "k" });
    }, "stale_disclosure"],
    ["step 4, permission", async (world, invitationId) => {
      await confirmAcceptance(world.deps, { ...world.owner, permission: "26" }, { invitationId, confirmationIdempotencyKey: "k" });
    }, "permission_mismatch"],
    // SEC-PK5-F02 / R-03: an omitted permission is a route that did not decide
    // against a cell. It denies rather than skipping step 4.
    ["step 4, permission omitted", async (world, invitationId) => {
      await confirmAcceptance(world.deps, ownerWithoutPermission(world.owner), { invitationId, confirmationIdempotencyKey: "k" });
    }, "permission_mismatch"],
    ["step 4, authorization version", async (world, invitationId) => {
      await confirmAcceptance(world.deps, { ...world.owner, decision: { ...world.owner.decision, authorizationVersion: 9 } }, { invitationId, confirmationIdempotencyKey: "k" });
    }, "stale_version"],
    ["step 4, no membership", async (world, invitationId) => {
      await confirmAcceptance(world.deps, { ...world.owner, subjectId: "88888888-8888-4888-8888-888888888888" }, { invitationId, confirmationIdempotencyKey: "k" });
    }, "authorization_denied"],
    ["step 5, already a member", async (world, invitationId) => {
      await confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "k" });
    }, "already_member"],
    ["step 5, membership ended after the invitation was issued", async (world, invitationId) => {
      await confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "k" });
    }, "membership_ended_after_issue"],
  ];

  for (const [name, attempt, code] of cases) {
    const world = testWorld();
    const { invitationId } = await awaitingConfirmation(world);
    if (name === "step 2, state") {
      // Drive the record to accepted first, then re-attempt with a different key.
      await attempt(world, invitationId);
      const membershipsBefore = world.repository.memberships.length;
      const consentsBefore = world.repository.consents.length;
      await assert.rejects(
        confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "second" }),
        (error: unknown) => isInvitationError(error, code), name,
      );
      assert.equal(world.repository.memberships.length, membershipsBefore, name);
      assert.equal(world.repository.consents.length, consentsBefore, name);
      continue;
    }
    if (name.startsWith("step 5, already")) {
      world.repository.seedMembership({
        membershipId: "99999999-9999-4999-8999-111111111111", budgetSpaceId: SPACE, profileId: "55555555-5555-4555-8555-555555555555",
        accountSubjectId: INVITEE_SUBJECT, role: "collaborator", status: "active", authorizationVersion: 1,
        createdBySubjectId: OWNER_SUBJECT, endedAt: null,
      });
    }
    if (name.startsWith("step 5, membership ended")) {
      world.repository.seedMembership({
        membershipId: "99999999-9999-4999-8999-222222222222", budgetSpaceId: SPACE, profileId: "55555555-5555-4555-8555-555555555555",
        accountSubjectId: INVITEE_SUBJECT, role: "collaborator", status: "removed", authorizationVersion: 2,
        createdBySubjectId: OWNER_SUBJECT, endedAt: "2026-09-30T00:00:00.000Z",
      });
    }
    const membershipsBefore = world.repository.memberships.length;
    const consentsBefore = world.repository.consents.length;
    const auditsBefore = world.repository.audits.length;
    const noticesBefore = world.repository.notices.length;
    await assert.rejects(() => attempt(world, invitationId), (error: unknown) => isInvitationError(error, code), name);
    assert.equal(world.repository.memberships.length, membershipsBefore, `${name}: no membership`);
    assert.equal(world.repository.consents.length, consentsBefore, `${name}: no consent`);
    assert.equal(world.repository.audits.length, auditsBefore, `${name}: no audit`);
    assert.equal(world.repository.notices.length, noticesBefore, `${name}: no notice`);
    assert.equal(world.repository.invitations.get(invitationId)?.state, "awaiting_confirmation", `${name}: the record did not move`);
  }
});

void test("PK5-03 replay: the same key returns the stored receipt; a different key on an accepted record is refused", async () => {
  const world = testWorld();
  const { invitationId } = await awaitingConfirmation(world);
  const first = await confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "k1" });
  const replay = await confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "k1" });
  assert.deepEqual(replay, first);
  assert.equal(world.repository.memberships.filter((row) => row.accountSubjectId === INVITEE_SUBJECT).length, 1, "one membership");
  assert.equal(world.repository.consents.length, 1, "one consent row");
  await assert.rejects(
    confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "k2" }),
    (error: unknown) => isInvitationError(error, "invitation_not_current"),
  );
});

void test("a replay by a different acting subject does not return another person's receipt", async () => {
  const world = testWorld();
  const { invitationId } = await awaitingConfirmation(world);
  await confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "k1" });
  await assert.rejects(
    confirmAcceptance(world.deps, { ...world.owner, subjectId: "88888888-8888-4888-8888-888888888888" }, { invitationId, confirmationIdempotencyKey: "k1" }),
    (error: unknown) => isInvitationError(error, "idempotency_key_reused"),
  );
});

void test("every sibling record bound to the accepting person is cancelled with the private cause", async () => {
  const world = testWorld();
  const first = await awaitingConfirmation(world, "invitee@example.com");
  // A second record for the same person, bound by the attach that never
  // finished: candidate_subject_id is what makes it enumerable.
  const second = await createInvitation(world.deps, world.owner, request("other@example.com"));
  const secondId = second.projection.invitationId;
  await world.repository.updateInvitation(SPACE, secondId, world.repository.invitations.get(secondId)!.stateVersion, {
    candidateSubjectId: INVITEE_SUBJECT,
  });

  await confirmAcceptance(world.deps, world.owner, { invitationId: first.invitationId, confirmationIdempotencyKey: "k1" });
  const sibling = world.repository.invitations.get(secondId);
  assert.equal(sibling?.state, "cancelled");
  assert.equal(sibling?.privateTerminalCause, "sibling_accepted");
  assert.equal(sibling?.projectionState, "pending", "a system cancel leaves the projection until TR-73-07");
  const siblingAudit = world.repository.audits.find((row) => row.eventCode === "AE-73-06" && row.targetId === secondId);
  assert.equal(siblingAudit?.audience, "restricted");
  assert.equal(siblingAudit?.result, "system");
  const receipt = world.repository.audits.find((row) => row.eventCode === "AE-73-13");
  assert.equal(receipt?.payload.siblingCount, 1);
});

void test("reject cancels the invitation, writes no membership or consent, and tells the acceptor nothing", async () => {
  const world = testWorld();
  const { invitationId, ceremonyId } = await awaitingConfirmation(world);
  // R-03: reject requires the permission too, and denies before any write.
  await assert.rejects(
    rejectAcceptance(world.deps, ownerWithoutPermission(world.owner), { invitationId }),
    (error: unknown) => isInvitationError(error, "permission_mismatch"),
  );
  assert.equal([...world.repository.confirmations.values()][0]?.state, "requested", "the denial wrote nothing");
  const projection = await rejectAcceptance(world.deps, world.owner, { invitationId });
  assert.equal(projection.state, "cancelled");
  assert.equal(world.repository.memberships.filter((row) => row.accountSubjectId === INVITEE_SUBJECT).length, 0);
  assert.equal(world.repository.consents.length, 0);
  assert.equal([...world.repository.confirmations.values()][0]?.state, "rejected");
  assert.equal(world.repository.ceremonies.get(ceremonyId)?.isCurrent, false);
  assert.ok(!world.repository.audits.some((row) => row.eventCode === "AE-73-13"), "no transition receipt");
  const notice = world.repository.notices.find((row) => row.accountSubjectId === INVITEE_SUBJECT);
  assert.equal(notice?.messageCode, "MSG-73-052");
  assert.deepEqual(Object.keys(notice ?? {}).sort(), ["accountSubjectId", "budgetSpaceId", "eventCorrelationId", "messageCode", "noticeId"]);
});

void test("a co-owner invitation commits a co_owner membership against its own disclosure kind", async () => {
  const world = testWorld();
  const { invitationId } = await awaitingConfirmation(world, "coowner@example.com", "co_owner");
  // The co_owner cell, which is what a co_owner invitation's required_permission is.
  const receipt = await confirmAcceptance(world.deps, { ...world.owner, permission: "26" }, { invitationId, confirmationIdempotencyKey: "k1" });
  assert.equal(receipt.role, "co_owner");
  assert.equal(world.repository.consents[0]?.role, "co_owner");
  assert.equal(world.repository.consents[0]?.disclosureKind, "invitation_co_owner");
  assert.equal(world.repository.consents[0]?.disclosureDigest, "b".repeat(64));
});

void test("the injected-failure boundaries name every real step of the sequence", () => {
  assert.deepEqual([...ACCEPTANCE_BOUNDARIES], [
    "after-checks", "after-membership", "after-consent", "after-terminal-states",
    "after-siblings", "after-audit", "after-notices", "before-receipt",
  ]);
});
