/**
 * CBD-236 consent record: the Primary Owner's creation-time self-disclosure
 * row (CBD236-CONSENT-SEMANTICS-001 items 1, 3 and 4;
 * docs/cbd-236-consent-facts-proposal.md SS4, SS5 and SS7).
 *
 * No database appears here (CBD-232 SS3.1). This module decides what the
 * creator's `budget_space_consent` row contains and whether the acknowledged
 * disclosure is the approved one; `../persistence/consent-store.ts` is the
 * CBD-246 seam that compares the claim before the transaction's first insert
 * and then writes the row immediately after the creator membership, from
 * server-side facts only.
 * Three of the row's facts are worth naming:
 *
 *  * `disclosure_version` and `disclosure_digest` come from the approved
 *    registry row, never from the request. The request's
 *    `acknowledgedDisclosure` is a *claim* in the `claimedEffectClass` sense
 *    of CBD-236 SS5.1: the client may claim which disclosure it showed, the
 *    server compares that claim with the registry's current row, denies
 *    inequality with the stable failure `stale_disclosure`, and records only
 *    what it verified. A missing claim is a stale claim -- a confirmation
 *    taken without the current disclosure is not consent (CBD-73 SS6 rule 1).
 *  * `policy_version` / `policy_digest` are the tuple of the decision that
 *    authorized this write (`PC-236-012`).
 *  * `source_record_id` / `source_record_version` are the CBD-233 proposal and
 *    the lifecycle revision the person actually confirmed, so the evidence
 *    names the exact record that was accepted (`DR-73-04`, `TR-73-13`).
 *
 * The row is evidence, never authorization (CBD-73 SS6 rule 6).
 */
import { ConfirmationError } from "./index.ts";
import type { AcknowledgedDisclosure, ConsentDisclosure } from "./disclosure.ts";

export { PRIMARY_OWNER_SELF_DISCLOSURE } from "./disclosure.ts";
export type { AcknowledgedDisclosure, ConsentDisclosure, ConsentDisclosureItem, ConsentDisclosureSource, ConsentDisclosureText } from "./disclosure.ts";

/**
 * CBD-233 SS3.3 `stale_disclosure`: the claim must equal the registry's current
 * row for the kind. A missing, malformed or superseded claim is denied here,
 * inside the transaction but ahead of its first creation insert
 * (`CBD233-STALE-CHECK-ORDER-001`), so the confirmation inserts no row at all
 * and there is none to roll back.
 */
export function assertAcknowledgedDisclosure(claim: AcknowledgedDisclosure | undefined, current: ConsentDisclosure): void {
  if (!claim || claim.kind !== current.kind || claim.version !== current.version) throw new ConfirmationError("stale_disclosure");
}

export interface SelfDisclosureConsentInput {
  readonly budgetSpaceId: string;
  readonly membershipId: string;
  readonly accountSubjectId: string;
  /** The CBD-233 proposal as a uuid (`budget_creation_operation.proposal_id`). */
  readonly sourceRecordId: string;
  /** The proposal `lifecycle_revision` that was confirmed. */
  readonly sourceRecordVersion: number;
  readonly disclosure: ConsentDisclosure;
  readonly policyVersion: string;
  readonly policyDigest: string;
  readonly recordedAt: string;
}

/** The exact column values of the creator's consent row. Separated from the write so a test can read them without a database. */
export function selfDisclosureConsentValues(input: SelfDisclosureConsentInput, consentId: string): Readonly<Record<string, unknown>> {
  if (!Number.isSafeInteger(input.sourceRecordVersion) || input.sourceRecordVersion < 1) throw new ConfirmationError("proposal_not_current");
  if (!Number.isSafeInteger(input.disclosure.version) || input.disclosure.version < 1 || !input.disclosure.digest) throw new ConfirmationError("stale_disclosure");
  if (!input.policyVersion || !input.policyDigest) throw new ConfirmationError("authorization_denied");
  return {
    consent_id: consentId,
    membership_id: input.membershipId,
    account_subject_id: input.accountSubjectId,
    role: "primary_owner",
    resource_scope: "full",
    source: "self_disclosure",
    source_record_id: input.sourceRecordId,
    source_record_version: input.sourceRecordVersion,
    disclosure_kind: input.disclosure.kind,
    disclosure_version: input.disclosure.version,
    disclosure_digest: input.disclosure.digest,
    policy_version: input.policyVersion,
    policy_digest: input.policyDigest,
    state: "current",
    // `self_disclosure` is not a protected action, so DR-73-04 requires no assurance evidence.
    assurance_ref: null,
    recorded_at: input.recordedAt,
    recorded_by_subject_id: input.accountSubjectId,
  };
}
