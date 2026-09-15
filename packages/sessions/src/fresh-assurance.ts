/**
 * CBD-191 section 5.1 fresh assurance as a record (PK-4, CBD-234 design
 * section 10.4).
 *
 * `account_session` already carries an `assurance_level` column and three
 * `fresh_assurance_*` columns, and `resolve.ts` already degrades an expired
 * grant back to `session` on the next read. What those columns cannot do is
 * be spent: they are mutable row state on a session that lives for hours, so
 * nothing records which ceremony issued the grant and nothing makes a grant
 * usable exactly once. CBD-236's protected cells need both -- section 5.3's
 * `fresh_assurance` obligation is discharged by *consuming* a grant, and a
 * single step-up must authorize a single protected commit, not every
 * protected commit inside the window.
 *
 * So a grant is its own row (`account_session_fresh_assurance`), and this
 * module is the only thing that writes one:
 *
 *   `issueFreshAssurance`  write-once. The unique `challenge_id` means one
 *                          completed step-up ceremony can produce at most
 *                          one grant however many times its callback is
 *                          delivered; the partial unique index means a
 *                          session cannot stack two live grants for the same
 *                          action and space.
 *   `findUsableFreshAssurance`  the read the fact source makes: a grant for
 *                          this session, this action and this space that is
 *                          unconsumed and not yet expired. It never mutates,
 *                          so fact assembly stays a read and the precheck and
 *                          the commit-time recheck agree byte for byte.
 *   `consumeFreshAssurance`  the single-use spend, a conditional UPDATE whose
 *                          WHERE clause carries `state = 'issued'`. It returns
 *                          true exactly once; every later call returns false
 *                          because the row is no longer in that state. The
 *                          state is a closed text value rather than a null
 *                          consumption instant because this package's
 *                          statement seam composes every condition as
 *                          `column <operator> $n` and has no IS NULL
 *                          predicate, so a condition on a nullable column
 *                          would silently never match. Run inside
 *                          the authorization boundary's transaction it is
 *                          rolled back with the effect it authorized.
 *
 * Revocation needs no sweep: a grant is reached only through its session,
 * and `findUsableFreshAssurance` requires that session row to be `active`
 * and unexpired, so revoking, rotating or expiring the session takes every
 * grant it holds with it in the same instant (CBD-191 section 6.1). That
 * requirement is this module's own (SEC-PK4-F3), not a property borrowed from
 * callers who happen to hold a resolved session: the finder reads the session
 * row itself. The statement seam composes one table per statement, so "the
 * reader joins the session row" is two selects on the same client -- inside
 * the authorizing transaction, on that transaction's client -- rather than one
 * SQL join.
 */
import { randomUUID } from "node:crypto";
import type { DataAccessClient } from "@cobudget/data-access";
import type { AccountSubjectId, Environment, SessionRef } from "./types.ts";
import { SessionStoreUnavailableError } from "./types.ts";

export const FRESH_ASSURANCE_TABLE = "account_session_fresh_assurance";

/** The session a grant belongs to; read here only to require it live. */
const SESSION_TABLE = "account_session";

export interface FreshAssuranceGrant {
  readonly freshAssuranceId: string;
  readonly sessionRef: SessionRef;
  readonly accountSubjectId: AccountSubjectId;
  readonly environmentId: Environment;
  /** The step-up ceremony that produced the grant; unique across the table. */
  readonly challengeId: string;
  readonly boundAction: string;
  readonly boundSpaceId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly state: "issued" | "consumed";
  readonly consumedAt: Date | undefined;
  readonly consumedByAction: string | undefined;
}

export interface IssueFreshAssuranceInput {
  readonly sessionRef: SessionRef;
  readonly accountSubjectId: AccountSubjectId;
  readonly environmentId: Environment;
  readonly challengeId: string;
  readonly boundAction: string;
  readonly boundSpaceId: string;
  readonly issuedAt: Date;
  /** Short and bounded: `SessionConfig.freshAssuranceWindowSeconds` from the issue instant. */
  readonly windowSeconds: number;
}

