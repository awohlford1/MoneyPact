/**
 * §5.2/§5.3 issuance: consumes a `SessionIssueCommandV1`, rotates the
 * representable causes, and returns the replayable sealed delivery result.
 *
 * CBD191-CORRECTION-001 item 6 / `SC-191-003A`: the issuance fence is now,
 * in order:
 *
 *   1. reject an already-expired, never-consumed handoff before any
 *      allocation or side effect at all (`deliverUntil <= now`);
 *   2. observe the subject's current `revocationEpoch`/`subjectLifecycle`
 *      once, up front;
 *   3. reject immediately if the subject is not `active`;
 *   4. allocate the new `sessionVersion` only if, at allocation time, the
 *      epoch still equals what was observed in step 2 and the subject is
 *      still `active` (`store.allocateSessionVersionFenced`) -- a
 *      concurrent epoch bump or lifecycle change rejects the whole
 *      consumption rather than silently reissuing at the new epoch;
 *   5. insert the new session row (unique on `session_ref`/`session_selector`/
 *      `(account_subject_id, session_version)`, so a duplicate insert fails
 *      rather than silently doubling a lineage);
 *   6. mark the prior row (if any) `rotated`;
 *   7. seal and store the delivery result, keyed uniquely by
 *      `session_handoff_id`.
 *
 * KNOWN LIMITATION (see `store.ts`'s header and the final report): steps
 * 4-7 are still not one database transaction -- `@cobudget/data-access`'s
 * client exposes no transaction primitive this packet may add (catalog.ts
 * is the only writable file in that package). A crash between steps 5 and 6
 * leaves a real gap this implementation cannot close without a transaction
 * primitive: a new row inserted but the prior row never marked `rotated`
 * leaves two `active` rows for the same subject until an operator or a
 * future reconciliation job notices. No step *mints* authority incorrectly
 * (each row's own epoch/version is correct in isolation, and a stuck prior
 * row is still revocable by the normal epoch-bump path), so the failure
 * mode is "an extra live session needing cleanup," not a security bypass.
 * Steps 1-4 (the actual `SC-191-003A` resurrection barrier CBD191-REVIEW-
 * IMPL-001 and CBD191-SECURITY-002 both flagged) are now atomic: step 4 is
 * one compare-and-swap that fails closed the instant the observed epoch or
 * lifecycle is stale.
 *
 * `OQ-191-007`: CBD-190 v0.3 supplies neither `preparedRevocationEpoch` nor
 * a `recovery` command, so those branches fail closed here exactly as the
 * contract requires, rather than being inferred from timestamps.
 */
import { randomUUID } from "node:crypto";
import { generateCsrfValue, generateOpaqueIdentifier, generateSessionRef, pepperedDigest } from "./crypto.ts";
import { openDelivery, sealDelivery } from "./envelope.ts";
import type { EnvelopeKeyProvider } from "./envelope-key.ts";
import type { SessionConfig } from "./config.ts";
import type { SessionStore } from "./store.ts";
import { StaleEpochError, SubjectNotActiveError } from "./types.ts";
import type { SealedSessionDelivery, SessionIssueCommandV1, SessionRecord } from "./types.ts";

export class UnsupportedUnderV03Error extends Error {
  constructor(reason: string) {
    super(`session issuance rejected: ${reason} (OQ-191-007 -- fails closed under CBD-190 v0.3 rather than inferring the additive input)`);
    this.name = "UnsupportedUnderV03Error";
  }
}

export class IssuanceRejectedError extends Error {
  constructor(reason: string) {
    super(`session issuance rejected: ${reason}`);
    this.name = "IssuanceRejectedError";
  }
}

function assertRepresentable(command: SessionIssueCommandV1): void {
  if (command.contractVersion !== 1) throw new IssuanceRejectedError("unknown contract version");
  if (command.rotationCause === "recovery") {
    throw new UnsupportedUnderV03Error("recovery has no CBD-190 v0.3 command shape");
  }
  if (command.rotationCause === "authentication" && command.boundCurrentSessionRef) {
    throw new UnsupportedUnderV03Error("the bound-context authentication branch cannot be invoked from a v0.3 command");
  }
  if (command.preparedRevocationEpoch !== undefined) {
    throw new UnsupportedUnderV03Error("prepared_revocation_epoch has no v0.3 command source; only the recovery branch may use it");
  }
  if (command.rotationCause === "assurance_elevation") {
    if (!command.freshAssurance) throw new IssuanceRejectedError("assurance_elevation requires a validated fresh assurance result");
    // Unlike `authentication`, `assurance_elevation` happens inside an
    // already-resolved session (a step-up on a live request), so its
    // "current row" is that already-known session, not a subject-wide
    // lookup -- the request handler passes it as `boundCurrentSessionRef`.
    // §5.2 does not mark this branch v0.3-blocked (only `authentication` and
    // `recovery` are), so this is representable, unlike the login case.
    if (!command.boundCurrentSessionRef) throw new IssuanceRejectedError("assurance_elevation requires the already-resolved session's boundCurrentSessionRef");
  }
  if (command.rotationCause === "account_switch" && !command.previousSessionId) {
    throw new IssuanceRejectedError("account_switch requires previous_session_id");
  }
}

