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
 * `consentDependency` is the production `ConfirmationDependencies.consent`.
 * `apps/api` composes it with the registry it verified at startup; this
 * package's own tests and its live-PostgreSQL proofs compose it with a fixture
 * registry, so every one of them exercises this exact code rather than a
 * stand-in for it.
 */
import { randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import { assertAcknowledgedDisclosure, selfDisclosureConsentValues } from "../creation-confirmation/consent.ts";
import type { SelfDisclosureConsentInput } from "../creation-confirmation/consent.ts";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../creation-confirmation/disclosure.ts";
import type { ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import type { CreationPlan } from "../creation-confirmation/index.ts";
import { proposalUuid } from "./proposal-store.ts";

/** Writes the creator's consent row on the transaction's own client. Returns the allocated `consent_id`. */
export async function recordSelfDisclosureConsent(client: DataAccessClient, input: SelfDisclosureConsentInput, id: () => string = randomUUID): Promise<string> {
  const consentId = id();
  await client.tenantInsert({ table: "budget_space_consent", budgetSpaceId: input.budgetSpaceId, values: selfDisclosureConsentValues(input, consentId) });
  return consentId;
}

/**
 * Compare the request's claim with the approved registry, then write the row. The comparison runs
 * first and throws `stale_disclosure`, so a confirmation taken without the current disclosure writes
 * nothing at all and the whole transaction rolls back.
 */
export function consentDependency(disclosures: ConsentDisclosureSource, id: () => string = randomUUID): (client: DataAccessClient, plan: CreationPlan) => Promise<void> {
  return async (client, plan) => {
    const disclosure = disclosures.current(PRIMARY_OWNER_SELF_DISCLOSURE);
    assertAcknowledgedDisclosure(plan.request.acknowledgedDisclosure, disclosure);
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
}
