import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { acceptPrimaryTransfer, proposePrimaryTransfer } from "./application.ts";
import { commitPrimaryTransfer } from "./commit.ts";
import { LOST_PERMISSION, TRANSFER_OBLIGATION_KINDS, primaryTransferObligations } from "./obligations.ts";
import type { TransferObligationKind } from "./obligations.ts";
import {
  ASSURANCE_REFERENCE, PRIMARY_MEMBERSHIP, RECIPIENT_MEMBERSHIP, SPACE, testDisclosures, testWorld,
} from "./support.ts";
import type { TestWorld } from "./support.ts";

/** A workflow at `ready`, with the Primary's leg bound to {@link ASSURANCE_REFERENCE}. */
async function readyWorkflow(world: TestWorld): Promise<string> {
  const proposed = await proposePrimaryTransfer(world.deps, world.primary("29.propose_primary_transfer"), {
    recipientMembershipId: RECIPIENT_MEMBERSHIP,
  });
  if (proposed.outcome !== "proposed") throw new Error("propose failed");
  const transferId = proposed.transfer.transferId;
  await acceptPrimaryTransfer(world.deps, world.recipient("29.accept_primary_transfer"), { transferId });
  const record = await world.repository.readTransfer(SPACE, transferId);
  await world.repository.updateTransfer(SPACE, transferId, record!.stateVersion, {
    state: "ready",
    primaryConfirmedAt: world.clock.now(),
    primaryConfirmedVersion: record!.stateVersion + 1,
    primaryAssuranceRef: ASSURANCE_REFERENCE,
  });
  return transferId;
}

function ledgerFor(world: TestWorld, transferId: string, freshAssuranceRef = ASSURANCE_REFERENCE) {
  return primaryTransferObligations(world.deps).begin({
    budgetSpaceId: SPACE, transferId,
    decision: world.primary("29.transfer_primary_ownership").decision,
    freshAssuranceRef,
    correlationId: world.primary("29.transfer_primary_ownership").correlationId,
  });
}

void test("PK7A-03: the four discharges are exactly the cell's obligations beyond fresh_assurance", () => {
  assert.deepEqual([...TRANSFER_OBLIGATION_KINDS], ["confirm", "invalidate", "notify", "preserve"]);
  // The obligation kinds are the contract's own; naming them here and not in
  // a copied union is what keeps PK-7B's routing honest.
  const decision = readFileSync(
    new URL("../../../contracts/src/authorization/decision.ts", import.meta.url), "utf8",
  );
  for (const kind of TRANSFER_OBLIGATION_KINDS) {
    assert.ok(decision.includes(`kind: "${kind}"`), kind);
  }
  assert.equal(LOST_PERMISSION, "26");
});

void test("PK7A-03: all four discharge on a ready workflow, and the commit then runs", async () => {
  const world = testWorld();
  const transferId = await readyWorkflow(world);
  const obligations = primaryTransferObligations(world.deps);
  const ledger = ledgerFor(world, transferId);

  for (const kind of TRANSFER_OBLIGATION_KINDS) {
    assert.equal(await obligations.discharge(ledger, kind), true, kind);
  }
  assert.equal(ledger.complete, true);
  assert.equal(obligations.verify(ledger, [...TRANSFER_OBLIGATION_KINDS]), true);

  // What each discharge captured is what the commit acts on.
  const capture = ledger.capture;
  assert.ok(capture);
  assert.equal(capture.proposerConsent.membershipId, PRIMARY_MEMBERSHIP);
  assert.equal(capture.recipientConsent.membershipId, RECIPIENT_MEMBERSHIP);
  assert.deepEqual(capture.openWork.map((row) => row.requiredPermission), ["26"]);
  assert.equal(capture.notifySubjects.length, 2);
  assert.equal(capture.freshAssuranceRef, ASSURANCE_REFERENCE);

  // Nothing has been written by the discharges themselves.
  assert.equal(world.repository.notices.length, 0);
  assert.equal(world.cancelled.length, 0);
  assert.equal((await world.repository.readMembership(SPACE, PRIMARY_MEMBERSHIP))?.role, "primary_owner");

  const receipt = await commitPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), ledger);
  assert.equal(receipt.newPrimaryMembershipId, RECIPIENT_MEMBERSHIP);
});

