/**
 * The four obligation discharges the protected cell
 * `29.transfer_primary_ownership` carries beyond `fresh_assurance`
 * (`SEC-PK4-R2`; `IMPL-PK4-F2`; design proposal SS11.2 row 29).
 *
 * The cell's obligation list is `fresh_assurance`, `confirm`, `audit`,
 * `invalidate`, `recheck_at_commit`. `audit` and `recheck_at_commit` are free
 * in `ApiTransactionStore` already; `fresh_assurance` is PK-4's and is spent
 * before anything here runs. `notify` and `preserve` are the two further
 * discharges the design's own transfer semantics require and that PK-4's
 * finding names, and they are implemented here beside the other two so that
 * PK-7B routes one object for all four.
 *
 * ## Why these are captures rather than writes
 *
 * `AuthorizationBoundary.execute` discharges obligations **before** it runs
 * the handler, and the handler is what commits `TR-73-43`. An `invalidate`
 * that cancelled invitations before the transfer committed, or a `notify`
 * that wrote notices for a commit that then denied, would be a lie in the
 * common case where a later step refuses. So each discharge here does the
 * half that *can* be done before the effect: it proves its own precondition
 * against durable state and captures exactly the rows the commit will act on.
 * {@link commitPrimaryTransfer} then refuses to run unless all four were
 * discharged, and performs the captured effects inside the same transaction.
 * A failure anywhere rolls back the whole transaction, the grant included --
 * which is the property `SEC-PK4-R2` asks for.
 *
 * ## Assurance
 *
 * `freshAssuranceRef` is an input. This module never reads a session, a grant
 * or an assurance level; it compares the reference it was given with the one
 * the workflow already stored and records it on the outgoing consent row and
 * the transfer row. The `confirm` discharge is the one that binds them.
 */
import { assertCurrentTransferDisclosure } from "./events.ts";
import { PrimaryTransferError } from "./records.ts";
import type {
  PrimaryTransferRecord, TransferConsentRecord, TransferMembershipRecord, TransferSpaceFacts,
} from "./records.ts";
import type {
  PermissionLostInvitation, PolicyDecision, PrimaryTransferDependencies,
} from "./ports.ts";

/** The four kinds this module discharges. `audit` and `recheck_at_commit` stay free; `fresh_assurance` is PK-4's. */
export const TRANSFER_OBLIGATION_KINDS = ["confirm", "invalidate", "notify", "preserve"] as const;
export type TransferObligationKind = (typeof TRANSFER_OBLIGATION_KINDS)[number];

/** The permission the former Primary loses at commit, and whose open invitations `invalidate` must close. */
export const LOST_PERMISSION = "26";

/**
 * What PK-7B hands the discharges: the allow decision and the fresh-assurance
 * evidence reference, exactly the way PK-5 takes the owner decision.
 */
export interface TransferObligationInput {
  readonly budgetSpaceId: string;
  readonly transferId: string;
  readonly decision: PolicyDecision;
  /** The reference to the evidence the boundary spent. Never the evidence. */
  readonly freshAssuranceRef: string;
  readonly correlationId: string;
}

/** Everything a discharge captured, for the commit to act on and to re-verify. */
export interface TransferCapture {
  readonly transfer: PrimaryTransferRecord;
  readonly space: TransferSpaceFacts;
  readonly proposer: TransferMembershipRecord;
  readonly recipient: TransferMembershipRecord;
  readonly proposerConsent: TransferConsentRecord;
  readonly recipientConsent: TransferConsentRecord;
  readonly openWork: readonly PermissionLostInvitation[];
  readonly notifySubjects: readonly string[];
  readonly freshAssuranceRef: string;
}

/**
 * The per-transaction ledger. It is deliberately not a set of booleans alone:
 * the commit needs the captured rows, and needs them to have been read by the
 * discharge that proved them rather than re-read afterwards, so that a row
 * that moved in between is a lost race rather than a silent substitution.
 */
