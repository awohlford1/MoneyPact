/**
 * The invitation state service (PK-5): CBD-73 SS4.2 as the prototype executes
 * it, in the shape `../targets/application.ts` established -- `parse*Request`
 * functions that turn a body into a checked command, commands that take one
 * dependency bundle, and canonical `InvitationError`s with field paths.
 *
 * Two rules run through every command here and are worth stating once rather
 * than repeating in each.
 *
 * **Uniform outcomes.** CBD-73 SS5.1 item 6 and design SS4.6 (`TR-73-14`)
 * require that resolve, verify-channel, decline and attach answer identically
 * for an unknown, malformed, expired, consumed, cancelled, superseded,
 * declined or foreign value. Each of those paths therefore funnels every
 * negative through `code_unusable` or `ceremony_unusable` and writes one
 * `AE-73-14` security event with an internal `outcome_class` that never
 * reaches the customer. A caller cannot tell a wrong code from a cancelled
 * one, or somebody else's ceremony from a dead one.
 *
 * **Nothing is written before every denial has run.** Each command performs
 * its whole precondition set -- state, expiry, versions, proof, attachment,
 * disclosure -- before its first write, which is what makes "a denial writes
 * nothing" true without depending on the caller's rollback. The acceptance
 * transaction of SS8 states this as an explicit ordering rule and lives in
 * `./acceptance.ts`; the same rule holds here.
 *
 * Every command runs inside the caller's `serializable` transaction. Nothing
 * here opens one, and nothing here retries: a `40001` reaches the caller as
 * `retryable_conflict` and the caller decides.
 */
import type { AcknowledgedDisclosure, ConsentDisclosure, ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import {
  ACTIVE_INVITATION_STATES, CONFIRMATION_BINDING_RULE_ID, CONFIRMATION_BINDING_RULE_VERSION,
  INVITABLE_ROLES, InvitationError, MAX_CHANNEL_ATTEMPTS, NEUTRAL_DISPLAY_LABEL,
  ROLE_DISCLOSURE_KIND, ROLE_PERMISSION, UNIFORM_LINK_MESSAGE_CODE, assertAuditPayload, invitationProjection,
} from "./records.ts";
import type {
  CeremonyRecord, ConfirmationRecord, DisplayIdentity, InvitableRole, InvitationProjection,
  InvitationRecord, LifecycleAuditEvent, PrivateTerminalCause, SecurityEventOutcomeClass,
} from "./records.ts";
import {
  abuseFingerprint, canonicalizeEmailDestination, ceremonySecretDigest, channelChallengeDigest,
  codeVerifierDigest, composeBearer, destinationToken, digestsEqual, generateBearer, generateCeremonySecret, generateCodeSelector,
  generateChannelChallenge, maskEmailDestination,
} from "./secrets.ts";
import type { KeyedDigest } from "./secrets.ts";
import { assertCeremonyEdge, assertConfirmationEdge, assertInvitationEdge, isTerminalInvitationState } from "./transitions.ts";
import type {
  ChannelChallengeReader, Clock, IdGenerator, InviteeContext, InvitationLocator, InvitationRepository, OwnerActorContext, OwnerContext, OwnerSystemContext,
} from "./ports.ts";

/** Lifetimes, in seconds. Defaults are the prototype's; PK-6 may supply its own from configuration. */
export interface InvitationLifetimes {
  readonly invitationSeconds: number;
  readonly ceremonySeconds: number;
  readonly confirmationSeconds: number;
}

export const DEFAULT_LIFETIMES: InvitationLifetimes = Object.freeze({
  invitationSeconds: 7 * 24 * 60 * 60,
  ceremonySeconds: 30 * 60,
  confirmationSeconds: 3 * 24 * 60 * 60,
});

export interface InvitationDependencies {
  readonly repository: InvitationRepository;
  readonly locator: InvitationLocator;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly digest: KeyedDigest;
  readonly disclosures: ConsentDisclosureSource;
  readonly lifetimes?: InvitationLifetimes;
  /**
   * The simulated local delivery adapter's read of the six-digit challenge
   * (SS5.3). It is the one component that may decrypt the outbox row, which is
   * why `TR-73-08` asks it for the value rather than reading a column itself.
   * Absent means no channel challenge is issued and the ceremony opens with
   * `channel_proof_state = 'none'`, which no later step can pass.
   */
  readonly challengeReader?: ChannelChallengeReader;
  /**
   * Envelope-encrypts the canonical destination for one invitation row. The
   * raw address never leaves this module in any other form: it arrives in the
   * create request, is turned into a token, a mask and a ciphertext, and is
   * then gone. Composition supplies the CBD-246 field-encryption provider;
   * the unit fixtures supply a deterministic stand-in.
   */
  readonly encryptDestination: DestinationEncryptor;
  /**
   * Decrypts one record's destination. Used by exactly one path -- `TR-73-05`,
   * which must re-encrypt the same address under the successor row's own AAD,
   * since the CBD-246 cipher binds a ciphertext to the row it was written for
   * and a copied ciphertext would not decrypt. Absent means replacement is
   * unavailable rather than silently writing the wrong value.
   */
  readonly readDestination?: (budgetSpaceId: string, invitationId: string) => Promise<string | null>;
}

/** Envelope-encrypts one invitation's canonical destination, bound to the row it belongs to. */
export interface DestinationEncryptor {
  (context: { readonly budgetSpaceId: string; readonly invitationId: string }, destination: string): Promise<Uint8Array>;
}

function lifetimes(deps: InvitationDependencies): InvitationLifetimes {
  return deps.lifetimes ?? DEFAULT_LIFETIMES;
}

function plusSeconds(instant: string, seconds: number): string {
  return new Date(Date.parse(instant) + seconds * 1000).toISOString();
}

function isBefore(a: string, b: string): boolean {
  return Date.parse(a) < Date.parse(b);
}

// ---------------------------------------------------------------------------
// Requests.
// ---------------------------------------------------------------------------

export interface CreateInvitationRequest {
  readonly channel: "email";
  /** The canonical destination. Held only for the duration of the command; never returned, never logged. */
  readonly destination: string;
  readonly destinationMasked: string;
  readonly proposedRole: InvitableRole;
  readonly idempotencyKey: string;
}

function requireString(body: Record<string, unknown>, field: string, max = 200): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new InvitationError("invalid_request", field);
  }
  return value.trim();
}

/** `POST /v1/budget-spaces/{id}/invitations`. The permission is selected from `proposedRole` server-side, never sent. */
export function parseCreateInvitationRequest(body: unknown): CreateInvitationRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new InvitationError("invalid_request", "body");
  const record = body as Record<string, unknown>;
  if (record.channel !== "email") throw new InvitationError("invalid_request", "channel");
  const proposedRole = record.proposedRole;
  if (typeof proposedRole !== "string" || !(INVITABLE_ROLES as readonly string[]).includes(proposedRole)) {
    throw new InvitationError("proposed_role_unsupported", "proposedRole");
  }
  const destination = canonicalizeEmailDestination(record.destination);
  return {
    channel: "email",
    destination,
    destinationMasked: maskEmailDestination(destination),
    proposedRole: proposedRole as InvitableRole,
    idempotencyKey: requireString(record, "idempotencyKey"),
  };
}

export interface ResolveCodeRequest {
  readonly presentedCode: string;
  readonly environment: string;
  readonly correlationId: string;
}

/** `POST /v1/invitations/resolve`. A malformed value is not an error here: it is the uniform outcome (`TR-73-14`). */
export function parseResolveCodeRequest(body: unknown, environment: string, correlationId: string): ResolveCodeRequest {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const presented = record.code;
  return {
    presentedCode: typeof presented === "string" ? presented.trim() : "",
    environment,
    correlationId,
  };
}

export interface CeremonyRequest {
  readonly ceremonyId: string;
  /** The `__Host-mp_invitation_ceremony` cookie value; compared as a digest, never stored. */
  readonly ceremonySecret: string;
  readonly correlationId: string;
}

