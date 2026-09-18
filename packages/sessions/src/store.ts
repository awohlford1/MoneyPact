/**
 * `SessionStorePort` (contract §3.4) backed by `@cobudget/data-access`'s
 * platform statement API.
 *
 * KNOWN LIMITATION (recorded for the final report and for `OQ-191-006`):
 * `DataAccessClient` exposes only single-statement `platformSelect`/
 * `platformInsert`/`platformUpdate`/`platformDelete` -- there is no
 * multi-statement transaction primitive, no `RETURNING` on update, and no
 * `SET column = column + 1` expression support (`platformUpdate.set` only
 * binds literal values). `packages/data-access/src/client.ts` and
 * `tenant.ts` are outside this packet's writable scope, so this module
 * cannot add one.
 *
 * CBD191-CORRECTION-001 round: `#casAuthority` is the one place every
 * mutation of `account_subject_authority` goes through. Every call binds
 * *all four* mutable columns (`next_session_version`, `revocation_epoch`,
 * `subject_lifecycle`, `latest_applied_cursor`) into the compare-and-swap
 * condition, not just the column the caller intends to change -- so a
 * concurrent writer that only touched a different column still forces a
 * retry with a freshly re-read row, closing the CBD191-REVIEW-IMPL-001
 * High finding that `allocateSessionVersion`'s CAS ignored a concurrent
 * epoch bump. `decide()` inspects the freshly re-read row on every attempt
 * and may reject outright (`StaleEpochError`/`SubjectNotActiveError`)
 * instead of retrying, which is what lets `issuance.ts` implement
 * `SC-191-003A`'s "reject a prepared handoff when its bound epoch differs
 * from current" rather than silently re-fencing to the new epoch.
 *
 * Every insert that must be idempotent under retry is protected by a unique
 * index instead of `INSERT ... ON CONFLICT` (also unavailable through this
 * client): a duplicate insert throws `StatementFailedError` (CBD-246's error
 * wrapper deliberately discards driver detail, so this layer cannot
 * distinguish "unique violation" from another failure) and the caller
 * re-reads the row it expected to be there.
 *
 * `claimRevocationActions`/`claimRevocationActionsInFlight` cannot express
 * `ORDER BY`/`LIMIT` or an `IN` condition through `PlatformSelectQuery`; they
 * query each claimable `attempt_state` value separately and slice
 * client-side. Fine for the fixture volumes this packet's tests use; a real
 * drain needs those primitives added to `@cobudget/data-access` (another
 * CBD-246 follow-up, outside this packet's writable scope).
 */
import { randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import type {
  AccountSubjectId,
  Environment,
  OutboxAttemptState,
  ProviderEventOutcome,
  ProviderSecurityEventV1,
  RevocationAction,
  RevocationCause,
  RevocationEpoch,
  RevocationTarget,
  SessionRecord,
  SessionRef,
  SessionSelector,
  SessionVersion,
  SubjectAuthority,
  SubjectLifecycle,
} from "./types.ts";
import { SessionStoreUnavailableError, StaleEpochError, SubjectNotActiveError } from "./types.ts";

/** Claimable by a plain retry (no reconciliation owed). `ambiguous` is
 * deliberately excluded -- §6.1 requires it be reconciled before retry;
 * see `outbox-worker.ts#reconcileAmbiguous`. */
const RETRYABLE_STATES: readonly OutboxAttemptState[] = ["pending", "failed_will_retry"];
const MAX_CAS_ATTEMPTS = 8;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toRecord(row: Record<string, unknown>): SessionRecord {
  return {
    sessionId: String(row.session_id),
    sessionSelector: String(row.session_selector),
    verifierDigest: String(row.verifier_digest),
    sessionRef: String(row.session_ref),
    accountSubjectId: String(row.account_subject_id),
    environmentId: String(row.environment_id),
    identityBindingId: row.identity_binding_id == null ? undefined : String(row.identity_binding_id),
    sessionVersion: Number(row.session_version),
    issuedRevocationEpoch: Number(row.issued_revocation_epoch),
    state: row.state as SessionRecord["state"],
    supersededBySessionRef: row.superseded_by_session_ref == null ? undefined : String(row.superseded_by_session_ref),
    assuranceLevel: row.assurance_level as SessionRecord["assuranceLevel"],
    freshAssurance:
      row.assurance_level === "fresh"
        ? {
            boundAction: row.fresh_assurance_bound_action == null ? undefined : String(row.fresh_assurance_bound_action),
            boundSpaceId: row.fresh_assurance_bound_space_id == null ? undefined : String(row.fresh_assurance_bound_space_id),
            expiresAt: toDate(row.fresh_assurance_expires_at),
          }
        : undefined,
    csrfDigest: String(row.csrf_digest),
    issuedAt: toDate(row.issued_at),
    idleExpiresAt: toDate(row.idle_expires_at),
    absoluteExpiresAt: toDate(row.absolute_expires_at),
    rotationCause: row.rotation_cause as SessionRecord["rotationCause"],
    revocationCause: row.revocation_cause == null ? undefined : (row.revocation_cause as SessionRecord["revocationCause"]),
  };
}

function toAuthority(accountSubjectId: AccountSubjectId, row: Record<string, unknown>): SubjectAuthority {
  return {
    accountSubjectId,
    nextSessionVersion: Number(row.next_session_version),
    revocationEpoch: Number(row.revocation_epoch),
    subjectLifecycle: row.subject_lifecycle as SubjectLifecycle,
    latestAppliedCursor: String(row.latest_applied_cursor ?? ""),
  };
}

async function withStoreFailure<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StaleEpochError || error instanceof SubjectNotActiveError) throw error;
    throw new SessionStoreUnavailableError(error);
  }
}

