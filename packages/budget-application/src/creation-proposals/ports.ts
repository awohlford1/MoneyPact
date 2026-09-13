/**
 * Persistence-independent ports and shared types (CBD-232 §9).
 *
 * This module depends on interfaces, not a database. `InMemoryProposalStore`
 * (in `in-memory-store.ts`) is the only implementation shipped here; the
 * durable, tenant-scoped implementation belongs to CBD-246.
 */

import type {
  BusinessDayPolicy,
  CadenceDefinition,
  NonBusinessDayReason,
} from "@cobudget/budget-domain/schedule";
import type { ISODate } from "@cobudget/budget-domain/shared";

// ---------------------------------------------------------------------------
// Trusted context
// ---------------------------------------------------------------------------

/**
 * Trusted authentication context, resolved by the caller (CBD-21 sessions)
 * and never accepted from client-supplied request fields (§4.1).
 */
export interface AuthenticatedSubjectContext {
  readonly environment: string;
  readonly subjectId: string;
  readonly accountId: string;
  readonly profileId: string;
  readonly sessionGeneration: number;
}

// ---------------------------------------------------------------------------
// Injected clock, identifiers, and binding keyring
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export interface OpaqueIdGenerator {
  /** A `bcp_` + 32 lowercase hex character opaque proposal identifier (§4.2). */
  proposalId(): string;
}

/**
 * Server-authenticated confirmation binding (§7.1). Implementations must
 * verify in constant time and must retain retired keys only through the
 * maximum proposal lifetime; a missing/retired key invalidates the proposal.
 */
export interface BindingKeyring {
  readonly bindingVersion: "bcp-hmac-sha256/v1";
  /** Sign canonical envelope JSON, returning an opaque token. */
  sign(canonicalEnvelope: string): string;
  /** Verify an opaque token against canonical envelope JSON, constant-time. */
  verify(canonicalEnvelope: string, token: string): boolean;
}

// ---------------------------------------------------------------------------
// Currency and lifecycle-constraint context
// ---------------------------------------------------------------------------

export interface CurrencyContextReader {
  readonly currencyCatalogVersion: string;
  isSupportedCode(code: string): boolean;
  isCompatibleWithContext(code: string, context: AuthenticatedSubjectContext): boolean;
}

/**
 * Proposed CBD-231 seam (§10.1). CBD-232 does not claim CBD-231 has accepted
 * this exact interface; it is optional here and, when supplied, its version
 * is folded into the §7.3 dependency fingerprint.
 */
export interface BudgetCreationConstraintReader {
  currentConstraintVersion(context: AuthenticatedSubjectContext): string;
}

// ---------------------------------------------------------------------------
// Governing versions
// ---------------------------------------------------------------------------

export interface GoverningVersions {
  readonly proposalContractVersion: string;
  readonly periodContractVersion: string;
  readonly calendarDataVersion: string | null;
  readonly timeZoneDataVersion: string;
  readonly currencyCatalogVersion: string;
}

// ---------------------------------------------------------------------------
// Normalized inputs, preview, and response shapes (§4.2, §6.2)
// ---------------------------------------------------------------------------

export interface NormalizedInputs {
  readonly name: string;
  readonly timeZone: string;
  readonly currencyCode: string;
  readonly schedule: CadenceDefinition;
}

export interface PreviewPeriod {
  readonly ordinal: 0 | 1 | 2 | 3;
  readonly relation: "current" | "following";
  readonly start: ISODate;
  readonly end: ISODate;
  readonly lengthInDays: number;
}

export type PreviewAdjustment =
  | {
      readonly kind: "monthly-anchor-clamp";
      readonly unadjustedDay: number;
      readonly adjustedDate: ISODate;
    }
  | {
      readonly kind: "business-day";
      readonly unadjustedDate: ISODate;
      readonly adjustedDate: ISODate;
      readonly policy: BusinessDayPolicy;
      readonly reason: NonBusinessDayReason | null;
      readonly calendarDataVersion: string;
    };

