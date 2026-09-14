/**
 * CBD-190 §5.2-5.3 PostgreSQL atomic resolution and conflict protocol,
 * honouring `CBD190-PROFILE-ATOMIC-001`: a first identity use commits the
 * subject, exactly one active financial profile, the binding, the callback
 * and the prepared hand-off in one SERIALIZABLE transaction; an existing
 * binding proves exactly-one-active-profile in the same snapshot before
 * preparing the hand-off.
 *
 * SQLSTATE 23505 / 40001 / 40P01 abort the whole attempt (the CBD-246 seam
 * has already issued ROLLBACK) and the algorithm restarts from step 1 in a
 * fresh transaction, with bounded jittered backoff, up to the configured
 * attempt count. A losing insert leaves nothing behind; the fresh attempt
 * re-reads the winner's committed callback or binding. On exhaustion a
 * separate short transaction re-reads the callback and only an absent
 * mapping may become terminal `callback_failure`.
 */
import { randomInt, randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import type { Ceremony } from "./challenge.ts";
import type { PublicOutcome } from "./outcomes.ts";
import { findBinding, findCallback, findHandoffByChallenge, findSubject, insertCallback, insertHandoff, insertSubjectWithProfileAndBinding, listProfiles } from "./store.ts";
import type { CallbackRow, HandoffRow } from "./store.ts";

/** §4.3 `VerifiedIdentityResultV1`: the only shape the mapping ever receives. */
export interface VerifiedIdentityResultV1 {
  readonly contractVersion: 1;
  readonly environmentId: string;
  readonly issuer: string;
  readonly providerSubject: string;
  readonly ceremony: Ceremony;
  readonly providerEventTime: Date;
  readonly assurance: "session";
  readonly challengeId: string;
  readonly identityEventId: string;
  readonly previousAccountSubjectId: string | undefined;
  readonly previousSessionRef: string | undefined;
}

export type MappingResult =
  | { readonly status: "handoff_ready"; readonly handoff: HandoffRow; readonly callback: CallbackRow; readonly created: boolean; readonly attempts: number }
  | { readonly status: "terminal"; readonly outcome: PublicOutcome; readonly callback: CallbackRow; readonly attempts: number }
  | { readonly status: "still_processing"; readonly attempts: number };

export interface MappingHooks {
  /** Test barrier (§9 "all workers begin the conflicting database operation before any is released"): awaited inside the transaction after step 1 and before the identity is resolved or inserted. */
  readonly beforeResolve?: ((attempt: number) => Promise<void>) | undefined;
  /** Test barrier: awaited inside the transaction after every insert and before COMMIT. */
  readonly beforeCommit?: ((attempt: number) => Promise<void>) | undefined;
  readonly onRetry?: ((attempt: number, sqlState: string | undefined) => void) | undefined;
}

export interface MappingInput {
  readonly result: VerifiedIdentityResultV1;
  readonly replayDigest: string;
  readonly receiptAt: Date;
  readonly callbackExpiresAt: Date;
  readonly handoffLifetimeSeconds: number;
  readonly maxAttempts: number;
  readonly now: () => Date;
  readonly hooks?: MappingHooks | undefined;
}

export const RETRYABLE_SQL_STATES: readonly string[] = Object.freeze(["23505", "40001", "40P01"]);

function sqlStateOf(error: unknown): string | undefined {
  const state = (error as { sqlState?: unknown } | null)?.sqlState;
  return typeof state === "string" ? state : undefined;
}

export function isRetryableMappingError(error: unknown): boolean {
  const state = sqlStateOf(error);
  return state !== undefined && RETRYABLE_SQL_STATES.includes(state);
}

/** Restricted integrity evidence class: never a customer-visible string. */
export class ProfileIntegrityViolation extends Error {
  readonly accountSubjectId: string;
  readonly activeProfiles: number;
  constructor(accountSubjectId: string, activeProfiles: number) {
    super("subject does not hold exactly one active financial profile; mapping fails closed (CBD190-PROFILE-ATOMIC-001)");
    this.name = "ProfileIntegrityViolation";
    this.accountSubjectId = accountSubjectId;
    this.activeProfiles = activeProfiles;
  }
}

async function backoff(attempt: number, now: () => Date, until: Date): Promise<void> {
  const remaining = until.getTime() - now().getTime();
  if (remaining <= 0) return;
  const base = Math.min(25 * 2 ** attempt, 250);
  const delay = Math.min(base + randomInt(0, 25), remaining);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

type AttemptOutcome =
  | { readonly kind: "handoff_ready"; readonly handoff: HandoffRow; readonly callback: CallbackRow; readonly created: boolean }
  | { readonly kind: "terminal"; readonly outcome: PublicOutcome; readonly callback: CallbackRow }
  | { readonly kind: "still_processing" };

async function attempt(client: DataAccessClient, input: MappingInput, attemptNumber: number): Promise<AttemptOutcome> {
  const { result } = input;
  return client.transaction({ isolation: "serializable" }, async (scoped) => {
    const now = input.now();
    // Step 1: the callback row by challenge_id. A committed terminal result is returned without repeating any effect; a handoff_ready row reuses its hand-off.
    const existing = await findCallback(scoped, result.challengeId);
    if (existing) {
      if (existing.processingState === "terminal") return { kind: "terminal", outcome: existing.terminalOutcome ?? "callback_failure", callback: existing };
      if (existing.processingState === "handoff_ready") {
        const handoff = await findHandoffByChallenge(scoped, result.challengeId);
        if (!handoff) throw new ProfileIntegrityViolation(existing.accountSubjectId ?? "", -1);
        return { kind: "handoff_ready", handoff, callback: existing, created: false };
      }
      return { kind: "still_processing" };
    }
    await input.hooks?.beforeResolve?.(attemptNumber);
    // Step 2: resolve the immutable provider identity under this snapshot.
    const binding = await findBinding(scoped, result.environmentId, result.issuer, result.providerSubject);
    let accountSubjectId: string;
    let identityBindingId: string;
    let created = false;
    if (!binding) {
      // Step 3: candidate subject + exactly one active profile + binding, same transaction.
      const inserted = await insertSubjectWithProfileAndBinding(scoped, { environmentId: result.environmentId, issuer: result.issuer, providerSubject: result.providerSubject, now });
      accountSubjectId = inserted.accountSubjectId;
      identityBindingId = inserted.identityBindingId;
      created = true;
    } else {
      accountSubjectId = binding.accountSubjectId;
      identityBindingId = binding.identityBindingId;
      const subject = await findSubject(scoped, accountSubjectId);
      if (!subject) throw new ProfileIntegrityViolation(accountSubjectId, -1);
      if (subject.lifecycleState !== "active" || binding.lifecycleState !== "active") {
        // §5.3: disabled, deletion-pending, deleted or security-blocked subjects resolve to the same binding and produce account_unavailable with no hand-off.
        const terminal = { challengeId: result.challengeId, environmentId: result.environmentId, replayDigest: input.replayDigest, receiptAt: input.receiptAt, expiresAt: input.callbackExpiresAt, processingState: "terminal" as const, terminalOutcome: "account_unavailable" as const, identityBindingId, accountSubjectId };
        await insertCallback(scoped, terminal);
        await input.hooks?.beforeCommit?.(attemptNumber);
        const callback = await findCallback(scoped, result.challengeId);
        return { kind: "terminal", outcome: "account_unavailable", callback: callback! };
      }
      // Step 4: exactly one active financial profile (§5.3), proven in this snapshot; never repaired here.
      const profiles = await listProfiles(scoped, accountSubjectId);
      const active = profiles.filter((profile) => profile.profileState === "active").length;
      if (active !== 1 || profiles.length !== 1) throw new ProfileIntegrityViolation(accountSubjectId, active);
    }
    // Step 5: exactly one prepared hand-off keyed by the challenge.
    const sessionHandoffId = await insertHandoff(scoped, {
      challengeId: result.challengeId, accountSubjectId, identityBindingId, identityEventId: result.identityEventId,
      authenticatedAt: result.providerEventTime, assurance: result.assurance, ceremony: result.ceremony,
      previousSessionId: result.previousSessionRef, expiresAt: new Date(now.getTime() + input.handoffLifetimeSeconds * 1000), now,
    });
    // Step 6: the callback becomes handoff_ready and everything commits together.
    await insertCallback(scoped, { challengeId: result.challengeId, environmentId: result.environmentId, replayDigest: input.replayDigest, receiptAt: input.receiptAt, expiresAt: input.callbackExpiresAt, processingState: "handoff_ready", identityBindingId, accountSubjectId, sessionHandoffId });
    await input.hooks?.beforeCommit?.(attemptNumber);
    const handoff = await findHandoffByChallenge(scoped, result.challengeId);
    const callback = await findCallback(scoped, result.challengeId);
    if (!handoff || !callback) throw new ProfileIntegrityViolation(accountSubjectId, -1);
    return { kind: "handoff_ready", handoff, callback, created };
  });
}

/** Exhaustion or integrity path: lock and re-read; only an absent mapping attempt becomes terminal `callback_failure`. */
async function settleAbsentMapping(client: DataAccessClient, input: MappingInput, attempts: number, integrity?: ProfileIntegrityViolation): Promise<MappingResult> {
  return client.transaction({ isolation: "serializable" }, async (scoped) => {
    const existing = await findCallback(scoped, input.result.challengeId);
    if (existing?.processingState === "terminal") return { status: "terminal", outcome: existing.terminalOutcome ?? "callback_failure", callback: existing, attempts };
    if (existing?.processingState === "handoff_ready") {
      const handoff = await findHandoffByChallenge(scoped, input.result.challengeId);
      if (handoff) return { status: "handoff_ready", handoff, callback: existing, created: false, attempts };
    }
    if (existing) return { status: "still_processing", attempts };
    await insertCallback(scoped, {
      challengeId: input.result.challengeId, environmentId: input.result.environmentId, replayDigest: input.replayDigest, receiptAt: input.receiptAt, expiresAt: input.callbackExpiresAt,
      processingState: "terminal", terminalOutcome: "callback_failure",
      ...(integrity ? { accountSubjectId: integrity.accountSubjectId || undefined } : {}),
    });
    const callback = await findCallback(scoped, input.result.challengeId);
    return { status: "terminal", outcome: "callback_failure", callback: callback!, attempts };
  });
}

export async function resolveMapping(client: DataAccessClient, input: MappingInput): Promise<MappingResult> {
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) throw new RangeError("mapping attempt bound must be a positive integer");
  let integrity: ProfileIntegrityViolation | undefined;
  for (let attemptNumber = 1; attemptNumber <= input.maxAttempts; attemptNumber += 1) {
    try {
      const outcome = await attempt(client, input, attemptNumber);
      if (outcome.kind === "handoff_ready") return { status: "handoff_ready", handoff: outcome.handoff, callback: outcome.callback, created: outcome.created, attempts: attemptNumber };
      if (outcome.kind === "terminal") return { status: "terminal", outcome: outcome.outcome, callback: outcome.callback, attempts: attemptNumber };
      return { status: "still_processing", attempts: attemptNumber };
    } catch (error) {
      if (error instanceof ProfileIntegrityViolation) { integrity = error; break; }
      if (!isRetryableMappingError(error)) throw error;
      input.hooks?.onRetry?.(attemptNumber, sqlStateOf(error));
      if (attemptNumber < input.maxAttempts) await backoff(attemptNumber, input.now, input.callbackExpiresAt);
    }
  }
  try {
    return await settleAbsentMapping(client, input, input.maxAttempts, integrity);
  } catch (error) {
    if (isRetryableMappingError(error)) return { status: "still_processing", attempts: input.maxAttempts };
    throw error;
  }
}

export function newIdentityEventId(): string {
  return randomUUID();
}
