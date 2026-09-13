/**
 * §6.1 application-initiated revocation and §7 customer-state clearing's
 * delegation-retirement outbox action.
 *
 * `OQ-191-001` (decided, branch B, `CBD191-ZERO-MEMBERSHIP-001`): losing the
 * last membership does not end authenticated standing. This module exposes
 * no "zero membership" trigger at all -- branch B means there is nothing to
 * call; `permission_loss` here only fires for subject disablement (the
 * unconditional half of branch B's own text), never for a membership count
 * reaching zero.
 */
import { DELEGATION_RETIREMENT_CAUSES, EPOCH_BUMP_CAUSES, GLOBAL_PROVIDER_INVALIDATION_CAUSES } from "./types.ts";
import type { SessionConfig } from "./config.ts";
import type { SessionStore } from "./store.ts";
import type { AccountSubjectId, Environment, RevocationCause, SessionRef, SubjectLifecycle } from "./types.ts";

/** SC-191-003A: causes that also move the subject out of `active` (terminal
 * for `account_deletion`/`security_action`; `disabled` is not terminal at
 * the database level, since an administrative re-enable is a legitimate
 * future flow this packet does not implement). Every other epoch-bumping
 * cause leaves the subject `active` -- a live subject may still be
 * revoked-and-reauthenticated (`logout_everywhere`,
 * `credential_or_factor_change`, the provider-initiated causes). */
const LIFECYCLE_TRANSITIONS: Partial<Record<RevocationCause, SubjectLifecycle>> = {
  account_deletion: "deleted",
  security_action: "security_blocked",
  permission_loss: "disabled",
};

function deadlineFrom(occurredAt: Date, config: SessionConfig): Date {
  return new Date(occurredAt.getTime() + config.revocationPropagationTargetSeconds * 1000);
}

async function enqueueOutboxActions(
  store: SessionStore,
  config: SessionConfig,
  accountSubjectId: AccountSubjectId,
  identityBindingId: string | undefined,
  environmentId: Environment,
  cause: RevocationCause,
  revocationEpoch: number,
  occurredAt: Date,
): Promise<void> {
  const deadlineAt = deadlineFrom(occurredAt, config);
  if (GLOBAL_PROVIDER_INVALIDATION_CAUSES.includes(cause)) {
    await store.insertRevocationOutbox({
      accountSubjectId,
      identityBindingId,
      environmentId,
      cause,
      target: "provider_global_invalidation",
      revocationEpoch,
      occurredAt,
      deadlineAt,
    });
  }
  if (DELEGATION_RETIREMENT_CAUSES.includes(cause)) {
    await store.insertRevocationOutbox({
      accountSubjectId,
      identityBindingId,
      environmentId,
      cause,
      target: "delegation_retirement",
      revocationEpoch,
      occurredAt,
      deadlineAt,
    });
  }
}

/** §6.1 `logout`: single-row revoke, no subject epoch effect. Cookie deletion is the caller's (cookie.ts) job. */
export async function logout(store: SessionStore, config: SessionConfig, sessionRef: SessionRef, environmentId: Environment): Promise<void> {
  const session = await store.findBySessionRef(sessionRef);
  if (!session) return;
  await store.markRevoked(sessionRef, "logout");
  await store.insertRevocationOutbox({
    accountSubjectId: session.accountSubjectId,
    identityBindingId: session.identityBindingId,
    environmentId,
    cause: "logout",
    target: "provider_current_browser_bound",
    revocationEpoch: session.issuedRevocationEpoch,
    occurredAt: new Date(),
    deadlineAt: deadlineFrom(new Date(), config),
  });
}

/**
 * §6.1 subject-epoch-bumping causes (`logout_everywhere`,
 * `recovery_completed`, `credential_or_factor_change`, `account_deletion`,
 * `security_action`, and the disablement-only half of `permission_loss`).
 * `recovery_completed`'s "atomic bump then replacement issuance" half is
 * `issuance.ts`'s `recovery` branch, which fails closed under v0.3
 * (`OQ-191-007`); this function only performs the bump/outbox half that is
 * representable today.
 */
export async function bumpSubjectForCause(
  store: SessionStore,
  config: SessionConfig,
  accountSubjectId: AccountSubjectId,
  identityBindingId: string | undefined,
  environmentId: Environment,
  cause: RevocationCause,
): Promise<number> {
  if (!EPOCH_BUMP_CAUSES.includes(cause)) {
    throw new RangeError(`${cause} is not a subject-epoch-bumping cause`);
  }
  const occurredAt = new Date();
  const revocationEpoch = await store.bumpSubjectEpoch(accountSubjectId, cause, LIFECYCLE_TRANSITIONS[cause]);
  await enqueueOutboxActions(store, config, accountSubjectId, identityBindingId, environmentId, cause, revocationEpoch, occurredAt);
  return revocationEpoch;
}
