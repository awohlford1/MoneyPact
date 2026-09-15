/**
 * The invitation state service against the in-memory adapter: the whole
 * ceremony, the uniform outcomes, the disclosure binding, resend/replace, and
 * the custody rule that no raw value reaches a record.
 *
 * `PK5-02` (disclosure binding), `PK5-03` (single use and replay), `PK5-04`
 * (custody) and `PK5-05` (transitions) all have their unit half here; the
 * live suite then proves the same claims against the real schema.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptInvitation, attachAccount, cancelInvitation, createInvitation, declineInvitation,
  expireOnObservation, parseCreateInvitationRequest, readConfirmationPrompt, readDisclosure,
  replaceInvitation, resolveCode, verifyChannel, UNIFORM_UNUSABLE,
} from "./application.ts";
import { confirmAcceptance } from "./acceptance.ts";
import { MAX_CHANNEL_ATTEMPTS, NEUTRAL_DISPLAY_LABEL, UNIFORM_LINK_MESSAGE_CODE, isInvitationError } from "./records.ts";
import { canonicalizeEmailDestination, generateBearer, generateCodeSelector, maskEmailDestination, splitPresentedCode } from "./secrets.ts";
import { ENVIRONMENT, INVITEE_SUBJECT, OWNER_SUBJECT, SPACE, ownerWithoutPermission, testWorld } from "./support.ts";
import type { TestWorld } from "./support.ts";

const DESTINATION = "Invitee@Example.COM";

function request(overrides: Record<string, unknown> = {}) {
  return parseCreateInvitationRequest({
    channel: "email", destination: DESTINATION, proposedRole: "collaborator",
    idempotencyKey: "11111111-1111-4111-8111-aaaaaaaaaaaa", ...overrides,
  });
}

async function dispatched(world: TestWorld) {
  const created = await createInvitation(world.deps, world.owner, request());
  const invitationId = created.projection.invitationId;
  return { invitationId, delivery: world.delivery(invitationId) };
}

/** Run the ceremony to the point named, returning what each step produced. */
async function ceremony(world: TestWorld, upTo: "resolve" | "verify" | "attach" | "accept") {
  const { invitationId, delivery } = await dispatched(world);
  const resolved = await resolveCode(world.deps, {
    presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: world.owner.correlationId,
  });
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome !== "resolved") throw new Error("unreachable");
  const ceremonyRequest = {
    ceremonyId: resolved.ceremonyId, ceremonySecret: resolved.ceremonySecret,
    environment: ENVIRONMENT, correlationId: world.owner.correlationId,
  };
  if (upTo === "resolve") return { invitationId, delivery, resolved, ceremonyRequest };
  await verifyChannel(world.deps, { ...ceremonyRequest, channelCode: delivery.challenge });
  if (upTo === "verify") return { invitationId, delivery, resolved, ceremonyRequest };
  await attachAccount(world.deps, world.invitee, ceremonyRequest);
  if (upTo === "attach") return { invitationId, delivery, resolved, ceremonyRequest };
  await acceptInvitation(world.deps, world.invitee, {
    ...ceremonyRequest, acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 },
  });
  return { invitationId, delivery, resolved, ceremonyRequest };
}

// ---------------------------------------------------------------------------
// Parsing and the destination.
// ---------------------------------------------------------------------------

void test("the destination is canonicalized and masked, and never folded", () => {
  assert.equal(canonicalizeEmailDestination("  Invitee@Example.COM "), "invitee@example.com");
  assert.equal(maskEmailDestination("invitee@example.com"), "i***@example.com");
  // OI-73-010's alias rule is not in this increment: plus-addressing and dots
  // are two different people until it is.
  assert.notEqual(
    canonicalizeEmailDestination("a.b+tag@example.com"),
    canonicalizeEmailDestination("ab@example.com"),
  );
  for (const bad of ["", "no-at-sign", "a@b", "a@@b.com", "a b@example.com", "a@example."]) {
    assert.throws(() => canonicalizeEmailDestination(bad), (error: unknown) => isInvitationError(error, "destination_invalid"), bad);
  }
});

void test("an unsupported role is refused by its own code, before anything else in the body is read", () => {
  assert.throws(
    () => parseCreateInvitationRequest({ channel: "email", destination: DESTINATION, proposedRole: "viewer", idempotencyKey: "k" }),
    (error: unknown) => isInvitationError(error, "proposed_role_unsupported"),
  );
});