async function replayIfConsumed(
  store: SessionStore,
  envelopeKeyProvider: EnvelopeKeyProvider,
  command: SessionIssueCommandV1,
): Promise<SealedSessionDelivery | undefined> {
  const existing = await store.findDeliveryResult(command.sessionHandoffId);
  if (!existing) return undefined;
  if (existing.acknowledgedAt !== undefined) {
    throw new IssuanceRejectedError("handoff already acknowledged; a consumed handoff never mints a second session");
  }
  if (existing.deliverUntil.getTime() <= Date.now()) {
    // §5.3: an expired, unacknowledged envelope revokes the orphan session
    // and erases the envelope; replay then fails terminally. `SC-191-004`'s
    // schema names this exact case with its own revocation_cause value.
    await store.markRevoked(existing.sessionRef, "orphaned_delivery_result_expiry");
    await store.acknowledgeDeliveryResult(command.sessionHandoffId);
    throw new IssuanceRejectedError("delivery envelope expired before acknowledgement; the orphan session was revoked and this handoff cannot be replayed");
  }
  const key = envelopeKeyProvider.keyFor(existing.envelopeKeyVersion);
  if (!key) throw new IssuanceRejectedError(`delivery envelope key version "${existing.envelopeKeyVersion}" is not resolvable; replay cannot be decrypted`);
  const payload = openDelivery(key, existing.sealedEnvelope, command.sessionHandoffId);
  const session = await store.findBySessionRef(payload.sessionRef);
  if (!session) throw new IssuanceRejectedError("delivery result names a session row that no longer exists");
  return { sessionRef: payload.sessionRef, cookieValue: payload.cookieValue, csrfValue: payload.csrfValue, absoluteExpiresAt: session.absoluteExpiresAt };
}

/**
 * §5.2/§5.3: resolves the one named prior row a representable v0.3 rotation
 * cause may act on, and validates it fully (CBD191-REVIEW-IMPL-001 Medium
 * finding: an earlier revision checked only state and subject, not
 * environment, expiry, or epoch).
 */
async function resolvePriorRow(store: SessionStore, command: SessionIssueCommandV1, observedRevocationEpoch: number, now: Date): Promise<SessionRecord | undefined> {
  if (command.rotationCause === "assurance_elevation") {
    if (!command.boundCurrentSessionRef) throw new IssuanceRejectedError("assurance_elevation requires boundCurrentSessionRef");
    const found = await store.findBySessionRef(command.boundCurrentSessionRef);
    if (
      !found
      || found.state !== "active"
      || found.accountSubjectId !== command.accountSubjectId
      || found.environmentId !== command.environmentId
      || found.issuedRevocationEpoch !== observedRevocationEpoch
      || found.idleExpiresAt.getTime() <= now.getTime()
      || found.absoluteExpiresAt.getTime() <= now.getTime()
    ) {
      throw new IssuanceRejectedError("assurance_elevation's bound current session must be active, unexpired, at the current epoch, and owned by the resolved subject in the resolved environment");
    }
    return found;
  }
  if (command.rotationCause === "account_switch") {
    if (!command.previousSessionId) throw new IssuanceRejectedError("account_switch requires previous_session_id");
    const found = await store.findBySessionRef(command.previousSessionId);
    if (found && found.state === "active" && found.accountSubjectId === command.accountSubjectId) {
      throw new IssuanceRejectedError("account_switch's previous_session_id names a row already under the resolved subject; use authentication instead");
    }
    return found && found.state === "active" ? found : undefined;
  }
  // §5.2/§5.3: "current row" means one specific named row, never a
  // subject-wide lookup -- `authentication`'s bound-context branch (naming
  // the browser's own prior cookie) is v0.3-blocked above, so ordinary v0.3
  // `authentication` always "starts a lineage" and never rotates any other
  // row for the subject. Rotating on a bare subject-wide lookup would
  // silently kill every sibling device on each new login.
  return undefined;
}