void test("PK7A-03: confirm binds the evidence reference, and refuses evidence bound to something else", async () => {
  const world = testWorld();
  const transferId = await readyWorkflow(world);
  const obligations = primaryTransferObligations(world.deps);

  // A reference that is not the one the workflow recorded cannot discharge.
  const foreign = ledgerFor(world, transferId, "fresh-assurance:99999999-9999-4999-8999-999999999999");
  assert.equal(await obligations.discharge(foreign, "confirm"), false);
  assert.equal(foreign.refusal, "assurance_required");

  // An empty reference is not a reference.
  const empty = ledgerFor(world, transferId, "");
  assert.equal(await obligations.discharge(empty, "confirm"), false);
  assert.equal(empty.refusal, "assurance_required");

  // The workflow's own reference discharges.
  const own = ledgerFor(world, transferId);
  assert.equal(await obligations.discharge(own, "confirm"), true);
});

void test("PK7A-03: confirm refuses an expired or terminal workflow, and admits an unaccepted one (R-01, SEC-PK7A-F1)", async () => {
  const world = testWorld();
  const transferId = await readyWorkflow(world);
  const obligations = primaryTransferObligations(world.deps);

  world.clock.advanceSeconds(8 * 24 * 60 * 60);
  const expired = ledgerFor(world, transferId);
  assert.equal(await obligations.discharge(expired, "confirm"), false);
  assert.equal(expired.refusal, "transfer_not_current");
  world.clock.set("2026-09-15T12:00:00.000Z");

  // A terminal workflow has nothing left to confirm.
  const record = await world.repository.readTransfer(SPACE, transferId);
  await world.repository.updateTransfer(SPACE, transferId, record!.stateVersion, { state: "withdrawn", terminalEventId: "e" });
  const terminal = ledgerFor(world, transferId);
  assert.equal(await obligations.discharge(terminal, "confirm"), false);
  assert.equal(terminal.refusal, "transfer_not_current");

  // A workflow with no recipient leg discharges: the boundary runs this
  // before the handler records the Primary's leg, and a Primary-first
  // confirm has to reach the handler. Completeness of the pair is the
  // commit's precondition, not this discharge's.
  const other = testWorld();
  const proposed = await proposePrimaryTransfer(other.deps, other.primary("29.propose_primary_transfer"), {
    recipientMembershipId: RECIPIENT_MEMBERSHIP,
  });
  if (proposed.outcome !== "proposed") throw new Error("propose failed");
  const unaccepted = ledgerFor(other, proposed.transfer.transferId);
  assert.equal(await primaryTransferObligations(other.deps).discharge(unaccepted, "confirm"), true);
  assert.equal(unaccepted.refusal, null);
});

void test("PK7A-03: preserve captures both current consent rows and refuses a moved registry", async () => {
  const world = testWorld();
  const transferId = await readyWorkflow(world);
  assert.equal(await primaryTransferObligations(world.deps).discharge(ledgerFor(world, transferId), "preserve"), true);

  // The registry moved under the live workflow: nothing can be preserved
  // coherently, and the refusal happens before any row is superseded.
  const moved = {
    ...world.deps,
    disclosures: testDisclosures({
      primary_transfer_recipient: {
        kind: "primary_transfer_recipient", version: 4, digest: "f".repeat(64),
        text: { heading: "New", items: [], acknowledgement: "I agree." },
      },
    }),
  };
  const stale = primaryTransferObligations(moved).begin({
    budgetSpaceId: SPACE, transferId, decision: world.primary("29.transfer_primary_ownership").decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: world.primary("29.transfer_primary_ownership").correlationId,
  });
  assert.equal(await primaryTransferObligations(moved).discharge(stale, "preserve"), false);
  assert.equal(stale.refusal, "stale_disclosure");
  assert.equal((await world.repository.readCurrentConsent(SPACE, PRIMARY_MEMBERSHIP))?.state, "current");
});