/**
 * Non-blocking preview explanations (contract gap: §6.2 declares
 * `readonly warnings: readonly PreviewWarning[]` but does not fix the item
 * shape; this is this implementation's assumption).
 */
export interface PreviewWarning {
  readonly kind: string;
  readonly periodOrdinal: 0 | 1 | 2 | 3;
  readonly message: string;
}

export interface SchedulePreview {
  readonly budgetDate: ISODate;
  readonly timeZone: string;
  readonly cadence: CadenceDefinition["cadence"];
  readonly cadenceDefinition: CadenceDefinition;
  readonly cadenceSummary: string;
  readonly periodCount: number;
  readonly periods: readonly PreviewPeriod[];
  readonly adjustments: readonly PreviewAdjustment[];
  readonly warnings: readonly PreviewWarning[];
}

export interface BudgetCreationProposalResponse {
  readonly proposalId: string;
  readonly proposalVersion: 1;
  readonly issuedStatus: "previewed";
  readonly draftRevision: number;
  readonly supersedesProposalId: string | null;
  readonly normalizedInputs: NormalizedInputs;
  readonly governingVersions: GoverningVersions;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly preview: SchedulePreview;
  readonly previewDigest: string;
  readonly confirmationBinding: string;
  readonly bindingVersion: "bcp-hmac-sha256/v1";
}

export type InvalidatedReason =
  | "superseded"
  | "dependency_changed"
  | "discarded"
  | "session_ended"
  | "context_changed";

export type ExpiredReason = "time_limit" | "local_midnight";

export type ProposalLifecycle =
  | { readonly status: "previewed"; readonly reason: null; readonly regenerateRequired: false }
  | {
      readonly status: "invalidated";
      readonly reason: InvalidatedReason;
      readonly regenerateRequired: true;
    }
  | { readonly status: "expired"; readonly reason: ExpiredReason; readonly regenerateRequired: true }
  | { readonly status: "confirmed"; readonly reason: "confirmed"; readonly regenerateRequired: false };

export interface BudgetCreationProposalReadResponse {
  readonly proposal: BudgetCreationProposalResponse;
  readonly lifecycle: ProposalLifecycle;
}

export type IdempotencyConflictResponse =
  | {
      readonly error: "idempotency_key_reused";
      readonly retryWithNewKey: true;
      readonly regenerateRequired: false;
    }
  | {
      readonly error: "idempotency_replay_unavailable";
      readonly reason: "invalidated" | "expired" | "dependency_changed";
      readonly retryWithNewKey: true;
      readonly regenerateRequired: true;
    }
  | {
      readonly error: "idempotency_replay_unavailable";
      readonly reason: "confirmed";
      readonly retryWithNewKey: true;
      readonly regenerateRequired: false;
    };

// ---------------------------------------------------------------------------
// Stored record shapes (implementation detail; not fixed by the contract text,
// which only fixes the port method signatures below and the wire responses
// above. Named and shaped here so the in-memory adapter and CBD-246's durable
// adapter have a concrete target.)
// ---------------------------------------------------------------------------

export type ProposalStatus = "previewed" | "invalidated" | "expired" | "confirmed";

export interface ProposalRecord {
  readonly proposalId: string;
  readonly proposalVersion: 1;
  readonly draftRevision: number;
  readonly predecessorProposalId: string | null;
  readonly successorProposalId: string | null;
  readonly environment: string;
  readonly subjectId: string;
  readonly accountId: string;
  readonly profileId: string;
  readonly sessionGeneration: number;
  readonly normalizedInputs: NormalizedInputs;
  readonly governingVersions: GoverningVersions;
  readonly budgetDate: ISODate;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly expiryReason: ExpiredReason;
  readonly preview: SchedulePreview;
  readonly previewDigest: string;
  readonly confirmationBinding: string;
  readonly bindingVersion: "bcp-hmac-sha256/v1";
  readonly dependencyFingerprint: string;
  readonly status: ProposalStatus;
  readonly statusReason: InvalidatedReason | ExpiredReason | "confirmed" | null;
  readonly confirmedBudgetSpaceId: string | null;
}

