/**
 * The durable half of the CBD-236 consent record (CBD236-CONSENT-SEMANTICS-001
 * item 4; docs/cbd-236-consent-facts-proposal.md SS7).
 *
 * `../creation-confirmation/consent.ts` decides *what* the creator's consent
 * row contains and *whether* the acknowledged disclosure is the approved one,
 * with no database in sight (CBD-232 SS3.1). This module is the CBD-246 seam
 * that writes it, and it lives here for the same reason
 * `confirmation-store.ts` does.
 *
 * `consentDependency` is the production `ConfirmationDependencies.consent`, in
 * its two phases: the comparison, which runs before the transaction's first
 * insert, and the write it returns.
 * `apps/api` composes it with the registry it verified at startup; this
 * package's own tests and its live-PostgreSQL proofs compose it with a fixture
 * registry, so every one of them exercises this exact code rather than a
 * stand-in for it.
 */
import { randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import type { ConsentDependency } from "./confirmation-store.ts";
import { assertAcknowledgedDisclosure, selfDisclosureConsentValues } from "../creation-confirmation/consent.ts";
import type { SelfDisclosureConsentInput } from "../creation-confirmation/consent.ts";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../creation-confirmation/disclosure.ts";
import type { ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import { proposalUuid } from "./proposal-store.ts";

/** Writes the creator's consent row on the transaction's own client. Returns the allocated `consent_id`. */
export async function recordSelfDisclosureConsent(client: DataAccessClient, input: SelfDisclosureConsentInput, id: () => string = randomUUID): Promise<string> {
  const consentId = id();
  await client.tenantInsert({ table: "budget_space_consent", budgetSpaceId: input.budgetSpaceId, values: selfDisclosureConsentValues(input, consentId) });
  return consentId;
}

/**
 * The two phases of the production consent dependency
 * (`CBD233-STALE-CHECK-ORDER-001`; CBD-233 SS3.3).
 *
 * Phase 1 runs once per confirmation, before the transaction has inserted
 * anything: it reads the approved registry once and compares the request's
 * claim with it, throwing `stale_disclosure` when the claim is absent, names
 * another kind, or names any version but the current one. Nothing has been
 * inserted at that point, so nothing is rolled back.
 *
 * Phase 2 is the write, still immediately after the creator membership inside
 * the transaction. It closes over the exact `ConsentDisclosure` phase 1
 * compared against, so the recorded `disclosure_version` and
 * `disclosure_digest` cannot disagree with the value that admitted the
 * confirmation even if the registry were reloaded in between.
 */
export function consentDependency(disclosures: ConsentDisclosureSource, id: () => string = randomUUID): ConsentDependency {
  return request => {
    const disclosure = disclosures.current(PRIMARY_OWNER_SELF_DISCLOSURE);
    assertAcknowledgedDisclosure(request.acknowledgedDisclosure, disclosure);
    return async (client, plan) => {
      await recordSelfDisclosureConsent(client, {
        budgetSpaceId: plan.response.budgetSpaceId,
        membershipId: plan.response.primaryOwnerMembershipId,
        accountSubjectId: plan.context.subjectId,
        sourceRecordId: proposalUuid(plan.proposal.record.proposalId),
        sourceRecordVersion: plan.proposal.lifecycleRevision,
        disclosure,
        policyVersion: plan.response.authorization.policyVersion,
        policyDigest: plan.response.authorization.policyDigest,
        recordedAt: plan.response.committedAt,
      }, id);
    };
  };
}