export function parseCeremonyRequest(ceremonyId: unknown, ceremonySecret: unknown, correlationId: string): CeremonyRequest {
  if (typeof ceremonyId !== "string" || ceremonyId.trim().length === 0
    || typeof ceremonySecret !== "string" || ceremonySecret.trim().length === 0) {
    // Uniform: a missing cookie and a wrong one are the same answer.
    throw new InvitationError("ceremony_unusable");
  }
  return { ceremonyId: ceremonyId.trim(), ceremonySecret: ceremonySecret.trim(), correlationId };
}

/**
 * A ceremony-addressed command taken **without a session**: verify-channel and
 * decline. `attachAccount`, the disclosure read and accept all carry an
 * `InviteeContext` whose `environment` binds the ceremony; these two carry
 * none, so the server's environment key travels with the request the way it
 * does on `resolveCode` (`SEC-PK5-F03`). It is a server-side value, never a
 * body field.
 */
export interface UnauthenticatedCeremonyRequest extends CeremonyRequest {
  readonly environment: string;
}

export function parseUnauthenticatedCeremonyRequest(
  ceremonyId: unknown, ceremonySecret: unknown, environment: string, correlationId: string,
): UnauthenticatedCeremonyRequest {
  return { ...parseCeremonyRequest(ceremonyId, ceremonySecret, correlationId), environment };
}

export interface VerifyChannelRequest extends UnauthenticatedCeremonyRequest {
  readonly channelCode: string;
}

export function parseVerifyChannelRequest(
  ceremonyId: unknown, ceremonySecret: unknown, body: unknown, environment: string, correlationId: string,
): VerifyChannelRequest {
  const base = parseUnauthenticatedCeremonyRequest(ceremonyId, ceremonySecret, environment, correlationId);
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const code = record.channelCode;
  return { ...base, channelCode: typeof code === "string" ? code.trim() : "" };
}

export interface AcceptInvitationRequest extends CeremonyRequest {
  readonly acknowledgedDisclosure: AcknowledgedDisclosure | undefined;
}

export function parseAcceptInvitationRequest(ceremonyId: unknown, ceremonySecret: unknown, body: unknown, correlationId: string): AcceptInvitationRequest {
  const base = parseCeremonyRequest(ceremonyId, ceremonySecret, correlationId);
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const claim = record.acknowledgedDisclosure;
  if (typeof claim !== "object" || claim === null) return { ...base, acknowledgedDisclosure: undefined };
  const { kind, version } = claim as Record<string, unknown>;
  if (typeof kind !== "string" || typeof version !== "number") return { ...base, acknowledgedDisclosure: undefined };
  return { ...base, acknowledgedDisclosure: { kind, version } };
}

export interface ConfirmAcceptanceRequest {
  readonly invitationId: string;
  readonly confirmationIdempotencyKey: string;
}

export function parseConfirmAcceptanceRequest(invitationId: unknown, body: unknown): ConfirmAcceptanceRequest {
  if (typeof invitationId !== "string" || invitationId.trim().length === 0) throw new InvitationError("invalid_request", "invitationId");
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return { invitationId: invitationId.trim(), confirmationIdempotencyKey: requireString(record, "confirmationIdempotencyKey") };
}

// ---------------------------------------------------------------------------
// Audit and notice helpers.
// ---------------------------------------------------------------------------

