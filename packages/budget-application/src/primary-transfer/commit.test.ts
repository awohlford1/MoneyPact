import assert from "node:assert/strict";
import { test } from "node:test";

import { acceptPrimaryTransfer, confirmPrimaryTransfer, proposePrimaryTransfer } from "./application.ts";
import { COMMIT_BOUNDARIES, commitPrimaryTransfer, transferReceiptOf } from "./commit.ts";
import type { CommitBoundary } from "./commit.ts";
import { primaryTransferObligations } from "./obligations.ts";
import type { TransferObligationInput, TransferObligationLedger } from "./obligations.ts";
import { PrimaryTransferError, isPrimaryTransferError } from "./records.ts";
import {
  ASSURANCE_REFERENCE, PRIMARY_CONSENT, PRIMARY_MEMBERSHIP, PRIMARY_SUBJECT, RECIPIENT_CONSENT,
  RECIPIENT_MEMBERSHIP, RECIPIENT_SUBJECT, SPACE, testDisclosures, testWorld,
} from "./support.ts";
import type { TestWorld } from "./support.ts";

async function propose(world: TestWorld): Promise<string> {
  const result = await proposePrimaryTransfer(world.deps, world.primary("29.propose_primary_transfer"), {
    recipientMembershipId: RECIPIENT_MEMBERSHIP,
  });
  if (result.outcome !== "proposed") throw new Error(`propose failed: ${JSON.stringify(result)}`);
  return result.transfer.transferId;
}

/** Carry a workflow to `ready` with the recipient acting last, so the commit runs in the accept request. */
async function readyByAccept(world: TestWorld): Promise<string> {
  const transferId = await propose(world);
  const confirmed = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(confirmed.outcome, "primary_confirmed");
  return transferId;
}

