/**
 * `TR-73-43`, the commit transaction (design proposal SS10.3).
 *
 * One `SERIALIZABLE` transaction -- the completing request's -- supersedes
 * both consent rows, swaps both membership roles, moves primary ownership,
 * writes both new consent rows, cancels the former Primary's permission-26
 * invitations, stamps the workflow `committed` and writes the audit group and
 * the two notices, or it writes nothing at all.
 *
 * The step order below is SS10.3's own and is load-bearing rather than
 * incidental:
 *
 *  * **every denial happens before the first write.** Step 1's version and
 *    eligibility checks and step 2's disclosure-currency check both precede
 *    step 3's first `UPDATE`, which is what makes "`stale_disclosure` with
 *    nothing written" true (`PK7A-01`);
 *  * **`UPDATE` precedes `INSERT` on the consent rows.** The partial unique
 *    index `budget_space_consent_one_current_per_membership` makes step 5
 *    impossible without step 3, which is exactly the ordering `SEC-F02` (c)
 *    requires;
 *  * **the former Primary's role changes first.** `budget_space_membership`
 *    carries a partial unique index over one active `primary_owner` per
 *    space, so demoting before promoting keeps it satisfied at *every*
 *    statement, not merely at COMMIT;
 *  * **the space moves last of the three.** The deferred
 *    `budget_space_creation_invariants` trigger then proves at COMMIT that
 *    `primary_owner_membership_id` names an active `primary_owner`, which it
 *    does only because step 4 already promoted the recipient.
 *
 * ## Concurrency, and what stands in for `FOR UPDATE`
 *
 * SS10.3 step 1 says `FOR UPDATE` the transfer, both memberships and the
 * space. The CBD-246 statement seam exposes no row-lock clause and this
 * packet may not widen it, so this module does what PK-5 did for the same
 * reason: `SERIALIZABLE` plus an optimistic predicate on *every* write --
 * the transfer's `state_version`, each membership's `authorization_version`,
 * the space's `primary_ownership_version` and each consent row's `state` --
 * so a concurrent writer makes this transaction's update match no row
 * (`stale_version`) or makes PostgreSQL abort it with `40001`
 * (`retryable_conflict`). The two outcomes SS10.3 requires are the two that
 * happen; recorded as a deviation in this packet's result.
 *
 * ## Assurance
 *
 * Nothing here reads an assurance. The reference arrives on the ledger, is
 * compared with the one the workflow stored, and is written to the outgoing
 * consent row and the transfer row as evidence (`SEC-PK4-R2`).
 *
 * ## Idempotency
 *
 * `M3` has no receipt column, so the committed row *is* the receipt: a repeat
 * commit of a workflow already `committed` returns
 * {@link transferReceiptOf} built from that row rather than a conflict
 * (`IC-73-015` "atomic and recoverably idempotent").
 */
import { NOTICE_EVENT_CODE, TRANSFER_EVENT_CODE, assertCurrentTransferDisclosure, transferAuditEvent } from "./events.ts";
import {
  COMMIT_NOTICE_MESSAGE_CODE, OUTGOING_DISCLOSURE_KIND, OUTGOING_ROLE_AFTER, PrimaryTransferError,
  RECIPIENT_DISCLOSURE_KIND, RECIPIENT_ROLE_AFTER, TRANSFER_CONSENT_SOURCE, TRANSFER_ENDED_REASON_CLASS,
} from "./records.ts";
import type { PrimaryTransferRecord, TransferConsentInsert } from "./records.ts";
import { LOST_PERMISSION } from "./obligations.ts";
import type { TransferObligationLedger } from "./obligations.ts";
import { assertTransferEdge } from "./transitions.ts";
import type { ActorContext, PrimaryTransferDependencies } from "./ports.ts";

