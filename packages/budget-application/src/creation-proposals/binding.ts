/**
 * Confirmation binding envelope (CBD-232 §7.1).
 */

import { canonicalJSON } from "./canonical-json.ts";
import type { AuthenticatedSubjectContext, GoverningVersions, NormalizedInputs } from "./ports.ts";

export interface BindingEnvelopeInput {
  readonly bindingVersion: "bcp-hmac-sha256/v1";
  readonly context: AuthenticatedSubjectContext;
  readonly proposalId: string;
  readonly proposalVersion: 1;
  readonly draftRevision: number;
  readonly normalizedInputs: NormalizedInputs;
  readonly governingVersions: GoverningVersions;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly previewDigest: string;
  readonly budgetDate: string;
  readonly predecessorProposalId: string | null;
}

/** Canonical JSON of the §7.1 binding envelope, ready to sign or verify. */
export function canonicalBindingEnvelope(input: BindingEnvelopeInput): string {
  return canonicalJSON({
    bindingVersion: input.bindingVersion,
    environment: input.context.environment,
    subjectId: input.context.subjectId,
    accountId: input.context.accountId,
    profileId: input.context.profileId,
    sessionGeneration: input.context.sessionGeneration,
    proposalId: input.proposalId,
    proposalVersion: input.proposalVersion,
    draftRevision: input.draftRevision,
    normalizedInputs: input.normalizedInputs,
    governingVersions: input.governingVersions,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    previewDigest: input.previewDigest,
    budgetDate: input.budgetDate,
    predecessorProposalId: input.predecessorProposalId,
  });
}