/** A `#casAuthority` decision: either write the given columns (all four are
 * always re-asserted in the WHERE clause against the freshly-read row this
 * decision was computed from) or skip with no write at all. */
type AuthorityCasDecision<T> =
  | {
      readonly write: {
        readonly nextSessionVersion?: number;
        readonly revocationEpoch?: number;
        readonly latestAppliedCursor?: string;
        readonly subjectLifecycle?: SubjectLifecycle;
        readonly bumpCause?: RevocationCause;
      };
      readonly result: T;
    }
  | { readonly write?: undefined; readonly result: T };

export class SessionStore {
  readonly #client: DataAccessClient;

  constructor(client: DataAccessClient) {
    this.#client = client;
  }

  /** Bootstrap-creating read, used only by issuance/revocation paths that are
   * allowed to originate a subject's first authority row. */
  async currentSubjectAuthority(accountSubjectId: AccountSubjectId): Promise<SubjectAuthority> {
    return withStoreFailure(async () => this.#ensureAuthority(accountSubjectId));
  }

  /**
   * Strict read for resolution (CBD191-REVIEW-IMPL-001 Medium finding): a
   * live session should never be resolvable if its subject has no authority
   * row at all -- that is an anomaly, not a bootstrap case -- so this never
   * creates one. Returns `undefined` rather than throwing so `resolve.ts`
   * can fail closed with its ordinary `not_authenticated` shape.
   */
  async readSubjectAuthorityStrict(accountSubjectId: AccountSubjectId): Promise<SubjectAuthority | undefined> {
    return withStoreFailure(async () => this.#readAuthority(accountSubjectId));
  }

  async #readAuthority(accountSubjectId: AccountSubjectId): Promise<SubjectAuthority | undefined> {
    const result = await this.#client.platformSelect({
      table: "account_subject_authority",
      conditions: [{ column: "account_subject_id", value: accountSubjectId }],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? toAuthority(accountSubjectId, row) : undefined;
  }

  async #ensureAuthority(accountSubjectId: AccountSubjectId): Promise<SubjectAuthority> {
    const existing = await this.#readAuthority(accountSubjectId);
    if (existing) return existing;
    try {
      await this.#client.platformInsert({
        table: "account_subject_authority",
        values: { account_subject_id: accountSubjectId, next_session_version: 1, revocation_epoch: 1, subject_lifecycle: "active", latest_applied_cursor: "" },
      });
    } catch {
      // Most likely a concurrent first-issuance race inserted the row first
      // (see the module-level note: this layer cannot distinguish a unique
      // violation from another failure). Re-read rather than fail closed on
      // a race that already produced a valid row.
    }
    const row = await this.#readAuthority(accountSubjectId);
    if (!row) throw new SessionStoreUnavailableError();
    return row;
  }

  /**
   * The one path every `account_subject_authority` mutation takes.
   * `bootstrap` controls whether a missing row is created (issuance
   * contexts) or treated as absent (nothing calls this in resolution --
   * `readSubjectAuthorityStrict` is strict-read-only and never mutates).
   */
  async #casAuthority<T>(accountSubjectId: AccountSubjectId, decide: (current: SubjectAuthority) => AuthorityCasDecision<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.#ensureAuthority(accountSubjectId);
      const decision = decide(current);
      if (!decision.write) return decision.result;

      const set: Record<string, unknown> = {};
      if (decision.write.nextSessionVersion !== undefined) set.next_session_version = decision.write.nextSessionVersion;
      if (decision.write.revocationEpoch !== undefined) set.revocation_epoch = decision.write.revocationEpoch;
      if (decision.write.latestAppliedCursor !== undefined) set.latest_applied_cursor = decision.write.latestAppliedCursor;
      if (decision.write.subjectLifecycle !== undefined) set.subject_lifecycle = decision.write.subjectLifecycle;
      if (decision.write.revocationEpoch !== undefined) {
        set.epoch_bumped_at = new Date();
        set.epoch_bump_cause = decision.write.bumpCause ?? null;
      }

      const result = await this.#client.platformUpdate({
        table: "account_subject_authority",
        set,
        conditions: [
          { column: "account_subject_id", value: accountSubjectId },
          { column: "next_session_version", value: current.nextSessionVersion },
          { column: "revocation_epoch", value: current.revocationEpoch },
          { column: "subject_lifecycle", value: current.subjectLifecycle },
          { column: "latest_applied_cursor", value: current.latestAppliedCursor },
        ],
      });
      if (result.rowCount === 1) return decision.result;
      // Row changed since `current` was read (by any of the four guarded
      // columns): loop and let `decide` re-evaluate against the fresh row.
    }
    throw new SessionStoreUnavailableError();
  }

  /**
   * `SC-191-003A`: allocates the new session's `sessionVersion` only if the
   * subject is still `active` and its `revocationEpoch` still equals
   * `observedRevocationEpoch` -- the epoch `issuance.ts` captured when the
   * handoff/ceremony began, standing in for CBD-190 v0.3's absent
   * `preparedRevocationEpoch` (`OQ-191-007`). A concurrent epoch bump or
   * lifecycle change between that observation and this call rejects the
   * whole consumption (`StaleEpochError`/`SubjectNotActiveError`) rather
   * than silently reissuing at the new epoch -- this is what closes
   * CBD191-REVIEW-IMPL-001's High finding and CBD191-SECURITY-002's
   * expired/stale-authority concern.
   */
  async allocateSessionVersionFenced(accountSubjectId: AccountSubjectId, observedRevocationEpoch: RevocationEpoch): Promise<{ sessionVersion: SessionVersion; revocationEpoch: RevocationEpoch }> {
    return withStoreFailure(() =>
      this.#casAuthority(accountSubjectId, (current) => {
        if (current.revocationEpoch !== observedRevocationEpoch) throw new StaleEpochError();
        if (current.subjectLifecycle !== "active") throw new SubjectNotActiveError(current.subjectLifecycle);
        return { write: { nextSessionVersion: current.nextSessionVersion + 1 }, result: { sessionVersion: current.nextSessionVersion, revocationEpoch: current.revocationEpoch } };
      }),
    );
  }

  /** SS4/SS6.1: bumps the subject's revocation epoch exactly once, atomically
   * per call (CBD-191-AC04's O(1) bound), optionally transitioning
   * `subject_lifecycle` in the same compare-and-swap. */
  async bumpSubjectEpoch(accountSubjectId: AccountSubjectId, cause: RevocationCause, lifecycle?: SubjectLifecycle): Promise<RevocationEpoch> {
    return withStoreFailure(() =>
      this.#casAuthority(accountSubjectId, (current) => ({
        write: { revocationEpoch: current.revocationEpoch + 1, bumpCause: cause, ...(lifecycle ? { subjectLifecycle: lifecycle } : {}) },
        result: current.revocationEpoch + 1,
      })),
    );
  }

  /**
   * §6.2 step 6/7, atomically: decides and commits the provider-event effect
   * (epoch bump + cursor watermark, or a no-op) against the *current*
   * authority row in one compare-and-swap. `decide` is re-invoked on every
   * retry against a freshly read row, so a concurrent event that already
   * advanced the watermark past this one's cursor is visible before this
   * call commits anything -- this is what makes cursor-ordering atomic
   * (CBD191-REVIEW-IMPL-001 High finding) rather than "read watermark, then
   * separately decide, then separately write."
   */
  async applyProviderEffect<T>(
    accountSubjectId: AccountSubjectId,
    decide: (current: SubjectAuthority) => AuthorityCasDecision<T>,
  ): Promise<T> {
    return withStoreFailure(() => this.#casAuthority(accountSubjectId, decide));
  }

  /**
   * PROTO-ACTIVATION-001 A2 (review R02): the revocation fence for a mutation transaction. Called on a
   * store bound to the boundary's serializable transaction after the session resolved inside it, this
   * re-reads the subject's authority row and re-writes its `revocation_epoch` with the value just read
   * as the predicate. A concurrent epoch bump that committed since the read makes this conditional
   * write see a changed row, which under SERIALIZABLE aborts the whole mutation (SQLSTATE 40001); a
   * bump arriving afterwards blocks on the row lock until this transaction commits and then applies.
   * Together with the session row's own idle-extension write inside the same transaction, no revoke
   * or subject-wide bump can land between the commit-time session read and the mutation's COMMIT.
   * Returns false when the row is gone or the epoch already moved.
   */
  async fenceRevocationEpoch(accountSubjectId: AccountSubjectId): Promise<boolean> {
    return withStoreFailure(async () => {
      const current = await this.#readAuthority(accountSubjectId);
      if (!current) return false;
      const result = await this.#client.platformUpdate({
        table: "account_subject_authority",
        set: { revocation_epoch: current.revocationEpoch },
        conditions: [
          { column: "account_subject_id", value: accountSubjectId },
          { column: "revocation_epoch", value: current.revocationEpoch },
        ],
      });
      return result.rowCount === 1;
    });
  }

  async insertSession(record: SessionRecord): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformInsert({
        table: "account_session",
        values: {
          session_id: record.sessionId,
          session_selector: record.sessionSelector,
          verifier_digest: record.verifierDigest,
          session_ref: record.sessionRef,
          account_subject_id: record.accountSubjectId,
          environment_id: record.environmentId,
          identity_binding_id: record.identityBindingId ?? null,
          session_version: record.sessionVersion,
          issued_revocation_epoch: record.issuedRevocationEpoch,
          state: record.state,
          superseded_by_session_ref: record.supersededBySessionRef ?? null,
          assurance_level: record.assuranceLevel,
          fresh_assurance_bound_action: record.freshAssurance?.boundAction ?? null,
          fresh_assurance_bound_space_id: record.freshAssurance?.boundSpaceId ?? null,
          fresh_assurance_expires_at: record.freshAssurance?.expiresAt ?? null,
          csrf_digest: record.csrfDigest,
          issued_at: record.issuedAt,
          idle_expires_at: record.idleExpiresAt,
          absolute_expires_at: record.absoluteExpiresAt,
          rotation_cause: record.rotationCause,
          revocation_cause: record.revocationCause ?? null,
        },
      });
    });
  }

  async resolveBySelector(selector: SessionSelector): Promise<SessionRecord | "not_found"> {
    return withStoreFailure(async () => {
      const result = await this.#client.platformSelect({
        table: "account_session",
        conditions: [{ column: "session_selector", value: selector }],
      });
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? toRecord(row) : "not_found";
    });
  }

  async findActiveByAccountSubject(accountSubjectId: AccountSubjectId): Promise<SessionRecord | undefined> {
    return withStoreFailure(async () => {
      const result = await this.#client.platformSelect({
        table: "account_session",
        conditions: [
          { column: "account_subject_id", value: accountSubjectId },
          { column: "state", value: "active" },
        ],
      });
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? toRecord(row) : undefined;
    });
  }

  async findBySessionRef(sessionRef: SessionRef): Promise<SessionRecord | undefined> {
    return withStoreFailure(async () => {
      const result = await this.#client.platformSelect({
        table: "account_session",
        conditions: [{ column: "session_ref", value: sessionRef }],
      });
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? toRecord(row) : undefined;
    });
  }

  async markRevoked(sessionRef: SessionRef, cause: RevocationCause | "orphaned_delivery_result_expiry"): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformUpdate({
        table: "account_session",
        set: { state: "revoked", revocation_cause: cause },
        conditions: [
          { column: "session_ref", value: sessionRef },
          { column: "state", value: "active" },
        ],
      });
    });
  }

  async markRotated(sessionRef: SessionRef, supersededBySessionRef: SessionRef): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformUpdate({
        table: "account_session",
        set: { state: "rotated", superseded_by_session_ref: supersededBySessionRef },
        conditions: [
          { column: "session_ref", value: sessionRef },
          { column: "state", value: "active" },
        ],
      });
    });
  }

  /** §5.1: idle expiry slides forward on every successfully resolved request, never past `absoluteExpiresAt`.
   * Waits for the row lock if another writer holds it; used for the in-transaction slide (unchanged) and
   * anywhere else a slide must not be skipped. */
  async extendIdleExpiry(sessionRef: SessionRef, newIdleExpiresAt: Date): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformUpdate({
        table: "account_session",
        set: { idle_expires_at: newIdleExpiresAt },
        conditions: [
          { column: "session_ref", value: sessionRef },
          { column: "state", value: "active" },
        ],
      });
    });
  }

  /**
   * SC-191-006 / IDLE-E03: the best-effort idle-expiry slide for a resolution outside any mutation's effect
   * transaction. One atomic statement that updates the row only if it can lock it without waiting
   * (`platformUpdate`'s `skipLocked` predicate); a row held by any conflicting lock holder -- most often the
   * same session's own in-flight effect transaction -- is skipped, not waited on. Returns the row count (0 or
   * 1) so the caller can tell "skipped" from "slid" without either being treated as a failure; only a thrown
   * error still fails closed (`withStoreFailure` -> `SessionStoreUnavailableError`, CT-191-009).
   *
   * Root store only. `TransactionSessionStore` (below), which `createTransactionSessionStore` returns for a
   * client bound to a mutation's effect transaction, does not expose this method at the type level (SEC-IDLE-R4):
   * the slide performed inside a mutation's transaction always waits and is never skipped.
   */
  async extendIdleExpiryBestEffort(sessionRef: SessionRef, newIdleExpiresAt: Date): Promise<number> {
    return withStoreFailure(async () => {
      const result = await this.#client.platformUpdate({
        table: "account_session",
        set: { idle_expires_at: newIdleExpiresAt },
        conditions: [
          { column: "session_ref", value: sessionRef },
          { column: "state", value: "active" },
        ],
        skipLocked: true,
      });
      return result.rowCount ?? 0;
    });
  }

  async findProviderEvent(environmentId: Environment, issuer: string, providerEventId: string): Promise<Record<string, unknown> | undefined> {
    return withStoreFailure(async () => {
      const existing = await this.#client.platformSelect({
        table: "provider_security_event",
        conditions: [
          { column: "environment_id", value: environmentId },
          { column: "issuer", value: issuer },
          { column: "provider_event_id", value: providerEventId },
        ],
      });
      return existing.rows[0] as Record<string, unknown> | undefined;
    });
  }

  /** §6.2 step 1: dedupe-first insert. A race that loses to a concurrent
   * insert of the identical dedupe key is treated as "duplicate" rather than
   * a hard failure, since this client cannot express `INSERT ... ON CONFLICT`. */
  async insertProviderEvent(
    environmentId: Environment,
    event: ProviderSecurityEventV1,
    outcome: ProviderEventOutcome,
  ): Promise<{ status: "inserted"; row: Record<string, unknown> } | { status: "duplicate"; row: Record<string, unknown> }> {
    return withStoreFailure(async () => {
      try {
        const inserted = await this.#client.platformInsert({
          table: "provider_security_event",
          values: {
            provider_security_event_id: randomUUID(),
            environment_id: environmentId,
            issuer: event.issuer,
            provider_event_id: event.providerEventId,
            provider_subject: event.providerSubject,
            event_class: event.eventClass,
            provider_event_time: event.providerEventTime,
            ordering_cursor: event.orderingCursor ?? null,
            received_at: event.receivedAt,
            identity_binding_id: outcome.identityBindingId ?? null,
            processing_state: outcome.processingState,
            rejection_reason: outcome.rejectionReason ?? null,
          },
          returning: ["*"],
        });
        return { status: "inserted", row: inserted.rows[0] as Record<string, unknown> };
      } catch (error) {
        const existing = await this.findProviderEvent(environmentId, event.issuer, event.providerEventId);
        if (existing) return { status: "duplicate", row: existing };
        throw error;
      }
    });
  }

  /** Corrects an already-inserted row's decided outcome from `applied` to
   * `superseded` when a concurrently-processed higher cursor won the
   * authority compare-and-swap first (see `provider-events.ts`). The
   * migration's trigger permits exactly this one transition besides
   * `applied_pending_reconciliation -> applied`. */
  async correctProviderEventToSuperseded(providerSecurityEventId: string): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformUpdate({
        table: "provider_security_event",
        set: { processing_state: "superseded" },
        conditions: [
          { column: "provider_security_event_id", value: providerSecurityEventId },
          { column: "processing_state", value: "applied" },
        ],
      });
    });
  }

  async reconcilePendingEvent(providerSecurityEventId: string): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformUpdate({
        table: "provider_security_event",
        set: { processing_state: "applied" },
        conditions: [
          { column: "provider_security_event_id", value: providerSecurityEventId },
          { column: "processing_state", value: "applied_pending_reconciliation" },
        ],
      });
    });
  }

  async insertRevocationOutbox(action: {
    accountSubjectId: AccountSubjectId;
    identityBindingId: string | undefined;
    environmentId: Environment;
    cause: RevocationCause;
    target: RevocationTarget;
    revocationEpoch: RevocationEpoch;
    occurredAt: Date;
    deadlineAt: Date;
  }): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformInsert({
        table: "revocation_outbox",
        values: {
          revocation_action_id: randomUUID(),
          attempt_state: "pending",
          attempt_count: 0,
          account_subject_id: action.accountSubjectId,
          identity_binding_id: action.identityBindingId ?? null,
          environment_id: action.environmentId,
          cause: action.cause,
          target: action.target,
          revocation_epoch: action.revocationEpoch,
          occurred_at: action.occurredAt,
          deadline_at: action.deadlineAt,
        },
      });
    });
  }

  /**
   * CBD191-REVIEW-IMPL-001/CBD191-SECURITY-002 High findings: claiming is
   * now an atomic per-row compare-and-swap to `in_flight` (`attempt_state =
   * <observed> -> 'in_flight'`), so two concurrent drains can never both
   * dispatch the same action, and `next_attempt_at` is honored (a row whose
   * `next_attempt_at` is still in the future is never selected). `ambiguous`
   * rows are excluded from ordinary claiming entirely -- `outbox-worker.ts`
   * reconciles them through a separate path before they become retryable
   * again.
   */
  async claimRevocationActions(now: Date, limit: number): Promise<RevocationAction[]> {
    return withStoreFailure(async () => {
      const claimed: RevocationAction[] = [];
      for (const state of RETRYABLE_STATES) {
        if (claimed.length >= limit) break;
        const result = await this.#client.platformSelect({
          table: "revocation_outbox",
          conditions: [{ column: "attempt_state", value: state }],
        });
        for (const row of result.rows as Record<string, unknown>[]) {
          if (claimed.length >= limit) break;
          const nextAttemptAt = row.next_attempt_at == null ? undefined : toDate(row.next_attempt_at);
          if (nextAttemptAt && nextAttemptAt.getTime() > now.getTime()) continue; // not yet due
          const revocationActionId = String(row.revocation_action_id);
          const cas = await this.#client.platformUpdate({
            table: "revocation_outbox",
            set: { attempt_state: "in_flight" },
            conditions: [
              { column: "revocation_action_id", value: revocationActionId },
              { column: "attempt_state", value: state },
            ],
          });
          if (cas.rowCount !== 1) continue; // lost the claim race to another drain
          claimed.push({
            revocationActionId,
            accountSubjectId: String(row.account_subject_id),
            identityBindingId: row.identity_binding_id == null ? undefined : String(row.identity_binding_id),
            environmentId: String(row.environment_id),
            cause: row.cause as RevocationCause,
            target: row.target as RevocationTarget,
            revocationEpoch: Number(row.revocation_epoch),
            occurredAt: toDate(row.occurred_at),
            deadlineAt: toDate(row.deadline_at),
            attemptState: "in_flight",
            attemptCount: Number(row.attempt_count),
          });
        }
      }
      return claimed;
    });
  }

  /**
   * CBD191-SECURITY-003 finding 1 (Refuted -> fixed): reconciliation of an
   * `ambiguous` row must be exclusively owned and must honor
   * `next_attempt_at`, exactly like `claimRevocationActions`. This claims
   * each due `ambiguous` row by atomically CAS-ing it to `in_flight` --
   * reusing the same "exactly one owner at a time" state, rather than
   * inventing a parallel one -- so two concurrent drains can never both
   * query and record an outcome for the same action. The caller
   * (`outbox-worker.ts`) records the reconciliation's own outcome through
   * `recordOutboxAttempt`'s expected-state CAS below.
   */
  async claimAmbiguousForReconciliation(now: Date, limit: number): Promise<RevocationAction[]> {
    return withStoreFailure(async () => {
      const claimed: RevocationAction[] = [];
      const result = await this.#client.platformSelect({
        table: "revocation_outbox",
        conditions: [{ column: "attempt_state", value: "ambiguous" }],
      });
      for (const row of result.rows as Record<string, unknown>[]) {
        if (claimed.length >= limit) break;
        const nextAttemptAt = row.next_attempt_at == null ? undefined : toDate(row.next_attempt_at);
        if (nextAttemptAt && nextAttemptAt.getTime() > now.getTime()) continue; // not yet due for re-query
        const revocationActionId = String(row.revocation_action_id);
        const cas = await this.#client.platformUpdate({
          table: "revocation_outbox",
          set: { attempt_state: "in_flight" },
          conditions: [
            { column: "revocation_action_id", value: revocationActionId },
            { column: "attempt_state", value: "ambiguous" },
          ],
        });
        if (cas.rowCount !== 1) continue; // lost the claim race to another drain
        claimed.push({
          revocationActionId,
          accountSubjectId: String(row.account_subject_id),
          identityBindingId: row.identity_binding_id == null ? undefined : String(row.identity_binding_id),
          environmentId: String(row.environment_id),
          cause: row.cause as RevocationCause,
          target: row.target as RevocationTarget,
          revocationEpoch: Number(row.revocation_epoch),
          occurredAt: toDate(row.occurred_at),
          deadlineAt: toDate(row.deadline_at),
          attemptState: "in_flight",
          attemptCount: Number(row.attempt_count),
        });
      }
      return claimed;
    });
  }

  async findDeliveryResult(sessionHandoffId: string): Promise<{ sealedEnvelope: Buffer; envelopeKeyVersion: string; deliverUntil: Date; acknowledgedAt: Date | undefined; sessionRef: SessionRef } | undefined> {
    return withStoreFailure(async () => {
      const result = await this.#client.platformSelect({
        table: "session_delivery_result",
        conditions: [{ column: "session_handoff_id", value: sessionHandoffId }],
      });
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        sealedEnvelope: Buffer.isBuffer(row.sealed_envelope) ? row.sealed_envelope : Buffer.from(row.sealed_envelope as string),
        envelopeKeyVersion: String(row.envelope_key_version),
        deliverUntil: toDate(row.deliver_until),
        acknowledgedAt: row.acknowledged_at == null ? undefined : toDate(row.acknowledged_at),
        sessionRef: String(row.session_ref),
      };
    });
  }

  async insertDeliveryResult(sessionHandoffId: string, sessionRef: SessionRef, sealedEnvelope: Buffer, keyVersion: string, deliverUntil: Date): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformInsert({
        table: "session_delivery_result",
        values: {
          session_handoff_id: sessionHandoffId,
          session_ref: sessionRef,
          sealed_envelope: sealedEnvelope,
          envelope_key_version: keyVersion,
          deliver_until: deliverUntil,
        },
      });
    });
  }

  /**
   * §3.1/§5.3: "erased on acknowledgement." The sensitive `sealed_envelope`
   * bytes are zeroed and `acknowledged_at` is set, rather than deleting the
   * row outright: `session_handoff_id` consumption must remain
   * distinguishable ("already acknowledged" vs. "never issued") so a replay
   * after acknowledgement is rejected instead of silently minting a second
   * session from the same handoff. This still satisfies "erased" for the
   * sensitive material itself.
   */
  async acknowledgeDeliveryResult(sessionHandoffId: string): Promise<void> {
    return withStoreFailure(async () => {
      await this.#client.platformUpdate({
        table: "session_delivery_result",
        set: { sealed_envelope: Buffer.alloc(0), acknowledged_at: new Date() },
        conditions: [{ column: "session_handoff_id", value: sessionHandoffId }],
      });
    });
  }

  /**
   * CBD191-SECURITY-002 High finding 4 / Manager ruling item 3: the
   * expiry-sweep counterpart to acknowledgement. Selects unacknowledged rows
   * whose `deliver_until` has passed, without an `ORDER BY`/`LIMIT`
   * primitive (see the module header), so this slices client-side; fine for
   * the bounded volumes a sweep interval accumulates.
   */
  async claimExpiredUnacknowledgedDeliveryResults(now: Date, limit: number): Promise<{ sessionHandoffId: string; sessionRef: SessionRef }[]> {
    return withStoreFailure(async () => {
      const result = await this.#client.platformSelect({
        table: "session_delivery_result",
        conditions: [{ column: "deliver_until", operator: "<", value: now }],
      });
      const candidates = (result.rows as Record<string, unknown>[]).filter((row) => row.acknowledged_at == null);
      return candidates.slice(0, limit).map((row) => ({ sessionHandoffId: String(row.session_handoff_id), sessionRef: String(row.session_ref) }));
    });
  }

  /**
   * CBD191-SECURITY-003 finding 1 (Refuted -> fixed): recording an outcome
   * is now itself a compare-and-swap on `expectedCurrentState` (always
   * `in_flight`, since every caller records the result of a row it just
   * claimed via `claimRevocationActions`/`claimAmbiguousForReconciliation`).
   * A write whose row is no longer at the expected state -- because another
   * claim/record already resolved it -- applies nothing and reports
   * `applied: false`, so a stale or duplicate write can never regress an
   * already-recorded terminal outcome (e.g. a late `ambiguous` requery
   * overwriting a `succeeded` another owner already recorded).
   */
  async recordOutboxAttempt(
    revocationActionId: string,
    expectedCurrentState: OutboxAttemptState,
    outcome: OutboxAttemptState,
    nextAttemptAt: Date | undefined,
  ): Promise<{ applied: boolean }> {
    return withStoreFailure(async () => {
      const existing = await this.#client.platformSelect({
        table: "revocation_outbox",
        columns: ["attempt_count"],
        conditions: [{ column: "revocation_action_id", value: revocationActionId }],
      });
      const currentCount = Number((existing.rows[0] as Record<string, unknown> | undefined)?.attempt_count ?? 0);
      const result = await this.#client.platformUpdate({
        table: "revocation_outbox",
        set: { attempt_state: outcome, next_attempt_at: nextAttemptAt ?? null, attempt_count: currentCount + 1 },
        conditions: [
          { column: "revocation_action_id", value: revocationActionId },
          { column: "attempt_state", value: expectedCurrentState },
        ],
      });
      return { applied: result.rowCount === 1 };
    });
  }
}

