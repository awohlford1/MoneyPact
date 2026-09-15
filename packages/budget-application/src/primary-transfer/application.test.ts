import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptPrimaryTransfer, confirmPrimaryTransfer, declinePrimaryTransfer, parseProposeTransferRequest,
  parseTransferRequest, proposePrimaryTransfer, readMembershipResourceLeaves, viewPrimaryTransfer,
  withdrawPrimaryTransfer,
} from "./application.ts";
import { PrimaryTransferError, isPrimaryTransferError } from "./records.ts";
import {
  OTHER_SUBJECT, PRIMARY_MEMBERSHIP, PRIMARY_SUBJECT, RECIPIENT_MEMBERSHIP, RECIPIENT_SUBJECT, SPACE, actorWithoutCell, testWorld,
} from "./support.ts";

/** Propose, and return the transfer id. Fails loudly rather than returning a denial the caller has to unwrap. */
async function propose(world: ReturnType<typeof testWorld>): Promise<string> {
  const result = await proposePrimaryTransfer(world.deps, world.primary("29.propose_primary_transfer"), {
    recipientMembershipId: RECIPIENT_MEMBERSHIP,
  });
  assert.equal(result.outcome, "proposed");
  if (result.outcome !== "proposed") throw new Error("unreachable");
  return result.transfer.transferId;
}

void test("PK7A-02 TR-73-40: propose captures all three versions, both disclosures and the deadline", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.ok(record);
  assert.equal(record.state, "proposed");
  assert.equal(record.stateVersion, 1);
  assert.equal(record.proposerMembershipId, PRIMARY_MEMBERSHIP);
  assert.equal(record.recipientMembershipId, RECIPIENT_MEMBERSHIP);
  assert.equal(record.proposerAuthorizationVersion, 1);
  assert.equal(record.recipientAuthorizationVersion, 1);
  assert.equal(record.primaryOwnershipVersion, 1);
  assert.equal(record.recipientDisclosureKind, "primary_transfer_recipient");
  assert.equal(record.outgoingDisclosureKind, "primary_transfer_outgoing");
  assert.equal(record.primaryAssuranceRef, null);
  assert.ok(Date.parse(record.expiresAt) > Date.parse(world.clock.now()));
  // No role changed.
  const primary = await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP);
  assert.equal(primary?.role, "primary_owner");
  // Exactly one AE-73-25 transfer_proposed plus one AE-73-30 enqueue child.
  const audit = world.repository.auditFor(world.primary("29.propose_primary_transfer").correlationId);
  assert.deepEqual(audit.map((row) => `${row.eventCode}/${row.eventSubtype ?? ""}`), [
    "AE-73-25/transfer_proposed", "AE-73-30/",
  ]);
  // PK7A-F01: the enqueue's durable row, to the recipient's subject, with the
  // code only and the request's correlation id.
  assert.deepEqual(world.repository.notices.map((row) => [row.messageCode, row.accountSubjectId, row.budgetSpaceId, row.eventCorrelationId]), [
    ["MSG-73-040", RECIPIENT_SUBJECT, SPACE, world.primary("29.propose_primary_transfer").correlationId],
  ]);
});