export interface TransferObligationLedger {
  readonly input: TransferObligationInput;
  /** Which of the four have been discharged so far. */
  readonly discharged: ReadonlySet<TransferObligationKind>;
  /** True once all four are discharged and every capture is present. */
  readonly complete: boolean;
  /** The captured rows, once every discharge that produces one has run. */
  readonly capture: TransferCapture | null;
  /** Why the last discharge returned false. A safe class, never a value. */
  readonly refusal: string | null;
}

interface MutableLedger {
  input: TransferObligationInput;
  discharged: Set<TransferObligationKind>;
  transfer?: PrimaryTransferRecord;
  space?: TransferSpaceFacts;
  proposer?: TransferMembershipRecord;
  recipient?: TransferMembershipRecord;
  proposerConsent?: TransferConsentRecord;
  recipientConsent?: TransferConsentRecord;
  openWork?: readonly PermissionLostInvitation[];
  notifySubjects?: readonly string[];
  refusal: string | null;
}

/** The store-level discharge surface PK-7B composes into `ApiTransactionStore`. */
export interface PrimaryTransferObligations {
  /** One ledger per authorizing transaction. */
  readonly begin: (input: TransferObligationInput) => TransferObligationLedger;
  /** Discharge one obligation kind. `false` denies exactly like any other undischargeable obligation. */
  readonly discharge: (ledger: TransferObligationLedger, kind: TransferObligationKind) => Promise<boolean>;
  /** Discharge all four in the order the commit needs them. The accept-completes path uses this. */
  readonly dischargeAll: (ledger: TransferObligationLedger) => Promise<boolean>;
  /** The boundary's `verify`: every kind this module owns was discharged. */
  readonly verify: (ledger: TransferObligationLedger, kinds: readonly TransferObligationKind[]) => boolean;
}

function asMutable(ledger: TransferObligationLedger): MutableLedger {
  return ledger as unknown as MutableLedger;
}

function refuse(ledger: MutableLedger, reasonClass: string): false {
  ledger.refusal = reasonClass;
  return false;
}

/**
 * Build the four discharges over one repository.
 *
 * `deps` is the same bundle the commands take. The discharges read through
 * the repository and therefore through the caller's transaction client; none
 * of them opens a transaction and none of them writes.
 */