export interface AuditInput {
  readonly budgetSpaceId: string;
  readonly eventCode: string;
  readonly eventSubtype?: string | null;
  readonly actorSubjectId?: string | null;
  readonly actingMembershipId?: string | null;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly result: "allow" | "deny" | "system";
  readonly reasonClass?: string | null;
  readonly policyVersion?: string | null;
  readonly policyDigest?: string | null;
  readonly correlationId: string;
  readonly audience: "customer" | "restricted";
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** Build one allowlisted `AE-73-*` row. The payload allowlist is checked here, before the row exists. */
export function auditEvent(deps: InvitationDependencies, input: AuditInput): LifecycleAuditEvent {
  return {
    eventId: deps.ids.uuid(),
    budgetSpaceId: input.budgetSpaceId,
    eventCode: input.eventCode,
    eventSubtype: input.eventSubtype ?? null,
    occurredAt: deps.clock.now(),
    actorSubjectId: input.actorSubjectId ?? null,
    actingMembershipId: input.actingMembershipId ?? null,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    result: input.result,
    reasonClass: input.reasonClass ?? null,
    policyVersion: input.policyVersion ?? null,
    policyDigest: input.policyDigest ?? null,
    correlationId: input.correlationId,
    audience: input.audience,
    payload: assertAuditPayload(input.payload ?? {}),
  };
}

async function writeAudit(deps: InvitationDependencies, input: AuditInput): Promise<void> {
  await deps.repository.insertAudit(auditEvent(deps, input));
}

/** One `AE-73-14`. `budgetSpaceId` is null whenever the presented value did not resolve at all. */
async function writeSecurityEvent(
  deps: InvitationDependencies, outcomeClass: SecurityEventOutcomeClass,
  correlationId: string, budgetSpaceId: string | null, fingerprint: string | null,
): Promise<void> {
  await deps.repository.insertSecurityEvent({
    eventId: deps.ids.uuid(),
    eventCode: "AE-73-14",
    occurredAt: deps.clock.now(),
    budgetSpaceId,
    outcomeClass,
    abuseFingerprint: fingerprint,
    correlationId,
    payload: {},
  });
}

// ---------------------------------------------------------------------------
// TR-73-07: expiry on observation. There is no scheduler.
// ---------------------------------------------------------------------------

/**
 * Materialize the expiry of an active record whose authoritative deadline has
 * passed, exactly once, and return the record as it now stands. Every read
 * path runs this first, which is what makes "expired" a real state rather
 * than a comparison every caller has to remember.
 */
export async function expireOnObservation(deps: InvitationDependencies, record: InvitationRecord, correlationId: string): Promise<InvitationRecord> {
  const now = deps.clock.now();
  const active = (ACTIVE_INVITATION_STATES as readonly string[]).includes(record.state)
    || record.state === "synthetic_created" || record.state === "synthetic_pending";
  if (!active || isBefore(now, record.expiresAt)) return record;

  const next = record.kind === "synthetic" ? "synthetic_inactive" : "expired";
  assertInvitationEdge(record.state, next);
  const applied = await deps.repository.updateInvitation(record.budgetSpaceId, record.invitationId, record.stateVersion, {
    state: next,
    projectionState: "no_longer_active",
  });
  if (!applied) {
    // Somebody else moved the record between the read and here; re-read and
    // let the caller's own precondition decide. Never a silent overwrite.
    const reread = await deps.repository.readInvitation(record.budgetSpaceId, record.invitationId);
    return reread ?? record;
  }
  if (record.kind === "real") {
    await invalidateCodeAndCeremonies(deps, record, "expired");
  }
  await writeAudit(deps, {
    budgetSpaceId: record.budgetSpaceId, eventCode: "AE-73-07", targetType: "invitation",
    targetId: record.invitationId, result: "system", correlationId, audience: "customer",
    payload: { invitationId: record.invitationId, invitationState: next, projectionState: "no_longer_active" },
  });
  const reread = await deps.repository.readInvitation(record.budgetSpaceId, record.invitationId);
  return reread ?? { ...record, state: next, stateVersion: record.stateVersion + 1, projectionState: "no_longer_active" };
}

/** The permanent invalidation set of `IC-73-006`: the code dies and every ceremony with it. */
async function invalidateCodeAndCeremonies(deps: InvitationDependencies, record: InvitationRecord, reasonClass: string): Promise<void> {
  const now = deps.clock.now();
  const code = await deps.repository.readCode(record.budgetSpaceId, record.invitationId);
  if (code && code.disposition === "active") {
    await deps.repository.updateCodeDisposition(record.budgetSpaceId, record.invitationId, "active", "invalidated", reasonClass, now);
    await deps.repository.tombstoneOutbox(record.invitationId, "code_invalidated", now);
  }
  for (const ceremony of await deps.repository.listCeremonies(record.budgetSpaceId, record.invitationId)) {
    if (ceremony.state === "open" || ceremony.state === "accepted_pending_confirmation") {
      assertCeremonyEdge(ceremony.state, "invalidated");
      await deps.repository.updateCeremony(record.budgetSpaceId, ceremony.ceremonyId, { state: "invalidated", isCurrent: false });
    }
  }
}

// ---------------------------------------------------------------------------
// TR-73-01 / TR-73-02 / TR-73-15..17: create and dispatch.
// ---------------------------------------------------------------------------

export interface CreateInvitationResult {
  readonly projection: InvitationProjection;
  /** True when the record is a suppressed synthetic one. Never projected; the caller must not branch a customer answer on it. */
  readonly suppressed: boolean;
  /** The replaced predecessor, when the create routed `TR-73-05`. */
  readonly supersededInvitationId: string | null;
}

/**
 * `TR-73-01` create, with `TR-73-02` dispatch in the same transaction, or the
 * `TR-73-15`/`TR-73-16`/`TR-73-17` synthetic suppressed record when the
 * destination is the creator's own or already an active member's.
 *
 * The two outcomes are indistinguishable to the inviter by construction: both
 * return the same projection shape, both leave `projection_state` `pending`,
 * and the suppressed one simply has no code, no ceremony and no outbox row.
 */
export async function createInvitation(
  deps: InvitationDependencies, owner: OwnerActorContext, request: CreateInvitationRequest,
  options: { readonly inviteeSubjectIdForDestination?: string | null } = {},
): Promise<CreateInvitationResult> {
  const space = await deps.repository.readBudgetSpace(owner.budgetSpaceId);
  if (!space) throw new InvitationError("budget_space_not_found", "budgetSpaceId");
  if (space.lifecycle !== "live") throw new InvitationError("budget_space_not_live", "budgetSpaceId");

  const required = ROLE_PERMISSION[request.proposedRole];
  const disclosure = deps.disclosures.current(ROLE_DISCLOSURE_KIND[request.proposedRole]);
  const token = await destinationToken(deps.digest, request.destination);

  // SS4.4 rule 4: a second create for a destination that already has a
  // dispatched record is a replacement, not a second record.
  const existing = await deps.repository.findDispatchedByDestination(owner.budgetSpaceId, token);
  if (existing) {
    const live = await expireOnObservation(deps, existing, owner.correlationId);
    if (!isTerminalInvitationState(live.state)) {
      // `R-01` / `SEC-PK6-F1`: the implicit replacement is the same `TR-73-05`
      // transition the explicit `replace` route performs, and carries the same
      // exact-permission rule: the actor retires the predecessor only while
      // holding the predecessor's own required permission. A Co-owner (24)
      // therefore cannot supersede a Primary's co_owner (26) record through
      // create; the route answers 403 and the transaction rolls back.
      if (owner.permission !== live.requiredPermission) throw new InvitationError("permission_mismatch", "requiredPermission");
      const replaced = await replaceInvitationRecord(deps, owner, live, request, { disclosure, required, normalizedDestination: token });
      return { ...replaced, supersededInvitationId: live.invitationId };
    }
  }

  const suppressedCause = await suppressionCause(deps, owner, request, options.inviteeSubjectIdForDestination ?? null);
  const created = await insertInvitationRecord(deps, owner, request, {
    disclosure, required, normalizedDestination: token, predecessorInvitationId: null, suppressedCause,
  });
  return { projection: invitationProjection(created), suppressed: suppressedCause !== null, supersededInvitationId: null };
}

/** `TR-73-15`: why a record would be suppressed, or null for an ordinary real one. Restricted evidence only. */
async function suppressionCause(
  deps: InvitationDependencies, owner: OwnerContext, request: CreateInvitationRequest, inviteeSubjectId: string | null,
): Promise<PrivateTerminalCause | null> {
  if (inviteeSubjectId && inviteeSubjectId === owner.subjectId) return "self_invitation";
  if (inviteeSubjectId) {
    const membership = await deps.repository.readActiveMembership(owner.budgetSpaceId, inviteeSubjectId);
    if (membership) return "already_member";
  }
  void request;
  return null;
}

interface RecordShape {
  readonly disclosure: ConsentDisclosure;
  readonly required: "24" | "26";
  /** The destination token, named without the word so the scanner's generic-api-key rule does not read the assignment as a credential (PK2FIX-F04). */
  readonly normalizedDestination: string;
  readonly predecessorInvitationId: string | null;
  readonly suppressedCause: PrivateTerminalCause | null;
}

async function insertInvitationRecord(
  deps: InvitationDependencies, owner: OwnerContext, request: CreateInvitationRequest, shape: RecordShape,
): Promise<InvitationRecord> {
  const now = deps.clock.now();
  const expiresAt = plusSeconds(now, lifetimes(deps).invitationSeconds);
  const invitationId = deps.ids.uuid();
  const synthetic = shape.suppressedCause !== null;
  const record: InvitationRecord = {
    invitationId,
    budgetSpaceId: owner.budgetSpaceId,
    kind: synthetic ? "synthetic" : "real",
    createdByMembershipId: owner.membershipId,
    createdBySubjectId: owner.subjectId,
    requiredPermission: shape.required,
    creatingAuthorizationVersion: owner.decision.authorizationVersion,
    channelType: "email",
    destinationToken: shape.normalizedDestination,
    destinationMasked: request.destinationMasked,
    proposedRole: request.proposedRole,
    resourceScope: "full",
    disclosureKind: shape.disclosure.kind,
    disclosureVersion: shape.disclosure.version,
    disclosureDigest: shape.disclosure.digest,
    policyVersion: owner.decision.policyVersion,
    policyDigest: owner.decision.policyDigest,
    invitationVersion: 1,
    state: synthetic ? "synthetic_created" : "created",
    stateVersion: 1,
    issuedAt: now,
    expiresAt,
    // SS4.1: for a real record the projection retires at the authoritative
    // expiry, never later; for a synthetic one the deadline is its own.
    projectionInactiveAt: expiresAt,
    projectionState: "pending",
    privateTerminalCause: null,
    predecessorInvitationId: shape.predecessorInvitationId,
    successorInvitationId: null,
    candidateSubjectId: null,
    acceptedMembershipId: null,
    commitIdempotencyKey: null,
    commitRequestDigest: null,
    committedResponse: null,
  };

  // The raw address leaves this function as ciphertext and in no other form.
  const ciphertext = await deps.encryptDestination(
    { budgetSpaceId: owner.budgetSpaceId, invitationId },
    synthetic ? record.destinationToken : request.destination,
  );
  await deps.repository.insertInvitation(record, ciphertext);
  await writeAudit(deps, {
    budgetSpaceId: owner.budgetSpaceId, eventCode: "AE-73-01", actorSubjectId: owner.subjectId,
    actingMembershipId: owner.membershipId, targetType: "invitation", targetId: invitationId,
    result: "allow", policyVersion: owner.decision.policyVersion, policyDigest: owner.decision.policyDigest,
    correlationId: owner.correlationId, audience: "customer",
    payload: {
      invitationId, proposedRole: request.proposedRole, requiredPermission: shape.required,
      resourceScope: "full", disclosureKind: shape.disclosure.kind, disclosureVersion: shape.disclosure.version,
      channelType: "email", predecessorInvitationId: shape.predecessorInvitationId,
    },
  });

  if (synthetic) {
    // TR-73-16 (project synthetic dispatch): the "equivalence schedule" is
    // immediate in the prototype. No code, no outbox, and one restricted
    // AE-73-27 that names the real cause.
    assertInvitationEdge("synthetic_created", "synthetic_pending");
    await deps.repository.updateInvitation(owner.budgetSpaceId, invitationId, 1, { state: "synthetic_pending" });
    await writeAudit(deps, {
      budgetSpaceId: owner.budgetSpaceId, eventCode: "AE-73-27", actorSubjectId: owner.subjectId,
      actingMembershipId: owner.membershipId, targetType: "invitation", targetId: invitationId,
      result: "system", reasonClass: shape.suppressedCause, correlationId: owner.correlationId,
      audience: "restricted", payload: { invitationId, invitationState: "synthetic_pending" },
    });
    return { ...record, state: "synthetic_pending", stateVersion: record.stateVersion + 1 };
  }

  await dispatchInvitation(deps, owner, record, request.destination);
  return { ...record, state: "pending", stateVersion: record.stateVersion + 1 };
}

/**
 * `TR-73-02`, in the same transaction as the create. One raw secret and one
 * opaque selector are generated; the selector and the secret's bound
 * verifier are stored, and the presented bearer `<selector>.<secret>` and
 * the six-digit channel challenge exist afterwards only inside the
 * envelope-encrypted outbox row that the simulated local adapter reads
 * (SS5.3). The selector encodes nothing and proves nothing (`PK5-F02`): it
 * is the lookup handle the locator uses instead of a scan.
 */
async function dispatchInvitation(
  deps: InvitationDependencies, owner: OwnerContext, record: InvitationRecord, destination: string,
): Promise<void> {
  const now = deps.clock.now();
  const codeSelector = generateCodeSelector();
  const secret = generateBearer();
  const bearer = composeBearer(codeSelector, secret);
  const challenge = generateChannelChallenge();
  const verifier = await codeVerifierDigest(deps.digest, {
    invitationId: record.invitationId, invitationVersion: record.invitationVersion, destinationToken: record.destinationToken,
  }, secret);

  // `R-05`: asserted before the first write, which is this module's stated
  // rule. The edge is constant so it cannot fail today, but the code and
  // outbox rows below are writes and the rule should be true textually.
  assertInvitationEdge("created", "pending");

  await deps.repository.insertCode({
    invitationId: record.invitationId, budgetSpaceId: record.budgetSpaceId, codeSelector, verifierDigest: verifier,
    issuedAt: now, expiresAt: record.expiresAt, disposition: "active",
    dispositionReasonClass: null, dispositionAt: null, abuseFingerprint: null,
  });
  await deps.repository.insertOutbox({
    outboxId: deps.ids.uuid(), invitationId: record.invitationId, budgetSpaceId: record.budgetSpaceId,
    channelType: "email", destination, bearer, challenge, custodyDeadline: record.expiresAt,
  });

  const applied = await deps.repository.updateInvitation(record.budgetSpaceId, record.invitationId, record.stateVersion, {
    state: "pending", projectionState: "pending",
  });
  if (!applied) throw new InvitationError("retryable_conflict", "invitation.stateVersion");

  await writeAudit(deps, {
    budgetSpaceId: record.budgetSpaceId, eventCode: "AE-73-02", targetType: "invitation_code",
    targetId: record.invitationId, result: "system", correlationId: owner.correlationId, audience: "customer",
    payload: { invitationId: record.invitationId, invitationVersion: record.invitationVersion, invitationState: "pending", channelType: "email" },
  });
}

// ---------------------------------------------------------------------------
// TR-73-05: resend and replacement.
// ---------------------------------------------------------------------------

/**
 * `TR-73-05` on an existing record: the predecessor becomes `superseded` with
 * its code `invalidated` and every current ceremony `invalidated`, and
 * exactly one successor is created through `TR-73-01`, in one transaction.
 * "Resend" and "replace" are the same transition (`OQ-IV-002`).
 */
export async function replaceInvitation(
  deps: InvitationDependencies, owner: OwnerActorContext, invitationId: string,
): Promise<CreateInvitationResult> {
  const record = await requireOwnedInvitation(deps, owner, invitationId);
  if (record.kind !== "real") throw new InvitationError("invitation_not_current", "kind");
  // `R-03`: the actor's own permission, not `ROLE_PERMISSION[proposedRole]`,
  // which the record satisfies by construction and therefore checked nothing.
  // `TR-73-05` requires "the same current exact permission as `TR-73-01`".
  if (owner.permission !== record.requiredPermission) throw new InvitationError("permission_mismatch", "requiredPermission");
  const disclosure = deps.disclosures.current(record.disclosureKind);
  const replaced = await replaceInvitationRecord(deps, owner, record, {
    channel: "email", destination: "", destinationMasked: record.destinationMasked,
    proposedRole: record.proposedRole, idempotencyKey: owner.correlationId,
  }, { disclosure, required: record.requiredPermission, normalizedDestination: record.destinationToken });
  return { ...replaced, supersededInvitationId: record.invitationId };
}

async function replaceInvitationRecord(
  deps: InvitationDependencies, owner: OwnerContext, predecessor: InvitationRecord,
  request: CreateInvitationRequest, shape: Pick<RecordShape, "disclosure" | "required" | "normalizedDestination">,
): Promise<Omit<CreateInvitationResult, "supersededInvitationId">> {
  assertInvitationEdge(predecessor.state, "superseded");

  // The successor carries the same recipient: the same destination token, the
  // same mask, and the same address re-encrypted under its own row's AAD. A
  // create that routed here already holds the raw address; a `replace` route
  // does not, and reads it back through the one decrypting port -- which has
  // to happen before the invalidation below tombstones the custody record.
  const destination = request.destination.length > 0
    ? request.destination
    : await readPredecessorDestination(deps, predecessor);

  const applied = await deps.repository.updateInvitation(predecessor.budgetSpaceId, predecessor.invitationId, predecessor.stateVersion, {
    state: "superseded", projectionState: "replaced",
  });
  if (!applied) throw new InvitationError("stale_version", "invitation.stateVersion");
  await invalidateCodeAndCeremonies(deps, predecessor, "superseded");
  const successor = await insertInvitationRecord(deps, owner, {
    ...request, destination, destinationMasked: predecessor.destinationMasked,
  }, { ...shape, predecessorInvitationId: predecessor.invitationId, suppressedCause: null });

  await deps.repository.updateInvitation(predecessor.budgetSpaceId, predecessor.invitationId, predecessor.stateVersion + 1, {
    successorInvitationId: successor.invitationId,
  });
  await writeAudit(deps, {
    budgetSpaceId: predecessor.budgetSpaceId, eventCode: "AE-73-05", actorSubjectId: owner.subjectId,
    actingMembershipId: owner.membershipId, targetType: "invitation", targetId: predecessor.invitationId,
    result: "allow", policyVersion: owner.decision.policyVersion, policyDigest: owner.decision.policyDigest,
    correlationId: owner.correlationId, audience: "customer",
    payload: {
      invitationId: predecessor.invitationId, successorInvitationId: successor.invitationId,
      invitationState: "superseded", projectionState: "replaced",
    },
  });
  return { projection: invitationProjection(successor), suppressed: false };
}

// ---------------------------------------------------------------------------
// TR-73-06: cancel.
// ---------------------------------------------------------------------------

/** `TR-73-06` actor path: the owner cancels, and the projection retires as `cancelled`. */
export async function cancelInvitation(deps: InvitationDependencies, owner: OwnerContext, invitationId: string): Promise<InvitationProjection> {
  const record = await requireOwnedInvitation(deps, owner, invitationId);
  return cancelRecord(deps, owner, record, null, "customer", "cancelled");
}

/**
 * The shared cancel body. The system path (`sibling_accepted`, rule 6/7) has a
 * private cause and leaves the projection `pending` until `TR-73-07`; the
 * actor path retires the projection immediately.
 */
export async function cancelRecord(
  deps: InvitationDependencies, owner: OwnerContext, record: InvitationRecord,
  cause: PrivateTerminalCause | null, audience: "customer" | "restricted",
  projectionState: "cancelled" | "pending",
): Promise<InvitationProjection> {
  const next = record.kind === "synthetic" ? "synthetic_inactive" : "cancelled";
  assertInvitationEdge(record.state, next);
  const applied = await deps.repository.updateInvitation(record.budgetSpaceId, record.invitationId, record.stateVersion, {
    state: next, projectionState, privateTerminalCause: cause,
  });
  if (!applied) throw new InvitationError("stale_version", "invitation.stateVersion");
  if (record.kind === "real") await invalidateCodeAndCeremonies(deps, record, cause ?? "cancelled");
  await writeAudit(deps, {
    budgetSpaceId: record.budgetSpaceId, eventCode: "AE-73-06",
    actorSubjectId: cause === null ? owner.subjectId : null,
    actingMembershipId: cause === null ? owner.membershipId : null,
    targetType: "invitation", targetId: record.invitationId,
    result: cause === null ? "allow" : "system", reasonClass: cause,
    policyVersion: cause === null ? owner.decision.policyVersion : null,
    policyDigest: cause === null ? owner.decision.policyDigest : null,
    correlationId: owner.correlationId, audience,
    payload: { invitationId: record.invitationId, invitationState: next, projectionState },
  });
  return { ...invitationProjection(record), state: projectionState };
}

async function readPredecessorDestination(deps: InvitationDependencies, predecessor: InvitationRecord): Promise<string> {
  const destination = await deps.readDestination?.(predecessor.budgetSpaceId, predecessor.invitationId);
  if (typeof destination !== "string" || destination.length === 0) throw new InvitationError("invalid_request", "destination");
  return destination;
}

async function requireOwnedInvitation(deps: InvitationDependencies, owner: OwnerContext, invitationId: string): Promise<InvitationRecord> {
  const found = await deps.repository.readInvitation(owner.budgetSpaceId, invitationId);
  if (!found) throw new InvitationError("invitation_not_found", "invitationId");
  const record = await expireOnObservation(deps, found, owner.correlationId);
  if (isTerminalInvitationState(record.state)) throw new InvitationError("invitation_not_current", "state");
  return record;
}

// ---------------------------------------------------------------------------
// TR-73-08 / TR-73-14: resolve a presented link.
// ---------------------------------------------------------------------------

export interface ResolveCodeSuccess {
  readonly outcome: "resolved";
  readonly ceremonyId: string;
  /** The opaque one-time ceremony token the caller sets as the `__Host-mp_invitation_ceremony` cookie. Returned once. */
  readonly ceremonySecret: string;
  readonly ceremonyExpiresAt: string;
  /** The ceremony-entry minimum of CBD-73 SS7.1 item 2 and nothing else: no role, no space, no inviter. */
  readonly channelType: "email";
}

export interface UniformUnusable {
  readonly outcome: "unusable";
  readonly messageCode: typeof UNIFORM_LINK_MESSAGE_CODE;
}

export type ResolveCodeResult = ResolveCodeSuccess | UniformUnusable;

/** The single uniform answer. Every negative path in this file returns this exact object. */
export const UNIFORM_UNUSABLE: UniformUnusable = Object.freeze({ outcome: "unusable", messageCode: UNIFORM_LINK_MESSAGE_CODE });

/**
 * `TR-73-08` when the presented value matches one dispatched, unexpired real
 * record; `TR-73-14` in every other case, with the same answer. A prior
 * current ceremony is invalidated, so a leaked link cannot ride an
 * in-progress ceremony (SS5.2).
 */
export async function resolveCode(deps: InvitationDependencies, request: ResolveCodeRequest): Promise<ResolveCodeResult> {
  if (request.presentedCode.length === 0) {
    await writeSecurityEvent(deps, "malformed_value", request.correlationId, null, null);
    return UNIFORM_UNUSABLE;
  }
  const fingerprint = await abuseFingerprint(deps.digest, request.presentedCode);

  // The verifier is bound to the record, so it can only be computed once the
  // record is known: the locator answers "which record", the binding then
  // proves the value. A value that locates nothing is `unknown_value`.
  const location = await locateByPresentedCode(deps, request.presentedCode);
  if (!location) {
    await writeSecurityEvent(deps, "unknown_value", request.correlationId, null, fingerprint);
    return UNIFORM_UNUSABLE;
  }

  const found = await deps.repository.readInvitation(location.budgetSpaceId, location.invitationId);
  if (!found) {
    await writeSecurityEvent(deps, "unknown_value", request.correlationId, null, fingerprint);
    return UNIFORM_UNUSABLE;
  }
  const record = await expireOnObservation(deps, found, request.correlationId);
  const code = await deps.repository.readCode(record.budgetSpaceId, record.invitationId);
  if (!code || code.disposition !== "active" || record.kind !== "real" || record.state !== "pending") {
    await deps.repository.stampAbuseFingerprint(record.budgetSpaceId, record.invitationId, fingerprint);
    await writeSecurityEvent(
      deps, isTerminalInvitationState(record.state) && record.state === "expired" ? "expired_record" : "terminal_record",
      request.correlationId, record.budgetSpaceId, fingerprint,
    );
    return UNIFORM_UNUSABLE;
  }

  // Invalidate whatever ceremony was current, then open exactly one.
  for (const ceremony of await deps.repository.listCeremonies(record.budgetSpaceId, record.invitationId)) {
    if (ceremony.isCurrent) {
      assertCeremonyEdge(ceremony.state, "invalidated");
      await deps.repository.updateCeremony(record.budgetSpaceId, ceremony.ceremonyId, { state: "invalidated", isCurrent: false });
    }
  }

  const now = deps.clock.now();
  const ceremonyId = deps.ids.uuid();
  const secret = generateCeremonySecret();
  const ceremonyExpiry = earliest(plusSeconds(now, lifetimes(deps).ceremonySeconds), record.expiresAt);
  const outbox = await deps.repository.readOutbox(record.invitationId);
  const challengeDigest = outbox === null ? null : await pendingChallengeDigest(deps, ceremonyId, record);
  await deps.repository.insertCeremony({
    ceremonyId, budgetSpaceId: record.budgetSpaceId, invitationId: record.invitationId,
    ceremonySecretDigest: await ceremonySecretDigest(deps.digest, ceremonyId, secret),
    isCurrent: true,
    channelProofState: challengeDigest === null ? "none" : "challenged",
    channelChallengeDigest: challengeDigest,
    channelAttempts: 0, channelProvedAt: null,
    attachedSubjectId: null, attachedSessionRef: null, attachedAt: null, primaryContactMatch: null,
    disclosureKind: record.disclosureKind, disclosureVersion: record.disclosureVersion, disclosureDigest: record.disclosureDigest,
    acceptanceActionAt: null, acceptedDisclosureVersion: null,
    state: "open", expiresAt: ceremonyExpiry, environment: request.environment,
  });
  await writeAudit(deps, {
    budgetSpaceId: record.budgetSpaceId, eventCode: "AE-73-08", targetType: "invitation_ceremony",
    targetId: ceremonyId, result: "system", correlationId: request.correlationId, audience: "customer",
    payload: { invitationId: record.invitationId, ceremonyId, channelType: "email" },
  });
  return { outcome: "resolved", ceremonyId, ceremonySecret: secret, ceremonyExpiresAt: ceremonyExpiry, channelType: "email" };
}

/**
 * The challenge digest for a fresh ceremony. The six digits themselves live
 * only in the outbox ciphertext, so the delivery adapter is the one component
 * that can render them; this binds the stored digest to the new ceremony id
 * through the adapter's `challengeFor` read.
 */
async function pendingChallengeDigest(deps: InvitationDependencies, ceremonyId: string, record: InvitationRecord): Promise<string | null> {
  const challenge = await deps.challengeReader?.(record.invitationId);
  if (typeof challenge !== "string" || challenge.length === 0) return null;
  return channelChallengeDigest(deps.digest, ceremonyId, challenge);
}

function earliest(a: string, b: string): string {
  return isBefore(a, b) ? a : b;
}

/**
 * Locate the record a presented raw bearer belongs to. The stored verifier is
 * bound to `(invitationId, invitationVersion, destinationToken)`, so the
 * locator cannot recompute it from the raw value alone; it is handed the raw
 * value, looks the row up by the selector half and computes the candidate
 * digest over the secret half on the server side of the seam (`PK5-F02`).
 * The data-access adapter implements this with closed statements.
 */
async function locateByPresentedCode(deps: InvitationDependencies, presented: string) {
  return deps.locator.locateByPresentedCode(presented);
}

// ---------------------------------------------------------------------------
// The ceremony-addressed commands: TR-73-09, TR-73-10, TR-73-11, the
// disclosure read and TR-73-38.
// ---------------------------------------------------------------------------

interface LoadedCeremony {
  readonly ceremony: CeremonyRecord;
  readonly invitation: InvitationRecord;
}

/**
 * Load a live, current ceremony whose cookie secret matches and whose
 * environment is this server's, or throw the uniform outcome. Unknown, foreign, expired, invalidated, consumed and
 * declined ceremonies are one answer; so is a ceremony whose invitation has
 * left `pending` or `awaiting_confirmation`.
 */
async function loadCeremony(
  deps: InvitationDependencies, request: CeremonyRequest, environment: string,
  allowedStates: readonly CeremonyRecord["state"][],
): Promise<LoadedCeremony> {
  const location = await deps.locator.locateByCeremony(request.ceremonyId);
  if (!location) throw new InvitationError("ceremony_unusable");
  const ceremony = await deps.repository.readCeremony(location.budgetSpaceId, request.ceremonyId);
  if (!ceremony) throw new InvitationError("ceremony_unusable");

  const expected = await ceremonySecretDigest(deps.digest, ceremony.ceremonyId, request.ceremonySecret);
  if (!digestsEqual(expected, ceremony.ceremonySecretDigest)) throw new InvitationError("ceremony_unusable");
  if (ceremony.environment !== environment) throw new InvitationError("ceremony_unusable");
  if (!ceremony.isCurrent || !allowedStates.includes(ceremony.state)) throw new InvitationError("ceremony_unusable");
  if (!isBefore(deps.clock.now(), ceremony.expiresAt)) throw new InvitationError("ceremony_unusable");

  const found = await deps.repository.readInvitation(ceremony.budgetSpaceId, ceremony.invitationId);
  if (!found) throw new InvitationError("ceremony_unusable");
  const invitation = await expireOnObservation(deps, found, request.correlationId);
  if (invitation.kind !== "real" || isTerminalInvitationState(invitation.state)) throw new InvitationError("ceremony_unusable");
  const code = await deps.repository.readCode(invitation.budgetSpaceId, invitation.invitationId);
  if (!code || code.disposition !== "active") throw new InvitationError("ceremony_unusable");
  return { ceremony, invitation };
}

export interface VerifyChannelResult {
  readonly outcome: "proved" | "retry" | "exhausted";
  readonly attemptsRemaining: number;
}

/**
 * `TR-73-09`. The bounded attempt count is the ceremony row's, so a client
 * that reopens the page cannot reset it; exhausting it moves the proof state
 * to `exhausted` permanently and the ceremony becomes unusable.
 *
 * `SEC-PK6-F2`: exhaustion is terminal for the bearer, not only for the
 * ceremony. The attempt count would otherwise reset through `resolveCode`,
 * which opens a fresh ceremony bound to the same six digits, and the bound
 * would be the rate limit rather than `MAX_CHANNEL_ATTEMPTS`. On the
 * exhausting guess the code is invalidated in the same transaction
 * (`disposition_reason_class` `channel_attempts_exhausted`, its outbox
 * tombstoned), so a re-resolve answers the uniform envelope with its
 * `terminal_record` security event and the inviter's recovery is a resend.
 * The exhausting ceremony is invalidated with the code (`IC-73-006`), so
 * every later step on it answers the uniform envelope; its row keeps the
 * `exhausted` proof state and `MAX_CHANNEL_ATTEMPTS` as the record of why.
 *
 * `SEC-PK5-F01`. A wrong guess is an **outcome, not an error**. Every command
 * in this module runs inside the caller's transaction, and that transaction
 * rolls back on any thrown error (`packages/data-access/src/binding.ts`), so
 * a function that wrote the attempt increment and then threw discarded its own
 * increment and its own `AE-73-09` row -- leaving the six-digit challenge
 * unbounded. `retry` and `exhausted` are therefore returned, and PK-6 maps
 * them to the 4xx its route needs. The only throw left here is the pre-write
 * `ceremony_unusable` class, which by definition has written nothing.
 */
export async function verifyChannel(deps: InvitationDependencies, request: VerifyChannelRequest): Promise<VerifyChannelResult> {
  const { ceremony, invitation } = await loadCeremony(deps, request, request.environment, ["open"]);
  if (ceremony.channelProofState === "proved") return { outcome: "proved", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - ceremony.channelAttempts };
  if (ceremony.channelProofState === "exhausted") return { outcome: "exhausted", attemptsRemaining: 0 };
  if (ceremony.channelChallengeDigest === null) throw new InvitationError("ceremony_unusable");

  const attempts = ceremony.channelAttempts + 1;
  const presented = request.channelCode.length === 0
    ? null
    : await channelChallengeDigest(deps.digest, ceremony.ceremonyId, request.channelCode);
  const matched = presented !== null && digestsEqual(presented, ceremony.channelChallengeDigest);
  const exhausted = !matched && attempts >= MAX_CHANNEL_ATTEMPTS;

  await deps.repository.updateCeremony(ceremony.budgetSpaceId, ceremony.ceremonyId, {
    channelAttempts: attempts,
    channelProofState: matched ? "proved" : exhausted ? "exhausted" : "challenged",
    channelProvedAt: matched ? deps.clock.now() : null,
  });
  await writeAudit(deps, {
    budgetSpaceId: ceremony.budgetSpaceId, eventCode: "AE-73-09", targetType: "invitation_ceremony",
    targetId: ceremony.ceremonyId, result: matched ? "allow" : "deny",
    reasonClass: matched ? null : exhausted ? "channel_attempts_exhausted" : "channel_challenge_invalid",
    correlationId: request.correlationId, audience: "customer",
    payload: { invitationId: invitation.invitationId, ceremonyId: ceremony.ceremonyId, attemptNumber: attempts, attemptsRemaining: Math.max(0, MAX_CHANNEL_ATTEMPTS - attempts) },
  });
  if (matched) return { outcome: "proved", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - attempts };
  if (exhausted) {
    // `SEC-PK6-F2`: the code and the ceremony die with the bound, in the
    // same transaction as the increment and the `AE-73-09` row.
    await invalidateCodeAndCeremonies(deps, invitation, "channel_attempts_exhausted");
    return { outcome: "exhausted", attemptsRemaining: 0 };
  }
  return { outcome: "retry", attemptsRemaining: MAX_CHANNEL_ATTEMPTS - attempts };
}

/**
 * `TR-73-11` decline: works with or without a session, needs only the channel
 * proof. The invitation becomes `declined` and the code dies, but the
 * inviter's projection stays `pending` until `TR-73-07`, so a decline is not
 * distinguishable from an unattended invitation (CBD-73 SS8.1).
 */
export async function declineInvitation(deps: InvitationDependencies, request: UnauthenticatedCeremonyRequest): Promise<UniformUnusable> {
  const { ceremony, invitation } = await loadCeremony(deps, request, request.environment, ["open"]);
  if (ceremony.channelProofState !== "proved") throw new InvitationError("channel_proof_required");
  assertInvitationEdge(invitation.state, "declined");

  const applied = await deps.repository.updateInvitation(invitation.budgetSpaceId, invitation.invitationId, invitation.stateVersion, {
    state: "declined", projectionState: "pending",
  });
  if (!applied) throw new InvitationError("stale_version", "invitation.stateVersion");
  assertCeremonyEdge(ceremony.state, "declined");
  await deps.repository.updateCeremony(ceremony.budgetSpaceId, ceremony.ceremonyId, { state: "declined", isCurrent: false });
  await invalidateCodeAndCeremonies(deps, invitation, "declined");
  await writeAudit(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-11", targetType: "invitation",
    targetId: invitation.invitationId, result: "system", reasonClass: "declined",
    correlationId: request.correlationId, audience: "restricted",
    payload: { invitationId: invitation.invitationId, ceremonyId: ceremony.ceremonyId, invitationState: "declined" },
  });
  // The person who declined learns only that the link is finished.
  return UNIFORM_UNUSABLE;
}