void test("PK7A-03: invalidate refuses a proposer who is no longer the Primary, and a missing cancel path", async () => {
  const world = testWorld();
  const transferId = await readyWorkflow(world);

  // Someone else moved primary ownership meanwhile.
  const space = world.repository.spaces.get(SPACE);
  world.repository.seedSpace({ ...space!, primaryOwnerMembershipId: RECIPIENT_MEMBERSHIP });
  const drifted = ledgerFor(world, transferId);
  assert.equal(await primaryTransferObligations(world.deps).discharge(drifted, "invalidate"), false);
  assert.equal(drifted.refusal, "proposer_not_primary");
  world.repository.seedSpace(space!);

  // Composition without the PK-5 system cancel path cannot discharge
  // `invalidate` at all, rather than committing a transfer that leaves the
  // former Primary's permission-26 invitations usable.
  const { cancelPermissionLostInvitations, ...withoutCancel } = world.deps;
  void cancelPermissionLostInvitations;
  const noPath = primaryTransferObligations(withoutCancel).begin({
    budgetSpaceId: SPACE, transferId, decision: world.primary("29.transfer_primary_ownership").decision,
    freshAssuranceRef: ASSURANCE_REFERENCE, correlationId: world.primary("29.transfer_primary_ownership").correlationId,
  });
  assert.equal(await primaryTransferObligations(withoutCancel).discharge(noPath, "invalidate"), false);
  assert.equal(noPath.refusal, "constraint_violation");
});

void test("PK7A-03: notify refuses when either party's membership is not active", async () => {
  const world = testWorld();
  const transferId = await readyWorkflow(world);
  const recipient = world.repository.memberships.get(`${SPACE}/${RECIPIENT_MEMBERSHIP}`);
  world.repository.seedMembership({ ...recipient!, status: "removed", endedAt: "2026-09-15T11:00:00.000Z" });
  const ledger = ledgerFor(world, transferId);
  assert.equal(await primaryTransferObligations(world.deps).discharge(ledger, "notify"), false);
  assert.equal(ledger.refusal, "authorization_denied");
});

void test("PK7A-03: the discharges never read an assurance -- the reference is the only input", async () => {
  const world = testWorld();
  const transferId = await readyWorkflow(world);
  // The dependency bundle has no session, grant, assurance or clock-of-record
  // member a discharge could consult: the only assurance-shaped value in
  // reach is the reference on the ledger.
  assert.deepEqual(Object.keys(world.deps).sort(), [
    "cancelPermissionLostInvitations", "clock", "disclosures", "ids", "repository",
  ]);
  // And the repository port itself exposes no assurance read.
  const surface = Object.keys(world.repository).concat(
    Object.getOwnPropertyNames(Object.getPrototypeOf(world.repository)),
  );
  for (const member of surface) {
    assert.equal(/assurance|session|grant|step.?up/i.test(member), false, member);
  }
  // The one reference in play is the one the workflow stored, and the commit
  // writes it where SS10.3 step 5 says it goes -- the outgoing consent row.
  const ledger = ledgerFor(world, transferId);
  assert.equal(await primaryTransferObligations(world.deps).dischargeAll(ledger), true);
  const receipt = await commitPrimaryTransfer(world.deps, world.primary("29.transfer_primary_ownership"), ledger);
  const outgoing = await world.repository.readConsent(SPACE, receipt.outgoingConsentId);
  assert.equal(outgoing?.assuranceRef, ASSURANCE_REFERENCE);
  const recipientRow = await world.repository.readConsent(SPACE, receipt.recipientConsentId);
  assert.equal(recipientRow?.assuranceRef, null);
});

void test("PK7A-03: verify names only the kinds actually discharged", async () => {
  const world = testWorld();
  const transferId = await readyWorkflow(world);
  const obligations = primaryTransferObligations(world.deps);
  const ledger = ledgerFor(world, transferId);
  assert.equal(await obligations.discharge(ledger, "confirm"), true);
  assert.equal(obligations.verify(ledger, ["confirm"]), true);
  assert.equal(obligations.verify(ledger, ["confirm", "notify"]), false);
  assert.equal(ledger.complete, false);
  const unknown = "audit" as unknown as TransferObligationKind;
  await assert.rejects(() => obligations.discharge(ledger, unknown));
});