// ---------------------------------------------------------------------------
// TR-73-01 / TR-73-02.
// ---------------------------------------------------------------------------

void test("create dispatches in the same call: pending, one code, one outbox row, two audit rows", async () => {
  const world = testWorld();
  const created = await createInvitation(world.deps, world.owner, request());
  const record = world.repository.invitations.get(created.projection.invitationId);
  assert.ok(record);
  assert.equal(record.state, "pending");
  assert.equal(record.projectionState, "pending");
  assert.equal(record.stateVersion, 2);
  assert.equal(record.requiredPermission, "24");
  assert.equal(record.disclosureKind, "invitation_collaborator");
  assert.equal(record.disclosureVersion, 1);
  assert.equal(record.policyVersion, "p5");
  assert.equal(record.projectionInactiveAt, record.expiresAt);
  assert.ok(world.repository.codes.get(record.invitationId));
  assert.ok(world.repository.outbox.get(record.invitationId));
  assert.deepEqual(world.repository.audits.map((row) => row.eventCode), ["AE-73-01", "AE-73-02"]);
});

void test("PK5-04 custody: no record carries the raw address, the bearer or the challenge", async () => {
  const world = testWorld();
  const { invitationId, delivery } = await dispatched(world);
  const record = world.repository.invitations.get(invitationId);
  assert.ok(record);
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes("invitee@example.com"), "the invitation record holds no address");
  assert.ok(!serialized.includes(delivery.bearer), "the invitation record holds no bearer");
  assert.ok(!serialized.includes(delivery.challenge), "the invitation record holds no challenge");
  assert.equal(record.destinationMasked, "i***@example.com");

  const code = world.repository.codes.get(invitationId);
  assert.ok(code);
  assert.ok(!JSON.stringify(code).includes(delivery.bearer), "the code row holds the verifier, never the bearer");
  assert.match(code.verifierDigest, /^[0-9a-f]{64}$/u);
  // PK5-F02: the bearer is `<selector>.<secret>`; the row carries the
  // selector, which encodes and proves nothing, and never the secret half.
  const parts = splitPresentedCode(delivery.bearer);
  assert.ok(parts, "the delivered bearer is selector-shaped");
  assert.equal(code.codeSelector, parts.selector);
  assert.ok(!JSON.stringify(code).includes(parts.secret), "the code row never holds the secret half");

  // The ceremony's two secret-derived columns are keyed digests, not the values.
  const { ceremonyRequest } = await ceremony(testWorld(), "resolve");
  assert.match(ceremonyRequest.ceremonySecret, /^[0-9a-f]{64}$/u);

  // The outbox projection the state service reads carries no payload at all.
  const projection = await world.repository.readOutbox(invitationId);
  assert.ok(projection);
  assert.ok(!Object.prototype.hasOwnProperty.call(projection, "bearer"));
  assert.equal(projection.fidelityLabel, "simulated");
});

void test("the display identity read returns the name only, and the neutral label until one exists", async () => {
  const world = testWorld();
  const identity = await world.repository.readDisplayIdentity(INVITEE_SUBJECT);
  assert.ok(identity);
  assert.deepEqual(Object.keys(identity).sort(), ["accountSubjectId", "displayName", "profileId", "profileState", "version"]);
  assert.equal(identity.displayName, null);

  // SEC-PK2-F08: the write advances the profile version, so a confirmation
  // receipt names the display identity it was actually given against.
  const version = await world.repository.writeDisplayName(INVITEE_SUBJECT, "Sam", identity.version);
  assert.equal(version, 1 + identity.version);
  assert.equal((await world.repository.readDisplayIdentity(INVITEE_SUBJECT))?.displayName, "Sam");
  assert.equal(await world.repository.writeDisplayName(INVITEE_SUBJECT, "Other", identity.version), null, "a stale version writes nothing");
});