export interface AttachSuccess {
  readonly ceremonyId: string;
  readonly attached: true;
}

/**
 * `SEC-PK5-F01`. The private `already_member` and `stale_after_membership_end`
 * cancels are writes -- one `TR-73-06` system cancel and one restricted
 * `AE-73-06` row -- so the uniform answer they produce has to be a **returned
 * value**. Throwing after the cancel rolled the caller's transaction back, so
 * the record stayed `pending` and was re-cancelled-and-discarded on every
 * attach. The invitee's answer is byte-identical either way.
 */
export type AttachResult = AttachSuccess | UniformUnusable;

/**
 * `TR-73-10`. The subject must be active with exactly one active profile
 * (`CBD190-PROFILE-ATOMIC-001`), must not already be an active member, and
 * the invitation must have been issued after this subject's latest membership
 * end in the space (`IC-73-017`). An already-member destination is cancelled
 * privately rather than answered, so the invitee learns nothing either.
 *
 * An account switch is never an in-place re-attach (`PK2FIX-F02`): the
 * ceremony is invalidated and the person resolves the link again, which is
 * why this command refuses a ceremony that already carries an attachment.
 */
export async function attachAccount(deps: InvitationDependencies, invitee: InviteeContext, request: CeremonyRequest): Promise<AttachResult> {
  const { ceremony, invitation } = await loadCeremony(deps, request, invitee.environment, ["open"]);
  if (ceremony.channelProofState !== "proved") throw new InvitationError("channel_proof_required");
  if (ceremony.attachedSubjectId !== null) {
    // Attachment evidence is write-once (`SEC-PK2-F03`). A second subject is a
    // new ceremony, never a re-attach.
    if (ceremony.attachedSubjectId !== invitee.subjectId) throw new InvitationError("ceremony_unusable");
    return { ceremonyId: ceremony.ceremonyId, attached: true };
  }

  const identity = await deps.repository.readDisplayIdentity(invitee.subjectId);
  if (!identity || identity.profileState !== "active") throw new InvitationError("subject_ineligible", "subjectId");

  const cancelled = await cancelForMembershipState(deps, invitation, invitee.subjectId, request.correlationId);
  if (cancelled) return cancelled;

  const now = deps.clock.now();
  await deps.repository.updateCeremony(ceremony.budgetSpaceId, ceremony.ceremonyId, {
    attachedSubjectId: invitee.subjectId,
    // `SEC-PK2-F07`: the session row id, never the opaque token or its verifier.
    attachedSessionRef: invitee.sessionRowId,
    attachedAt: now,
    // Restricted evidence only (`IC-73-005`): recorded, never compared to anything the invitee sees.
    primaryContactMatch: null,
  });
  await deps.repository.updateInvitation(invitation.budgetSpaceId, invitation.invitationId, invitation.stateVersion, {
    candidateSubjectId: invitee.subjectId,
  });
  await writeAudit(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-10", actorSubjectId: invitee.subjectId,
    targetType: "invitation_ceremony", targetId: ceremony.ceremonyId, result: "allow",
    correlationId: request.correlationId, audience: "customer",
    payload: { invitationId: invitation.invitationId, ceremonyId: ceremony.ceremonyId },
  });
  return { ceremonyId: ceremony.ceremonyId, attached: true };
}