export type IssueFreshAssuranceOutcome =
  | { readonly status: "issued"; readonly grant: FreshAssuranceGrant }
  /** The ceremony already produced a grant (a replayed callback), or a live grant for this session, action and space already exists. */
  | { readonly status: "already_issued"; readonly grant: FreshAssuranceGrant | undefined };

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toGrant(row: Record<string, unknown>): FreshAssuranceGrant {
  return {
    freshAssuranceId: String(row.fresh_assurance_id),
    sessionRef: String(row.session_ref),
    accountSubjectId: String(row.account_subject_id),
    environmentId: String(row.environment_id),
    challengeId: String(row.challenge_id),
    boundAction: String(row.bound_action),
    boundSpaceId: String(row.bound_space_id),
    issuedAt: toDate(row.issued_at),
    expiresAt: toDate(row.expires_at),
    state: row.state === "consumed" ? "consumed" : "issued",
    consumedAt: row.consumed_at == null ? undefined : toDate(row.consumed_at),
    consumedByAction: row.consumed_by_action == null ? undefined : String(row.consumed_by_action),
  };
}

async function withStoreFailure<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new SessionStoreUnavailableError(error);
  }
}

/** The grant a given step-up ceremony produced, if any. */
export async function findFreshAssuranceByChallenge(client: DataAccessClient, challengeId: string): Promise<FreshAssuranceGrant | undefined> {
  return withStoreFailure(async () => {
    const result = await client.platformSelect({ table: FRESH_ASSURANCE_TABLE, conditions: [{ column: "challenge_id", value: challengeId }] });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? toGrant(row) : undefined;
  });
}

/**
 * Write-once. A duplicate `challenge_id`, or a second live grant for the
 * same session, action and space, is refused by a unique index rather than
 * by a read-then-write check that a concurrent caller could interleave with;
 * the rejected caller re-reads and reports `already_issued`, exactly as
 * `store.ts` handles every other unique-index idempotency in this package.
 */
export async function issueFreshAssurance(client: DataAccessClient, input: IssueFreshAssuranceInput): Promise<IssueFreshAssuranceOutcome> {
  if (!Number.isSafeInteger(input.windowSeconds) || input.windowSeconds <= 0) throw new Error("fresh assurance window must be a positive whole number of seconds");
  const existing = await findFreshAssuranceByChallenge(client, input.challengeId);
  if (existing) return { status: "already_issued", grant: existing };
  const grant: FreshAssuranceGrant = {
    freshAssuranceId: randomUUID(),
    sessionRef: input.sessionRef,
    accountSubjectId: input.accountSubjectId,
    environmentId: input.environmentId,
    challengeId: input.challengeId,
    boundAction: input.boundAction,
    boundSpaceId: input.boundSpaceId,
    issuedAt: input.issuedAt,
    expiresAt: new Date(input.issuedAt.getTime() + input.windowSeconds * 1000),
    state: "issued",
    consumedAt: undefined,
    consumedByAction: undefined,
  };
  try {
    await client.platformInsert({
      table: FRESH_ASSURANCE_TABLE,
      values: {
        fresh_assurance_id: grant.freshAssuranceId,
        session_ref: grant.sessionRef,
        account_subject_id: grant.accountSubjectId,
        environment_id: grant.environmentId,
        challenge_id: grant.challengeId,
        ceremony: "step_up",
        bound_action: grant.boundAction,
        bound_space_id: grant.boundSpaceId,
        issued_at: grant.issuedAt,
        expires_at: grant.expiresAt,
        state: "issued",
        consumed_at: null,
        consumed_by_action: null,
        created_at: grant.issuedAt,
        updated_at: grant.issuedAt,
      },
    });
  } catch {
    // The CBD-246 wrapper discards driver detail, so a unique violation and any
    // other insert failure look alike here: re-read, and report `already_issued`
    // only when the row the index would have refused is actually present.
    const winner = await findFreshAssuranceByChallenge(client, input.challengeId);
    if (winner) return { status: "already_issued", grant: winner };
    const live = await findUsableFreshAssurance(client, { sessionRef: input.sessionRef, boundAction: input.boundAction, boundSpaceId: input.boundSpaceId, now: input.issuedAt });
    if (live) return { status: "already_issued", grant: live };
    throw new SessionStoreUnavailableError(undefined);
  }
  return { status: "issued", grant };
}