/** Context key identifying exactly one proposal to a single subject/session (§8.1). */
export interface ProposalContextKey {
  readonly environment: string;
  readonly subjectId: string;
  readonly accountId: string;
  readonly profileId: string;
  readonly sessionGeneration: number;
  readonly proposalId: string;
}

export type IdempotencyOperation = "create-proposal";

export interface IdempotencyRecord {
  readonly key: string;
  readonly environment: string;
  readonly subjectId: string;
  readonly accountId: string;
  readonly profileId: string;
  readonly sessionGeneration: number;
  readonly operation: IdempotencyOperation;
  readonly normalizedCommandDigest: string;
  readonly dependencyFingerprint: string;
  readonly issuedAt: string;
  readonly proposalId: string;
  readonly response: BudgetCreationProposalResponse;
}

export interface CreateProposalRecord {
  /** The instant this attempt is being evaluated at (the caller's Clock). */
  readonly now: string;
  readonly idempotency: IdempotencyRecord;
  readonly record: ProposalRecord;
}

export interface ReplaceProposalRecord {
  readonly predecessorContext: ProposalContextKey;
  readonly expectedPredecessorRevision: number;
  readonly successor: CreateProposalRecord;
}

export type CreateOrReplayResult =
  | { readonly kind: "created"; readonly record: ProposalRecord }
  | { readonly kind: "replayed"; readonly response: BudgetCreationProposalResponse }
  | { readonly kind: "idempotency_conflict"; readonly conflict: IdempotencyConflictResponse };

/**
 * `predecessor_conflict` is this implementation's name for the bare
 * expected-revision/eligibility conflict §9 describes ("a predecessor that
 * already has a successor, or that was CONFIRMED, is a conflict") when it is
 * not also an idempotency-key conflict. The contract fixes the idempotency
 * conflict wire shape (§4.1) but leaves the pure-revision case a persistence
 * detail; this is this implementation's assumption, stated per the task
 * packet.
 */
export type ReplaceProposalResult =
  | { readonly kind: "created"; readonly record: ProposalRecord }
  | { readonly kind: "replayed"; readonly response: BudgetCreationProposalResponse }
  | { readonly kind: "idempotency_conflict"; readonly conflict: IdempotencyConflictResponse }
  | { readonly kind: "predecessor_conflict" };

/**
 * §9's persistence-independent store. `createOrReplay` handles requests
 * without `supersedesProposalId`; `replaceCurrent` handles requests with one,
 * with the fixed evaluation order the contract requires: look up the
 * successor idempotency record first, and only evaluate predecessor
 * eligibility when none exists.
 */
export interface BudgetCreationProposalStore {
  createOrReplay(command: CreateProposalRecord): Promise<CreateOrReplayResult>;
  replaceCurrent(command: ReplaceProposalRecord): Promise<ReplaceProposalResult>;
  loadForContext(key: ProposalContextKey): Promise<ProposalRecord | null>;
  invalidate(
    key: ProposalContextKey,
    expectedRevision: number,
    reason: InvalidatedReason,
  ): Promise<void>;
}

/** Transaction-bound confirmation seam, amended by CBD-233 section 8. */
export interface BudgetCreationConfirmationUnitOfWork {
  /** Available only inside the confirmation transaction callback. */
  claimCurrentProposal(key: ProposalContextKey, binding: string, expectedLifecycleRevision: number): Promise<ProposalRecord>;
  recordConfirmed(command: { readonly context: ProposalContextKey; readonly authoritativeBudgetSpaceId: string;
    readonly confirmationOutcomeId: string; readonly expectedLifecycleRevision: number; readonly bindingDigest: string }): Promise<void>;
}

export interface Ports {
  readonly clock: Clock;
  readonly idGenerator: OpaqueIdGenerator;
  readonly bindingKeyring: BindingKeyring;
  readonly currencyContextReader: CurrencyContextReader;
  readonly constraintReader?: BudgetCreationConstraintReader;
  readonly store: BudgetCreationProposalStore;
  readonly timeZoneDataVersion: string;
}
