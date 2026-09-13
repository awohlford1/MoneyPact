/**
 * Public surface of `@cobudget/budget-application/creation-proposals`
 * (CBD-232). Anything not re-exported here is internal.
 */

export {
  PROPOSAL_CONTRACT_VERSION,
  PERIOD_CONTRACT_VERSION,
  BINDING_VERSION,
  EXPIRY_TIME_LIMIT_MS,
  IDEMPOTENCY_RETENTION_MS,
} from "./constants.ts";

export type { FieldError, ValidationErrorResponse } from "./errors.ts";

export type {
  AuthenticatedSubjectContext,
  BindingKeyring,
  BudgetCreationConfirmationUnitOfWork,
  BudgetCreationConstraintReader,
  BudgetCreationProposalReadResponse,
  BudgetCreationProposalResponse,
  BudgetCreationProposalStore,
  Clock,
  CreateOrReplayResult,
  CreateProposalRecord,
  CurrencyContextReader,
  ExpiredReason,
  GoverningVersions,
  IdempotencyConflictResponse,
  IdempotencyOperation,
  IdempotencyRecord,
  InvalidatedReason,
  NormalizedInputs,
  OpaqueIdGenerator,
  Ports,
  PreviewAdjustment,
  PreviewPeriod,
  PreviewWarning,
  ProposalContextKey,
  ProposalLifecycle,
  ProposalRecord,
  ProposalStatus,
  ReplaceProposalRecord,
  ReplaceProposalResult,
  SchedulePreview,
} from "./ports.ts";

export { InMemoryProposalStore } from "./in-memory-store.ts";

export { canonicalJSON, constantTimeEqual, digestOf, hmacSha256Base64Url, sha256Base64Url } from "./canonical-json.ts";

export { canonicalizeTimeZone, localDateOf, localMidnightInstant } from "./time-zone.ts";

export { computeSchedulePreview, calendarDataVersionFor } from "./preview.ts";

export type { BindingEnvelopeInput } from "./binding.ts";
export { canonicalBindingEnvelope } from "./binding.ts";

export type { ValidationFailure, ValidationOutcome, ValidationSuccess } from "./normalize.ts";
export { validateCreateProposalRequest, validateIdempotencyKeyHeader } from "./normalize.ts";

export type { CreateProposalCommand, CreateProposalOutcome, ReadProposalOutcome } from "./application.ts";
export {
  buildDependencyFingerprint,
  buildGoverningVersions,
  buildProposalResponse,
  computeExpiry,
  computeLifecycle,
  createOrRegenerateProposal,
  discardProposal,
  invalidateForContextChange,
  invalidateForSessionEnd,
  readProposal,
} from "./application.ts";