export function primaryTransferObligations(deps: PrimaryTransferDependencies): PrimaryTransferObligations {
  const repository = deps.repository;

  function begin(input: TransferObligationInput): TransferObligationLedger {
    const ledger: MutableLedger = { input, discharged: new Set(), refusal: null };
    return Object.defineProperties(ledger as unknown as TransferObligationLedger, {
      complete: { get: () => isComplete(ledger), enumerable: true },
      capture: { get: () => captureOf(ledger), enumerable: true },
    });
  }

  function isComplete(ledger: MutableLedger): boolean {
    return TRANSFER_OBLIGATION_KINDS.every((kind) => ledger.discharged.has(kind)) && captureOf(ledger) !== null;
  }

  function captureOf(ledger: MutableLedger): TransferCapture | null {
    const {
      transfer, space, proposer, recipient, proposerConsent, recipientConsent, openWork, notifySubjects,
    } = ledger;
    if (!transfer || !space || !proposer || !recipient || !proposerConsent || !recipientConsent) return null;
    if (openWork === undefined || notifySubjects === undefined) return null;
    return {
      transfer, space, proposer, recipient, proposerConsent, recipientConsent,
      openWork, notifySubjects, freshAssuranceRef: ledger.input.freshAssuranceRef,
    };
  }

  /**
   * The workflow, the space and both memberships, read once and shared by the
   * four discharges so that they cannot disagree about what they are
   * discharging against.
   */
  async function load(ledger: MutableLedger): Promise<boolean> {
    if (ledger.transfer && ledger.space && ledger.proposer && ledger.recipient) return true;
    const transfer = await repository.readTransfer(ledger.input.budgetSpaceId, ledger.input.transferId);
    if (!transfer) return refuse(ledger, "transfer_not_found");
    const space = await repository.readSpace(ledger.input.budgetSpaceId);
    if (!space) return refuse(ledger, "budget_space_not_found");
    if (space.lifecycle !== "live") return refuse(ledger, "budget_space_not_live");
    const proposer = await repository.readMembership(transfer.budgetSpaceId, transfer.proposerMembershipId);
    const recipient = await repository.readMembership(transfer.budgetSpaceId, transfer.recipientMembershipId);
    if (!proposer || !recipient) return refuse(ledger, "authorization_denied");
    ledger.transfer = transfer;
    ledger.space = space;
    ledger.proposer = proposer;
    ledger.recipient = recipient;
    return true;
  }

  /**
   * `confirm` (`targetDescriptor: "authorized_target"`, `consequenceClass:
   * "governed_change"`). The governed change is the ownership move, the
   * authorized target is the recipient's membership, and the confirmation
   * that discharges it is the Primary's own recorded leg bound to this
   * request's fresh-assurance evidence.
   *
   * It refuses a workflow that is terminal, expired, or whose recipient has
   * not acted, and -- the binding that matters -- a workflow whose stored
   * `primaryAssuranceRef` names other evidence than the reference this
   * request spent. A grant can therefore authorize the confirmation it was
   * bound to and no other.
   */
  async function dischargeConfirm(ledger: MutableLedger): Promise<boolean> {
    if (!(await load(ledger))) return false;
    const transfer = ledger.transfer as PrimaryTransferRecord;
    if (transfer.state !== "proposed" && transfer.state !== "recipient_accepted" && transfer.state !== "ready") {
      return refuse(ledger, "transfer_not_current");
    }
    if (Date.parse(deps.clock.now()) >= Date.parse(transfer.expiresAt)) return refuse(ledger, "transfer_not_current");
    if (ledger.input.freshAssuranceRef.length === 0) return refuse(ledger, "assurance_required");
    if (transfer.primaryAssuranceRef !== null && transfer.primaryAssuranceRef !== ledger.input.freshAssuranceRef) {
      return refuse(ledger, "assurance_required");
    }
    // The recipient's leg is the other half of the pair. A confirm may precede
    // it (`primary_confirmed` then waits), but the *commit* cannot, and the
    // commit is what this discharge is an obligation of.
    if (transfer.recipientAcceptedAt === null) return refuse(ledger, "transfer_not_current");
    ledger.discharged.add("confirm");
    return true;
  }

  /**
   * `preserve` (`recordClasses: ["history", "provenance"]`). The history to
   * preserve is both parties' current consent rows, which the commit
   * supersedes rather than overwrites, and the provenance is the
   * `supersedes_consent_id` chain the new rows carry back to them.
   *
   * The capture is the discharge: the commit links to exactly the rows read
   * here, and a row that moved in between makes the supersede predicate miss
   * and the whole transaction roll back.
   */
  async function dischargePreserve(ledger: MutableLedger): Promise<boolean> {
    if (!(await load(ledger))) return false;
    const transfer = ledger.transfer as PrimaryTransferRecord;
    const proposerConsent = await repository.readCurrentConsent(transfer.budgetSpaceId, transfer.proposerMembershipId);
    const recipientConsent = await repository.readCurrentConsent(transfer.budgetSpaceId, transfer.recipientMembershipId);
    if (!proposerConsent || !recipientConsent) return refuse(ledger, "constraint_violation");
    if (proposerConsent.state !== "current" || recipientConsent.state !== "current") return refuse(ledger, "constraint_violation");
    // Design SS10.3 step 2, run here rather than only at the commit: both
    // disclosures must still be current in the registry at the versions the
    // workflow captured. A registry that moved under a live workflow means
    // the two parties consented to a text nobody would now be shown, so the
    // request denies `stale_disclosure` having written nothing at all. The
    // commit re-checks the same thing as its own last line.
    try {
      assertCurrentTransferDisclosure(deps, {
        kind: transfer.recipientDisclosureKind,
        version: transfer.recipientDisclosureVersion,
        digest: transfer.recipientDisclosureDigest,
      });
      assertCurrentTransferDisclosure(deps, {
        kind: transfer.outgoingDisclosureKind,
        version: transfer.outgoingDisclosureVersion,
        digest: transfer.outgoingDisclosureDigest,
      });
    } catch {
      return refuse(ledger, "stale_disclosure");
    }
    ledger.proposerConsent = proposerConsent;
    ledger.recipientConsent = recipientConsent;
    ledger.discharged.add("preserve");
    return true;
  }

  /**
   * `invalidate` (`artifactClasses: ["derived_surfaces", "open_work"]`). The
   * derived surfaces are every cached decision for either member, invalidated
   * by the two `authorization_version` bumps and the
   * `primary_ownership_version` bump the commit makes; the open work is every
   * still-active invitation the former Primary created under permission 26,
   * which design SS10.3 step 6 cancels through the PK-5 system path.
   *
   * This discharge captures that set and refuses when the proposer is no
   * longer the space's Primary -- there is then nothing coherent to
   * invalidate and the workflow is stale.
   */
  async function dischargeInvalidate(ledger: MutableLedger): Promise<boolean> {
    if (!(await load(ledger))) return false;
    const transfer = ledger.transfer as PrimaryTransferRecord;
    const space = ledger.space as TransferSpaceFacts;
    if (space.primaryOwnerMembershipId !== transfer.proposerMembershipId) return refuse(ledger, "proposer_not_primary");
    if (deps.cancelPermissionLostInvitations === undefined) return refuse(ledger, "constraint_violation");
    const openWork = await repository.listPermissionInvitations(
      transfer.budgetSpaceId, transfer.proposerMembershipId, LOST_PERMISSION,
    );
    ledger.openWork = openWork;
    ledger.discharged.add("invalidate");
    return true;
  }

  /**
   * `notify` (`class: "safe_authorization_change"`). Both parties receive the
   * mandatory `MSG-73-042` lifecycle notice under `IC-73-019`. The discharge
   * captures the two subjects and refuses when either membership is not
   * active, because a notice owed to a person whose membership just ended is
   * a different lifecycle event than this one.
   */
  async function dischargeNotify(ledger: MutableLedger): Promise<boolean> {
    if (!(await load(ledger))) return false;
    const proposer = ledger.proposer as TransferMembershipRecord;
    const recipient = ledger.recipient as TransferMembershipRecord;
    if (proposer.status !== "active" || recipient.status !== "active") return refuse(ledger, "authorization_denied");
    ledger.notifySubjects = [recipient.accountSubjectId, proposer.accountSubjectId];
    ledger.discharged.add("notify");
    return true;
  }

  async function discharge(ledger: TransferObligationLedger, kind: TransferObligationKind): Promise<boolean> {
    const mutable = asMutable(ledger);
    mutable.refusal = null;
    if (kind === "confirm") return dischargeConfirm(mutable);
    if (kind === "preserve") return dischargePreserve(mutable);
    if (kind === "invalidate") return dischargeInvalidate(mutable);
    if (kind === "notify") return dischargeNotify(mutable);
    throw new PrimaryTransferError("constraint_violation", "obligation.kind");
  }

  async function dischargeAll(ledger: TransferObligationLedger): Promise<boolean> {
    for (const kind of TRANSFER_OBLIGATION_KINDS) {
      if (!(await discharge(ledger, kind))) return false;
    }
    return true;
  }

  function verify(ledger: TransferObligationLedger, kinds: readonly TransferObligationKind[]): boolean {
    return kinds.every((kind) => ledger.discharged.has(kind));
  }

  return { begin, discharge, dischargeAll, verify };
}