export interface FreshAssuranceLookup {
  readonly sessionRef: SessionRef;
  readonly boundAction: string;
  readonly boundSpaceId: string;
  readonly now: Date;
}

/**
 * The grant the fact source may report as `assurance.level = "fresh"`: bound
 * to exactly this action and this space, unconsumed, and not yet expired at
 * `now`. A grant bound to another action or another space is not "a weaker
 * match" here, it is simply not found -- matching is equality, so the caller
 * emits `session` and `decide` denies `assurance_insufficient` on its own
 * comparison rather than on a judgement made here.
 *
 * Expiry uses `>` on the stored instant so a request landing exactly on the
 * boundary finds nothing, the same strictness `resolve.ts` applies to the
 * session's own expiries.
 *
 * SEC-PK4-F3: the session row is read here too, and the grant is reported only
 * while that row is `active` and both of its expiries are still ahead of
 * `now`. Every production caller already resolves a live session before it
 * gets a `sessionRef`, so this changes no composed behaviour; what it changes
 * is where the guarantee lives. "A grant dies with its session" is the rule
 * this function is documented to keep and the migration header states, so it
 * is checked here rather than assumed of whoever calls next.
 */
export async function findUsableFreshAssurance(client: DataAccessClient, lookup: FreshAssuranceLookup): Promise<FreshAssuranceGrant | undefined> {
  return withStoreFailure(async () => {
    const result = await client.platformSelect({
      table: FRESH_ASSURANCE_TABLE,
      conditions: [
        { column: "session_ref", value: lookup.sessionRef },
        { column: "bound_action", value: lookup.boundAction },
        { column: "bound_space_id", value: lookup.boundSpaceId },
        { column: "state", value: "issued" },
        { column: "expires_at", operator: ">", value: lookup.now },
      ],
    });
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    // Second statement rather than a join: this package's seam composes one
    // table per statement. Both run on the client the caller passed, so inside
    // the authorization boundary's transaction both are part of it.
    const live = await client.platformSelect({
      table: SESSION_TABLE,
      columns: ["session_ref"],
      conditions: [
        { column: "session_ref", value: lookup.sessionRef },
        { column: "state", value: "active" },
        { column: "idle_expires_at", operator: ">", value: lookup.now },
        { column: "absolute_expires_at", operator: ">", value: lookup.now },
      ],
    });
    if (live.rows.length === 0) return undefined;
    return toGrant(row);
  });
}

/**
 * Consumed once. The conditional UPDATE is the whole mechanism: two callers
 * racing for the same grant both send it, exactly one matches
 * `consumed_at IS NULL`, and the loser sees `rowCount === 0`. `client` is the
 * boundary's transaction-scoped client at the call site that matters, so a
 * rolled-back effect rolls the consumption back with it and a grant is never
 * spent by a commit that did not happen.
 *
 * `action` is recorded for evidence only; the grant is already bound, and a
 * mismatched action never reaches here because `findUsableFreshAssurance`
 * matched on it.
 */
export async function consumeFreshAssurance(client: DataAccessClient, input: { readonly freshAssuranceId: string; readonly action: string; readonly now: Date }): Promise<boolean> {
  return withStoreFailure(async () => {
    const result = await client.platformUpdate({
      table: FRESH_ASSURANCE_TABLE,
      set: { state: "consumed", consumed_at: input.now, consumed_by_action: input.action, updated_at: input.now },
      conditions: [
        { column: "fresh_assurance_id", value: input.freshAssuranceId },
        { column: "state", value: "issued" },
      ],
    });
    return result.rowCount === 1;
  });
}