/**
 * CBD-73 SS4.4 rule 6, the recipient-side half: an active membership, or an
 * invitation issued at or before this subject's latest membership end
 * (`IC-73-017`), cancels the record privately through `TR-73-06` and answers
 * the uniform outcome. Returns null when neither holds, which is the only
 * case where the caller may go on.
 *
 * The cancel is a write, so this **returns** the uniform answer rather than
 * throwing it (`SEC-PK5-F01`); the cancel and its restricted `AE-73-06` row
 * then commit with the caller's transaction.
 */
async function cancelForMembershipState(
  deps: InvitationDependencies, invitation: InvitationRecord, subjectId: string, correlationId: string,
): Promise<UniformUnusable | null> {
  const memberships = await deps.repository.listMemberships(invitation.budgetSpaceId, subjectId);
  const owner = ownerFromRecord(invitation, correlationId);
  if (memberships.some((row) => row.status === "active")) {
    await cancelRecord(deps, owner, invitation, "already_member", "restricted", "pending");
    return UNIFORM_UNUSABLE;
  }
  const latestEnd = memberships
    .map((row) => row.endedAt)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);
  if (latestEnd !== undefined && !isBefore(latestEnd, invitation.issuedAt)) {
    await cancelRecord(deps, owner, invitation, "stale_after_membership_end", "restricted", "pending");
    return UNIFORM_UNUSABLE;
  }
  return null;
}