void test("PK7A-02 TR-73-47: every ineligible or stale target denies without a workflow row", async () => {
  const cases: readonly (readonly [string, (world: ReturnType<typeof testWorld>) => Promise<unknown>, string])[] = [
    ["self", async (world) => proposePrimaryTransfer(world.deps, world.primary("29.propose_primary_transfer"), {
      recipientMembershipId: PRIMARY_MEMBERSHIP,
    }), "self_transfer"],
    ["an ended member", async (world) => {
      world.repository.seedMembership({
        membershipId: RECIPIENT_MEMBERSHIP, budgetSpaceId: SPACE, profileId: "p", accountSubjectId: RECIPIENT_SUBJECT,
        role: "collaborator", status: "removed", authorizationVersion: 2, endedAt: "2026-09-14T00:00:00.000Z",
      });
      return proposePrimaryTransfer(world.deps, world.primary("29.propose_primary_transfer"), {
        recipientMembershipId: RECIPIENT_MEMBERSHIP,
      });
    }, "recipient_ineligible"],
    ["an unknown membership", async (world) => proposePrimaryTransfer(world.deps, world.primary("29.propose_primary_transfer"), {
      recipientMembershipId: "00000000-0000-4000-8000-999999999999",
    }), "recipient_ineligible"],
    ["a stale decision version", async (world) => proposePrimaryTransfer(world.deps, {
      ...world.primary("29.propose_primary_transfer"),
      decision: { policyVersion: "p4", policyDigest: "c".repeat(64), authorizationVersion: 7 },
    }, { recipientMembershipId: RECIPIENT_MEMBERSHIP }), "stale_version"],
    ["a proposer who is not the Primary", async (world) => proposePrimaryTransfer(world.deps, {
      ...world.primary("29.propose_primary_transfer"), membershipId: RECIPIENT_MEMBERSHIP, subjectId: RECIPIENT_SUBJECT,
    }, { recipientMembershipId: PRIMARY_MEMBERSHIP }), "proposer_not_primary"],
    ["an archived space", async (world) => {
      world.repository.seedSpace({
        budgetSpaceId: SPACE, lifecycle: "archived",
        primaryOwnerMembershipId: PRIMARY_MEMBERSHIP, primaryOwnershipVersion: 1,
      });
      return proposePrimaryTransfer(world.deps, world.primary("29.propose_primary_transfer"), {
        recipientMembershipId: RECIPIENT_MEMBERSHIP,
      });
    }, "budget_space_not_live"],
  ];

  for (const [label, run, reasonClass] of cases) {
    const world = testWorld();
    const result = await run(world) as { outcome: string; reasonClass?: string; messageCode?: string };
    assert.equal(result.outcome, "denied", label);
    assert.equal(result.reasonClass, reasonClass, label);
    // RI-93-017: one bounded message, whatever the cause.
    assert.equal(result.messageCode, "MSG-73-046", label);
    assert.equal(world.repository.transfers.size, 0, label);
    // Exactly one AE-73-25 transfer_denied, and it mutated nothing.
    const audit = world.repository.audit;
    assert.equal(audit.length, 1, label);
    assert.equal(audit[0]?.eventSubtype, "transfer_denied", label);
    assert.equal(audit[0]?.result, "deny", label);
  }
});

void test("PK7A-02: one live workflow per space -- the second proposal denies rather than racing the index", async () => {
  const world = testWorld();
  await propose(world);
  const second = await proposePrimaryTransfer(world.deps, world.primary("29.propose_primary_transfer"), {
    recipientMembershipId: RECIPIENT_MEMBERSHIP,
  });
  assert.equal(second.outcome, "denied");
  if (second.outcome !== "denied") throw new Error("unreachable");
  assert.equal(second.reasonClass, "transfer_already_live");
  assert.equal(world.repository.transfers.size, 1);
});

void test("PK7A-02 SEC-PK5-F02: a route that did not decide against the cell is refused, not defaulted", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  const bare = actorWithoutCell(world.recipient("29.accept_primary_transfer"));
  const result = await acceptPrimaryTransfer(world.deps, bare, { transferId });
  assert.equal(result.outcome, "denied");
  if (result.outcome !== "denied") throw new Error("unreachable");
  assert.equal(result.reasonClass, "permission_mismatch");
  // And a cell decided for a different action is equally not this one.
  const wrongCell = { ...world.recipient("29.accept_primary_transfer"), actionCode: "29.view_primary_transfer" as const };
  const crossed = await acceptPrimaryTransfer(world.deps, wrongCell, { transferId });
  assert.equal(crossed.outcome, "denied");
});

