/**
 * The Primary-transfer state service: `TR-73-40` propose, `TR-73-41` recipient
 * accept, `TR-73-42` Primary confirm, `TR-73-44` decline, `TR-73-45`
 * withdraw, the `TR-73-46` closures and the `TR-73-47` denials, plus the
 * status read (CBD-73 SS12; design proposal SS10.2).
 *
 * `TR-73-43` itself is `./commit.ts`, called from whichever of accept or
 * confirm completes the pair.
 *
 * ## Return, do not throw, anything whose write must commit (`PK5FIX`)
 *
 * `TR-73-47` writes exactly one `AE-73-25 transfer_denied` row and `TR-73-46`
 * writes one `transfer_expired`/`transfer_invalidated` row plus the workflow
 * mutation. Throwing either would roll that row back with the caller's
 * transaction and leave the workflow claiming a state the audit never
 * recorded, so both are **outcomes**: {@link TransferDenied} and
 * {@link TransferClosed}. A `PrimaryTransferError` is thrown only where
 * nothing has been written and nothing needs to be -- a malformed request, a
 * record that does not exist, and the commit's own preconditions -- or where
 * what was written must **not** stay: a completing leg whose commit then
 * refuses is thrown so the leg rolls back with it (`R-02`).
 *
 * ## The cell is required, not optional
 *
 * Every actor command requires `permission` and `actionCode` on the context
 * and answers `permission_mismatch` when either is absent. An omitted cell is
 * a route that did not decide, not a route that was allowed (`SEC-PK5-F02`,
 * `R-03`).
 *
 * ## Assurance
 *
 * `confirmPrimaryTransfer` requires `actor.freshAssuranceRef` -- the
 * reference the authorizing boundary produced *after* it spent the grant. The
 * module records and compares it and never reads an assurance itself
 * (`SEC-PK4-R2`).
 */
import { commitPrimaryTransfer, transferReceiptOf } from "./commit.ts";
import type { CommitOptions, TransferReceipt } from "./commit.ts";
import { NOTICE_EVENT_CODE, TRANSFER_EVENT_CODE, transferAuditEvent } from "./events.ts";
import { primaryTransferObligations } from "./obligations.ts";
import type { TransferObligationInput, TransferObligationLedger } from "./obligations.ts";
import {
  DEFAULT_TRANSFER_LIFETIMES, TRANSFER_PERMISSION,
} from "./ports.ts";
import type {
  ActorContext, PrimaryTransferDependencies, TransferActionCode, TransferLifetimes,
} from "./ports.ts";
import {
  ELIGIBLE_RECIPIENT_ROLES, EXPIRY_MESSAGE_CODE, INVALIDATION_MESSAGE_CODE, OUTGOING_DISCLOSURE_KIND,
  PRIMARY_TRANSFER_ERROR_CODES, PrimaryTransferError, RECIPIENT_DISCLOSURE_KIND, RECIPIENT_ROLE_AFTER, TRANSFER_MESSAGE_CODES,
  UNIFORM_DENIAL_MESSAGE_CODE, transferView,
} from "./records.ts";
import type {
  PrimaryTransferErrorCode, PrimaryTransferRecord, TransferMembershipRecord, TransferNoticeMessageCode, TransferState, TransferView,
} from "./records.ts";
import { assertTransferEdge } from "./transitions.ts";

export type { CommitBoundary, CommitOptions, TransferReceipt } from "./commit.ts";

function lifetimes(deps: PrimaryTransferDependencies): TransferLifetimes {
  return deps.lifetimes ?? DEFAULT_TRANSFER_LIFETIMES;
}

