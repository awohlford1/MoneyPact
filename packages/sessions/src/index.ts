/**
 * @cobudget/sessions (CBD-191)
 *
 * Opaque application sessions, per-session version and subject revocation
 * epoch, rotation, application- and provider-initiated two-way revocation,
 * and the local Cognito-shaped provider-event adapter. Persistence goes
 * through @cobudget/data-access; no framework.
 *
 * CBD191-SECURITY-002 High finding 3: `sealDelivery`/`openDelivery`
 * (`envelope.ts`) are deliberately NOT re-exported here. Decrypt/seal
 * capability for the delivery envelope is confined to `issuance.ts`, the
 * "isolated issuance/replay component."
 */
export { resolveSessionConfig, MissingSessionConfigError, SESSION_COOKIE_NAME } from "./config.ts";
export type { SessionConfig, SessionConfigEnvironment } from "./config.ts";

export {
  resolveSessionEnvelopeKeyProvider,
  MissingEnvelopeKeyConfigError,
  EnvelopeKeyProviderNotAllowedError,
  KmsEnvelopeKeyProviderNotConfiguredError,
} from "./envelope-key.ts";
export type { EnvelopeKeyProvider } from "./envelope-key.ts";
export type { EnvelopeKeyConfigEnvironment } from "./envelope-key.ts";

export {
  generateOpaqueIdentifier,
  parseCookieValue,
  pepperedDigest,
  verifyPepperedDigest,
  syntheticCandidate,
  generateCsrfValue,
  generateSessionRef,
  cryptoRandomJitterMs,
} from "./crypto.ts";
export type { OpaqueIdentifier, ParsedCookieValue } from "./crypto.ts";

export { DeliveryEnvelopeTamperedError } from "./envelope.ts";

export { SessionStore, createSessionStore } from "./store.ts";

export { resolveSession, verifySessionStillLive } from "./resolve.ts";
export type { ResolutionOutcome, ResolvedSession, RejectedSession, ResolutionDiagnostic } from "./resolve.ts";

export { consumeAndIssue, IssuanceRejectedError, UnsupportedUnderV03Error } from "./issuance.ts";

export { logout, bumpSubjectForCause } from "./revocation.ts";

export { processProviderEvent, reconcileProviderEvent } from "./provider-events.ts";
export type { IdentityBindingLookup, ResolveIdentityBinding, ProviderEventResult } from "./provider-events.ts";

export { drainRevocationOutbox } from "./outbox-worker.ts";
export type {
  ProviderRevocationAdapter,
  ProviderOperationOutcome,
  DelegationRetirementAdapter,
  DrainOptions,
  DrainResult,
} from "./outbox-worker.ts";

export { sweepExpiredDeliveryResults } from "./sweep-worker.ts";
export type { SweepResult } from "./sweep-worker.ts";

export {
  FIDELITY_LABEL,
  genuineFixture,
  forgedFixture,
  authenticateLocalEvent,
  isAuthenticated,
  UnauthenticatedProviderEventError,
  allEventClasses,
  ControllableLocalProviderAdapter,
  AuthenticatedProviderEvent,
} from "./local-adapter.ts";
export type { LocalAdapterAuthenticity } from "./local-adapter.ts";
export type { LocalProviderEventFixture } from "./local-adapter.ts";

export {
  buildSessionCookieHeader,
  buildSessionCookieDeletionHeader,
  readSessionCookieValue,
  checkCsrf,
} from "./cookie.ts";
export type { CsrfCheckInput } from "./cookie.ts";

export {
  FRESH_ASSURANCE_TABLE,
  consumeFreshAssurance,
  findFreshAssuranceByChallenge,
  findUsableFreshAssurance,
  issueFreshAssurance,
} from "./fresh-assurance.ts";
export type { FreshAssuranceGrant, FreshAssuranceLookup, IssueFreshAssuranceInput, IssueFreshAssuranceOutcome } from "./fresh-assurance.ts";

export { createSessionFactSourceAdapter } from "./fact-source.ts";
export type { MinimalFactSourceAdapter } from "./fact-source.ts";

export {
  EPOCH_BUMP_CAUSES,
  GLOBAL_PROVIDER_INVALIDATION_CAUSES,
  DELEGATION_RETIREMENT_CAUSES,
  providerEventClassToCause,
  SessionStoreUnavailableError,
  StaleEpochError,
  SubjectNotActiveError,
} from "./types.ts";
export type {
  AccountSubjectId,
  Environment,
  OutboxAttemptState,
  ProviderEventClass,
  ProviderEventOutcome,
  ProviderEventProcessingState,
  ProviderEventRejectionReason,
  ProviderSecurityEventV1,
  RevocationAction,
  RevocationCause,
  RevocationEpoch,
  RevocationTarget,
  RotationCause,
  SealedSessionDelivery,
  SessionIssueCommandV1,
  SessionRecord,
  SessionRef,
  SessionSelector,
  SessionVersion,
  ServerSessionContext,
  SubjectAuthority,
  SubjectLifecycle,
} from "./types.ts";
