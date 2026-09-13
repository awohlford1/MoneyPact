import { timingSafeEqual, randomUUID } from "node:crypto";
import { canonicalBindingEnvelope } from "../creation-proposals/binding.ts";
import { digestOf } from "../creation-proposals/canonical-json.ts";
import { buildDependencyFingerprint, buildGoverningVersions } from "../creation-proposals/application.ts";
import { localDateOf } from "../creation-proposals/time-zone.ts";
import type { AuthenticatedSubjectContext, Ports, ProposalRecord } from "../creation-proposals/ports.ts";

export interface ConfirmBudgetCreationRequest {
  readonly proposalId: string;
  readonly confirmationBinding: string;
  readonly confirmationIdempotencyKey: string;
}
export interface ConfirmBudgetCreationResponse {
  readonly confirmationOutcomeId: string;
  readonly budgetSpaceId: string;
  readonly primaryOwnerMembershipId: string;
  readonly initialScheduleVersionId: string;
  readonly currentScheduleVersionId: string;
  readonly currentPeriodId: string;
  readonly nameVersion: 1;
  readonly lifecycle: "live";
  readonly lifecycleVersion: 1;
  readonly scheduleVersion: 1;
  readonly authorization: { readonly policyVersion: string; readonly policyDigest: string; readonly inputSchemaVersion: number; readonly authorizationVersion: 1 };
  readonly committedAt: string;
  readonly onboardingContinuationId: string;
}
export type ConfirmationErrorCode = "invalid_request" | "unauthenticated" | "proposal_not_found" | "proposal_not_current" | "idempotency_key_reused" | "authorization_denied" | "confirmation_stale" | "retryable_conflict";
export class ConfirmationError extends Error {
  readonly code: ConfirmationErrorCode;
  constructor(code: ConfirmationErrorCode) { super(code); this.code = code; }
}
export function equalDigest(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function confirmationRequest(proposalId: unknown, key: unknown, body: unknown): ConfirmBudgetCreationRequest {
  if (typeof proposalId !== "string" || !/^bcp_[0-9a-f]{32}$/u.test(proposalId)
    || typeof key !== "string" || !/^[\x21-\x7e]{16,128}$/u.test(key)
    || !body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !("confirmationBinding" in body)
    || typeof body.confirmationBinding !== "string" || !body.confirmationBinding.length || body.confirmationBinding.length > 1024) throw new ConfirmationError("invalid_request");
  return { proposalId, confirmationIdempotencyKey: key, confirmationBinding: body.confirmationBinding };
}
export const requestDigest = (request: ConfirmBudgetCreationRequest): string => digestOf(request);
export interface ClaimedProposal {
  readonly record: ProposalRecord;
  readonly lifecycleRevision: number;
  readonly candidateBudgetSpaceId: string;
  readonly candidatePrimaryMembershipId: string;
}
export interface CreationPlan {
  readonly proposal: ClaimedProposal;
  readonly request: ConfirmBudgetCreationRequest;
  readonly context: AuthenticatedSubjectContext;
  readonly operationId: string;
  readonly periodIds: readonly string[];
  readonly response: ConfirmBudgetCreationResponse;
}
/** The closed operation port exposes no optional setup or arbitrary entity write. */
export interface ConfirmationTransaction {
  replay(context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest): Promise<ConfirmBudgetCreationResponse | null>;
  claimCurrentProposal(context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest): Promise<ClaimedProposal>;
  reload(context: AuthenticatedSubjectContext, proposal: ProposalRecord): Promise<{ context: AuthenticatedSubjectContext; ports: Ports }>;
  authorize(proposal: ClaimedProposal): Promise<ConfirmBudgetCreationResponse["authorization"]>;
  persist(plan: CreationPlan): Promise<void>;
}
export interface ConfirmationUnitOfWork {
  confirm<T>(work: (transaction: ConfirmationTransaction) => Promise<T>): Promise<T>;
  loadCommitted(context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest): Promise<ConfirmBudgetCreationResponse | null>;
}
export function verifyProposal(record: ProposalRecord, context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest, ports: Ports): void {
  if (["environment", "subjectId", "accountId", "profileId", "sessionGeneration"].some(key => record[key as keyof AuthenticatedSubjectContext] !== context[key as keyof AuthenticatedSubjectContext])) throw new ConfirmationError("proposal_not_found");
  if (record.proposalId !== request.proposalId) throw new ConfirmationError("proposal_not_found");
  if (!ports.constraintReader?.currentConstraintVersion(context)) throw new ConfirmationError("proposal_not_current");
  const now = ports.clock.now();
  if (record.status !== "previewed" || record.successorProposalId !== null || record.confirmedBudgetSpaceId !== null || !Number.isFinite(Date.parse(record.expiresAt)) || now.getTime() >= Date.parse(record.expiresAt)) throw new ConfirmationError("proposal_not_current");
  const governingVersions = buildGoverningVersions(ports, record.normalizedInputs);
  const fingerprint = buildDependencyFingerprint({ context, normalizedInputs: record.normalizedInputs, governingVersions,
    budgetDate: localDateOf(now, record.normalizedInputs.timeZone), constraintVersion: ports.constraintReader?.currentConstraintVersion(context) ?? null,
    currencyContextCompatible: ports.currencyContextReader.isCompatibleWithContext(record.normalizedInputs.currencyCode, context), bindingVersion: ports.bindingKeyring.bindingVersion });
  if (!equalDigest(fingerprint, record.dependencyFingerprint)
    || !equalDigest(digestOf({ normalizedInputs: record.normalizedInputs, governingVersions, preview: record.preview }), record.previewDigest)
    || !ports.bindingKeyring.verify(canonicalBindingEnvelope({ ...record, context }), request.confirmationBinding)
    || !equalDigest(digestOf(request.confirmationBinding), digestOf(record.confirmationBinding))) throw new ConfirmationError("proposal_not_current");
}
export async function confirmWithin(transaction: ConfirmationTransaction, context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest, id = randomUUID): Promise<ConfirmBudgetCreationResponse> {
  const replay = await transaction.replay(context, request); if (replay) return replay;
  const proposal = await transaction.claimCurrentProposal(context, request);
  const fresh = await transaction.reload(context, proposal.record);
  verifyProposal(proposal.record, fresh.context, request, fresh.ports);
  const authorization = await transaction.authorize(proposal);
  const periods = proposal.record.preview.periods;
  const current = periods.filter(p => p.relation === "current" && p.start <= proposal.record.budgetDate && p.end >= proposal.record.budgetDate);
  if (current.length !== 1 || periods.length < 4) throw new ConfirmationError("proposal_not_current");
  const periodIds = periods.map(() => id()); const schedule = id();
  const response: ConfirmBudgetCreationResponse = { confirmationOutcomeId: id(), budgetSpaceId: proposal.candidateBudgetSpaceId,
    primaryOwnerMembershipId: proposal.candidatePrimaryMembershipId, initialScheduleVersionId: schedule, currentScheduleVersionId: schedule,
    currentPeriodId: periodIds[periods.indexOf(current[0]!)]!, nameVersion: 1, lifecycle: "live", lifecycleVersion: 1, scheduleVersion: 1,
    authorization, committedAt: fresh.ports.clock.now().toISOString(), onboardingContinuationId: id() };
  await transaction.persist({ proposal, request, context: fresh.context, operationId: id(), periodIds, response });
  return response;
}
/** Neither response serialization nor navigation occurs in the transaction. */
export async function confirmBudgetCreation(uow: ConfirmationUnitOfWork, context: AuthenticatedSubjectContext, request: ConfirmBudgetCreationRequest): Promise<ConfirmBudgetCreationResponse> {
  await uow.confirm(tx => confirmWithin(tx, context, request));
  const committed = await uow.loadCommitted(context, request);
  if (!committed) throw new ConfirmationError("retryable_conflict");
  return committed;
}