void test("PK7A-02 TR-73-41: the recipient accepts and the workflow waits for the Primary", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  const result = await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  assert.equal(result.outcome, "recipient_accepted");
  if (result.outcome !== "recipient_accepted") throw new Error("unreachable");
  assert.equal(result.messageCode, "MSG-73-025");
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "recipient_accepted");
  assert.equal(record?.stateVersion, 2);
  assert.equal(record?.recipientAcceptedVersion, 2);
  // No role changed and no consent row moved: acceptance is evidence, not authority.
  assert.equal((await world.repository.readMembership(SPACE, RECIPIENT_MEMBERSHIP))?.role, "collaborator");
  assert.equal((await world.repository.readCurrentConsent(SPACE, RECIPIENT_MEMBERSHIP))?.role, "collaborator");
  // R-06: the recipient's exact retry answers the prior conditional result
  // -- the current state and MSG-73-025 -- and writes nothing.
  const auditsBefore = world.repository.audit.length;
  const again = await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  assert.equal(again.outcome, "recipient_accepted");
  if (again.outcome !== "recipient_accepted") throw new Error("unreachable");
  assert.equal(again.messageCode, "MSG-73-025");
  assert.equal(again.transfer.transferId, transferId);
  assert.equal((await world.repository.readTransfer(SPACE, transferId))?.stateVersion, 2);
  assert.equal(world.repository.audit.length, auditsBefore);
});

void test("PK7A-02 TR-73-42: the Primary confirms first and the workflow waits for the recipient", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  const result = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(result.outcome, "primary_confirmed");
  if (result.outcome !== "primary_confirmed") throw new Error("unreachable");
  assert.equal(result.messageCode, "MSG-73-041");
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "primary_confirmed");
  // The evidence reference is recorded on the row; the assurance itself is
  // never read by this module.
  assert.equal(record?.primaryAssuranceRef, world.primary("29.transfer_primary_ownership").freshAssuranceRef);
  assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner");
});

void test("R-06: the Primary's repeated confirm answers the prior result without writing", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  const first = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(first.outcome, "primary_confirmed");
  const auditsBefore = world.repository.audit.length;
  const again = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(again.outcome, "primary_confirmed");
  if (again.outcome !== "primary_confirmed") throw new Error("unreachable");
  assert.equal(again.messageCode, "MSG-73-041");
  assert.equal((await world.repository.readTransfer(SPACE, transferId))?.stateVersion, 2);
  assert.equal(world.repository.audit.length, auditsBefore);
  // A stale decision on the retry is still refused first: recovery never
  // outranks the version check.
  const stale = world.primary("29.transfer_primary_ownership");
  const staleResult = await confirmPrimaryTransfer(world.deps, { ...stale, decision: { ...stale.decision, authorizationVersion: 9 } }, { transferId });
  assert.equal(staleResult.outcome, "denied");
});

void test("R-03: a committed workflow answers its receipt to either party's retry without writing, and denies the rest", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  const committed = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(committed.outcome, "committed");
  if (committed.outcome !== "committed") throw new Error("unreachable");
  const auditsBefore = world.repository.audit.length;
  const noticesBefore = world.repository.notices.length;

  // Both parties recover the same receipt. Their decision versions are the
  // pre-commit ones, which is what a lost-response retry carries; a committed
  // workflow is answered after the party check and before the version check.
  const confirmAgain = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(confirmAgain.outcome, "committed");
  if (confirmAgain.outcome !== "committed") throw new Error("unreachable");
  assert.deepEqual(confirmAgain.receipt, committed.receipt);
  assert.equal(confirmAgain.messageCode, "MSG-73-042");
  const acceptAgain = await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  assert.equal(acceptAgain.outcome, "committed");
  if (acceptAgain.outcome !== "committed") throw new Error("unreachable");
  assert.deepEqual(acceptAgain.receipt, committed.receipt);
  assert.equal(world.repository.audit.length, auditsBefore);
  assert.equal(world.repository.notices.length, noticesBefore);
  assert.equal((await world.repository.readSpace(SPACE))?.primaryOwnershipVersion, 2);

  // A non-party gets the denial, not the receipt.
  const stranger = { ...world.recipient("29.accept_primary_transfer"), subjectId: OTHER_SUBJECT };
  assert.equal((await acceptPrimaryTransfer(world.deps, stranger, { transferId })).outcome, "denied");
  // Withdraw and decline on a committed workflow stay the uniform no-op.
  assert.equal((await withdrawPrimaryTransfer(world.deps, world.primary("29.withdraw_primary_transfer"), { transferId })).outcome, "denied");
  assert.equal((await declinePrimaryTransfer(world.deps, world.recipient("29.decline_primary_transfer"), { transferId })).outcome, "denied");
  assert.equal((await world.repository.readTransfer(SPACE, transferId))?.state, "committed");
});