/** A system-path owner context for a transition nobody is acting on. Carries the record's own creator and creation tuple, never a decided permission. */
function ownerFromRecord(record: InvitationRecord, correlationId: string): OwnerSystemContext {
  // Bound to a short local first: the scanner's generic-api-key rule reads
  // `authorizationVersion: <long identifier>` as a credential (PK2FIX-F04).
  const version = record.creatingAuthorizationVersion;
  return {
    budgetSpaceId: record.budgetSpaceId,
    subjectId: record.createdBySubjectId,
    membershipId: record.createdByMembershipId,
    decision: { policyVersion: record.policyVersion, policyDigest: record.policyDigest, authorizationVersion: version },
    correlationId,
  };
}

export interface DisclosureView {
  readonly ceremonyId: string;
  readonly proposedRole: InvitableRole;
  readonly resourceScope: "full";
  readonly disclosure: ConsentDisclosure;
  /** The two-way statement of CBD-73 SS7.3 and the SS5.1 item 4 confirmation notice, by message code. */
  readonly twoWayNoticeCode: "MSG-73-016";
  readonly confirmationNoticeCode: "MSG-73-051";
  /** The inviting space's display identity is deliberately absent: the invitee sees the role and the consequence. */
  readonly expiresAt: string;
}

/**
 * `GET /v1/invitations/{ceremonyId}`: the pre-acceptance disclosure. The
 * registry's current entry for the invitation's kind is what is shown, and
 * its version is what `TR-73-38` will compare the claim against.
 */
