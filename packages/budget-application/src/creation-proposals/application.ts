/**
 * Application entry points for versioned budget-creation proposals
 * (CBD-232 §4, §6, §7, §8).
 *
 * No NestJS decorator, HTTP framework, or database client appears here or
 * anywhere else in this package (§3.1). `apps/api` binds these functions and
 * types to the §4 HTTP contract; that binding is out of this packet's scope.
 */

import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../creation-confirmation/disclosure.ts";
import { canonicalBindingEnvelope } from "./binding.ts";
import { digestOf } from "./canonical-json.ts";
import { EXPIRY_TIME_LIMIT_MS, PERIOD_CONTRACT_VERSION, PROPOSAL_CONTRACT_VERSION } from "./constants.ts";
import { addCalendarDays } from "./date.ts";
import type { FieldError } from "./errors.ts";
import { validateCreateProposalRequest } from "./normalize.ts";
import { calendarDataVersionFor, computeSchedulePreview } from "./preview.ts";
import { localDateOf, localMidnightInstant } from "./time-zone.ts";
import type {
  AuthenticatedSubjectContext,
  BudgetCreationProposalReadResponse,
  BudgetCreationProposalResponse,
  ExpiredReason,
  GoverningVersions,
  IdempotencyConflictResponse,
  IdempotencyRecord,
  InvalidatedReason,
  NormalizedInputs,
  Ports,
  ProposalContextKey,
  ProposalLifecycle,
  ProposalRecord,
} from "./ports.ts";

// ---------------------------------------------------------------------------
// Create / regenerate
// ---------------------------------------------------------------------------

export interface CreateProposalCommand {
  readonly subjectContext: AuthenticatedSubjectContext;
  readonly idempotencyKeyHeader: string | undefined;
  readonly body: unknown;
}

export type CreateProposalOutcome =
  | { readonly kind: "validation_failed"; readonly status: 400; readonly fieldErrors: readonly FieldError[] }
  | { readonly kind: "created"; readonly status: 201; readonly response: BudgetCreationProposalResponse }
  | { readonly kind: "replayed"; readonly status: 200; readonly response: BudgetCreationProposalResponse }
  | { readonly kind: "conflict"; readonly status: 409; readonly conflict: IdempotencyConflictResponse }
  | { readonly kind: "predecessor_not_found"; readonly status: 404 };

function computeExpiry(now: Date, timeZone: string): { expiresAt: string; expiryReason: ExpiredReason } {
  const timeLimit = new Date(now.getTime() + EXPIRY_TIME_LIMIT_MS);
  const budgetDate = localDateOf(now, timeZone);
  const nextLocalDay = addCalendarDays(budgetDate, 1);
  const nextMidnight = localMidnightInstant(nextLocalDay, timeZone);
  if (nextMidnight.getTime() <= timeLimit.getTime()) {
    return { expiresAt: nextMidnight.toISOString(), expiryReason: "local_midnight" };
  }
  return { expiresAt: timeLimit.toISOString(), expiryReason: "time_limit" };
}

function buildGoverningVersions(ports: Ports, normalizedInputs: NormalizedInputs): GoverningVersions {
  return {
    proposalContractVersion: PROPOSAL_CONTRACT_VERSION,
    periodContractVersion: PERIOD_CONTRACT_VERSION,
    calendarDataVersion: calendarDataVersionFor(normalizedInputs.schedule.cadence),
    timeZoneDataVersion: ports.timeZoneDataVersion,
    currencyCatalogVersion: ports.currencyContextReader.currencyCatalogVersion,
  };
}

/**
 * The §7.3 result-affecting dependency fingerprint. Recomputing this with
 * live ports (current governing versions, current constraint version, and
 * "today" freshly resolved from the clock) at read or retry time, and
 * comparing it against the value captured at issuance, is what makes a rule,
 * currency, holiday, constraint, session, or budget-local-date change stale
 * the proposal on the next read even when no eager invalidation job ran.
 */
function buildDependencyFingerprint(input: {
  readonly context: AuthenticatedSubjectContext;
  readonly normalizedInputs: NormalizedInputs;
  readonly governingVersions: GoverningVersions;
  readonly budgetDate: string;
  readonly constraintVersion: string | null;
  readonly currencyContextCompatible: boolean;
  readonly bindingVersion: string;
}): string {
  return digestOf({
    environment: input.context.environment,
    subjectId: input.context.subjectId,
    accountId: input.context.accountId,
    profileId: input.context.profileId,
    sessionGeneration: input.context.sessionGeneration,
    normalizedInputs: input.normalizedInputs,
    governingVersions: input.governingVersions,
    budgetDate: input.budgetDate,
    constraintVersion: input.constraintVersion,
    currencyContextCompatible: input.currencyContextCompatible,
    bindingVersion: input.bindingVersion,
  });
}