void test("PK7A-03: a confirm with no fresh-assurance reference denies and records nothing", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  const { freshAssuranceRef, ...withoutAssurance } = world.primary("29.transfer_primary_ownership");
  void freshAssuranceRef;
  const result = await confirmPrimaryTransfer(world.deps, withoutAssurance, { transferId });
  assert.equal(result.outcome, "denied");
  if (result.outcome !== "denied") throw new Error("unreachable");
  assert.equal(result.reasonClass, "assurance_required");
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "proposed");
  assert.equal(record?.primaryConfirmedAt, null);
});

void test("PK7A-02 TR-73-44 and TR-73-45: decline and withdraw close the workflow and change no role", async () => {
  for (const [label, run, outcome, messageCode] of [
    ["decline", (world: ReturnType<typeof testWorld>, transferId: string) =>
      declinePrimaryTransfer(world.deps, world.recipient("29.decline_primary_transfer"), { transferId }), "declined", "MSG-73-043"],
    ["withdraw", (world: ReturnType<typeof testWorld>, transferId: string) =>
      withdrawPrimaryTransfer(world.deps, world.primary("29.withdraw_primary_transfer"), { transferId }), "withdrawn", "MSG-73-044"],
  ] as const) {
    const world = testWorld();
    const transferId = await propose(world);
    const result = await run(world, transferId);
    assert.equal(result.outcome, outcome, label);
    if (result.outcome !== outcome) throw new Error("unreachable");
    assert.equal(result.messageCode, messageCode, label);
    const record = await world.repository.readTransfer(SPACE, transferId);
    assert.equal(record?.state, outcome, label);
    assert.ok(record?.terminalEventId, label);
    assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner", label);
    assert.equal((await world.repository.readMembership(SPACE, RECIPIENT_MEMBERSHIP))?.role, "collaborator", label);
    // Exactly one AE-73-25 with this subtype plus one AE-73-30 enqueue child.
    const closing = world.repository.audit.slice(2);
    assert.deepEqual(closing.map((row) => `${row.eventCode}/${row.eventSubtype ?? ""}`), [
      `AE-73-25/transfer_${outcome === "declined" ? "declined" : "withdrawn"}`, "AE-73-30/",
    ], label);
    // PK7A-F01: the durable row goes to the other party -- the proposer on a
    // decline, the recipient on a withdrawal -- and never to the actor.
    assert.deepEqual(world.repository.notices.slice(1).map((row) => [row.messageCode, row.accountSubjectId]), [
      [messageCode, outcome === "declined" ? PRIMARY_SUBJECT : RECIPIENT_SUBJECT],
    ], label);
    // Repeat is the uniform no-op, never a second mutation.
    const repeat = await run(world, transferId);
    assert.equal(repeat.outcome, "denied", label);
  }
});