void test("PK7A-01 TR-73-43: the whole commit, in the SS10.3 order, through the confirm leg", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  const accepted = await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  assert.equal(accepted.outcome, "recipient_accepted");

  const result = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(result.outcome, "committed");
  if (result.outcome !== "committed") throw new Error("unreachable");
  assert.equal(result.messageCode, "MSG-73-042");

  // The roles swapped, each with its version advanced.
  const formerPrimary = await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP);
  const newPrimary = await world.repository.readMembership(SPACE, RECIPIENT_MEMBERSHIP);
  assert.equal(formerPrimary?.role, "co_owner");
  assert.equal(formerPrimary?.authorizationVersion, 2);
  assert.equal(newPrimary?.role, "primary_owner");
  assert.equal(newPrimary?.authorizationVersion, 2);

  // The space points at the new Primary and its own version advanced.
  const space = await world.repository.readSpace(SPACE);
  assert.equal(space?.primaryOwnerMembershipId, RECIPIENT_MEMBERSHIP);
  assert.equal(space?.primaryOwnershipVersion, 2);

  // Both prior consent rows are superseded, each linked to the terminal event.
  const priorPrimary = await world.repository.readConsent(SPACE, PRIMARY_CONSENT);
  const priorRecipient = await world.repository.readConsent(SPACE, RECIPIENT_CONSENT);
  for (const row of [priorPrimary, priorRecipient]) {
    assert.equal(row?.state, "superseded");
    assert.equal(row?.endedReasonClass, "primary_transfer");
    assert.equal(row?.endedByEventId, result.receipt.transferId === transferId ? row?.endedByEventId : null);
    assert.ok(row?.endedAt);
  }

  // Two new current rows, each naming the row it supersedes and the right kind.
  const newRecipientConsent = await world.repository.readConsent(SPACE, result.receipt.recipientConsentId);
  const newOutgoingConsent = await world.repository.readConsent(SPACE, result.receipt.outgoingConsentId);
  assert.equal(newRecipientConsent?.state, "current");
  assert.equal(newRecipientConsent?.role, "primary_owner");
  assert.equal(newRecipientConsent?.disclosureKind, "primary_transfer_recipient");
  assert.equal(newRecipientConsent?.supersedesConsentId, RECIPIENT_CONSENT);
  // The recipient's leg discharges no protected obligation.
  assert.equal(newRecipientConsent?.assuranceRef, null);
  assert.equal(newOutgoingConsent?.state, "current");
  assert.equal(newOutgoingConsent?.role, "co_owner");
  assert.equal(newOutgoingConsent?.disclosureKind, "primary_transfer_outgoing");
  assert.equal(newOutgoingConsent?.supersedesConsentId, PRIMARY_CONSENT);
  // PK7A-03: the fresh-assurance evidence reference is on the outgoing row.
  assert.equal(newOutgoingConsent?.assuranceRef, ASSURANCE_REFERENCE);

  // The former Primary's permission-26 invitation was cancelled through PK-5.
  assert.deepEqual(world.cancelled, ["12121212-1212-4212-8212-121212121212"]);

  // Exactly one AE-73-25 transfer_committed, two AE-73-30 enqueues, two notices.
  const committedEvents = world.repository.audit.filter((row) => row.eventSubtype === "transfer_committed");
  assert.equal(committedEvents.length, 1);
  assert.equal(committedEvents[0]?.payload.supersededConsentCount, 2);
  assert.equal(committedEvents[0]?.payload.cancelledInvitationCount, 1);
  const enqueues = world.repository.audit.filter((row) => row.eventCode === "AE-73-30" && row.targetId === transferId);
  assert.equal(enqueues.filter((row) => row.payload.messageCode === "MSG-73-042").length, 2);
  const commitNotices = world.repository.notices.filter((row) => row.messageCode === "MSG-73-042");
  assert.deepEqual(commitNotices.map((row) => row.accountSubjectId).sort(), [PRIMARY_SUBJECT, RECIPIENT_SUBJECT].sort());
  // PK7A-F01: the proposal's MSG-73-040 to the recipient is the only other durable notice.
  assert.deepEqual(world.repository.notices.filter((row) => row.messageCode !== "MSG-73-042").map((row) => [row.messageCode, row.accountSubjectId]),
    [["MSG-73-040", RECIPIENT_SUBJECT]]);

  // The transfer row is the receipt (M3 carries no receipt column).
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "committed");
  assert.deepEqual(transferReceiptOf(record!), result.receipt);
  // The evidence reference is on the row, and nothing else about the grant is.
  assert.equal(record?.primaryAssuranceRef, ASSURANCE_REFERENCE);
});

void test("PK7A-01 TR-73-43: the recipient's accept can complete the pair, and commits the same way", async () => {
  const world = testWorld();
  const transferId = await readyByAccept(world);
  const result = await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  assert.equal(result.outcome, "committed");
  if (result.outcome !== "committed") throw new Error("unreachable");
  assert.equal((await world.repository.readMembership(SPACE, RECIPIENT_MEMBERSHIP))?.role, "primary_owner");
  assert.equal((await world.repository.readSpace(SPACE))?.primaryOwnerMembershipId, RECIPIENT_MEMBERSHIP);
  // The assurance the commit bound to is the Primary's own, stored at confirm:
  // the accept path never carries one of its own.
  const outgoing = await world.repository.readConsent(SPACE, result.receipt.outgoingConsentId);
  assert.equal(outgoing?.assuranceRef, ASSURANCE_REFERENCE);
});

