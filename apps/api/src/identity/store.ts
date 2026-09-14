/**
 * CBD-190 §5.1 persistence over the CBD-246 statement API. Every function
 * takes the client it must use -- the transaction-scoped client inside the
 * mapping transaction, the root client for short finalization transactions
 * -- so the caller, not this module, decides the transaction boundary.
 *
 * Tables: `identity_callback`, `identity_binding`, `identity_session_handoff`
 * and `account_subject` (identity scope, platform statements) and
 * `financial_profile` (financial-profile scope, subject-scoped statements).
 * No raw token, code, state, nonce, contact attribute or provider error text
 * is written anywhere here; the callback row carries a keyed replay digest
 * and opaque references only.
 */
import { randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import type { Ceremony } from "./challenge.ts";
import type { PublicOutcome } from "./outcomes.ts";

export type SubjectLifecycle = "active" | "disabled" | "deletion_pending" | "deleted" | "security_blocked";

export interface CallbackRow {
  readonly challengeId: string;
  readonly environmentId: string;
  readonly replayDigest: string;
  readonly processingState: "processing" | "handoff_ready" | "terminal";
  readonly terminalOutcome: PublicOutcome | undefined;
  readonly identityBindingId: string | undefined;
  readonly accountSubjectId: string | undefined;
  readonly sessionHandoffId: string | undefined;
  readonly commitAt: Date | undefined;
  readonly expiresAt: Date;
}

export interface BindingRow {
  readonly identityBindingId: string;
  readonly environmentId: string;
  readonly issuer: string;
  readonly providerSubject: string;
  readonly accountSubjectId: string;
  readonly lifecycleState: "active" | "revoked";
  readonly bindingVersion: number;
}

export interface SubjectRow {
  readonly accountSubjectId: string;
  readonly lifecycleState: SubjectLifecycle;
  readonly lifecycleVersion: number;
}

export interface ProfileRow {
  readonly profileId: string;
  readonly profileState: "active" | "deleted";
  readonly version: number;
}

export interface HandoffRow {
  readonly sessionHandoffId: string;
  readonly challengeId: string;
  readonly accountSubjectId: string;
  readonly identityBindingId: string;
  readonly identityEventId: string;
  readonly authenticatedAt: Date;
  readonly assurance: string;
  readonly ceremony: Ceremony;
  readonly previousSessionId: string | undefined;
  readonly state: "prepared" | "consumed" | "terminal_failed";
  readonly attemptCount: number;
  readonly issuedSessionReference: string | undefined;
  readonly expiresAt: Date;
}

type Row = Record<string, unknown>;
const toDate = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));
const optional = (value: unknown): string | undefined => (value === null || value === undefined ? undefined : String(value));

function toCallback(row: Row): CallbackRow {
  return {
    challengeId: String(row.challenge_id), environmentId: String(row.environment_id), replayDigest: String(row.replay_digest),
    processingState: row.processing_state as CallbackRow["processingState"], terminalOutcome: optional(row.terminal_outcome) as PublicOutcome | undefined,
    identityBindingId: optional(row.identity_binding_id), accountSubjectId: optional(row.account_subject_id), sessionHandoffId: optional(row.session_handoff_id),
    commitAt: row.commit_at === null || row.commit_at === undefined ? undefined : toDate(row.commit_at), expiresAt: toDate(row.expires_at),
  };
}

function toHandoff(row: Row): HandoffRow {
  return {
    sessionHandoffId: String(row.session_handoff_id), challengeId: String(row.challenge_id), accountSubjectId: String(row.account_subject_id),
    identityBindingId: String(row.identity_binding_id), identityEventId: String(row.identity_event_id), authenticatedAt: toDate(row.authenticated_at),
    assurance: String(row.assurance), ceremony: row.ceremony as Ceremony, previousSessionId: optional(row.previous_session_id),
    state: row.state as HandoffRow["state"], attemptCount: Number(row.attempt_count), issuedSessionReference: optional(row.issued_session_reference), expiresAt: toDate(row.expires_at),
  };
}

export async function findCallback(client: DataAccessClient, challengeId: string): Promise<CallbackRow | undefined> {
  const result = await client.platformSelect({ table: "identity_callback", conditions: [{ column: "challenge_id", value: challengeId }] });
  const row = result.rows[0] as Row | undefined;
  return row ? toCallback(row) : undefined;
}