export function createSessionStore(client: DataAccessClient): SessionStore {
  return new SessionStore(client);
}

/**
 * SC-191-006 / IDLE-E03: the subset of `SessionStore` a session resolution needs, satisfied identically by
 * the root store and by a transaction-bound store. Deliberately does NOT include `extendIdleExpiryBestEffort`
 * -- a resolution holding only this type cannot call it, at compile time, regardless of which concrete store
 * it was actually given (SEC-IDLE-R4). `SessionStore` already satisfies this structurally; no `implements` is
 * needed there.
 */
export interface SessionResolutionStore {
  resolveBySelector(selector: SessionSelector): Promise<SessionRecord | "not_found">;
  readSubjectAuthorityStrict(accountSubjectId: AccountSubjectId): Promise<SubjectAuthority | undefined>;
  extendIdleExpiry(sessionRef: SessionRef, newIdleExpiresAt: Date): Promise<void>;
  fenceRevocationEpoch(accountSubjectId: AccountSubjectId): Promise<boolean>;
}

/** The exported type of `createTransactionSessionStore`'s result: exactly `SessionResolutionStore`, with no
 * `extendIdleExpiryBestEffort` member. See `TransactionSessionStoreImpl` for why the runtime object still
 * carries a throwing stub of that name. */
export type TransactionSessionStore = SessionResolutionStore;