void test("PK7A-02: the wrong party is refused on every actor path", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  // The Primary cannot accept or decline on the recipient's behalf.
  const asPrimary = { ...world.primary("29.accept_primary_transfer") };
  assert.equal((await acceptPrimaryTransfer(world.deps, asPrimary, { transferId })).outcome, "denied");
  const declineAsPrimary = { ...world.primary("29.decline_primary_transfer") };
  assert.equal((await declinePrimaryTransfer(world.deps, declineAsPrimary, { transferId })).outcome, "denied");
  // The recipient cannot confirm or withdraw.
  const confirmAsRecipient = {
    ...world.recipient("29.transfer_primary_ownership"), freshAssuranceRef: "fresh-assurance:x",
  };
  assert.equal((await confirmPrimaryTransfer(world.deps, confirmAsRecipient, { transferId })).outcome, "denied");
  const withdrawAsRecipient = { ...world.recipient("29.withdraw_primary_transfer") };
  assert.equal((await withdrawPrimaryTransfer(world.deps, withdrawAsRecipient, { transferId })).outcome, "denied");
  assert.equal((await world.repository.readTransfer(SPACE, transferId))?.state, "proposed");
});

void test("PK7A-01 TR-73-46: expiry closes the workflow at the next command, with two enqueue children", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  world.clock.advanceSeconds(8 * 24 * 60 * 60);
  const result = await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  assert.equal(result.outcome, "expired");
  if (result.outcome !== "expired") throw new Error("unreachable");
  assert.equal(result.messageCode, "MSG-73-045");
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "expired");
  const closing = world.repository.audit.slice(2);
  assert.deepEqual(closing.map((row) => `${row.eventCode}/${row.eventSubtype ?? ""}`), [
    "AE-73-25/transfer_expired", "AE-73-30/", "AE-73-30/",
  ]);
  // PK7A-F01: one MSG-73-045 row per party, recipient first as the enqueue order is.
  assert.deepEqual(world.repository.notices.slice(1).map((row) => [row.messageCode, row.accountSubjectId]), [
    ["MSG-73-045", RECIPIENT_SUBJECT], ["MSG-73-045", PRIMARY_SUBJECT],
  ]);
});

void test("PK7A-02 TR-73-46: a version that moved after the proposal invalidates rather than committing", async () => {
  const drifts: readonly (readonly [string, (world: ReturnType<typeof testWorld>) => void])[] = [
    ["the recipient's authorization version", (world) => {
      const row = world.repository.memberships.get(`${SPACE}/${RECIPIENT_MEMBERSHIP}`);
      world.repository.seedMembership({ ...row!, authorizationVersion: row!.authorizationVersion + 1 });
    }],
    ["the Primary's authorization version", (world) => {
      const row = world.repository.memberships.get(`${SPACE}/${PRIMARY_MEMBERSHIP}`);
      world.repository.seedMembership({ ...row!, authorizationVersion: row!.authorizationVersion + 1 });
    }],
    ["the space's primary ownership version", (world) => {
      const space = world.repository.spaces.get(SPACE);
      world.repository.seedSpace({ ...space!, primaryOwnershipVersion: space!.primaryOwnershipVersion + 1 });
    }],
  ];
  for (const [label, drift] of drifts) {
    const world = testWorld();
    const transferId = await propose(world);
    drift(world);
    const result = await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
    assert.equal(result.outcome, "invalidated", label);
    if (result.outcome !== "invalidated") throw new Error("unreachable");
    // MSG-73-027, never the denial message: this closure is a mutation.
    assert.equal(result.messageCode, "MSG-73-027", label);
    assert.equal((await world.repository.readTransfer(SPACE, transferId))?.state, "invalidated", label);
    assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner", label);
    // PK7A-F01: one MSG-73-027 row per party.
    assert.deepEqual(world.repository.notices.slice(1).map((row) => [row.messageCode, row.accountSubjectId]).sort(), [
      ["MSG-73-027", PRIMARY_SUBJECT], ["MSG-73-027", RECIPIENT_SUBJECT],
    ].sort(), label);
  }
});

