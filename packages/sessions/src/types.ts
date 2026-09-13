/**
 * CBD-191 shared types. This package defines `SessionIssueCommandV1` itself
 * (packages/contracts does not export the CBD-190 SS6 hand-off shape; the
 * packet requires it be defined here as a typed in-process boundary).
 */

export type Environment = string;
export type AccountSubjectId = string;
export type SessionRef = string;
export type SessionSelector = string;
export type RevocationEpoch = number;
export type SessionVersion = number;

/** SS5.2 closed vocabulary. `recovery` and the bound-context branch of
 * `authentication` cannot be selected from a CBD-190 v0.3 command; they are
 * named here because §5.3's fence and a future additive CBD-190 revision use
 * them. */
export type RotationCause = "authentication" | "recovery" | "assurance_elevation" | "account_switch";

/** SS6.1 application-initiated causes, plus the SS6.2 provider-initiated
 * causes normalized onto the same closed vocabulary (see
 * `providerEventClassToCause`). Shared by `account_session.revocation_cause`,
 * `account_subject_authority.epoch_bump_cause`, and `revocation_outbox.cause`. */
export type RevocationCause =
  | "logout"
  | "logout_everywhere"
  | "recovery_completed"
  | "credential_or_factor_change"
  | "account_deletion"
  | "security_action"
  | "permission_loss"
  | "provider_global_sign_out"
  | "provider_account_disabled"
  | "provider_account_deleted"
  | "provider_compromised_credentials_action";

/** SS6.1: the subject-epoch-bumping causes ("subject epoch bump" column). Every
 * cause here is one for which no single-row revoke ever substitutes. */
export const EPOCH_BUMP_CAUSES: readonly RevocationCause[] = [
  "logout_everywhere",
  "recovery_completed",
  "credential_or_factor_change",
  "account_deletion",
  "security_action",
  "permission_loss",
  "provider_global_sign_out",
  "provider_account_disabled",
  "provider_account_deleted",
  "provider_compromised_credentials_action",
];

/** SS6.1: causes requiring durable global provider invalidation via the outbox. */
export const GLOBAL_PROVIDER_INVALIDATION_CAUSES: readonly RevocationCause[] = [
  "logout_everywhere",
  "recovery_completed",
  "credential_or_factor_change",
  "account_deletion",
  "security_action",
];

/** SS6.1/SS7: causes requiring delegation retirement via the outbox. */
/** `recovery_completed`'s table row conditions delegation retirement on
 * recovery policy ("where recovery policy requires it") rather than making
 * it unconditional like the three causes below, and recovery is unsupported
 * under v0.3 in any case (`OQ-191-007`); it is therefore deliberately
 * excluded here rather than approximated. */
export const DELEGATION_RETIREMENT_CAUSES: readonly RevocationCause[] = [
  "account_deletion",
  "security_action",
  "permission_loss",
];

export interface SessionRecord {
  readonly sessionId: string;
  readonly sessionSelector: SessionSelector;
  readonly verifierDigest: string;
  readonly sessionRef: SessionRef;
  readonly accountSubjectId: AccountSubjectId;
  readonly environmentId: Environment;
  readonly identityBindingId: string | undefined;
  readonly sessionVersion: SessionVersion;
  readonly issuedRevocationEpoch: RevocationEpoch;
  readonly state: "active" | "rotated" | "revoked" | "expired";
  readonly supersededBySessionRef: SessionRef | undefined;
  readonly assuranceLevel: "session" | "fresh";
  readonly freshAssurance:
    | { readonly boundAction: string | undefined; readonly boundSpaceId: string | undefined; readonly expiresAt: Date }
    | undefined;
  readonly csrfDigest: string;
  readonly issuedAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly rotationCause: RotationCause;
  readonly revocationCause: RevocationCause | "orphaned_delivery_result_expiry" | undefined;
}

/** CBD191-CORRECTION-001 item 6: the subject lifecycle `consumeAndIssue` rechecks
 * as part of the same compare-and-swap as the epoch/version fence. Only
 * `active` may issue a new session; the rest are terminal once reached. */
export type SubjectLifecycle = "active" | "disabled" | "deletion_pending" | "deleted" | "security_blocked";

export interface SubjectAuthority {
  readonly accountSubjectId: AccountSubjectId;
  readonly nextSessionVersion: number;
  readonly revocationEpoch: RevocationEpoch;
  readonly subjectLifecycle: SubjectLifecycle;
  /** `""` means no cursor has been applied yet (lexical bottom). */
  readonly latestAppliedCursor: string;
}

export class StaleEpochError extends Error {
  constructor() {
    super("the subject's revocation epoch or lifecycle changed since this handoff observed it (SC-191-003A); consumption is rejected, not silently re-fenced to the new epoch");
    this.name = "StaleEpochError";
  }
}

