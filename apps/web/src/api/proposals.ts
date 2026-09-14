import type { CadenceDefinition } from "@cobudget/budget-domain/schedule";
import type { FieldError } from "./client";

/**
 * CBD-236 consent landing: the approved Primary Owner self-disclosure the
 * server sends with every preview. The creation surface must present it above
 * the confirm control and echo `{ kind, version }` back with the confirmation
 * (CBD236-CONSENT-SEMANTICS-001 items 1 and 3).
 */
export interface Disclosure {
  kind: string;
  version: number;
  digest: string;
  text: { heading: string; items: readonly { id: string; text: string }[]; acknowledgement: string };
}
export interface Draft { name: string; timeZone: string; currencyCode: string; schedule: unknown }
export interface PreviewPeriod { ordinal: number; relation: "current" | "following"; start: string; end: string; lengthInDays: number }
export interface Proposal {
  proposalId: string;
  proposalVersion: 1;
  issuedStatus: "previewed";
  draftRevision: number;
  supersedesProposalId: string | null;
  normalizedInputs: Omit<Draft, "schedule"> & { schedule: CadenceDefinition };
  governingVersions: { proposalContractVersion: string; periodContractVersion: string; calendarDataVersion: string | null; timeZoneDataVersion: string; currencyCatalogVersion: string };
  issuedAt: string;
  expiresAt: string;
  preview: { budgetDate: string; timeZone: string; cadence: CadenceDefinition["cadence"]; cadenceDefinition: CadenceDefinition; cadenceSummary: string; periodCount: number; periods: readonly PreviewPeriod[]; adjustments: readonly unknown[]; warnings: readonly { code: string; message: string }[] };
  previewDigest: string;
  confirmationBinding: string;
  bindingVersion: "bcp-hmac-sha256/v1";
  currentDisclosure: Disclosure;
}
export interface ProposalRead { proposal: Proposal; lifecycle: { status: "previewed" | "invalidated" | "expired" | "confirmed"; reason: string | null; regenerateRequired: boolean } }
export interface Confirmation {
  confirmationOutcomeId: string; budgetSpaceId: string; primaryOwnerMembershipId: string;
  initialScheduleVersionId: string; currentScheduleVersionId: string; currentPeriodId: string;
  nameVersion: 1; lifecycle: "live"; lifecycleVersion: 1; scheduleVersion: 1;
  authorization: { policyVersion: string; policyDigest: string; inputSchemaVersion: number; authorizationVersion: 1 };
  committedAt: string; onboardingContinuationId: string;
}
export interface ProposalApi {
  createProposal(draft: Draft, idempotency: string, supersedes?: string, signal?: AbortSignal): Promise<Proposal>;
  readProposal(id: string, signal?: AbortSignal): Promise<ProposalRead>;
  confirmProposal(id: string, binding: string, idempotency: string, acknowledgedDisclosure: { kind: string; version: number }): Promise<Confirmation>;
}
export interface CreationState {
  stage: "draft" | "loading" | "review" | "confirming" | "error" | "complete";
  draft: Draft;
  proposal?: Proposal;
  rendered: boolean;
  /** The explicit acknowledgement of the current disclosure. Reset by every edit and every new preview. */
  acknowledged: boolean;
  errors: readonly FieldError[];
  message: string;
}