void test("PK7A-02: the status read answers either party and nobody else, and never materializes an expiry", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  for (const actor of [world.primary("29.view_primary_transfer"), world.recipient("29.view_primary_transfer")]) {
    const view = await viewPrimaryTransfer(world.deps, actor, { transferId });
    assert.equal(view.outcome, "view");
    if (view.outcome !== "view") throw new Error("unreachable");
    assert.equal(view.transfer.transferId, transferId);
    // The projection carries no assurance reference and no digest.
    assert.equal(Object.prototype.hasOwnProperty.call(view.transfer, "primaryAssuranceRef"), false);
    assert.equal(JSON.stringify(view.transfer).includes("fresh-assurance"), false);
  }
  const stranger = { ...world.primary("29.view_primary_transfer"), membershipId: "00000000-0000-4000-8000-123412341234" };
  assert.equal((await viewPrimaryTransfer(world.deps, stranger, { transferId })).outcome, "denied");
  // SEC-PK7A-F4: a party's membership id under another subject is not the
  // party, and neither is a party whose membership has ended.
  const forgedSubject = { ...world.recipient("29.view_primary_transfer"), subjectId: OTHER_SUBJECT };
  assert.equal((await viewPrimaryTransfer(world.deps, forgedSubject, { transferId })).outcome, "denied");
  const recipient = await world.repository.readMembership(SPACE, RECIPIENT_MEMBERSHIP);
  world.repository.seedMembership({ ...recipient!, status: "ended", endedAt: world.clock.now() });
  assert.equal((await viewPrimaryTransfer(world.deps, world.recipient("29.view_primary_transfer"), { transferId })).outcome, "denied");
  world.repository.seedMembership(recipient!);
  assert.equal((await viewPrimaryTransfer(world.deps, world.recipient("29.view_primary_transfer"), { transferId })).outcome, "view");

  world.clock.advanceSeconds(8 * 24 * 60 * 60);
  const afterExpiry = await viewPrimaryTransfer(world.deps, world.primary("29.view_primary_transfer"), { transferId });
  assert.equal(afterExpiry.outcome, "view");
  assert.equal((await world.repository.readTransfer(SPACE, transferId))?.state, "proposed");
});

void test("PK7A-02: request parsing refuses a malformed body before anything is read", async () => {
  assert.throws(() => parseProposeTransferRequest(null), PrimaryTransferError);
  assert.throws(() => parseProposeTransferRequest({}), PrimaryTransferError);
  assert.throws(() => parseProposeTransferRequest({ recipientMembershipId: 7 }), PrimaryTransferError);
  assert.throws(() => parseTransferRequest(""), PrimaryTransferError);
  assert.deepEqual(parseTransferRequest(RECIPIENT_MEMBERSHIP), { transferId: RECIPIENT_MEMBERSHIP });
  const world = testWorld();
  await assert.rejects(
    () => viewPrimaryTransfer(world.deps, world.primary("29.view_primary_transfer"), { transferId: "00000000-0000-4000-8000-000000000000" }),
    (error: unknown) => isPrimaryTransferError(error, "transfer_not_found"),
  );
});

void test("PK7A-03: the membership resource leaves PK-7B assembles are tenant-scoped and carry nothing else", async () => {
  const world = testWorld();
  const leaves = await readMembershipResourceLeaves(world.deps, SPACE, RECIPIENT_MEMBERSHIP);
  assert.deepEqual(leaves, {
    type: "membership", id: RECIPIENT_MEMBERSHIP, owningSpaceId: SPACE, version: 1, lifecycle: "active",
  });
  // Keyed on the acting space: another space's identifier answers nothing,
  // rather than reaching across the tenant boundary (`SEC-PK4-R2`).
  assert.equal(await readMembershipResourceLeaves(world.deps, "00000000-0000-4000-8000-000000000042", RECIPIENT_MEMBERSHIP), null);
  assert.equal(await readMembershipResourceLeaves(world.deps, SPACE, "00000000-0000-4000-8000-000000000043"), null);
});