function plusSeconds(instant: string, seconds: number): string {
  return new Date(Date.parse(instant) + seconds * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Outcomes.
// ---------------------------------------------------------------------------

/** `TR-73-47`: a bounded denial that mutates no workflow. One `AE-73-25 transfer_denied` was written. */
export interface TransferDenied {
  readonly outcome: "denied";
  readonly messageCode: typeof UNIFORM_DENIAL_MESSAGE_CODE;
  readonly reasonClass: PrimaryTransferErrorCode;
}

/** `TR-73-46`: the workflow closed itself. The mutation and its `AE-73-25` are already written. */
export interface TransferClosed {
  readonly outcome: "expired" | "invalidated";
  readonly messageCode: typeof EXPIRY_MESSAGE_CODE | typeof INVALIDATION_MESSAGE_CODE;
  readonly transfer: TransferView;
}

export interface TransferProposed {
  readonly outcome: "proposed";
  readonly messageCode: string;
  readonly transfer: TransferView;
}

/** `TR-73-41`/`TR-73-42`: one leg recorded, the pair not yet complete or complete but not yet committed. */
export interface TransferLegRecorded {
  readonly outcome: "recipient_accepted" | "primary_confirmed" | "ready";
  readonly messageCode: string;
  readonly transfer: TransferView;
}

/** `TR-73-43` ran in this request. */
export interface TransferCommitted {
  readonly outcome: "committed";
  readonly messageCode: string;
  readonly transfer: TransferView;
  readonly receipt: TransferReceipt;
}

/** `TR-73-44`/`TR-73-45`. */
export interface TransferTerminated {
  readonly outcome: "declined" | "withdrawn";
  readonly messageCode: string;
  readonly transfer: TransferView;
}

export type ProposeResult = TransferProposed | TransferDenied;
export type AcceptResult = TransferLegRecorded | TransferCommitted | TransferClosed | TransferDenied;
export type ConfirmResult = TransferLegRecorded | TransferCommitted | TransferClosed | TransferDenied;
export type TerminateResult = TransferTerminated | TransferClosed | TransferDenied;
export type ViewResult = { readonly outcome: "view"; readonly transfer: TransferView } | TransferDenied;

// ---------------------------------------------------------------------------
// Requests.
// ---------------------------------------------------------------------------

export interface ProposeTransferRequest {
  readonly recipientMembershipId: string;
}

export interface TransferRequest {
  readonly transferId: string;
}

function requireUuidish(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 64) {
    throw new PrimaryTransferError("invalid_request", field);
  }
  return value;
}

export function parseProposeTransferRequest(body: unknown): ProposeTransferRequest {
  if (typeof body !== "object" || body === null) throw new PrimaryTransferError("invalid_request", "body");
  const record = body as Record<string, unknown>;
  return { recipientMembershipId: requireUuidish(record.recipientMembershipId, "recipientMembershipId") };
}

export function parseTransferRequest(transferId: unknown): TransferRequest {
  return { transferId: requireUuidish(transferId, "transferId") };
}

// ---------------------------------------------------------------------------
// The shared denial and closure bodies.
// ---------------------------------------------------------------------------

/**
 * `TR-73-47`. Writes exactly one `AE-73-25 transfer_denied` naming the safe
 * reason class and mutates nothing else, then returns the uniform outcome.
 */
async function deny(
  deps: PrimaryTransferDependencies, actor: ActorContext,
  reasonClass: PrimaryTransferErrorCode, transferId: string | null,
): Promise<TransferDenied> {
  await deps.repository.insertAudit(transferAuditEvent(deps, {
    budgetSpaceId: actor.budgetSpaceId,
    eventCode: TRANSFER_EVENT_CODE,
    eventSubtype: "transfer_denied",
    actorSubjectId: actor.subjectId,
    actingMembershipId: actor.membershipId,
    targetType: "primary_transfer",
    targetId: transferId,
    result: "deny",
    reasonClass,
    policyVersion: actor.decision.policyVersion,
    policyDigest: actor.decision.policyDigest,
    correlationId: actor.correlationId,
    audience: "customer",
    payload: transferId === null ? { outcomeClass: reasonClass } : { transferId, outcomeClass: reasonClass },
  }));
  return { outcome: "denied", messageCode: UNIFORM_DENIAL_MESSAGE_CODE, reasonClass };
}

/**
 * One mandatory lifecycle notice (`DR-73-11`, `IC-73-019`): the durable
 * `account_lifecycle_notice` row for the party's subject and its `AE-73-30`
 * enqueue child, in the causing transaction. `PK7A-F01`: until migration
 * `20260915T130001Z` widened the table's CHECK the transfer commands could
 * only audit these; now each writes the row it audits. The row is the
 * notice -- the prototype has no delivery -- and it carries a code only,
 * never copy and never the other party's state.
 */
async function enqueueNotice(
  deps: PrimaryTransferDependencies, actor: ActorContext, record: PrimaryTransferRecord,
  party: TransferMembershipRecord, messageCode: TransferNoticeMessageCode,
): Promise<void> {
  await deps.repository.insertNotice({
    noticeId: deps.ids.uuid(),
    accountSubjectId: party.accountSubjectId,
    budgetSpaceId: record.budgetSpaceId,
    messageCode,
    eventCorrelationId: actor.correlationId,
  });
  await deps.repository.insertAudit(transferAuditEvent(deps, {
    budgetSpaceId: record.budgetSpaceId,
    eventCode: NOTICE_EVENT_CODE,
    targetType: "notice",
    targetId: record.transferId,
    result: "system",
    correlationId: actor.correlationId,
    audience: "customer",
    payload: { transferId: record.transferId, membershipId: party.membershipId, messageCode, noticeCount: 1 },
  }));
}

/**
 * The two parties of a workflow, read for their subjects. Both rows exist
 * while the transfer row does (the M3 foreign keys), so a missing one is an
 * invariant failure, not an outcome.
 */
async function parties(
  deps: PrimaryTransferDependencies, record: PrimaryTransferRecord,
): Promise<{ readonly proposer: TransferMembershipRecord; readonly recipient: TransferMembershipRecord }> {
  const proposer = await deps.repository.readMembership(record.budgetSpaceId, record.proposerMembershipId);
  const recipient = await deps.repository.readMembership(record.budgetSpaceId, record.recipientMembershipId);
  if (!proposer || !recipient) throw new PrimaryTransferError("constraint_violation", "transfer.membership");
  return { proposer, recipient };
}

/**
 * `TR-73-46`. Mutates the workflow to `expired` or `invalidated`, writes one
 * `AE-73-25` with the matching subtype and, per party, one durable notice
 * row with its `AE-73-30` enqueue child, and returns the closure. It never
 * uses the denial message: this closure is a mutation and `MSG-73-046` is
 * reserved for the no-op.
 */
async function close(
  deps: PrimaryTransferDependencies, actor: ActorContext,
  record: PrimaryTransferRecord, to: "expired" | "invalidated", reasonClass: string,
): Promise<TransferClosed> {
  assertTransferEdge(record.state, to);
  const terminalEventId = deps.ids.uuid();
  const applied = await deps.repository.updateTransfer(record.budgetSpaceId, record.transferId, record.stateVersion, {
    state: to, terminalEventId,
  });
  if (!applied) throw new PrimaryTransferError("retryable_conflict", "transfer.stateVersion");
  await deps.repository.insertAudit(transferAuditEvent(deps, {
    eventId: terminalEventId,
    budgetSpaceId: record.budgetSpaceId,
    eventCode: TRANSFER_EVENT_CODE,
    eventSubtype: to === "expired" ? "transfer_expired" : "transfer_invalidated",
    targetType: "primary_transfer",
    targetId: record.transferId,
    result: "system",
    reasonClass,
    correlationId: actor.correlationId,
    audience: "customer",
    payload: { transferId: record.transferId, transferState: to, outcomeClass: reasonClass },
  }));
  // Exactly two notices and two AE-73-30 enqueue children (CBD-73 SS14,
  // AE-73-25 row), recipient first as the audit order was.
  const closureParties = await parties(deps, record);
  for (const party of [closureParties.recipient, closureParties.proposer]) {
    await enqueueNotice(deps, actor, record, party, to === "expired" ? EXPIRY_MESSAGE_CODE : INVALIDATION_MESSAGE_CODE);
  }
  const closed: PrimaryTransferRecord = { ...record, state: to, stateVersion: record.stateVersion + 1, terminalEventId };
  return {
    outcome: to,
    messageCode: to === "expired" ? EXPIRY_MESSAGE_CODE : INVALIDATION_MESSAGE_CODE,
    transfer: transferView(closed),
  };
}

/** The cell check every actor command runs first. */
function decidedCell(actor: ActorContext, expected: TransferActionCode): boolean {
  return actor.permission === TRANSFER_PERMISSION && actor.actionCode === expected;
}

interface LoadedWorkflow {
  readonly record: PrimaryTransferRecord;
  readonly proposer: TransferMembershipRecord;
  readonly recipient: TransferMembershipRecord;
}

/**
 * Load a live workflow and run `TR-73-46`'s own preconditions on it: expiry
 * first, then the three captured versions. Returns the closure or the denial
 * when either applies, so every command's happy path starts from a workflow
 * that is live, unexpired and version-current.
 *
 * `answerCommitted` (`R-03`): the two leg commands ask for a committed
 * workflow back rather than a denial, so that a retried accept or confirm
 * whose first response was lost can recover the receipt (`IC-73-015`
 * "recoverably idempotent"). A committed workflow is returned with both
 * memberships and **without** the liveness checks -- its versions moved when
 * it committed, which is not staleness -- and the caller answers it after
 * its own party check. Every other terminal state denies, on every command.
 */
async function loadLive(
  deps: PrimaryTransferDependencies, actor: ActorContext, transferId: string,
  options: { readonly answerCommitted?: boolean } = {},
): Promise<LoadedWorkflow | TransferClosed | TransferDenied> {
  const record = await deps.repository.readTransfer(actor.budgetSpaceId, transferId);
  if (!record) throw new PrimaryTransferError("transfer_not_found", "transferId");
  if (record.state === "committed" && options.answerCommitted === true) {
    const proposer = await deps.repository.readMembership(record.budgetSpaceId, record.proposerMembershipId);
    const recipient = await deps.repository.readMembership(record.budgetSpaceId, record.recipientMembershipId);
    if (!proposer || !recipient) return deny(deps, actor, "authorization_denied", record.transferId);
    return { record, proposer, recipient };
  }
  if (record.state === "committed" || record.state === "declined" || record.state === "withdrawn"
    || record.state === "expired" || record.state === "invalidated") {
    return deny(deps, actor, "transfer_not_current", record.transferId);
  }
  if (Date.parse(deps.clock.now()) >= Date.parse(record.expiresAt)) {
    return close(deps, actor, record, "expired", "expired");
  }
  const space = await deps.repository.readSpace(record.budgetSpaceId);
  if (!space) throw new PrimaryTransferError("budget_space_not_found", "budgetSpaceId");
  if (space.lifecycle !== "live") return deny(deps, actor, "budget_space_not_live", record.transferId);
  const proposer = await deps.repository.readMembership(record.budgetSpaceId, record.proposerMembershipId);
  const recipient = await deps.repository.readMembership(record.budgetSpaceId, record.recipientMembershipId);
  if (!proposer || !recipient) return deny(deps, actor, "authorization_denied", record.transferId);
  // TR-73-46: a version that moved after the proposal invalidates the
  // workflow rather than letting it commit against a stale picture.
  if (space.primaryOwnerMembershipId !== record.proposerMembershipId
    || space.primaryOwnershipVersion !== record.primaryOwnershipVersion
    || proposer.authorizationVersion !== record.proposerAuthorizationVersion
    || recipient.authorizationVersion !== record.recipientAuthorizationVersion
    || proposer.status !== "active" || recipient.status !== "active") {
    return close(deps, actor, record, "invalidated", "stale_version");
  }
  return { record, proposer, recipient };
}

function isOutcome(value: LoadedWorkflow | TransferClosed | TransferDenied): value is TransferClosed | TransferDenied {
  return "outcome" in value;
}

// ---------------------------------------------------------------------------
// TR-73-40: propose.
// ---------------------------------------------------------------------------

/**
 * The current Primary proposes a transfer to another active member.
 *
 * Every ineligible or stale target denies here **without a workflow row**
 * (`TR-73-47`): self, a member who is not active, a role this increment
 * cannot promote from, a proposer who is not the space's Primary, a stale
 * decision version, and a space that already has a live workflow.
 */
export async function proposePrimaryTransfer(
  deps: PrimaryTransferDependencies, actor: ActorContext, request: ProposeTransferRequest,
): Promise<ProposeResult> {
  if (!decidedCell(actor, "29.propose_primary_transfer")) return deny(deps, actor, "permission_mismatch", null);

  const space = await deps.repository.readSpace(actor.budgetSpaceId);
  if (!space) throw new PrimaryTransferError("budget_space_not_found", "budgetSpaceId");
  if (space.lifecycle !== "live") return deny(deps, actor, "budget_space_not_live", null);

  const proposer = await deps.repository.readMembership(actor.budgetSpaceId, actor.membershipId);
  if (!proposer || proposer.status !== "active") return deny(deps, actor, "authorization_denied", null);
  if (proposer.accountSubjectId !== actor.subjectId) return deny(deps, actor, "authorization_denied", null);
  if (proposer.role !== RECIPIENT_ROLE_AFTER || space.primaryOwnerMembershipId !== proposer.membershipId) {
    return deny(deps, actor, "proposer_not_primary", null);
  }
  if (proposer.authorizationVersion !== actor.decision.authorizationVersion) return deny(deps, actor, "stale_version", null);

  if (request.recipientMembershipId === proposer.membershipId) return deny(deps, actor, "self_transfer", null);
  const recipient = await deps.repository.readMembership(actor.budgetSpaceId, request.recipientMembershipId);
  if (!recipient || recipient.status !== "active") return deny(deps, actor, "recipient_ineligible", null);
  if (!ELIGIBLE_RECIPIENT_ROLES.includes(recipient.role)) return deny(deps, actor, "recipient_ineligible", null);
  if (recipient.accountSubjectId === proposer.accountSubjectId) return deny(deps, actor, "self_transfer", null);

  // One live workflow per space. The `M3` partial unique index is the last
  // line; refusing here gives the canonical outcome instead of a 23505.
  const live = await deps.repository.findLiveTransfer(actor.budgetSpaceId);
  if (live) return deny(deps, actor, "transfer_already_live", live.transferId);

  // Both disclosure kinds are read from the approved registry, server-side,
  // and captured on the row. A registry that moves afterwards makes the
  // commit's own currency check (SS10.3 step 2) deny `stale_disclosure`.
  let recipientDisclosure;
  let outgoingDisclosure;
  try {
    recipientDisclosure = deps.disclosures.current(RECIPIENT_DISCLOSURE_KIND);
    outgoingDisclosure = deps.disclosures.current(OUTGOING_DISCLOSURE_KIND);
  } catch {
    return deny(deps, actor, "stale_disclosure", null);
  }

  const now = deps.clock.now();
  const record: PrimaryTransferRecord = {
    transferId: deps.ids.uuid(),
    budgetSpaceId: actor.budgetSpaceId,
    proposerMembershipId: proposer.membershipId,
    recipientMembershipId: recipient.membershipId,
    proposerAuthorizationVersion: proposer.authorizationVersion,
    recipientAuthorizationVersion: recipient.authorizationVersion,
    primaryOwnershipVersion: space.primaryOwnershipVersion,
    recipientDisclosureKind: RECIPIENT_DISCLOSURE_KIND,
    recipientDisclosureVersion: recipientDisclosure.version,
    recipientDisclosureDigest: recipientDisclosure.digest,
    outgoingDisclosureKind: OUTGOING_DISCLOSURE_KIND,
    outgoingDisclosureVersion: outgoingDisclosure.version,
    outgoingDisclosureDigest: outgoingDisclosure.digest,
    state: "proposed",
    stateVersion: 1,
    expiresAt: plusSeconds(now, lifetimes(deps).transferSeconds),
    recipientAcceptedAt: null,
    recipientAcceptedVersion: null,
    primaryConfirmedAt: null,
    primaryConfirmedVersion: null,
    primaryAssuranceRef: null,
    committedAt: null,
    recipientConsentId: null,
    outgoingConsentId: null,
    terminalEventId: null,
    policyVersion: actor.decision.policyVersion,
    policyDigest: actor.decision.policyDigest,
  };
  await deps.repository.insertTransfer(record);
  await deps.repository.insertAudit(transferAuditEvent(deps, {
    budgetSpaceId: record.budgetSpaceId,
    eventCode: TRANSFER_EVENT_CODE,
    eventSubtype: "transfer_proposed",
    actorSubjectId: actor.subjectId,
    actingMembershipId: proposer.membershipId,
    targetType: "primary_transfer",
    targetId: record.transferId,
    result: "allow",
    policyVersion: actor.decision.policyVersion,
    policyDigest: actor.decision.policyDigest,
    correlationId: actor.correlationId,
    audience: "customer",
    payload: {
      transferId: record.transferId, transferState: "proposed",
      proposerMembershipId: proposer.membershipId, recipientMembershipId: recipient.membershipId,
      primaryOwnershipVersion: space.primaryOwnershipVersion,
      disclosureKind: RECIPIENT_DISCLOSURE_KIND, disclosureVersion: recipientDisclosure.version,
    },
  }));
  // One recipient notice and its AE-73-30 enqueue child (TR-73-40).
  await enqueueNotice(deps, actor, record, recipient, "MSG-73-040");
  return { outcome: "proposed", messageCode: TRANSFER_MESSAGE_CODES.proposed, transfer: transferView(record) };
}

// ---------------------------------------------------------------------------
// TR-73-41: recipient accept. TR-73-42: Primary confirm.
// ---------------------------------------------------------------------------

/** Where a leg lands given the state it arrives at. `ready` means the pair is complete. */
function legDestination(state: TransferState, leg: "recipient" | "primary"): TransferState {
  if (leg === "recipient") return state === "primary_confirmed" ? "ready" : "recipient_accepted";
  return state === "recipient_accepted" ? "ready" : "primary_confirmed";
}

async function recordLeg(
  deps: PrimaryTransferDependencies, actor: ActorContext, loaded: LoadedWorkflow,
  leg: "recipient" | "primary", assuranceRef: string | null,
): Promise<PrimaryTransferRecord> {
  const record = loaded.record;
  const to = legDestination(record.state, leg);
  assertTransferEdge(record.state, to);
  const now = deps.clock.now();
  const nextVersion = record.stateVersion + 1;
  const patch = leg === "recipient"
    ? { state: to, recipientAcceptedAt: now, recipientAcceptedVersion: nextVersion }
    : { state: to, primaryConfirmedAt: now, primaryConfirmedVersion: nextVersion, primaryAssuranceRef: assuranceRef };
  const applied = await deps.repository.updateTransfer(record.budgetSpaceId, record.transferId, record.stateVersion, patch);
  if (!applied) throw new PrimaryTransferError("retryable_conflict", "transfer.stateVersion");
  await deps.repository.insertAudit(transferAuditEvent(deps, {
    budgetSpaceId: record.budgetSpaceId,
    eventCode: TRANSFER_EVENT_CODE,
    eventSubtype: leg === "recipient" ? "recipient_accepted" : "primary_confirmed",
    actorSubjectId: actor.subjectId,
    actingMembershipId: actor.membershipId,
    targetType: "primary_transfer",
    targetId: record.transferId,
    result: "allow",
    policyVersion: actor.decision.policyVersion,
    policyDigest: actor.decision.policyDigest,
    correlationId: actor.correlationId,
    audience: "customer",
    payload: { transferId: record.transferId, transferState: to, stateVersion: nextVersion },
  }));
  return {
    ...record,
    state: to,
    stateVersion: nextVersion,
    ...(leg === "recipient"
      ? { recipientAcceptedAt: now, recipientAcceptedVersion: nextVersion }
      : { primaryConfirmedAt: now, primaryConfirmedVersion: nextVersion, primaryAssuranceRef: assuranceRef }),
  };
}

/**
 * The answer to a party's exact retry (`R-03`, `R-06`; CBD-73 `TR-73-41`,
 * `IC-73-015`): a committed workflow answers the receipt the row already is,
 * and a leg the party already recorded answers the prior conditional result
 * -- the current state and the leg's own message code. Neither writes: a
 * retry whose first response was lost is recovered, not denied and audited
 * as a second attempt.
 */
function committedAnswer(record: PrimaryTransferRecord): TransferCommitted {
  return {
    outcome: "committed",
    messageCode: TRANSFER_MESSAGE_CODES.committed,
    transfer: transferView(record),
    receipt: transferReceiptOf(record),
  };
}

function repeatedLegAnswer(record: PrimaryTransferRecord, leg: "recipient" | "primary"): TransferLegRecorded {
  const state = record.state as TransferLegRecorded["outcome"];
  return {
    outcome: state,
    messageCode: leg === "recipient" ? TRANSFER_MESSAGE_CODES.recipientAccepted : TRANSFER_MESSAGE_CODES.primaryConfirmed,
    transfer: transferView(record),
  };
}

/**
 * `TR-73-41`. The recipient accepts. If the Primary has already confirmed,
 * this completes the pair and `TR-73-43` runs in this request; the four
 * obligation discharges are run here through `dischargeAll`, because the
 * accept cell is not protected and PK-7B's boundary therefore discharges
 * nothing for it. The assurance reference the commit binds to is the one the
 * Primary's own confirm already stored on the row.
 *
 * A committed workflow answers its receipt and the recipient's own repeated
 * leg answers the prior result, both without writing (`R-03`, `R-06`).
 */
export async function acceptPrimaryTransfer(
  deps: PrimaryTransferDependencies, actor: ActorContext, request: TransferRequest,
  options: CommitOptions = {},
): Promise<AcceptResult> {
  if (!decidedCell(actor, "29.accept_primary_transfer")) return deny(deps, actor, "permission_mismatch", request.transferId);
  const loaded = await loadLive(deps, actor, request.transferId, { answerCommitted: true });
  if (isOutcome(loaded)) return loaded;
  if (loaded.recipient.membershipId !== actor.membershipId || loaded.recipient.accountSubjectId !== actor.subjectId) {
    return deny(deps, actor, "authorization_denied", request.transferId);
  }
  if (loaded.record.state === "committed") return committedAnswer(loaded.record);
  if (loaded.recipient.authorizationVersion !== actor.decision.authorizationVersion) {
    return deny(deps, actor, "stale_version", request.transferId);
  }
  if (loaded.record.recipientAcceptedAt !== null) return repeatedLegAnswer(loaded.record, "recipient");

  // The assurance reference the commit binds to is the one the Primary's own
  // confirm stored on the row; the accept path never carries one of its own.
  const assuranceRef = loaded.record.primaryAssuranceRef;
  if (legDestination(loaded.record.state, "recipient") === "ready") {
    if (assuranceRef === null) return deny(deps, actor, "assurance_required", request.transferId);
    const refused = await dischargeBeforeLeg(deps, actor, loaded.record, assuranceRef);
    if (refused) return refused;
  }

  const accepted = await recordLeg(deps, actor, loaded, "recipient", null);
  if (accepted.state !== "ready" || assuranceRef === null) {
    return { outcome: "recipient_accepted", messageCode: TRANSFER_MESSAGE_CODES.recipientAccepted, transfer: transferView(accepted) };
  }
  return runCommit(deps, actor, accepted, assuranceRef, options);
}

/**
 * `TR-73-42`. The current Primary confirms, under the protected cell.
 *
 * `actor.freshAssuranceRef` is required: it is the reference the boundary
 * produced when it spent the grant `decide` had already re-proved. When the
 * confirm completes the pair, `TR-73-43` runs in this request.
 *
 * `ledger` is PK-7B's own: the ledger `ApiTransactionStore` discharged the
 * four obligations on *before* this handler ran. It is the proof that the
 * four discharged before the effect, and it must be complete and bound to
 * this request's space, transfer and evidence reference or the command
 * denies `obligation_undischarged` before writing anything (`SEC-PK7A-F3`).
 * It is not the capture the commit acts on: the leg this command records
 * advances `stateVersion` past the boundary's capture, so the commit
 * discharges a fresh ledger on the same input after the leg and acts on that
 * (`R-01`, `SEC-PK7A-F1`).
 *
 * A committed workflow answers its receipt and the Primary's own repeated
 * leg answers the prior result, both without writing (`R-03`, `R-06`).
 */
export async function confirmPrimaryTransfer(
  deps: PrimaryTransferDependencies, actor: ActorContext, request: TransferRequest,
  options: CommitOptions & { readonly ledger?: TransferObligationLedger } = {},
): Promise<ConfirmResult> {
  if (!decidedCell(actor, "29.transfer_primary_ownership")) return deny(deps, actor, "permission_mismatch", request.transferId);
  const assuranceRef = actor.freshAssuranceRef;
  if (typeof assuranceRef !== "string" || assuranceRef.length === 0) {
    return deny(deps, actor, "assurance_required", request.transferId);
  }
  const loaded = await loadLive(deps, actor, request.transferId, { answerCommitted: true });
  if (isOutcome(loaded)) return loaded;
  if (loaded.proposer.membershipId !== actor.membershipId || loaded.proposer.accountSubjectId !== actor.subjectId) {
    return deny(deps, actor, "authorization_denied", request.transferId);
  }
  if (loaded.record.state === "committed") return committedAnswer(loaded.record);
  if (loaded.proposer.authorizationVersion !== actor.decision.authorizationVersion) {
    return deny(deps, actor, "stale_version", request.transferId);
  }
  if (loaded.record.primaryConfirmedAt !== null) return repeatedLegAnswer(loaded.record, "primary");

  // The pre-leg proof. The boundary's ledger is it when one is supplied;
  // otherwise, when this leg completes the pair, the four discharge here
  // before anything is written (`R-02`).
  if (options.ledger) {
    if (!ledgerBoundTo(options.ledger, actor, loaded.record, assuranceRef)) {
      return deny(deps, actor, "obligation_undischarged", request.transferId);
    }
  } else if (legDestination(loaded.record.state, "primary") === "ready") {
    const refused = await dischargeBeforeLeg(deps, actor, loaded.record, assuranceRef);
    if (refused) return refused;
  }

  const confirmed = await recordLeg(deps, actor, loaded, "primary", assuranceRef);
  if (confirmed.state !== "ready") {
    return { outcome: "primary_confirmed", messageCode: TRANSFER_MESSAGE_CODES.primaryConfirmed, transfer: transferView(confirmed) };
  }
  return runCommit(deps, actor, confirmed, assuranceRef, options);
}

/** The obligation input one request's discharges are begun on. */
function obligationInput(actor: ActorContext, record: PrimaryTransferRecord, assuranceRef: string): TransferObligationInput {
  return {
    budgetSpaceId: record.budgetSpaceId,
    transferId: record.transferId,
    decision: actor.decision,
    freshAssuranceRef: assuranceRef,
    correlationId: actor.correlationId,
  };
}

/**
 * `SEC-PK7A-F3`: a ledger supplied by the boundary serves this request only
 * if it is complete and was begun on this request's space, transfer and
 * evidence reference. A capture from another authorizing transaction --
 * another transfer, another space, another grant -- is not a discharge of
 * this one, whatever it captured.
 */
function ledgerBoundTo(
  ledger: TransferObligationLedger, actor: ActorContext, record: PrimaryTransferRecord, assuranceRef: string,
): boolean {
  return ledger.complete
    && ledger.input.budgetSpaceId === actor.budgetSpaceId
    && ledger.input.budgetSpaceId === record.budgetSpaceId
    && ledger.input.transferId === record.transferId
    && ledger.input.freshAssuranceRef === assuranceRef;
}

/** The refusal class a discharge left on its ledger, when it is one of this module's codes. */
function refusalClassOf(ledger: TransferObligationLedger): PrimaryTransferErrorCode {
  // The refusal class is the discharge's own, when it is one of this
  // module's codes: a stale disclosure has to say `stale_disclosure`
  // (SS10.3 step 2), not merely that some obligation did not discharge.
  const refusal = ledger.refusal;
  return refusal !== null && (PRIMARY_TRANSFER_ERROR_CODES as readonly string[]).includes(refusal)
    ? refusal as PrimaryTransferErrorCode
    : "obligation_undischarged";
}

/**
 * `R-02`: the in-module pre-leg proof. When the leg about to be recorded
 * completes the pair and no boundary ledger was supplied, the four
 * obligations are discharged *before* the leg, so that a refusal -- a
 * registry that moved under the workflow, say -- denies with **nothing**
 * written (design SS10.3 step 2) rather than committing the leg and
 * stranding the workflow in `ready`, from which nothing but expiry or
 * invalidation can leave.
 */
async function dischargeBeforeLeg(
  deps: PrimaryTransferDependencies, actor: ActorContext, record: PrimaryTransferRecord, assuranceRef: string,
): Promise<TransferDenied | null> {
  const obligations = primaryTransferObligations(deps);
  const ledger = obligations.begin(obligationInput(actor, record, assuranceRef));
  if (await obligations.dischargeAll(ledger)) return null;
  return deny(deps, actor, refusalClassOf(ledger), record.transferId);
}

/**
 * Run `TR-73-43` on a workflow that just became `ready`.
 *
 * The four obligations are discharged again here, on a fresh ledger begun on
 * this request's input, *after* the completing leg was recorded: the capture
 * the commit acts on then carries the leg's own `stateVersion`, which is the
 * one the commit's re-read has to agree with. The pre-leg proof -- the
 * boundary's ledger, required complete and bound (`ledgerBoundTo`), or the
 * in-module `dischargeBeforeLeg` -- is what makes a refusal here an anomaly
 * rather than an outcome: the same transaction proved the four a moment ago,
 * so a refusal now is thrown, and the leg rolls back with it instead of
 * leaving the workflow `ready` (`R-01`, `R-02`, `SEC-PK7A-F1`). Either way
 * the commit refuses unless all four are discharged.
 */
async function runCommit(
  deps: PrimaryTransferDependencies, actor: ActorContext, record: PrimaryTransferRecord,
  assuranceRef: string, options: CommitOptions,
): Promise<TransferCommitted> {
  const obligations = primaryTransferObligations(deps);
  const ledger = obligations.begin(obligationInput(actor, record, assuranceRef));
  if (!(await obligations.dischargeAll(ledger))) {
    throw new PrimaryTransferError(refusalClassOf(ledger), "obligations");
  }
  const commitOptions: CommitOptions = options.boundary ? { boundary: options.boundary } : {};
  const receipt = await commitPrimaryTransfer(deps, actor, ledger, commitOptions);
  const committed = await deps.repository.readTransfer(record.budgetSpaceId, record.transferId);
  return {
    outcome: "committed",
    messageCode: TRANSFER_MESSAGE_CODES.committed,
    transfer: transferView(committed ?? record),
    receipt,
  };
}

// ---------------------------------------------------------------------------
// TR-73-44 decline, TR-73-45 withdraw.
// ---------------------------------------------------------------------------

async function terminate(
  deps: PrimaryTransferDependencies, actor: ActorContext, loaded: LoadedWorkflow,
  to: "declined" | "withdrawn",
): Promise<TransferTerminated> {
  const { record } = loaded;
  assertTransferEdge(record.state, to);
  const terminalEventId = deps.ids.uuid();
  const applied = await deps.repository.updateTransfer(record.budgetSpaceId, record.transferId, record.stateVersion, {
    state: to, terminalEventId,
  });
  if (!applied) throw new PrimaryTransferError("retryable_conflict", "transfer.stateVersion");
  await deps.repository.insertAudit(transferAuditEvent(deps, {
    eventId: terminalEventId,
    budgetSpaceId: record.budgetSpaceId,
    eventCode: TRANSFER_EVENT_CODE,
    eventSubtype: to === "declined" ? "transfer_declined" : "transfer_withdrawn",
    actorSubjectId: actor.subjectId,
    actingMembershipId: actor.membershipId,
    targetType: "primary_transfer",
    targetId: record.transferId,
    result: "allow",
    policyVersion: actor.decision.policyVersion,
    policyDigest: actor.decision.policyDigest,
    correlationId: actor.correlationId,
    audience: "customer",
    payload: { transferId: record.transferId, transferState: to },
  }));
  // Exactly one notice and one AE-73-30 enqueue child, to the other party
  // (TR-73-44 tells the proposer, TR-73-45 tells the recipient).
  await enqueueNotice(
    deps, actor, record,
    to === "declined" ? loaded.proposer : loaded.recipient,
    to === "declined" ? "MSG-73-043" : "MSG-73-044",
  );
  const closed: PrimaryTransferRecord = { ...record, state: to, stateVersion: record.stateVersion + 1, terminalEventId };
  return {
    outcome: to,
    messageCode: to === "declined" ? TRANSFER_MESSAGE_CODES.declined : TRANSFER_MESSAGE_CODES.withdrawn,
    transfer: transferView(closed),
  };
}

/** `TR-73-44`. The recipient declines; no role changes and the workflow's evidence closes. */
export async function declinePrimaryTransfer(
  deps: PrimaryTransferDependencies, actor: ActorContext, request: TransferRequest,
): Promise<TerminateResult> {
  if (!decidedCell(actor, "29.decline_primary_transfer")) return deny(deps, actor, "permission_mismatch", request.transferId);
  const loaded = await loadLive(deps, actor, request.transferId);
  if (isOutcome(loaded)) return loaded;
  if (loaded.recipient.membershipId !== actor.membershipId || loaded.recipient.accountSubjectId !== actor.subjectId) {
    return deny(deps, actor, "authorization_denied", request.transferId);
  }
  return terminate(deps, actor, loaded, "declined");
}

/** `TR-73-45`. The Primary withdraws. Repeat is idempotent: a withdrawn workflow denies the uniform no-op. */
export async function withdrawPrimaryTransfer(
  deps: PrimaryTransferDependencies, actor: ActorContext, request: TransferRequest,
): Promise<TerminateResult> {
  if (!decidedCell(actor, "29.withdraw_primary_transfer")) return deny(deps, actor, "permission_mismatch", request.transferId);
  const loaded = await loadLive(deps, actor, request.transferId);
  if (isOutcome(loaded)) return loaded;
  if (loaded.proposer.membershipId !== actor.membershipId || loaded.proposer.accountSubjectId !== actor.subjectId) {
    return deny(deps, actor, "authorization_denied", request.transferId);
  }
  return terminate(deps, actor, loaded, "withdrawn");
}

// ---------------------------------------------------------------------------
// The status read.
// ---------------------------------------------------------------------------

/**
 * `29.view_primary_transfer`. Either party reads the workflow's status.
 *
 * The party check is the same one accept and decline run (`SEC-PK7A-F4`):
 * the acting membership must be one of the two parties, must be active, and
 * must belong to the acting subject. A membership id alone is not a party.
 *
 * It does not materialize an expiry: a read is not a mutation, and
 * `TR-73-46`'s closure is a mutating transition that belongs to the next
 * write. A timestamp-expired workflow therefore reads as what it is, and the
 * next command closes it.
 */
export async function viewPrimaryTransfer(
  deps: PrimaryTransferDependencies, actor: ActorContext, request: TransferRequest,
): Promise<ViewResult> {
  if (!decidedCell(actor, "29.view_primary_transfer")) return deny(deps, actor, "permission_mismatch", request.transferId);
  const record = await deps.repository.readTransfer(actor.budgetSpaceId, request.transferId);
  if (!record) throw new PrimaryTransferError("transfer_not_found", "transferId");
  if (record.proposerMembershipId !== actor.membershipId && record.recipientMembershipId !== actor.membershipId) {
    return deny(deps, actor, "authorization_denied", request.transferId);
  }
  const party = await deps.repository.readMembership(record.budgetSpaceId, actor.membershipId);
  if (!party || party.status !== "active" || party.accountSubjectId !== actor.subjectId) {
    return deny(deps, actor, "authorization_denied", request.transferId);
  }
  return { outcome: "view", transfer: transferView(record) };
}

/** The receipt a committed workflow already carries, for a repeat read of a committed transfer. */
export { transferReceiptOf };

// ---------------------------------------------------------------------------
// The pure query PK-7B needs (packet scope note; `IMPL-PK4-F2`).
// ---------------------------------------------------------------------------

/**
 * The membership resource leaves `apps/api/src/sessions/budget-facts.ts` has
 * to assemble for a `membership`-typed target.
 *
 * The transfer cells name `membership` as their resource type and the merged
 * datastore reader produces `resource.*` only for the space-set types and the
 * account, transaction and category row types, so `decide` denies
 * `input_invalid` for every one of them (`IMPL-PK4-F2`). That reader belongs
 * to PK-7B because `budget-facts.ts` is also being edited by PK-6; this
 * module exposes the query instead, so PK-7B adds a call rather than a read.
 *
 * It is a tenant-scoped read keyed on the acting space, as `SEC-PK4-R2`
 * requires, and it returns the four leaves and nothing else: no subject, no
 * consent, no personal state.
 */
export interface MembershipResourceLeaves {
  readonly type: "membership";
  readonly id: string;
  readonly owningSpaceId: string;
  /** `authorization_version`: the target version every transfer cell's `stale_version` family compares. */
  readonly version: number;
  /** The membership's own status, which is what `lifecycle_blocked` reads for a membership target. */
  readonly lifecycle: string;
}

export async function readMembershipResourceLeaves(
  deps: PrimaryTransferDependencies, budgetSpaceId: string, membershipId: string,
): Promise<MembershipResourceLeaves | null> {
  const membership = await deps.repository.readMembership(budgetSpaceId, membershipId);
  if (!membership || membership.budgetSpaceId !== budgetSpaceId) return null;
  return {
    type: "membership",
    id: membership.membershipId,
    owningSpaceId: membership.budgetSpaceId,
    version: membership.authorizationVersion,
    lifecycle: membership.status,
  };
}