/**
 * SEC-IDLE-R4: backs a mutation's transaction-bound session store. Implements exactly
 * `SessionResolutionStore` by delegating to an ordinary `SessionStore` over the transaction's own client, so
 * `extendIdleExpiry`/`fenceRevocationEpoch` (both wait for the row lock, as today) and the read paths are
 * unchanged. `extendIdleExpiryBestEffort` is declared here -- not omitted -- specifically so that a caller
 * who reaches this object through a cast, `as any`, or other bypass of the exported `TransactionSessionStore`
 * type still fails loudly with a message naming why, instead of hitting `undefined is not a function` or
 * silently resolving to nothing. `createTransactionSessionStore`'s declared return type hides this member;
 * only `TransactionSessionStore`'s (i.e. `SessionResolutionStore`'s) four methods are reachable through the
 * type system.
 */
class TransactionSessionStoreImpl implements SessionResolutionStore {
  readonly #inner: SessionStore;
  constructor(client: DataAccessClient) {
    this.#inner = new SessionStore(client);
  }
  resolveBySelector(selector: SessionSelector): Promise<SessionRecord | "not_found"> {
    return this.#inner.resolveBySelector(selector);
  }
  readSubjectAuthorityStrict(accountSubjectId: AccountSubjectId): Promise<SubjectAuthority | undefined> {
    return this.#inner.readSubjectAuthorityStrict(accountSubjectId);
  }
  extendIdleExpiry(sessionRef: SessionRef, newIdleExpiresAt: Date): Promise<void> {
    return this.#inner.extendIdleExpiry(sessionRef, newIdleExpiresAt);
  }
  fenceRevocationEpoch(accountSubjectId: AccountSubjectId): Promise<boolean> {
    return this.#inner.fenceRevocationEpoch(accountSubjectId);
  }
  /** SEC-IDLE-R4 / IDLE-T02: not reachable through `TransactionSessionStore`'s declared type; a deliberate
   * bypass still fails closed instead of silently doing nothing. */
  extendIdleExpiryBestEffort(): Promise<number> {
    throw new Error(
      "SC-191-006: a transaction-bound session store has no best-effort slide; the slide performed inside a "
      + "mutation's effect transaction always waits and holds the row lock to COMMIT, it never skips",
    );
  }
}

/** SC-191-006 / IDLE-E03: builds the transaction-bound session store `apps/api/src/sessions/index.ts`'s
 * `storeFor` factory hands to the scoped resolution path. Its declared return type (`TransactionSessionStore`
 * = `SessionResolutionStore`) structurally lacks `extendIdleExpiryBestEffort`, so that path cannot skip. */
export function createTransactionSessionStore(client: DataAccessClient): TransactionSessionStore {
  return new TransactionSessionStoreImpl(client);
}