void test("a self-invitation and an already-member destination become suppressed synthetic records, indistinguishable to the inviter", async () => {
  const world = testWorld();
  const suppressed = await createInvitation(world.deps, world.owner, request(), { inviteeSubjectIdForDestination: OWNER_SUBJECT });
  assert.equal(suppressed.suppressed, true);
  assert.equal(suppressed.projection.state, "pending", "the projection is identical to a real record's");
  const record = world.repository.invitations.get(suppressed.projection.invitationId);
  assert.equal(record?.kind, "synthetic");
  assert.equal(record?.state, "synthetic_pending");
  assert.equal(world.repository.codes.size, 0, "no code");
  assert.equal(world.repository.outbox.size, 0, "no outbox row");
  const suppression = world.repository.audits.find((row) => row.eventCode === "AE-73-27");
  assert.equal(suppression?.audience, "restricted", "the cause is security scope only");
  assert.equal(suppression?.reasonClass, "self_invitation");
});

// ---------------------------------------------------------------------------
// TR-73-08 / TR-73-14: resolve and the uniform outcome.
// ---------------------------------------------------------------------------

void test("resolve opens one ceremony and invalidates the previous one, so a leaked link cannot ride an in-progress ceremony", async () => {
  const world = testWorld();
  const { invitationId, delivery } = await dispatched(world);
  const first = await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c1" });
  const second = await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c2" });
  assert.equal(first.outcome, "resolved");
  assert.equal(second.outcome, "resolved");
  if (first.outcome !== "resolved" || second.outcome !== "resolved") throw new Error("unreachable");
  assert.notEqual(first.ceremonyId, second.ceremonyId);
  const ceremonies = await world.repository.listCeremonies(SPACE, invitationId);
  assert.equal(ceremonies.filter((row) => row.isCurrent).length, 1);
  assert.equal(ceremonies.find((row) => row.ceremonyId === first.ceremonyId)?.state, "invalidated");
});