export async function insertCallback(client: DataAccessClient, callback: {
  readonly challengeId: string; readonly environmentId: string; readonly replayDigest: string; readonly receiptAt: Date; readonly expiresAt: Date;
  readonly processingState: "handoff_ready" | "terminal"; readonly terminalOutcome?: PublicOutcome | undefined;
  readonly identityBindingId?: string | undefined; readonly accountSubjectId?: string | undefined; readonly sessionHandoffId?: string | undefined;
}): Promise<void> {
  await client.platformInsert({ table: "identity_callback", values: {
    challenge_id: callback.challengeId, environment_id: callback.environmentId, replay_digest: callback.replayDigest,
    processing_state: callback.processingState, terminal_outcome: callback.terminalOutcome ?? null,
    identity_binding_id: callback.identityBindingId ?? null, account_subject_id: callback.accountSubjectId ?? null, session_handoff_id: callback.sessionHandoffId ?? null,
    receipt_at: callback.receiptAt, expires_at: callback.expiresAt,
  } });
}

/** Success finalization marker (§6): the schema carries no success `terminal_outcome`, so `commit_at` on a `handoff_ready` row is the committed-success mark. */
export async function markCallbackCommitted(client: DataAccessClient, challengeId: string, commitAt: Date): Promise<boolean> {
  const result = await client.platformUpdate({ table: "identity_callback", set: { commit_at: commitAt }, conditions: [{ column: "challenge_id", value: challengeId }, { column: "processing_state", value: "handoff_ready" }] });
  return result.rowCount === 1;
}

export async function markCallbackTerminal(client: DataAccessClient, challengeId: string, outcome: PublicOutcome, commitAt: Date): Promise<boolean> {
  const result = await client.platformUpdate({ table: "identity_callback", set: { processing_state: "terminal", terminal_outcome: outcome, commit_at: commitAt }, conditions: [{ column: "challenge_id", value: challengeId }, { column: "processing_state", value: "handoff_ready" }] });
  return result.rowCount === 1;
}

export async function findBinding(client: DataAccessClient, environmentId: string, issuer: string, providerSubject: string): Promise<BindingRow | undefined> {
  const result = await client.platformSelect({ table: "identity_binding", conditions: [
    { column: "environment_id", value: environmentId }, { column: "issuer", value: issuer }, { column: "provider_subject", value: providerSubject },
  ] });
  const row = result.rows[0] as Row | undefined;
  return row ? { identityBindingId: String(row.identity_binding_id), environmentId: String(row.environment_id), issuer: String(row.issuer), providerSubject: String(row.provider_subject), accountSubjectId: String(row.account_subject_id), lifecycleState: row.lifecycle_state as BindingRow["lifecycleState"], bindingVersion: Number(row.binding_version) } : undefined;
}

export async function findBindingBySubject(client: DataAccessClient, environmentId: string, accountSubjectId: string): Promise<BindingRow | undefined> {
  const result = await client.platformSelect({ table: "identity_binding", conditions: [{ column: "environment_id", value: environmentId }, { column: "account_subject_id", value: accountSubjectId }] });
  const row = result.rows[0] as Row | undefined;
  return row ? { identityBindingId: String(row.identity_binding_id), environmentId: String(row.environment_id), issuer: String(row.issuer), providerSubject: String(row.provider_subject), accountSubjectId: String(row.account_subject_id), lifecycleState: row.lifecycle_state as BindingRow["lifecycleState"], bindingVersion: Number(row.binding_version) } : undefined;
}

export async function findSubject(client: DataAccessClient, accountSubjectId: string): Promise<SubjectRow | undefined> {
  const result = await client.platformSelect({ table: "account_subject", conditions: [{ column: "account_subject_id", value: accountSubjectId }] });
  const row = result.rows[0] as Row | undefined;
  return row ? { accountSubjectId: String(row.account_subject_id), lifecycleState: row.lifecycle_state as SubjectLifecycle, lifecycleVersion: Number(row.lifecycle_version) } : undefined;
}

/** Test and administrative lifecycle transition (disabled/deletion-pending/security-blocked scenarios). */
export async function setSubjectLifecycle(client: DataAccessClient, accountSubjectId: string, lifecycle: SubjectLifecycle): Promise<void> {
  await client.platformUpdate({ table: "account_subject", set: { lifecycle_state: lifecycle, updated_at: new Date() }, conditions: [{ column: "account_subject_id", value: accountSubjectId }] });
}

export async function listProfiles(client: DataAccessClient, accountSubjectId: string): Promise<ProfileRow[]> {
  if (!client.profileSelect) throw new Error("profile statements unavailable on this client");
  const result = await client.profileSelect({ table: "financial_profile", accountSubjectId });
  return (result.rows as Row[]).map((row) => ({ profileId: String(row.profile_id), profileState: row.profile_state as ProfileRow["profileState"], version: Number(row.version) }));
}