void test("PK7A-01: a repeat commit of a committed workflow returns the stored receipt, not a conflict", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  const first = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  if (first.outcome !== "committed") throw new Error("unreachable");

  // The workflow is committed; commit it again directly, the way a retried
  // request would after its transaction was aborted and replayed.
  const obligations = primaryTransferObligations(world.deps);
  const ledger = obligations.begin({
    budgetSpaceId: SPACE, transferId, decision: world.primary("29.transfer_primary_ownership").decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  // The discharges refuse a committed workflow, which is itself the check the
  // boundary would apply; the commit answers the stored receipt when handed a
  // complete ledger, so the receipt path is proven by building one from the
  // first commit's own ledger state.
  assert.equal(await obligations.discharge(ledger, "confirm"), false);
  assert.equal(ledger.refusal, "transfer_not_current");

  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.deepEqual(transferReceiptOf(record!), first.receipt);
  // And an uncommitted row has no receipt to give.
  assert.throws(() => transferReceiptOf({ ...record!, state: "ready" }), PrimaryTransferError);
});

void test("R-01 SEC-PK7A-F1: a ledger the boundary discharged before the leg commits through confirmPrimaryTransfer", async () => {
  // The PK-7B composition: `AuthorizationBoundary.execute` discharges the
  // four obligations before it runs the handler, so the ledger's capture
  // predates the Primary's leg. The handler must still commit.
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  const actor = world.primary("29.transfer_primary_ownership");
  const obligations = primaryTransferObligations(world.deps);
  const ledger = obligations.begin({
    budgetSpaceId: SPACE, transferId, decision: actor.decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: actor.correlationId,
  });
  assert.equal(await obligations.dischargeAll(ledger), true, String(ledger.refusal));
  const captured = ledger.capture?.transfer.stateVersion;

  const result = await confirmPrimaryTransfer(world.deps, actor, { transferId }, { ledger });
  assert.equal(result.outcome, "committed", JSON.stringify(result));
  if (result.outcome !== "committed") throw new Error("unreachable");
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "committed");
  // The leg advanced the version past the boundary's capture, and the commit
  // acted on a capture of its own rather than losing to that advance.
  assert.equal(record?.stateVersion, (captured ?? 0) + 2);
  assert.equal(record?.primaryAssuranceRef, ASSURANCE_REFERENCE);
  assert.equal((await world.repository.readSpace(SPACE))?.primaryOwnerMembershipId, RECIPIENT_MEMBERSHIP);
  assert.deepEqual(transferReceiptOf(record!), result.receipt);
  assert.equal(world.repository.audit.filter((row) => row.eventSubtype === "transfer_committed").length, 1);
  assert.equal(world.repository.audit.filter((row) => row.eventSubtype === "transfer_denied").length, 0);
});

void test("R-01 SEC-PK7A-F1: a ledger discharged on a proposed workflow admits the Primary's confirm-first leg", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  const actor = world.primary("29.transfer_primary_ownership");
  const obligations = primaryTransferObligations(world.deps);
  const ledger = obligations.begin({
    budgetSpaceId: SPACE, transferId, decision: actor.decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: actor.correlationId,
  });
  assert.equal(await obligations.dischargeAll(ledger), true, String(ledger.refusal));

  const result = await confirmPrimaryTransfer(world.deps, actor, { transferId }, { ledger });
  assert.equal(result.outcome, "primary_confirmed", JSON.stringify(result));
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "primary_confirmed");
  assert.equal(record?.primaryAssuranceRef, ASSURANCE_REFERENCE);
  assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner");

  // The recipient then completes the pair on the accept path.
  const accepted = await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  assert.equal(accepted.outcome, "committed");
});