void test("PK5-03 uniform outcome: unknown, malformed, consumed, cancelled, superseded, declined and expired codes answer identically", async () => {
  const answers: string[] = [];

  // Unknown and malformed, in both the pre-selector shape and the selector
  // shape; then PK5-F02's two new classes -- a known selector with a wrong
  // secret, and an unknown selector with the real secret.
  for (const presented of ["", "not-a-real-bearer", `${generateCodeSelector()}.not-a-real-secret`, "short.not-a-real-secret"]) {
    const world = testWorld();
    await dispatched(world);
    answers.push(JSON.stringify(await resolveCode(world.deps, { presentedCode: presented, environment: ENVIRONMENT, correlationId: "c" })));
  }
  {
    const world = testWorld();
    const { delivery } = await dispatched(world);
    const parts = splitPresentedCode(delivery.bearer);
    assert.ok(parts);
    for (const presented of [`${parts.selector}.${generateBearer()}`, `${generateCodeSelector()}.${parts.secret}`]) {
      answers.push(JSON.stringify(await resolveCode(world.deps, { presentedCode: presented, environment: ENVIRONMENT, correlationId: "c" })));
    }
    // The real bearer still resolves afterwards: a wrong guess against the
    // selector does not touch the code.
    const real = await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c" });
    assert.equal(real.outcome, "resolved");
  }

  // Cancelled.
  {
    const world = testWorld();
    const { invitationId, delivery } = await dispatched(world);
    await cancelInvitation(world.deps, world.owner, invitationId);
    answers.push(JSON.stringify(await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c" })));
  }

  // Superseded by a replacement.
  {
    const world = testWorld();
    const { invitationId, delivery } = await dispatched(world);
    await replaceInvitation(world.deps, world.owner, invitationId);
    answers.push(JSON.stringify(await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c" })));
  }

  // Expired by timestamp, materialized on observation.
  {
    const world = testWorld();
    const { delivery } = await dispatched(world);
    world.clock.advanceSeconds(8 * 24 * 60 * 60);
    answers.push(JSON.stringify(await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c" })));
  }

  // Declined.
  {
    const world = testWorld();
    const { delivery, ceremonyRequest } = await ceremony(world, "verify");
    await declineInvitation(world.deps, ceremonyRequest);
    answers.push(JSON.stringify(await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c" })));
  }

  // Consumed by a committed acceptance.
  {
    const world = testWorld();
    const { invitationId, delivery } = await ceremony(world, "accept");
    await confirmAcceptance(world.deps, world.owner, { invitationId, confirmationIdempotencyKey: "k1" });
    answers.push(JSON.stringify(await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c" })));
  }

  const expected = JSON.stringify({ outcome: "unusable", messageCode: UNIFORM_LINK_MESSAGE_CODE });
  assert.equal(answers.length, 11);
  for (const answer of answers) assert.equal(answer, expected);
});

void test("an unknown code writes one AE-73-14 with no budget space, and a terminal one names the space only in restricted evidence", async () => {
  const world = testWorld();
  const { invitationId, delivery } = await dispatched(world);
  await resolveCode(world.deps, { presentedCode: "nonsense", environment: ENVIRONMENT, correlationId: "c1" });
  await cancelInvitation(world.deps, world.owner, invitationId);
  await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c2" });

  const [unknown, terminal] = world.repository.securityEvents;
  assert.equal(unknown?.outcomeClass, "unknown_value");
  assert.equal(unknown?.budgetSpaceId, null);
  assert.equal(terminal?.outcomeClass, "terminal_record");
  assert.equal(terminal?.budgetSpaceId, SPACE);
  // The fingerprint is a keyed digest of the presented value, never the value.
  assert.match(String(unknown?.abuseFingerprint), /^[0-9a-f]{64}$/u);
  assert.notEqual(terminal?.abuseFingerprint, delivery.bearer);
});

// ---------------------------------------------------------------------------
// TR-73-09, TR-73-10, TR-73-11.
// ---------------------------------------------------------------------------

void test("SEC-PK5-F01: a wrong channel guess is a returned outcome, so the attempt and its audit row survive the transaction", async () => {
  const world = testWorld();
  const { ceremonyRequest } = await ceremony(world, "resolve");
  const auditsBefore = world.repository.audits.length;

  const first = await verifyChannel(world.deps, { ...ceremonyRequest, channelCode: "000000" });
  assert.deepEqual(first, { outcome: "retry", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - 1 }, "a wrong guess does not throw");
  assert.equal(world.repository.ceremonies.get(ceremonyRequest.ceremonyId)?.channelAttempts, 1, "the increment is persisted");
  const denial = world.repository.audits.slice(auditsBefore).find((row) => row.eventCode === "AE-73-09");
  assert.equal(denial?.result, "deny");
  assert.equal(denial?.reasonClass, "channel_challenge_invalid");
});

void test("the channel challenge is bounded, and exhausting it kills the ceremony for good", async () => {
  const world = testWorld();
  const { ceremonyRequest, invitationId, delivery } = await ceremony(world, "resolve");
  for (let attempt = 1; attempt < MAX_CHANNEL_ATTEMPTS; attempt += 1) {
    const answer = await verifyChannel(world.deps, { ...ceremonyRequest, channelCode: "000000" });
    assert.deepEqual(answer, { outcome: "retry", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - attempt }, `attempt ${attempt}`);
  }
  assert.deepEqual(
    await verifyChannel(world.deps, { ...ceremonyRequest, channelCode: "000000" }),
    { outcome: "exhausted", attemptsRemaining: 0 },
  );
  const ceremonyRow = world.repository.ceremonies.get(ceremonyRequest.ceremonyId);
  assert.equal(ceremonyRow?.channelProofState, "exhausted");
  assert.equal(ceremonyRow?.channelAttempts, MAX_CHANNEL_ATTEMPTS);

  // SEC-PK6-F2: exhaustion is terminal for the bearer. The ceremony is
  // invalidated with the code, so the correct code no longer proves and
  // takes no further attempt ...
  assert.equal(ceremonyRow?.state, "invalidated");
  assert.equal(ceremonyRow?.isCurrent, false);
  await assert.rejects(
    verifyChannel(world.deps, { ...ceremonyRequest, channelCode: "000000" }),
    (error: unknown) => isInvitationError(error, "ceremony_unusable"), "an exhausted ceremony stays unusable",
  );
  assert.equal(world.repository.ceremonies.get(ceremonyRequest.ceremonyId)?.channelAttempts, MAX_CHANNEL_ATTEMPTS, "and takes no further attempt");
  // ... and the code died with it (its outbox row tombstoned): a re-resolve cannot open a fresh ceremony bound to the same digits.
  const code = world.repository.codes.get(invitationId);
  assert.equal(code?.disposition, "invalidated");
  assert.equal(code?.dispositionReasonClass, "channel_attempts_exhausted");
  assert.throws(() => world.delivery(invitationId), /no simulated delivery/);
  assert.deepEqual(
    await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c-exhausted" }),
    UNIFORM_UNUSABLE, "the exhausted code no longer resolves",
  );
  assert.equal(world.repository.securityEvents.at(-1)?.outcomeClass, "terminal_record");
  assert.equal([...world.repository.ceremonies.values()].filter((c) => c.invitationId === invitationId && c.isCurrent).length, 0, "no fresh ceremony was opened");
});

void test("SEC-PK5-F01: an already-member attach cancels the record privately and answers the uniform outcome as a value", async () => {
  const world = testWorld();
  const { invitationId, ceremonyRequest } = await ceremony(world, "verify");
  world.repository.seedMembership({
    membershipId: "99999999-9999-4999-8999-333333333333", budgetSpaceId: SPACE,
    profileId: "55555555-5555-4555-8555-555555555555", accountSubjectId: INVITEE_SUBJECT,
    role: "collaborator", status: "active", authorizationVersion: 1, createdBySubjectId: OWNER_SUBJECT, endedAt: null,
  });
  const answer = await attachAccount(world.deps, world.invitee, ceremonyRequest);
  assert.deepEqual(answer, { outcome: "unusable", messageCode: UNIFORM_LINK_MESSAGE_CODE });
  const record = world.repository.invitations.get(invitationId);
  assert.equal(record?.state, "cancelled", "the private cancel is committed, not discarded");
  assert.equal(record?.privateTerminalCause, "already_member");
  assert.equal(record?.projectionState, "pending", "the inviter learns nothing until TR-73-07");
  const audit = world.repository.audits.find((row) => row.eventCode === "AE-73-06" && row.targetId === invitationId);
  assert.equal(audit?.audience, "restricted");
  assert.equal(audit?.result, "system");
});

void test("the fixed partial order is the row's: attach needs proof, the disclosure and accept need the attachment", async () => {
  const world = testWorld();
  const { ceremonyRequest } = await ceremony(world, "resolve");
  await assert.rejects(
    attachAccount(world.deps, world.invitee, ceremonyRequest),
    (error: unknown) => isInvitationError(error, "channel_proof_required"),
  );
  const { delivery } = await dispatched(testWorld());
  void delivery;

  const second = testWorld();
  const verified = await ceremony(second, "verify");
  await assert.rejects(
    readDisclosure(second.deps, second.invitee, verified.ceremonyRequest),
    (error: unknown) => isInvitationError(error, "attachment_required"),
  );
  await assert.rejects(
    acceptInvitation(second.deps, second.invitee, {
      ...verified.ceremonyRequest, acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 },
    }),
    (error: unknown) => isInvitationError(error, "attachment_required"),
  );
});

void test("attach records the session row id, never a token, and a second subject is refused rather than re-attached", async () => {
  const world = testWorld();
  const { ceremonyRequest } = await ceremony(world, "attach");
  const ceremonyRow = world.repository.ceremonies.get(ceremonyRequest.ceremonyId);
  assert.equal(ceremonyRow?.attachedSubjectId, INVITEE_SUBJECT);
  assert.equal(ceremonyRow?.attachedSessionRef, world.invitee.sessionRowId);
  assert.equal(ceremonyRow?.primaryContactMatch, null, "restricted evidence only; never compared");

  // PK2FIX-F02: an account switch is invalidation plus a new ceremony, never
  // an in-place re-attach.
  await assert.rejects(
    attachAccount(world.deps, { ...world.invitee, subjectId: "88888888-8888-4888-8888-888888888888" }, ceremonyRequest),
    (error: unknown) => isInvitationError(error, "ceremony_unusable"),
  );
});

void test("a ceremony from another environment is unreadable", async () => {
  const world = testWorld();
  const { ceremonyRequest } = await ceremony(world, "verify");
  await assert.rejects(
    attachAccount(world.deps, { ...world.invitee, environment: "other" }, ceremonyRequest),
    (error: unknown) => isInvitationError(error, "ceremony_unusable"),
  );
});

void test("SEC-PK5-F03: the two unauthenticated commands bind the environment too", async () => {
  // verify-channel and decline carry no session, so the server's environment
  // key travels with the request as it does on resolve. Both answer the
  // uniform outcome for a ceremony belonging to another environment.
  const verify = testWorld();
  const verifyCeremony = await ceremony(verify, "resolve");
  await assert.rejects(
    verifyChannel(verify.deps, {
      ...verifyCeremony.ceremonyRequest, environment: "other", channelCode: verifyCeremony.delivery.challenge,
    }),
    (error: unknown) => isInvitationError(error, "ceremony_unusable"),
  );
  const untouched = verify.repository.ceremonies.get(verifyCeremony.ceremonyRequest.ceremonyId);
  assert.equal(untouched?.channelProofState, "challenged", "a foreign environment proves nothing");
  assert.equal(untouched?.channelAttempts, 0, "and takes no attempt");

  const decline = testWorld();
  const declineCeremony = await ceremony(decline, "verify");
  await assert.rejects(
    declineInvitation(decline.deps, { ...declineCeremony.ceremonyRequest, environment: "other" }),
    (error: unknown) => isInvitationError(error, "ceremony_unusable"),
  );
  assert.equal(decline.repository.invitations.get(declineCeremony.invitationId)?.state, "pending", "nothing was declined");
});

void test("a wrong ceremony cookie is the same answer as a missing ceremony", async () => {
  const world = testWorld();
  const { ceremonyRequest } = await ceremony(world, "verify");
  for (const wrong of [{ ...ceremonyRequest, ceremonySecret: "f".repeat(64) }, { ...ceremonyRequest, ceremonyId: "00000000-0000-4000-8000-000000009999" }]) {
    await assert.rejects(
      attachAccount(world.deps, world.invitee, wrong),
      (error: unknown) => isInvitationError(error, "ceremony_unusable"),
    );
  }
});

void test("decline ends the record but leaves the inviter's projection pending until expiry", async () => {
  const world = testWorld();
  const { invitationId, ceremonyRequest } = await ceremony(world, "verify");
  const answer = await declineInvitation(world.deps, ceremonyRequest);
  assert.equal(answer.messageCode, UNIFORM_LINK_MESSAGE_CODE);
  const record = world.repository.invitations.get(invitationId);
  assert.equal(record?.state, "declined");
  assert.equal(record?.projectionState, "pending", "a decline is not distinguishable from an unattended invitation");
  assert.equal(world.repository.codes.get(invitationId)?.disposition, "invalidated");
  const audit = world.repository.audits.find((row) => row.eventCode === "AE-73-11");
  assert.equal(audit?.audience, "restricted");
});

// ---------------------------------------------------------------------------
// TR-73-38 and the disclosure binding.
// ---------------------------------------------------------------------------

void test("PK5-02: a stale, mismatched or missing disclosure claim denies at TR-73-38 and writes nothing", async () => {
  for (const claim of [undefined, { kind: "invitation_collaborator", version: 2 }, { kind: "invitation_co_owner", version: 1 }]) {
    const world = testWorld();
    const { invitationId, ceremonyRequest } = await ceremony(world, "attach");
    const auditsBefore = world.repository.audits.length;
    await assert.rejects(
      acceptInvitation(world.deps, world.invitee, { ...ceremonyRequest, acknowledgedDisclosure: claim }),
      (error: unknown) => isInvitationError(error, "stale_disclosure"),
    );
    assert.equal(world.repository.invitations.get(invitationId)?.state, "pending", "nothing moved");
    assert.equal(world.repository.confirmations.size, 0, "no confirmation row");
    assert.equal(world.repository.audits.length, auditsBefore, "no audit row");
  }
});

void test("PK5-02: a registry that has moved past the invitation's stored version denies too", async () => {
  const world = testWorld();
  const { invitationId, ceremonyRequest } = await ceremony(world, "attach");
  const moved = {
    ...world.deps,
    disclosures: {
      current: () => ({
        kind: "invitation_collaborator", version: 2, digest: "d".repeat(64),
        text: { heading: "Collaborator", items: [], acknowledgement: "I agree." },
      }),
    },
  };
  await assert.rejects(
    acceptInvitation(moved, world.invitee, { ...ceremonyRequest, acknowledgedDisclosure: { kind: "invitation_collaborator", version: 2 } }),
    (error: unknown) => isInvitationError(error, "stale_disclosure"),
  );
  assert.equal(world.repository.invitations.get(invitationId)?.state, "pending");
});

void test("R-01: TR-73-38 answers an active or stale membership uniformly, cancelling the record privately", async () => {
  // An active membership created between attach and accept.
  const active = testWorld();
  const first = await ceremony(active, "attach");
  active.repository.seedMembership({
    membershipId: "99999999-9999-4999-8999-444444444444", budgetSpaceId: SPACE,
    profileId: "55555555-5555-4555-8555-555555555555", accountSubjectId: INVITEE_SUBJECT,
    role: "collaborator", status: "active", authorizationVersion: 1, createdBySubjectId: OWNER_SUBJECT, endedAt: null,
  });
  const answer = await acceptInvitation(active.deps, active.invitee, {
    ...first.ceremonyRequest, acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 },
  });
  assert.deepEqual(answer, { outcome: "unusable", messageCode: UNIFORM_LINK_MESSAGE_CODE }, "the same answer a dead link gives");
  assert.equal(active.repository.invitations.get(first.invitationId)?.state, "cancelled");
  assert.equal(active.repository.invitations.get(first.invitationId)?.privateTerminalCause, "already_member");
  assert.equal(active.repository.confirmations.size, 0, "no confirmation was opened");

  // A membership that ended at or after the invitation was issued: the stale
  // recheck TR-73-38 previously skipped entirely.
  const stale = testWorld();
  const second = await ceremony(stale, "attach");
  const issuedAt = stale.repository.invitations.get(second.invitationId)!.issuedAt;
  stale.repository.seedMembership({
    membershipId: "99999999-9999-4999-8999-555555555555", budgetSpaceId: SPACE,
    profileId: "55555555-5555-4555-8555-555555555555", accountSubjectId: INVITEE_SUBJECT,
    role: "collaborator", status: "removed", authorizationVersion: 2, createdBySubjectId: OWNER_SUBJECT,
    endedAt: issuedAt,
  });
  assert.deepEqual(
    await acceptInvitation(stale.deps, stale.invitee, {
      ...second.ceremonyRequest, acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 },
    }),
    { outcome: "unusable", messageCode: UNIFORM_LINK_MESSAGE_CODE },
  );
  assert.equal(stale.repository.invitations.get(second.invitationId)?.privateTerminalCause, "stale_after_membership_end");
  const audit = stale.repository.audits.find((row) => row.eventCode === "AE-73-06" && row.targetId === second.invitationId);
  assert.equal(audit?.audience, "restricted");
});

void test("accept opens a confirmation and writes no consent row", async () => {
  const world = testWorld();
  const { invitationId } = await ceremony(world, "accept");
  const record = world.repository.invitations.get(invitationId);
  assert.equal(record?.state, "awaiting_confirmation");
  assert.equal(world.repository.consents.length, 0, "there is no membership to reference yet");
  const confirmation = [...world.repository.confirmations.values()][0];
  assert.equal(confirmation?.state, "requested");
  assert.equal(confirmation?.acceptorSubjectId, INVITEE_SUBJECT);
  assert.equal(confirmation?.bindingRuleId, "CBD-73-5.1");
  assert.equal(confirmation?.displayedIdentityVersion, 1);
  assert.ok(world.repository.notices.some((row) => row.messageCode === "MSG-73-050" && row.accountSubjectId === OWNER_SUBJECT));
});

void test("the confirmation prompt shows the display identity and the mask, and nothing else about the acceptor", async () => {
  const world = testWorld();
  const { invitationId } = await ceremony(world, "accept");
  const prompt = await readConfirmationPrompt(world.deps, world.owner, invitationId);
  assert.equal(prompt.acceptorDisplayName, NEUTRAL_DISPLAY_LABEL);
  assert.equal(prompt.destinationMasked, "i***@example.com");
  assert.deepEqual(Object.keys(prompt).sort(), [
    "acceptorDisplayName", "confirmationId", "destinationMasked", "displayedIdentityVersion",
    "expiresAt", "invitationId", "proposedRole",
  ]);
});

// ---------------------------------------------------------------------------
// TR-73-05, TR-73-06, TR-73-07.
// ---------------------------------------------------------------------------

void test("PK5-03: replace supersedes the predecessor, invalidates its code and ceremonies, and leaves one usable version", async () => {
  const world = testWorld();
  const { invitationId, delivery } = await dispatched(world);
  const opened = await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c" });
  assert.equal(opened.outcome, "resolved");

  // R-03: replace compares the actor's own permission against the record's
  // required_permission, so a wrong or absent cell denies before any write.
  for (const actor of [ownerWithoutPermission(world.owner), { ...world.owner, permission: "26" as const }]) {
    await assert.rejects(
      replaceInvitation(world.deps, actor, invitationId),
      (error: unknown) => isInvitationError(error, "permission_mismatch"),
    );
  }
  assert.equal(world.repository.invitations.get(invitationId)?.state, "pending", "the denial wrote nothing");

  const replacement = await replaceInvitation(world.deps, world.owner, invitationId);
  const predecessor = world.repository.invitations.get(invitationId);
  const successor = world.repository.invitations.get(replacement.projection.invitationId);
  assert.equal(predecessor?.state, "superseded");
  assert.equal(predecessor?.projectionState, "replaced");
  assert.equal(predecessor?.successorInvitationId, successor?.invitationId);
  assert.equal(successor?.predecessorInvitationId, invitationId);
  assert.equal(successor?.state, "pending");
  assert.equal(successor?.destinationToken, predecessor?.destinationToken, "the same recipient");
  assert.equal(world.repository.codes.get(invitationId)?.disposition, "invalidated");
  assert.ok((await world.repository.listCeremonies(SPACE, invitationId)).every((row) => !row.isCurrent));

  // The old bearer is dead and the new one works: exactly one usable version.
  const stale = await resolveCode(world.deps, { presentedCode: delivery.bearer, environment: ENVIRONMENT, correlationId: "c" });
  assert.equal(stale.outcome, "unusable");
  const fresh = world.delivery(replacement.projection.invitationId);
  assert.notEqual(fresh.bearer, delivery.bearer);
  assert.equal((await resolveCode(world.deps, { presentedCode: fresh.bearer, environment: ENVIRONMENT, correlationId: "c" })).outcome, "resolved");
  assert.ok(world.repository.audits.some((row) => row.eventCode === "AE-73-05"));
});

void test("a second create for the same destination routes the replacement rather than making a second record", async () => {
  const world = testWorld();
  const first = await createInvitation(world.deps, world.owner, request());
  const second = await createInvitation(world.deps, world.owner, request({ idempotencyKey: "k2" }));
  assert.equal(second.supersededInvitationId, first.projection.invitationId);
  const dispatchedRecords = [...world.repository.invitations.values()].filter((row) => row.state === "pending");
  assert.equal(dispatchedRecords.length, 1, "one dispatched real invitation per destination at a time");
});

void test("cancel retires the projection and kills the code; expiry on observation does the same once", async () => {
  const cancelled = testWorld();
  const { invitationId } = await dispatched(cancelled);
  await cancelInvitation(cancelled.deps, cancelled.owner, invitationId);
  assert.equal(cancelled.repository.invitations.get(invitationId)?.state, "cancelled");
  assert.equal(cancelled.repository.invitations.get(invitationId)?.projectionState, "cancelled");
  assert.equal(cancelled.repository.outbox.get(invitationId)?.deliveryState, "tombstoned");

  const expired = testWorld();
  const later = await dispatched(expired);
  expired.clock.advanceSeconds(8 * 24 * 60 * 60);
  const record = expired.repository.invitations.get(later.invitationId);
  assert.ok(record);
  const first = await expireOnObservation(expired.deps, record, "c1");
  const second = await expireOnObservation(expired.deps, first, "c2");
  assert.equal(second.state, "expired");
  assert.equal(second.projectionState, "no_longer_active");
  assert.equal(expired.repository.audits.filter((row) => row.eventCode === "AE-73-07").length, 1, "exactly once");
});

void test("a cancelled record's ceremony is dead too, and the audit payload carries no value", async () => {
  const world = testWorld();
  const { invitationId, ceremonyRequest } = await ceremony(world, "attach");
  await cancelInvitation(world.deps, world.owner, invitationId);
  await assert.rejects(
    acceptInvitation(world.deps, world.invitee, {
      ...ceremonyRequest, acknowledgedDisclosure: { kind: "invitation_collaborator", version: 1 },
    }),
    (error: unknown) => isInvitationError(error, "ceremony_unusable"),
  );
  for (const row of world.repository.audits) {
    const payload = JSON.stringify(row.payload);
    assert.ok(!payload.includes("@example.com"), row.eventCode);
    assert.ok(!payload.includes("i***"), row.eventCode);
  }
});