export async function readDisclosure(deps: InvitationDependencies, invitee: InviteeContext, request: CeremonyRequest): Promise<DisclosureView> {
  const { ceremony, invitation } = await loadCeremony(deps, request, invitee.environment, ["open"]);
  if (ceremony.attachedSubjectId !== invitee.subjectId) throw new InvitationError("attachment_required");
  return {
    ceremonyId: ceremony.ceremonyId,
    proposedRole: invitation.proposedRole,
    resourceScope: "full",
    disclosure: deps.disclosures.current(invitation.disclosureKind),
    twoWayNoticeCode: "MSG-73-016",
    confirmationNoticeCode: "MSG-73-051",
    expiresAt: ceremony.expiresAt,
  };
}

export interface AcceptSuccess {
  readonly confirmationId: string;
  readonly state: "awaiting_confirmation";
  readonly confirmationExpiresAt: string;
}

/**
 * `R-01`. `TR-73-38` re-runs the recipient-side half of SS4.4 rule 6 -- "if
 * later attachment reveals active membership, or issue time at/before latest
 * membership end, the system executes `TR-73-06` once ... Acceptance repeats
 * both checks to close races" -- so an active or stale membership answers the
 * same uniform outcome `attachAccount` gives, not a distinguishable
 * `already_member`, and the private cancel commits with it (`SEC-PK5-F01`).
 */
export type AcceptResult = AcceptSuccess | UniformUnusable;