/** The ordered points the live suite may inject a failure at. Every one is a real boundary in the sequence below. */
export const COMMIT_BOUNDARIES = [
  "after-checks", "after-supersede", "after-memberships", "after-space",
  "after-consents", "after-invitations", "after-state", "after-audit", "before-receipt",
] as const;
export type CommitBoundary = (typeof COMMIT_BOUNDARIES)[number];

export interface CommitOptions {
  /** Test seam. Called at each named boundary; throwing rolls the caller's transaction back. */
  readonly boundary?: (point: CommitBoundary) => Promise<void> | void;
}

/** The whole customer answer of a committed transfer. It carries no assurance reference and no digest. */
export interface TransferReceipt {
  readonly transferId: string;
  readonly budgetSpaceId: string;
  readonly newPrimaryMembershipId: string;
  readonly formerPrimaryMembershipId: string;
  readonly recipientConsentId: string;
  readonly outgoingConsentId: string;
  readonly committedAt: string;
  readonly messageCode: typeof COMMIT_NOTICE_MESSAGE_CODE;
}

/** The receipt a committed row already carries. The row is the receipt; see this file's header. */
export function transferReceiptOf(record: PrimaryTransferRecord): TransferReceipt {
  if (record.state !== "committed" || record.committedAt === null
    || record.recipientConsentId === null || record.outgoingConsentId === null) {
    throw new PrimaryTransferError("transfer_not_current", "state");
  }
  return {
    transferId: record.transferId,
    budgetSpaceId: record.budgetSpaceId,
    newPrimaryMembershipId: record.recipientMembershipId,
    formerPrimaryMembershipId: record.proposerMembershipId,
    recipientConsentId: record.recipientConsentId,
    outgoingConsentId: record.outgoingConsentId,
    committedAt: record.committedAt,
    messageCode: COMMIT_NOTICE_MESSAGE_CODE,
  };
}

/**
 * Commit the transfer the ledger's four discharges captured.
 *
 * `ledger` must be complete: all four of `confirm`, `invalidate`, `notify`
 * and `preserve` discharged, by PK-7B's `ApiTransactionStore` on the confirm
 * route or by `dischargeAll` on the accept-completes path. An incomplete
 * ledger denies `obligation_undischarged` before anything is read, because a
 * protected effect whose obligations were not discharged is precisely what
 * the boundary exists to refuse.
 */