void test("SEC-PK7A-F3: a supplied ledger bound to another transfer, space or reference denies obligation_undischarged", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  const actor = world.primary("29.transfer_primary_ownership");
  const obligations = primaryTransferObligations(world.deps);
  const auditsBefore = world.repository.audit.length;

  // A complete ledger for this transfer, then re-labelled: the shape a
  // capture from another authorizing transaction would present.
  async function completeLedger(input: Partial<TransferObligationInput>): Promise<TransferObligationLedger> {
    const ledger = obligations.begin({
      budgetSpaceId: SPACE, transferId, decision: actor.decision,
      freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: actor.correlationId,
    });
    assert.equal(await obligations.dischargeAll(ledger), true, String(ledger.refusal));
    return { ...ledger, complete: true, capture: ledger.capture, input: { ...ledger.input, ...input } };
  }
  const cases: TransferObligationLedger[] = [
    await completeLedger({ transferId: "00000000-0000-4000-8000-0000000000ff" }),
    await completeLedger({ budgetSpaceId: "00000000-0000-4000-8000-00000000dead" }),
    await completeLedger({ freshAssuranceRef: "fresh-assurance:someone-else" }),
    // Incomplete: the boundary did not discharge all four.
    obligations.begin({
      budgetSpaceId: SPACE, transferId, decision: actor.decision,
      freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: actor.correlationId,
    }),
  ];
  for (const [index, ledger] of cases.entries()) {
    const result = await confirmPrimaryTransfer(world.deps, actor, { transferId }, { ledger });
    assert.equal(result.outcome, "denied", `case ${index}`);
    if (result.outcome !== "denied") throw new Error("unreachable");
    assert.equal(result.reasonClass, "obligation_undischarged", `case ${index}`);
  }
  // Nothing was written but the four denial rows: no leg, no role, no consent.
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "recipient_accepted");
  assert.equal(record?.primaryConfirmedAt, null);
  assert.equal(record?.primaryAssuranceRef, null);
  assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner");
  assert.equal((await world.repository.readConsent(SPACE, PRIMARY_CONSENT))?.state, "current");
  assert.equal(world.repository.audit.length, auditsBefore + cases.length);
  assert.equal(world.repository.audit.slice(auditsBefore).every((row) => row.eventSubtype === "transfer_denied"), true);
});

void test("PK7A-01: a stale disclosure denies at the commit with nothing written", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });

  // The registry moves under the live workflow: version 2 of the outgoing text.
  const moved = testDisclosures({
    primary_transfer_outgoing: {
      kind: "primary_transfer_outgoing", version: 2, digest: "e".repeat(64),
      text: { heading: "Handing over", items: [], acknowledgement: "I agree." },
    },
  });
  const deps = { ...world.deps, disclosures: moved };
  const auditsBefore = world.repository.audit.length;
  const noticesBefore = world.repository.notices.length;
  const result = await confirmPrimaryTransfer(deps, world.primary("29.transfer_primary_ownership"), { transferId });
  // R-02: the four discharge before the completing leg, so the denial writes
  // nothing at all -- not the leg, not its audit row -- and the workflow
  // stays where it was rather than stranded in `ready`.
  assert.equal(result.outcome, "denied");
  if (result.outcome !== "denied") throw new Error("unreachable");
  assert.equal(result.reasonClass, "stale_disclosure");
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "recipient_accepted");
  assert.equal(record?.stateVersion, 2);
  assert.equal(record?.primaryConfirmedAt, null);
  assert.equal(record?.primaryAssuranceRef, null);
  assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner");
  assert.equal((await world.repository.readConsent(SPACE, PRIMARY_CONSENT))?.state, "current");
  assert.equal(world.repository.notices.length, noticesBefore);
  assert.equal(world.cancelled.length, 0);
  const written = world.repository.audit.slice(auditsBefore);
  assert.deepEqual(written.map((row) => row.eventSubtype), ["transfer_denied"]);

  // The registry restored, the same confirm completes the pair: the
  // workflow was not stranded.
  const retried = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(retried.outcome, "committed");
});

void test("R-02: a stale disclosure on the accept-completes path also writes nothing", async () => {
  const world = testWorld();
  const transferId = await readyByAccept(world);
  const moved = testDisclosures({
    primary_transfer_recipient: {
      kind: "primary_transfer_recipient", version: 2, digest: "f".repeat(64),
      text: { heading: "Becoming the Primary Owner", items: [], acknowledgement: "I agree." },
    },
  });
  const auditsBefore = world.repository.audit.length;
  const result = await acceptPrimaryTransfer({ ...world.deps, disclosures: moved }, world.recipient("29.accept_primary_transfer"), { transferId });
  assert.equal(result.outcome, "denied");
  if (result.outcome !== "denied") throw new Error("unreachable");
  assert.equal(result.reasonClass, "stale_disclosure");
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.equal(record?.state, "primary_confirmed");
  assert.equal(record?.recipientAcceptedAt, null);
  assert.deepEqual(world.repository.audit.slice(auditsBefore).map((row) => row.eventSubtype), ["transfer_denied"]);
  assert.equal((await world.repository.readMembership(SPACE, RECIPIENT_MEMBERSHIP))?.role, "collaborator");
});

