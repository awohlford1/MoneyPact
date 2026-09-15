/**
 * `@cobudget/budget-application/invitations` (PK-5).
 *
 * The state service, its ports, its two adapters, the simulated local
 * delivery adapter and the digest construction. PK-6 composes this with
 * `apps/api`'s authorization boundary and the data-access statement modules;
 * nothing under `src/invitations` imports a database or a framework.
 */
export type {
  AcceptanceConsentRecord, CeremonyRecord, CeremonyState, ChannelProofState, CodeDisposition,
  ConfirmationRecord, ConfirmationState, DisplayIdentity, InvitableRole, InvitationCodeRecord,
  InvitationErrorCode, InvitationKind, InvitationProjection, InvitationProjectionState, InvitationRecord,
  InvitationState, LifecycleAuditEvent, LifecycleNotice, MembershipRecord, NoticeMessageCode,
  PrivateTerminalCause, RequiredPermission, SecurityEvent, SecurityEventOutcomeClass,
} from "./records.ts";
export {
  ACTIVE_INVITATION_STATES, AUDIT_PAYLOAD_KEYS, CEREMONY_STATES, CHANNEL_PROOF_STATES,
  CODE_DISPOSITIONS, CONFIRMATION_BINDING_RULE_ID, CONFIRMATION_BINDING_RULE_VERSION, CONFIRMATION_STATES,
  DELIVERY_FIDELITY_LABEL, INVITABLE_ROLES, INVITATION_ERROR_CODES, INVITATION_KINDS, INVITATION_STATES,
  InvitationError, MAX_CHANNEL_ATTEMPTS, NEUTRAL_DISPLAY_LABEL, NOTICE_MESSAGE_CODES,
  PRIVATE_TERMINAL_CAUSES, PROJECTION_STATES, REQUIRED_PERMISSIONS, RESTRICTED_ONLY_EVENT_CODES,
  ROLE_DISCLOSURE_KIND, ROLE_PERMISSION, UNIFORM_CEREMONY_OUTCOME, UNIFORM_LINK_MESSAGE_CODE,
  UNIFORM_LINK_OUTCOME, assertAuditPayload, invitationProjection, isInvitationError,
} from "./records.ts";

export {
  CEREMONY_EDGES, CODE_DISPOSITION_EDGES, CONFIRMATION_EDGES, INVITATION_EDGES,
  TERMINAL_INVITATION_STATES, assertCeremonyEdge, assertCodeDispositionEdge, assertConfirmationEdge,
  assertInvitationEdge, invitationEdgeTransition, isTerminalInvitationState,
} from "./transitions.ts";

export type { DigestKeySource, DigestPurpose, KeyedDigest } from "./secrets.ts";
export {
  DIGEST_PURPOSES, abuseFingerprint, canonicalizeEmailDestination, ceremonySecretDigest,
  channelChallengeDigest, codeVerifierDigest, createKeyedDigest, destinationToken, digestsEqual,
  generateBearer, generateCeremonySecret, generateChannelChallenge, maskEmailDestination,
} from "./secrets.ts";

export type {
  BudgetSpaceFacts, BudgetSpaceInvitationCeremonyRow, BudgetSpaceInvitationCodeRow,
  BudgetSpaceInvitationConfirmationRow, BudgetSpaceInvitationOutboxRow, BudgetSpaceInvitationRow,
  BudgetSpaceMembershipRow, CeremonyPatch, ChannelChallengeReader, Clock, ConfirmationPatch,
  FinancialProfileDisplayRow, IdGenerator, InviteeContext, InvitationLocation, InvitationLocator,
  InvitationPatch, InvitationRepository, InvitationStatements, LiveCodeBinding, OutboxInsert,
  OutboxRecord, OutboxTombstoneReason, OwnerContext, PolicyDecision,
} from "./ports.ts";

export type {
  AcceptInvitationRequest, AcceptResult, AcceptSuccess, AttachResult, AttachSuccess, AuditInput,
  CeremonyRequest, ConfirmAcceptanceRequest, ConfirmationPrompt, CreateInvitationRequest,
  CreateInvitationResult, DestinationEncryptor, DisclosureView,
  InvitationDependencies, InvitationLifetimes, ResolveCodeRequest, ResolveCodeResult,
  ResolveCodeSuccess, UnauthenticatedCeremonyRequest, UniformUnusable, VerifyChannelRequest,
  VerifyChannelResult,
} from "./application.ts";
export {
  DEFAULT_LIFETIMES, UNIFORM_UNUSABLE, acceptInvitation, assertCurrentDisclosure, attachAccount,
  auditEvent, cancelInvitation, cancelRecord, createInvitation, currentConfirmation, declineInvitation,
  displayLabel, expireOnObservation, parseAcceptInvitationRequest, parseCeremonyRequest,
  parseConfirmAcceptanceRequest, parseCreateInvitationRequest, parseResolveCodeRequest,
  parseUnauthenticatedCeremonyRequest, parseVerifyChannelRequest, readConfirmationPrompt,
  readDisclosure, replaceInvitation, resolveCode, verifyChannel,
} from "./application.ts";

export type { AcceptanceBoundary, AcceptanceOptions, AcceptanceReceipt } from "./acceptance.ts";
export { ACCEPTANCE_BOUNDARIES, commitRequestDigest, confirmAcceptance, rejectAcceptance } from "./acceptance.ts";

export { InMemoryInvitationRepository } from "./in-memory.ts";
export {
  SERIALIZATION_FAILURE_SQLSTATE, dataAccessInvitationLocator, dataAccessInvitationRepository,
  translateStatementFailure,
} from "./data-access-adapter.ts";

export type { DeliveryOutboxPort, LocalDeliveryAdapter, SimulatedDelivery } from "./delivery.ts";
export { createLocalDeliveryAdapter } from "./delivery.ts";
