/**
 * `@cobudget/budget-application/primary-transfer` (PK-7A).
 *
 * The Primary-transfer state service, its ports, its two adapters, the
 * `TR-73-43` commit transaction and the four obligation discharges PK-7B
 * composes into `ApiTransactionStore`. PK-7B composes this with `apps/api`'s
 * authorization boundary, the membership resource reader and the six routes;
 * nothing under `src/primary-transfer` imports a database or a framework.
 */
export type {
  PrimaryTransferErrorCode, PrimaryTransferRecord, TransferAuditEvent, TransferConsentInsert,
  TransferConsentRecord, TransferEventSubtype, TransferMembershipRecord, TransferNotice,
  TransferSpaceFacts, TransferState, TransferView,
} from "./records.ts";
export {
  COMMIT_NOTICE_MESSAGE_CODE, ELIGIBLE_RECIPIENT_ROLES, EXPIRY_MESSAGE_CODE, INVALIDATION_MESSAGE_CODE,
  LIVE_TRANSFER_STATES, OUTGOING_DISCLOSURE_KIND, OUTGOING_ROLE_AFTER, PRIMARY_TRANSFER_ERROR_CODES,
  PrimaryTransferError, RECIPIENT_DISCLOSURE_KIND, RECIPIENT_ROLE_AFTER, TERMINAL_TRANSFER_STATES,
  TRANSFER_AUDIT_PAYLOAD_KEYS, TRANSFER_CONSENT_SOURCE, TRANSFER_ENDED_REASON_CLASS, TRANSFER_EVENT_SUBTYPES,
  TRANSFER_MESSAGE_CODES, TRANSFER_STATES, UNIFORM_DENIAL_MESSAGE_CODE, assertTransferAuditPayload,
  isLiveTransferState, isPrimaryTransferError, isTerminalTransferState, transferView,
} from "./records.ts";

export { TRANSFER_EDGES, assertTransferEdge, isTransferEdge, transferEdgeTransition } from "./transitions.ts";

export type {
  ActorContext, BudgetSpacePrimaryTransferRow, Clock, ConsentSupersedePatch, IdGenerator,
  PermissionInvitationRow, PermissionLostInvitation, PermissionLostInvitationCanceller, PolicyDecision,
  PrimaryTransferDependencies, PrimaryTransferRepository, PrimaryTransferStatements, TransferActionCode,
  TransferConsentRow, TransferLifetimes, TransferMembershipRow, TransferPatch, TransferSpaceRow,
} from "./ports.ts";
export { DEFAULT_TRANSFER_LIFETIMES, TRANSFER_ACTION_CODES, TRANSFER_PERMISSION } from "./ports.ts";

export type { TransferAuditInput } from "./events.ts";
export {
  NOTICE_EVENT_CODE, TRANSFER_EVENT_CODE, assertCurrentTransferDisclosure, transferAuditEvent,
} from "./events.ts";

export type {
  PrimaryTransferObligations, TransferCapture, TransferObligationInput, TransferObligationKind,
  TransferObligationLedger,
} from "./obligations.ts";
export { LOST_PERMISSION, TRANSFER_OBLIGATION_KINDS, primaryTransferObligations } from "./obligations.ts";

export type { CommitBoundary, CommitOptions, TransferReceipt } from "./commit.ts";
export { COMMIT_BOUNDARIES, commitPrimaryTransfer, transferReceiptOf } from "./commit.ts";

export type {
  AcceptResult, ConfirmResult, MembershipResourceLeaves, ProposeResult, ProposeTransferRequest,
  TerminateResult, TransferClosed, TransferCommitted, TransferDenied, TransferDisclosureClaim,
  TransferDisclosureTexts, TransferLegRecorded, TransferLegRequest, TransferProposed, TransferRequest,
  TransferTerminated, ViewResult,
} from "./application.ts";
export {
  acceptPrimaryTransfer, assertAcknowledgedTransferDisclosure, confirmPrimaryTransfer, declinePrimaryTransfer,
  parseProposeTransferRequest, parseTransferDisclosureClaim, parseTransferRequest, proposePrimaryTransfer,
  readMembershipResourceLeaves, transferDisclosureTexts, viewPrimaryTransfer, withdrawPrimaryTransfer,
} from "./application.ts";

export { InMemoryPrimaryTransferRepository } from "./in-memory.ts";
export {
  CHECK_VIOLATION_SQLSTATE, DEADLOCK_SQLSTATE, SERIALIZATION_FAILURE_SQLSTATE, UNIQUE_VIOLATION_SQLSTATE,
  dataAccessPrimaryTransferRepository, translateStatementFailure,
} from "./data-access-adapter.ts";