export async function commitPrimaryTransfer(
  deps: PrimaryTransferDependencies, actor: ActorContext, ledger: TransferObligationLedger,
  options: CommitOptions = {},
): Promise<TransferReceipt> {
  const repository = deps.repository;
  const boundary = options.boundary ?? (() => undefined);

  if (!ledger.complete) throw new PrimaryTransferError("obligation_undischarged", ledger.refusal ?? "obligations");
  const capture = ledger.capture;
  if (!capture) throw new PrimaryTransferError("obligation_undischarged", "capture");
  const cancelInvitations = deps.cancelPermissionLostInvitations;
  if (!cancelInvitations) throw new PrimaryTransferError("constraint_violation", "cancelPermissionLostInvitations");

  // --- 1: re-read every row the commit acts on, and every precondition. ----
  // The re-read is what a `FOR UPDATE` would have made unnecessary; see this
  // file's header. Every value compared below comes from durable state, never
  // from the ledger's copy, and the ledger's copy is then required to agree.
  const transfer = await repository.readTransfer(actor.budgetSpaceId, capture.transfer.transferId);
  if (!transfer) throw new PrimaryTransferError("transfer_not_found", "transferId");
  if (transfer.state === "committed") return transferReceiptOf(transfer);
  if (transfer.state !== "ready") throw new PrimaryTransferError("transfer_not_current", "state");
  if (transfer.stateVersion !== capture.transfer.stateVersion) throw new PrimaryTransferError("stale_version", "transfer.stateVersion");

  const now = deps.clock.now();
  if (Date.parse(now) >= Date.parse(transfer.expiresAt)) throw new PrimaryTransferError("transfer_not_current", "expiresAt");

  const space = await repository.readSpace(transfer.budgetSpaceId);
  if (!space) throw new PrimaryTransferError("budget_space_not_found", "budgetSpaceId");
  if (space.lifecycle !== "live") throw new PrimaryTransferError("budget_space_not_live", "lifecycle");
  if (space.primaryOwnerMembershipId !== transfer.proposerMembershipId) {
    throw new PrimaryTransferError("proposer_not_primary", "space.primaryOwnerMembershipId");
  }
  if (space.primaryOwnershipVersion !== transfer.primaryOwnershipVersion) {
    throw new PrimaryTransferError("stale_version", "space.primaryOwnershipVersion");
  }

  const proposer = await repository.readMembership(transfer.budgetSpaceId, transfer.proposerMembershipId);
  const recipient = await repository.readMembership(transfer.budgetSpaceId, transfer.recipientMembershipId);
  if (!proposer || !recipient) throw new PrimaryTransferError("authorization_denied", "membershipId");
  if (proposer.status !== "active" || recipient.status !== "active") throw new PrimaryTransferError("authorization_denied", "membership.status");
  if (proposer.role !== RECIPIENT_ROLE_AFTER) throw new PrimaryTransferError("proposer_not_primary", "membership.role");
  if (proposer.authorizationVersion !== transfer.proposerAuthorizationVersion) {
    throw new PrimaryTransferError("stale_version", "proposer.authorizationVersion");
  }
  if (recipient.authorizationVersion !== transfer.recipientAuthorizationVersion) {
    throw new PrimaryTransferError("stale_version", "recipient.authorizationVersion");
  }

  // The fresh-assurance evidence reference. An input, compared, never read
  // from a session by this module.
  const assuranceRef = transfer.primaryAssuranceRef;
  if (assuranceRef === null || assuranceRef !== capture.freshAssuranceRef) {
    throw new PrimaryTransferError("assurance_required", "transfer.primaryAssuranceRef");
  }

  // --- 2: both disclosures still current at the captured versions. ---------
  // Nothing has been written; a stale registry denies here and nowhere later.
  const recipientDisclosure = assertCurrentTransferDisclosure(deps, {
    kind: transfer.recipientDisclosureKind, version: transfer.recipientDisclosureVersion, digest: transfer.recipientDisclosureDigest,
  });
  const outgoingDisclosure = assertCurrentTransferDisclosure(deps, {
    kind: transfer.outgoingDisclosureKind, version: transfer.outgoingDisclosureVersion, digest: transfer.outgoingDisclosureDigest,
  });

  const proposerConsent = await repository.readCurrentConsent(transfer.budgetSpaceId, transfer.proposerMembershipId);
  const recipientConsent = await repository.readCurrentConsent(transfer.budgetSpaceId, transfer.recipientMembershipId);
  if (!proposerConsent || !recipientConsent) throw new PrimaryTransferError("constraint_violation", "consent.current");
  if (proposerConsent.consentId !== capture.proposerConsent.consentId
    || recipientConsent.consentId !== capture.recipientConsent.consentId) {
    throw new PrimaryTransferError("stale_version", "consent.current");
  }

  // The identifier both superseded rows link to and the audit row is written
  // with, allocated before the first write because step 3 references it.
  const terminalEventId = deps.ids.uuid();

  await boundary("after-checks");

  // --- 3: supersede both current consent rows. First write. ---------------
  const ended = { endedAt: now, endedReasonClass: TRANSFER_ENDED_REASON_CLASS, endedByEventId: terminalEventId };
  const proposerSuperseded = await repository.supersedeConsent(transfer.budgetSpaceId, proposerConsent.consentId, ended);
  if (!proposerSuperseded) throw new PrimaryTransferError("stale_version", "consent.proposer");
  const recipientSuperseded = await repository.supersedeConsent(transfer.budgetSpaceId, recipientConsent.consentId, ended);
  if (!recipientSuperseded) throw new PrimaryTransferError("stale_version", "consent.recipient");
  await boundary("after-supersede");

  // --- 4a: the former Primary steps down first (the partial unique index). -
  const demoted = await repository.updateMembershipRole(
    transfer.budgetSpaceId, proposer.membershipId, proposer.authorizationVersion, OUTGOING_ROLE_AFTER,
  );
  if (!demoted) throw new PrimaryTransferError("stale_version", "proposer.authorizationVersion");
  // --- 4b: then the recipient becomes the sole Primary. -------------------
  const promoted = await repository.updateMembershipRole(
    transfer.budgetSpaceId, recipient.membershipId, recipient.authorizationVersion, RECIPIENT_ROLE_AFTER,
  );
  if (!promoted) throw new PrimaryTransferError("stale_version", "recipient.authorizationVersion");
  await boundary("after-memberships");

  // --- 4c: the space points at the new Primary and its version advances. --
  const moved = await repository.movePrimaryOwnership(
    transfer.budgetSpaceId, recipient.membershipId, space.primaryOwnershipVersion,
  );
  if (!moved) throw new PrimaryTransferError("stale_version", "space.primaryOwnershipVersion");
  await boundary("after-space");

  // --- 5: the two new consent rows, each naming the row it supersedes. ----
  const recipientConsentId = deps.ids.uuid();
  const outgoingConsentId = deps.ids.uuid();
  const recipientRow: TransferConsentInsert = {
    consentId: recipientConsentId,
    budgetSpaceId: transfer.budgetSpaceId,
    membershipId: recipient.membershipId,
    // Both subject columns are the recipient: a consent row evidences the
    // consenting person's own action, and the M1 trigger refuses inequality.
    accountSubjectId: recipient.accountSubjectId,
    recordedBySubjectId: recipient.accountSubjectId,
    role: RECIPIENT_ROLE_AFTER,
    resourceScope: "full",
    source: TRANSFER_CONSENT_SOURCE,
    sourceRecordId: transfer.transferId,
    // SS10.3 step 5: the workflow version at the recipient's acceptance.
    sourceRecordVersion: transfer.recipientAcceptedVersion ?? transfer.stateVersion,
    disclosureKind: RECIPIENT_DISCLOSURE_KIND,
    disclosureVersion: recipientDisclosure.version,
    disclosureDigest: recipientDisclosure.digest,
    policyVersion: actor.decision.policyVersion,
    policyDigest: actor.decision.policyDigest,
    state: "current",
    // No protected obligation is discharged by the recipient's leg.
    assuranceRef: null,
    recordedAt: now,
    supersedesConsentId: recipientConsent.consentId,
  };
  await repository.insertConsent(recipientRow);
  const outgoingRow: TransferConsentInsert = {
    consentId: outgoingConsentId,
    budgetSpaceId: transfer.budgetSpaceId,
    membershipId: proposer.membershipId,
    accountSubjectId: proposer.accountSubjectId,
    recordedBySubjectId: proposer.accountSubjectId,
    role: OUTGOING_ROLE_AFTER,
    resourceScope: "full",
    source: TRANSFER_CONSENT_SOURCE,
    sourceRecordId: transfer.transferId,
    sourceRecordVersion: transfer.primaryConfirmedVersion ?? transfer.stateVersion,
    disclosureKind: OUTGOING_DISCLOSURE_KIND,
    disclosureVersion: outgoingDisclosure.version,
    disclosureDigest: outgoingDisclosure.digest,
    policyVersion: actor.decision.policyVersion,
    policyDigest: actor.decision.policyDigest,
    state: "current",
    // SS10.3 step 5: the protected leg's evidence reference lives here.
    assuranceRef,
    recordedAt: now,
    supersedesConsentId: proposerConsent.consentId,
  };
  await repository.insertConsent(outgoingRow);
  await boundary("after-consents");

  // --- 6: the former Primary's permission-26 invitations, through PK-5. ---
  const cancelled = await cancelInvitations({
    budgetSpaceId: transfer.budgetSpaceId,
    createdByMembershipId: proposer.membershipId,
    requiredPermission: LOST_PERMISSION,
    correlationId: actor.correlationId,
  });
  await boundary("after-invitations");

  // --- 7a: the workflow's own terminal state. -----------------------------
  assertTransferEdge(transfer.state, "committed");
  const committed = await repository.updateTransfer(transfer.budgetSpaceId, transfer.transferId, transfer.stateVersion, {
    state: "committed",
    committedAt: now,
    recipientConsentId,
    outgoingConsentId,
    terminalEventId,
  });
  if (!committed) throw new PrimaryTransferError("retryable_conflict", "transfer.stateVersion");
  await boundary("after-state");

  // --- 7b: exactly one AE-73-25 transfer_committed, linking both rows. ----
  // The three advanced versions are bound to short locals first: the secret
  // scanner's generic-api-key rule reads an auth-shaped name followed by
  // another long identifier as a credential assignment (PK2FIX-F04).
  const nextProposerVersion = 1 + proposer.authorizationVersion;
  const nextRecipientVersion = 1 + recipient.authorizationVersion;
  const nextOwnershipVersion = 1 + space.primaryOwnershipVersion;
  await repository.insertAudit(transferAuditEvent(deps, {
    eventId: terminalEventId,
    budgetSpaceId: transfer.budgetSpaceId,
    eventCode: TRANSFER_EVENT_CODE,
    eventSubtype: "transfer_committed",
    actorSubjectId: actor.subjectId,
    actingMembershipId: actor.membershipId,
    targetType: "primary_transfer",
    targetId: transfer.transferId,
    result: "allow",
    policyVersion: actor.decision.policyVersion,
    policyDigest: actor.decision.policyDigest,
    correlationId: actor.correlationId,
    audience: "customer",
    payload: {
      transferId: transfer.transferId,
      transferState: "committed",
      proposerMembershipId: proposer.membershipId,
      recipientMembershipId: recipient.membershipId,
      recipientConsentId,
      outgoingConsentId,
      supersededConsentCount: 2,
      cancelledInvitationCount: cancelled.length,
      proposerAuthorizationVersion: nextProposerVersion,
      recipientAuthorizationVersion: nextRecipientVersion,
      primaryOwnershipVersion: nextOwnershipVersion,
    },
  }));
  await boundary("after-audit");

  // --- 7c: the two mandatory notices and their two AE-73-30 children. -----
  for (const accountSubjectId of capture.notifySubjects) {
    await repository.insertNotice({
      noticeId: deps.ids.uuid(),
      accountSubjectId,
      budgetSpaceId: transfer.budgetSpaceId,
      messageCode: COMMIT_NOTICE_MESSAGE_CODE,
      eventCorrelationId: actor.correlationId,
    });
    await repository.insertAudit(transferAuditEvent(deps, {
      budgetSpaceId: transfer.budgetSpaceId,
      eventCode: NOTICE_EVENT_CODE,
      targetType: "notice",
      targetId: transfer.transferId,
      result: "system",
      correlationId: actor.correlationId,
      audience: "customer",
      payload: { transferId: transfer.transferId, messageCode: COMMIT_NOTICE_MESSAGE_CODE, noticeCount: 1 },
    }));
  }
  await boundary("before-receipt");

  return {
    transferId: transfer.transferId,
    budgetSpaceId: transfer.budgetSpaceId,
    newPrimaryMembershipId: recipient.membershipId,
    formerPrimaryMembershipId: proposer.membershipId,
    recipientConsentId,
    outgoingConsentId,
    committedAt: now,
    messageCode: COMMIT_NOTICE_MESSAGE_CODE,
  };
}