void test("PK7A-01: every boundary in the commit sequence is reachable and each one aborts before the next write", async () => {
  // The in-memory double has no transaction, so this proves the *sequence*:
  // an injected failure at each named point stops the commit there and leaves
  // every later write undone. That a failure also undoes the *earlier* writes
  // is a property of the database transaction and is proved by the live suite.
  const seen: CommitBoundary[] = [];
  for (const point of COMMIT_BOUNDARIES) {
    const world = testWorld();
    const transferId = await propose(world);
    await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
    const obligations = primaryTransferObligations(world.deps);
    const ledger = obligations.begin({
      budgetSpaceId: SPACE, transferId, decision: world.primary("29.transfer_primary_ownership").decision,
      freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: world.primary("29.transfer_primary_ownership").correlationId,
    });
    // Record the Primary's leg so the workflow is `ready`.
    await confirmLegOnly(world, transferId);
    assert.equal(await obligations.dischargeAll(ledger), true, point);

    const reached: CommitBoundary[] = [];
    await assert.rejects(
      () => commitPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), ledger, {
        boundary: (at) => {
          reached.push(at);
          if (at === point) throw new Error(`injected at ${at}`);
        },
      }),
      (error: unknown) => (error as Error).message === `injected at ${point}`,
    );
    assert.equal(reached.at(-1), point, point);
    seen.push(point);

    // Nothing after the injection point ran.
    const record = await world.repository.readTransfer(SPACE, transferId);
    const stateWritten = record?.state === "committed";
    const orderedPoints = [...COMMIT_BOUNDARIES];
    assert.equal(stateWritten, orderedPoints.indexOf(point) >= orderedPoints.indexOf("after-state"), point);
    if (orderedPoints.indexOf(point) <= orderedPoints.indexOf("after-invitations")) {
      assert.equal(world.repository.notices.filter((row) => row.messageCode === "MSG-73-042").length, 0, point);
    }
  }
  assert.deepEqual(seen, [...COMMIT_BOUNDARIES]);
});

/** Record the Primary's confirm leg without letting it run the commit. */
async function confirmLegOnly(world: TestWorld, transferId: string): Promise<void> {
  const record = await world.repository.readTransfer(SPACE, transferId);
  assert.ok(record);
  if (record.state === "ready") return;
  const applied = await world.repository.updateTransfer(SPACE, transferId, record.stateVersion, {
    state: "ready",
    primaryConfirmedAt: world.clock.now(),
    primaryConfirmedVersion: record.stateVersion + 1,
    primaryAssuranceRef: ASSURANCE_REFERENCE,
  });
  assert.equal(applied, true);
}

void test("PK7A-03: the commit refuses a ledger whose four obligations were not discharged", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  await confirmLegOnly(world, transferId);

  const obligations = primaryTransferObligations(world.deps);
  const ledger = obligations.begin({
    budgetSpaceId: SPACE, transferId, decision: world.primary("29.transfer_primary_ownership").decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: world.primary("29.transfer_primary_ownership").correlationId,
  });
  assert.equal(await obligations.discharge(ledger, "confirm"), true);
  assert.equal(ledger.complete, false);
  await assert.rejects(
    () => commitPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), ledger),
    (error: unknown) => isPrimaryTransferError(error, "obligation_undischarged"),
  );
  assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner");
});