function toResponse(record: ProposalRecord, ports: Ports): BudgetCreationProposalResponse {
  return {
    proposalId: record.proposalId,
    proposalVersion: 1,
    issuedStatus: "previewed",
    draftRevision: record.draftRevision,
    supersedesProposalId: record.predecessorProposalId,
    normalizedInputs: record.normalizedInputs,
    governingVersions: record.governingVersions,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    preview: record.preview,
    previewDigest: record.previewDigest,
    confirmationBinding: record.confirmationBinding,
    bindingVersion: record.bindingVersion,
    // Always the registry's current row, never a value frozen into the stored proposal (CBD-236 SS5).
    currentDisclosure: ports.disclosures.current(PRIMARY_OWNER_SELF_DISCLOSURE),
  };
}

function contextKeyFor(context: AuthenticatedSubjectContext, proposalId: string): ProposalContextKey {
  return {
    environment: context.environment,
    subjectId: context.subjectId,
    accountId: context.accountId,
    profileId: context.profileId,
    sessionGeneration: context.sessionGeneration,
    proposalId,
  };
}

export async function createOrRegenerateProposal(
  command: CreateProposalCommand,
  ports: Ports,
): Promise<CreateProposalOutcome> {
  const validation = validateCreateProposalRequest(command.idempotencyKeyHeader, command.body, {
    currencyContextReader: ports.currencyContextReader,
    subjectContext: command.subjectContext,
  });
  if (!validation.ok) {
    return { kind: "validation_failed", status: 400, fieldErrors: validation.fieldErrors };
  }

  const { normalizedInputs, supersedesProposalId } = validation;
  const now = ports.clock.now();
  const budgetDate = localDateOf(now, normalizedInputs.timeZone);
  const governingVersions = buildGoverningVersions(ports, normalizedInputs);
  const preview = computeSchedulePreview(normalizedInputs.schedule, budgetDate, normalizedInputs.timeZone);
  const previewDigest = digestOf({ normalizedInputs, governingVersions, preview });
  const issuedAt = now.toISOString();
  const { expiresAt, expiryReason } = computeExpiry(now, normalizedInputs.timeZone);
  const normalizedCommandDigest = digestOf({ normalizedInputs, supersedesProposalId });
  const constraintVersion = ports.constraintReader?.currentConstraintVersion(command.subjectContext) ?? null;
  const dependencyFingerprint = buildDependencyFingerprint({
    context: command.subjectContext,
    normalizedInputs,
    governingVersions,
    budgetDate,
    constraintVersion,
    currencyContextCompatible: ports.currencyContextReader.isCompatibleWithContext(
      normalizedInputs.currencyCode,
      command.subjectContext,
    ),
    bindingVersion: ports.bindingKeyring.bindingVersion,
  });

  // Validated non-empty and well-formed by validateCreateProposalRequest above.
  const suppliedIdempotency = command.idempotencyKeyHeader as string;

  let predecessor: ProposalRecord | null = null;
  if (supersedesProposalId !== null) {
    predecessor = await ports.store.loadForContext(contextKeyFor(command.subjectContext, supersedesProposalId));
    if (predecessor === null) {
      return { kind: "predecessor_not_found", status: 404 };
    }
  }

  const proposalId = ports.idGenerator.proposalId();
  const draftRevision = predecessor === null ? 1 : predecessor.draftRevision + 1;

  const envelope = canonicalBindingEnvelope({
    bindingVersion: ports.bindingKeyring.bindingVersion,
    context: command.subjectContext,
    proposalId,
    proposalVersion: 1,
    draftRevision,
    normalizedInputs,
    governingVersions,
    issuedAt,
    expiresAt,
    previewDigest,
    budgetDate,
    predecessorProposalId: supersedesProposalId,
  });
  const confirmationBinding = ports.bindingKeyring.sign(envelope);

  const record: ProposalRecord = {
    proposalId,
    proposalVersion: 1,
    draftRevision,
    predecessorProposalId: supersedesProposalId,
    successorProposalId: null,
    environment: command.subjectContext.environment,
    subjectId: command.subjectContext.subjectId,
    accountId: command.subjectContext.accountId,
    profileId: command.subjectContext.profileId,
    sessionGeneration: command.subjectContext.sessionGeneration,
    normalizedInputs,
    governingVersions,
    budgetDate,
    issuedAt,
    expiresAt,
    expiryReason,
    preview,
    previewDigest,
    confirmationBinding,
    bindingVersion: ports.bindingKeyring.bindingVersion,
    dependencyFingerprint,
    status: "previewed",
    statusReason: null,
    confirmedBudgetSpaceId: null,
  };
  const response = toResponse(record, ports);
  const idempotency: IdempotencyRecord = {
    key: suppliedIdempotency,
    environment: command.subjectContext.environment,
    subjectId: command.subjectContext.subjectId,
    accountId: command.subjectContext.accountId,
    profileId: command.subjectContext.profileId,
    sessionGeneration: command.subjectContext.sessionGeneration,
    operation: "create-proposal",
    normalizedCommandDigest,
    dependencyFingerprint,
    issuedAt,
    proposalId,
    response,
  };

  if (predecessor === null) {
    const result = await ports.store.createOrReplay({ now: issuedAt, idempotency, record });
    if (result.kind === "created") return { kind: "created", status: 201, response };
    if (result.kind === "replayed") return { kind: "replayed", status: 200, response: result.response };
    return { kind: "conflict", status: 409, conflict: result.conflict };
  }

  const result = await ports.store.replaceCurrent({
    predecessorContext: contextKeyFor(command.subjectContext, predecessor.proposalId),
    expectedPredecessorRevision: predecessor.draftRevision,
    successor: { now: issuedAt, idempotency, record },
  });
  if (result.kind === "created") return { kind: "created", status: 201, response };
  if (result.kind === "replayed") return { kind: "replayed", status: 200, response: result.response };
  if (result.kind === "idempotency_conflict") return { kind: "conflict", status: 409, conflict: result.conflict };
  // predecessor_conflict: the same predecessor readable moments ago is no
  // longer an eligible chain head (raced by another regeneration, discard, or
  // confirmation). The uniform not-found behavior (§4.3, §8.1) is the correct
  // client-facing shape: no proposal data is disclosed and no state changes.
  return { kind: "predecessor_not_found", status: 404 };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type ReadProposalOutcome =
  | { readonly kind: "found"; readonly status: 200; readonly response: BudgetCreationProposalReadResponse }
  | { readonly kind: "not_found"; readonly status: 404 };

export function computeLifecycle(
  record: ProposalRecord,
  now: Date,
  currentDependencyFingerprint: string,
): ProposalLifecycle {
  if (record.status === "confirmed") {
    return { status: "confirmed", reason: "confirmed", regenerateRequired: false };
  }
  if (record.status === "invalidated") {
    return {
      status: "invalidated",
      reason: (record.statusReason as InvalidatedReason) ?? "discarded",
      regenerateRequired: true,
    };
  }
  if (record.status === "expired") {
    return {
      status: "expired",
      reason: (record.statusReason as ExpiredReason) ?? record.expiryReason,
      regenerateRequired: true,
    };
  }

  // previewed: lazy checks, per §7.3, even if no eager job ran.
  if (now.getTime() >= Date.parse(record.expiresAt)) {
    return { status: "expired", reason: record.expiryReason, regenerateRequired: true };
  }
  if (currentDependencyFingerprint !== record.dependencyFingerprint) {
    return { status: "invalidated", reason: "dependency_changed", regenerateRequired: true };
  }
  return { status: "previewed", reason: null, regenerateRequired: false };
}

export async function readProposal(
  key: ProposalContextKey,
  ports: Ports,
): Promise<ReadProposalOutcome> {
  const record = await ports.store.loadForContext(key);
  if (record === null) return { kind: "not_found", status: 404 };

  const now = ports.clock.now();
  const currentGoverningVersions = buildGoverningVersions(ports, record.normalizedInputs);
  const currentBudgetDate = localDateOf(now, record.normalizedInputs.timeZone);
  const currentConstraintVersion =
    ports.constraintReader?.currentConstraintVersion({
      environment: record.environment,
      subjectId: record.subjectId,
      accountId: record.accountId,
      profileId: record.profileId,
      sessionGeneration: record.sessionGeneration,
    }) ?? null;
  const currentDependencyFingerprint = buildDependencyFingerprint({
    context: {
      environment: record.environment,
      subjectId: record.subjectId,
      accountId: record.accountId,
      profileId: record.profileId,
      sessionGeneration: record.sessionGeneration,
    },
    normalizedInputs: record.normalizedInputs,
    governingVersions: currentGoverningVersions,
    budgetDate: currentBudgetDate,
    constraintVersion: currentConstraintVersion,
    currencyContextCompatible: ports.currencyContextReader.isCompatibleWithContext(
      record.normalizedInputs.currencyCode,
      {
        environment: record.environment,
        subjectId: record.subjectId,
        accountId: record.accountId,
        profileId: record.profileId,
        sessionGeneration: record.sessionGeneration,
      },
    ),
    bindingVersion: ports.bindingKeyring.bindingVersion,
  });

  const lifecycle = computeLifecycle(record, now, currentDependencyFingerprint);
  return {
    kind: "found",
    status: 200,
    response: { proposal: toResponse(record, ports), lifecycle },
  };
}

// ---------------------------------------------------------------------------
// Discard and context-change invalidation (§7.4, §8.2)
// ---------------------------------------------------------------------------

export async function discardProposal(
  key: ProposalContextKey,
  expectedRevision: number,
  ports: Ports,
): Promise<void> {
  await ports.store.invalidate(key, expectedRevision, "discarded");
}

export async function invalidateForSessionEnd(
  key: ProposalContextKey,
  expectedRevision: number,
  ports: Ports,
): Promise<void> {
  await ports.store.invalidate(key, expectedRevision, "session_ended");
}

export async function invalidateForContextChange(
  key: ProposalContextKey,
  expectedRevision: number,
  ports: Ports,
): Promise<void> {
  await ports.store.invalidate(key, expectedRevision, "context_changed");
}

export { toResponse as buildProposalResponse, buildDependencyFingerprint, buildGoverningVersions, computeExpiry };