/** §5.2 step 3: candidate subject, exactly one active profile through the CBD-212 subject-scoped seam, then the binding -- all on the caller's transaction client. */
export async function insertSubjectWithProfileAndBinding(client: DataAccessClient, input: { readonly environmentId: string; readonly issuer: string; readonly providerSubject: string; readonly now: Date }): Promise<{ readonly accountSubjectId: string; readonly profileId: string; readonly identityBindingId: string }> {
  if (!client.profileInsert) throw new Error("profile statements unavailable on this client");
  const accountSubjectId = randomUUID();
  const profileId = randomUUID();
  const identityBindingId = randomUUID();
  await client.platformInsert({ table: "account_subject", values: { account_subject_id: accountSubjectId, lifecycle_state: "active", lifecycle_version: 1, created_at: input.now, updated_at: input.now } });
  await client.profileInsert({ table: "financial_profile", accountSubjectId, values: { profile_id: profileId, profile_state: "active", created_at: input.now, updated_at: input.now, version: 1 } });
  await client.platformInsert({ table: "identity_binding", values: {
    identity_binding_id: identityBindingId, environment_id: input.environmentId, issuer: input.issuer, provider_subject: input.providerSubject,
    account_subject_id: accountSubjectId, lifecycle_state: "active", binding_version: 1, created_at: input.now, updated_at: input.now,
  } });
  return { accountSubjectId, profileId, identityBindingId };
}

export async function findHandoffByChallenge(client: DataAccessClient, challengeId: string): Promise<HandoffRow | undefined> {
  const result = await client.platformSelect({ table: "identity_session_handoff", conditions: [{ column: "challenge_id", value: challengeId }] });
  const row = result.rows[0] as Row | undefined;
  return row ? toHandoff(row) : undefined;
}

export async function findHandoff(client: DataAccessClient, sessionHandoffId: string): Promise<HandoffRow | undefined> {
  const result = await client.platformSelect({ table: "identity_session_handoff", conditions: [{ column: "session_handoff_id", value: sessionHandoffId }] });
  const row = result.rows[0] as Row | undefined;
  return row ? toHandoff(row) : undefined;
}

export async function insertHandoff(client: DataAccessClient, handoff: {
  readonly challengeId: string; readonly accountSubjectId: string; readonly identityBindingId: string; readonly identityEventId: string;
  readonly authenticatedAt: Date; readonly assurance: string; readonly ceremony: Ceremony; readonly previousSessionId: string | undefined; readonly expiresAt: Date; readonly now: Date;
}): Promise<string> {
  const sessionHandoffId = randomUUID();
  await client.platformInsert({ table: "identity_session_handoff", values: {
    session_handoff_id: sessionHandoffId, challenge_id: handoff.challengeId, account_subject_id: handoff.accountSubjectId, identity_binding_id: handoff.identityBindingId,
    identity_event_id: handoff.identityEventId, authenticated_at: handoff.authenticatedAt, assurance: handoff.assurance, ceremony: handoff.ceremony,
    previous_session_id: handoff.previousSessionId ?? null, state: "prepared", attempt_count: 1, issued_session_reference: null, expires_at: handoff.expiresAt,
    created_at: handoff.now, updated_at: handoff.now,
  } });
  return sessionHandoffId;
}

export async function markHandoffConsumed(client: DataAccessClient, sessionHandoffId: string, issuedSessionReference: string, now: Date): Promise<boolean> {
  const result = await client.platformUpdate({ table: "identity_session_handoff", set: { state: "consumed", issued_session_reference: issuedSessionReference, updated_at: now }, conditions: [{ column: "session_handoff_id", value: sessionHandoffId }, { column: "state", value: "prepared" }] });
  return result.rowCount === 1;
}

export async function markHandoffTerminalFailed(client: DataAccessClient, sessionHandoffId: string, now: Date): Promise<boolean> {
  const result = await client.platformUpdate({ table: "identity_session_handoff", set: { state: "terminal_failed", updated_at: now }, conditions: [{ column: "session_handoff_id", value: sessionHandoffId }, { column: "state", value: "prepared" }] });
  return result.rowCount === 1;
}

export async function incrementHandoffAttempt(client: DataAccessClient, handoff: HandoffRow, now: Date): Promise<void> {
  await client.platformUpdate({ table: "identity_session_handoff", set: { attempt_count: handoff.attemptCount + 1, updated_at: now }, conditions: [{ column: "session_handoff_id", value: handoff.sessionHandoffId }, { column: "attempt_count", value: handoff.attemptCount }] });
}