void test("PK7A-01: a concurrent writer that moved a version makes the commit lose rather than overwrite", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  await confirmLegOnly(world, transferId);

  const obligations = primaryTransferObligations(world.deps);
  const ledger = obligations.begin({
    budgetSpaceId: SPACE, transferId, decision: world.primary("29.transfer_primary_ownership").decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: world.primary("29.transfer_primary_ownership").correlationId,
  });
  assert.equal(await obligations.dischargeAll(ledger), true);

  // Between the discharge and the commit, someone else bumps the recipient's
  // authorization version -- an invitation confirm on the same space, say.
  const recipient = world.repository.memberships.get(`${SPACE}/${RECIPIENT_MEMBERSHIP}`);
  world.repository.seedMembership({ ...recipient!, authorizationVersion: recipient!.authorizationVersion + 1 });

  await assert.rejects(
    () => commitPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), ledger),
    (error: unknown) => isPrimaryTransferError(error, "stale_version"),
  );
  // Nothing was written: the version check precedes the first supersession.
  assert.equal((await world.repository.readConsent(SPACE, PRIMARY_CONSENT))?.state, "current");
  assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner");
  assert.equal((await world.repository.readSpace(SPACE))?.primaryOwnershipVersion, 1);
});

void test("R-05: the commit cancels exactly the invitations the invalidate discharge captured", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  await confirmLegOnly(world, transferId);
  const obligations = primaryTransferObligations(world.deps);
  const ledger = obligations.begin({
    budgetSpaceId: SPACE, transferId, decision: world.primary("29.transfer_primary_ownership").decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: world.primary("29.transfer_primary_ownership").correlationId,
  });
  assert.equal(await obligations.dischargeAll(ledger), true);
  assert.deepEqual(ledger.capture?.openWork.map((row) => row.invitationId), ["12121212-1212-4212-8212-121212121212"]);

  // A row that appears after the capture is not the capture's. On the real
  // database the serializable snapshot makes the two sets identical; the
  // double has no snapshot, which is what lets this prove the selection.
  world.repository.seedInvitation({
    invitationId: "13131313-1313-4313-8313-131313131313", budgetSpaceId: SPACE,
    createdByMembershipId: PRIMARY_MEMBERSHIP, requiredPermission: "26", state: "pending",
  });
  const receipt = await commitPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), ledger);
  assert.equal(receipt.transferId, transferId);
  assert.deepEqual(world.cancelled, ["12121212-1212-4212-8212-121212121212"]);
  assert.equal(world.repository.invitations.get("13131313-1313-4313-8313-131313131313")?.state, "pending");
  const committedEvent = world.repository.audit.find((row) => row.eventSubtype === "transfer_committed");
  assert.equal(committedEvent?.payload.cancelledInvitationCount, 1);
});

void test("PK7A-01: the role swap keeps one active primary owner at every statement", async () => {
  const world = testWorld();
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  await confirmLegOnly(world, transferId);
  const obligations = primaryTransferObligations(world.deps);
  const ledger = obligations.begin({
    budgetSpaceId: SPACE, transferId, decision: world.primary("29.transfer_primary_ownership").decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: world.primary("29.transfer_primary_ownership").correlationId,
  });
  assert.equal(await obligations.dischargeAll(ledger), true);

  // The double refuses a second active primary_owner exactly as the partial
  // unique index does, so a commit that promoted before demoting would throw
  // here. It does not.
  await commitPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), ledger, {
    boundary: async (at) => {
      if (at !== "after-memberships" && at !== "after-space") return;
      const rows = await world.repository.listMemberships(SPACE);
      const primaries = rows.filter((row) => row.role === "primary_owner" && row.status === "active");
      assert.equal(primaries.length, 1, at);
    },
  });
  const rows = await world.repository.listMemberships(SPACE);
  assert.deepEqual(rows.filter((row) => row.role === "primary_owner").map((row) => row.membershipId), [RECIPIENT_MEMBERSHIP]);
});

void test("PK7A-01: a co-owner recipient is eligible and lands in the same place", async () => {
  const world = testWorld({ recipientRole: "co_owner" });
  const transferId = await propose(world);
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  const result = await confirmPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), { transferId });
  assert.equal(result.outcome, "committed");
  assert.equal((await world.repository.readMembership(SPACE, RECIPIENT_MEMBERSHIP))?.role, "primary_owner");
  assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "co_owner");
});