export class SubjectNotActiveError extends Error {
  constructor(lifecycle: SubjectLifecycle) {
    super(`the subject is not active (lifecycle=${lifecycle}); no new session may be issued`);
    this.name = "SubjectNotActiveError";
  }
}

/**
 * The CBD-190 v0.3 §6 hand-off shape this document consumes, as a typed
 * in-process boundary owned by this package (packages/contracts does not
 * export it). `previousSessionId`/`boundSessionRef` supply the §5.2 rotation
 * table's "current row" context; a v0.3 command never carries
 * `preparedRevocationEpoch` (§5.3), so the fence recorded there fails closed
 * whenever this field is absent (`OQ-191-007`).
 */
export interface SessionIssueCommandV1 {
  readonly contractVersion: 1;
  readonly sessionHandoffId: string;
  readonly accountSubjectId: AccountSubjectId;
  readonly environmentId: Environment;
  readonly identityBindingId: string | undefined;
  readonly rotationCause: RotationCause;
  /** Present only for `account_switch` (CBD-190 §5.4). */
  readonly previousSessionId: string | undefined;
  /** Server-bound current-browser session context CBD-191 must capture itself
   * (§5.2's closing paragraph); a v0.3 command never supplies it. */
  readonly boundCurrentSessionRef: SessionRef | undefined;
  /** §5.3's fence input. Absent under every v0.3 command. */
  readonly preparedRevocationEpoch: RevocationEpoch | undefined;
  readonly freshAssurance:
    | { readonly boundAction: string; readonly boundSpaceId: string | undefined }
    | undefined;
  readonly deliverUntil: Date;
}

export interface ServerSessionContext {
  readonly now: Date;
}

export interface SealedSessionDelivery {
  readonly sessionRef: SessionRef;
  readonly cookieValue: string;
  readonly csrfValue: string;
  readonly absoluteExpiresAt: Date;
}

/** SS6.2 closed vocabulary. */
export type ProviderEventClass =
  | "credential_changed"
  | "factor_changed"
  | "account_disabled"
  | "account_deleted"
  | "global_sign_out"
  | "compromised_credentials_action";

/** SS6.2 `SC-191-004`: the canonical event envelope. Authenticated by its own
 * adapter before this package ever sees it -- nothing here re-derives trust. */
export interface ProviderSecurityEventV1 {
  readonly contractVersion: 1;
  readonly environmentId: Environment;
  readonly issuer: string;
  readonly providerSubject: string;
  readonly eventClass: ProviderEventClass;
  readonly providerEventId: string;
  readonly providerEventTime: Date;
  readonly orderingCursor: string | undefined;
  readonly receivedAt: Date;
}

export type ProviderEventProcessingState = "applied" | "applied_pending_reconciliation" | "superseded" | "rejected";
export type ProviderEventRejectionReason = "cross_environment" | "unknown_binding";

export interface ProviderEventOutcome {
  readonly processingState: ProviderEventProcessingState;
  readonly rejectionReason: ProviderEventRejectionReason | undefined;
  readonly identityBindingId: string | undefined;
}

/** §6.2 step 5: normalizes a provider event class onto the shared revocation-cause vocabulary ("every provider-initiated class is an epoch bump"). */
export function providerEventClassToCause(eventClass: ProviderEventClass): RevocationCause {
  switch (eventClass) {
    case "credential_changed":
    case "factor_changed":
      return "credential_or_factor_change";
    case "account_disabled":
      return "provider_account_disabled";
    case "account_deleted":
      return "provider_account_deleted";
    case "global_sign_out":
      return "provider_global_sign_out";
    case "compromised_credentials_action":
      return "provider_compromised_credentials_action";
    default: {
      const unreachable: never = eventClass;
      throw new Error(`unknown provider event class ${String(unreachable)}`);
    }
  }
}

export type RevocationTarget = "provider_global_invalidation" | "provider_current_browser_bound" | "delegation_retirement";
export type OutboxAttemptState = "pending" | "in_flight" | "succeeded" | "ambiguous" | "failed_will_retry" | "failed_deadline_exceeded";

export interface RevocationAction {
  readonly revocationActionId: string;
  readonly accountSubjectId: AccountSubjectId;
  readonly identityBindingId: string | undefined;
  readonly environmentId: Environment;
  readonly cause: RevocationCause;
  readonly target: RevocationTarget;
  readonly revocationEpoch: RevocationEpoch;
  readonly occurredAt: Date;
  readonly deadlineAt: Date;
  readonly attemptState: OutboxAttemptState;
  readonly attemptCount: number;
}

export class SessionStoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("session store unavailable; resolution and revocation both fail closed (CT-191-009)");
    this.name = "SessionStoreUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}