/**
 * Consumes `command` and issues (or replays) a session. Returns the
 * replayable sealed delivery: identical bytes on a replay while
 * `deliver_until` remains live (§5.3).
 */
export async function consumeAndIssue(
  command: SessionIssueCommandV1,
  store: SessionStore,
  config: SessionConfig,
  envelopeKeyProvider: EnvelopeKeyProvider,
  now: Date,
): Promise<SealedSessionDelivery> {
  assertRepresentable(command);

  const replay = await replayIfConsumed(store, envelopeKeyProvider, command);
  if (replay) return replay;

  // CBD191-SECURITY-002 High finding 1: a never-consumed command whose
  // deliverUntil has already passed must mint nothing at all -- no
  // allocation, no session row, no delivery result.
  if (command.deliverUntil.getTime() <= now.getTime()) {
    throw new IssuanceRejectedError("delivery deadline has already passed; a handoff that was never consumed while live cannot be consumed after expiry");
  }

  // SC-191-003A step 2: observe the fence input once, before any prior-row
  // lookup or allocation attempt.
  const observed = await store.currentSubjectAuthority(command.accountSubjectId);
  if (observed.subjectLifecycle !== "active") {
    throw new IssuanceRejectedError(`subject is not active (lifecycle=${observed.subjectLifecycle})`);
  }

  const priorRow = await resolvePriorRow(store, command, observed.revocationEpoch, now);

  let sessionVersion: number;
  let revocationEpoch: number;
  try {
    ({ sessionVersion, revocationEpoch } = await store.allocateSessionVersionFenced(command.accountSubjectId, observed.revocationEpoch));
  } catch (error) {
    if (error instanceof StaleEpochError || error instanceof SubjectNotActiveError) {
      throw new IssuanceRejectedError(`prepared handoff rejected: ${error.message}`);
    }
    throw error;
  }

  const identifier = generateOpaqueIdentifier();
  const csrfValue = generateCsrfValue();
  // CBD191-SECURITY-002 High finding 2: `sessionRef` is an independent
  // random value, never a cookie half. It is the one session-shaped value
  // CBD-236/audit code may carry (§3.1); it cannot resolve anything by
  // itself because resolution indexes on `session_selector`, not this.
  const sessionRef = generateSessionRef();
  const issuedAt = now;
  const idleExpiresAt = new Date(issuedAt.getTime() + config.idleTimeoutSeconds * 1000);
  const absoluteExpiresAt = new Date(issuedAt.getTime() + config.absoluteLifetimeSeconds * 1000);

  const record: SessionRecord = {
    sessionId: randomUUID(),
    sessionSelector: identifier.selector,
    verifierDigest: pepperedDigest(config.pepper, identifier.verifier),
    sessionRef,
    accountSubjectId: command.accountSubjectId,
    environmentId: command.environmentId,
    identityBindingId: command.identityBindingId,
    sessionVersion,
    issuedRevocationEpoch: revocationEpoch,
    state: "active",
    supersededBySessionRef: undefined,
    assuranceLevel: command.freshAssurance ? "fresh" : "session",
    freshAssurance: command.freshAssurance
      ? {
          boundAction: command.freshAssurance.boundAction,
          boundSpaceId: command.freshAssurance.boundSpaceId,
          expiresAt: new Date(issuedAt.getTime() + config.freshAssuranceWindowSeconds * 1000),
        }
      : undefined,
    csrfDigest: pepperedDigest(config.pepper, csrfValue),
    issuedAt,
    idleExpiresAt: new Date(Math.min(idleExpiresAt.getTime(), absoluteExpiresAt.getTime())),
    absoluteExpiresAt,
    rotationCause: command.rotationCause,
    revocationCause: undefined,
  };

  await store.insertSession(record);

  if (priorRow) {
    await store.markRotated(priorRow.sessionRef, sessionRef);
  }

  const delivery: SealedSessionDelivery = { sessionRef, cookieValue: identifier.cookieValue, csrfValue, absoluteExpiresAt };
  const sealed = sealDelivery(envelopeKeyProvider.sealingKey(), { cookieValue: delivery.cookieValue, csrfValue: delivery.csrfValue, sessionRef, sessionHandoffId: command.sessionHandoffId });
  await store.insertDeliveryResult(command.sessionHandoffId, sessionRef, sealed, envelopeKeyProvider.currentVersion, command.deliverUntil);

  return delivery;
}