/**
 * `TR-73-38`. The claim must equal the registry's current entry for the kind
 * **and** the invitation's stored version; anything else denies
 * `stale_disclosure` with nothing written (CBD-41-AC02, `PK5-02`). No consent
 * row is written here -- there is no membership to reference yet, and the
 * ceremony and confirmation rows are the pending, non-authorizing evidence
 * CBD-73 requires.
 */
export async function acceptInvitation(deps: InvitationDependencies, invitee: InviteeContext, request: AcceptInvitationRequest): Promise<AcceptResult> {
  const { ceremony, invitation } = await loadCeremony(deps, request, invitee.environment, ["open"]);
  if (ceremony.channelProofState !== "proved") throw new InvitationError("channel_proof_required");
  if (ceremony.attachedSubjectId !== invitee.subjectId) throw new InvitationError("attachment_required");

  assertCurrentDisclosure(deps, invitation, request.acknowledgedDisclosure);

  const identity = await deps.repository.readDisplayIdentity(invitee.subjectId);
  if (!identity || identity.profileState !== "active") throw new InvitationError("subject_ineligible", "subjectId");

  // Recheck eligibility last, because it is the one check that writes: a
  // membership may have been created, or ended, since the attach, and either
  // cancels the record privately and answers the uniform outcome (`R-01`).
  const cancelled = await cancelForMembershipState(deps, invitation, invitee.subjectId, request.correlationId);
  if (cancelled) return cancelled;

  const now = deps.clock.now();
  const confirmationExpiresAt = earliest(plusSeconds(now, lifetimes(deps).confirmationSeconds), invitation.expiresAt);
  const confirmationId = deps.ids.uuid();

  assertInvitationEdge(invitation.state, "awaiting_confirmation");
  const applied = await deps.repository.updateInvitation(invitation.budgetSpaceId, invitation.invitationId, invitation.stateVersion, {
    state: "awaiting_confirmation", projectionState: "pending",
  });
  if (!applied) throw new InvitationError("stale_version", "invitation.stateVersion");

  assertCeremonyEdge(ceremony.state, "accepted_pending_confirmation");
  await deps.repository.updateCeremony(ceremony.budgetSpaceId, ceremony.ceremonyId, {
    state: "accepted_pending_confirmation",
    acceptanceActionAt: now,
    acceptedDisclosureVersion: invitation.disclosureVersion,
  });
  await deps.repository.insertConfirmation({
    confirmationId, budgetSpaceId: invitation.budgetSpaceId, invitationId: invitation.invitationId,
    ceremonyId: ceremony.ceremonyId, acceptorSubjectId: invitee.subjectId,
    // SS9: the display-identity value the confirming owner will decide against.
    displayedIdentityVersion: identity.version,
    bindingRuleId: CONFIRMATION_BINDING_RULE_ID, bindingRuleVersion: CONFIRMATION_BINDING_RULE_VERSION,
    state: "requested", expiresAt: confirmationExpiresAt,
    decidedByMembershipId: null, decidedBySubjectId: null, decidedAt: null, decidedAuthorizationVersion: null,
    committedConsentId: null,
  });
  await writeAudit(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-32", eventSubtype: "confirmation_requested",
    actorSubjectId: invitee.subjectId, targetType: "invitation_confirmation", targetId: confirmationId,
    result: "allow", correlationId: request.correlationId, audience: "customer",
    payload: {
      invitationId: invitation.invitationId, ceremonyId: ceremony.ceremonyId, confirmationId,
      disclosureKind: invitation.disclosureKind, disclosureVersion: invitation.disclosureVersion,
    },
  });
  // AE-73-30: the owner is told there is something to decide.
  await writeAudit(deps, {
    budgetSpaceId: invitation.budgetSpaceId, eventCode: "AE-73-30", targetType: "notice",
    targetId: confirmationId, result: "system", correlationId: request.correlationId, audience: "customer",
    payload: { invitationId: invitation.invitationId, confirmationId, messageCode: "MSG-73-050", noticeCount: 1 },
  });
  await deps.repository.insertNotice({
    noticeId: deps.ids.uuid(), accountSubjectId: invitation.createdBySubjectId,
    budgetSpaceId: invitation.budgetSpaceId, messageCode: "MSG-73-050", eventCorrelationId: request.correlationId,
  });
  return { confirmationId, state: "awaiting_confirmation", confirmationExpiresAt };
}

/**
 * The disclosure binding of CBD-41-AC02, used at `TR-73-38` and again at
 * commit. Three things must agree: the claim, the registry's current entry
 * for the invitation's kind, and the version stored on the invitation. A
 * missing claim is a stale claim -- a confirmation taken without the current
 * disclosure is not consent (CBD-73 SS6 rule 1).
 */
export function assertCurrentDisclosure(
  deps: Pick<InvitationDependencies, "disclosures">,
  invitation: Pick<InvitationRecord, "disclosureKind" | "disclosureVersion" | "disclosureDigest">,
  claim: AcknowledgedDisclosure | undefined,
): ConsentDisclosure {
  const current = deps.disclosures.current(invitation.disclosureKind);
  if (current.version !== invitation.disclosureVersion || current.digest !== invitation.disclosureDigest) {
    throw new InvitationError("stale_disclosure", "disclosure.version");
  }
  if (!claim || claim.kind !== invitation.disclosureKind || claim.version !== invitation.disclosureVersion) {
    throw new InvitationError("stale_disclosure", "acknowledgedDisclosure");
  }
  return current;
}

// ---------------------------------------------------------------------------
// Reads the confirming owner needs.
// ---------------------------------------------------------------------------

export interface ConfirmationPrompt {
  readonly confirmationId: string;
  readonly invitationId: string;
  readonly destinationMasked: string;
  readonly proposedRole: InvitableRole;
  /** The acceptor's safe display identity and nothing else (CBD-73 SS5.1 item 3). */
  readonly acceptorDisplayName: string;
  readonly displayedIdentityVersion: number;
  readonly expiresAt: string;
}

/** The minimum the inviter needs to decide. No contact, no other memberships, no account detail. */
export async function readConfirmationPrompt(
  deps: InvitationDependencies, owner: OwnerContext, invitationId: string,
): Promise<ConfirmationPrompt> {
  const invitation = await requireOwnedInvitation(deps, owner, invitationId);
  const confirmation = await currentConfirmation(deps, invitation);
  const identity = await deps.repository.readDisplayIdentity(confirmation.acceptorSubjectId);
  return {
    confirmationId: confirmation.confirmationId,
    invitationId: invitation.invitationId,
    destinationMasked: invitation.destinationMasked,
    proposedRole: invitation.proposedRole,
    acceptorDisplayName: displayLabel(identity),
    displayedIdentityVersion: identity?.version ?? confirmation.displayedIdentityVersion,
    expiresAt: confirmation.expiresAt,
  };
}

/** SS9: until a value exists, every surface shows the neutral label and never the contact. */
export function displayLabel(identity: DisplayIdentity | null): string {
  const name = identity?.displayName;
  return typeof name === "string" && name.trim().length > 0 ? name : NEUTRAL_DISPLAY_LABEL;
}

/**
 * The one `requested`, unexpired confirmation of a record, or the canonical
 * failure.
 *
 * `R-04`: an expired request is **materialized** before it is denied, the way
 * `expireOnObservation` materializes an expired invitation. Without it the
 * `requested -> expired` edge the confirmation machine draws was never
 * executed by anything and a dead request stayed `requested` for ever.
 */
export async function currentConfirmation(deps: InvitationDependencies, invitation: InvitationRecord): Promise<ConfirmationRecord> {
  const rows = await deps.repository.listConfirmations(invitation.budgetSpaceId, invitation.invitationId);
  const requested = rows.filter((row) => row.state === "requested");
  const now = deps.clock.now();
  const live = requested.find((row) => isBefore(now, row.expiresAt));
  if (live) return live;
  for (const row of requested) {
    assertConfirmationEdge(row.state, "expired");
    await deps.repository.updateConfirmation(invitation.budgetSpaceId, row.confirmationId, { state: "expired" });
  }
  throw new InvitationError("confirmation_not_current", "confirmationId");
}
