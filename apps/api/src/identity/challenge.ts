/**
 * CBD-190 §4.1 one-time challenge store.
 *
 * `begin` generates >= 256 bits of state, a PKCE S256 verifier/challenge and
 * an OIDC nonce (three distinct values) and stores only the minimum record:
 * one-way state verifier (the lookup key), protected PKCE verifier, one-way
 * nonce verifier, environment, exact origins, ceremony, destination key,
 * creation/expiry, single-use status and the optional current subject for
 * an account switch. No client value can override a stored field.
 *
 * The store is in-process for the local prototype, the same custody choice
 * `LOCAL_PROTOTYPE_COUNTER_STORE` makes for rate-limit counters: the raw
 * state and nonce never exist server-side (only their SHA-256), the PKCE
 * verifier never touches a database, backup or dump (§10.2 inventory), and a
 * process restart simply expires every pending ceremony (`invalid_or_expired`).
 * It is bounded so an unauthenticated flood of `begin` calls fails closed
 * instead of growing without limit.
 */
import { createHash, randomBytes } from "node:crypto";

/**
 * PK-4 (CBD-234 design section 10.4): `step_up` is the re-authentication of
 * an already-signed-in subject that produces a fresh-assurance grant. It
 * issues no session and maps no subject, so it is not reachable through
 * `POST /v1/identity/begin` -- `IdentityCeremony#begin` refuses it by name
 * and `beginStepUp` is its only entry point. Widening the vocabulary here
 * is the application half of the CBD-190 amendment; the database half is
 * the `identity_session_handoff.ceremony` CHECK
 * (20260915T120000Z__create_account_session_fresh_assurance.sql).
 */
export type Ceremony = "register" | "verify" | "sign_in" | "enroll_factor" | "account_switch" | "step_up";
export const CEREMONIES: readonly Ceremony[] = Object.freeze(["register", "verify", "sign_in", "enroll_factor", "account_switch", "step_up"]);

export interface ChallengeRecord {
  readonly challengeId: string;
  readonly environmentId: string;
  readonly ceremony: Ceremony;
  readonly initiatingOrigin: string;
  readonly callbackUri: string;
  readonly postResultDestinationId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly stateDigest: string;
  readonly nonceDigest: string;
  /** Present for an authenticated account switch and for a step-up; taken from server state, never sent to the provider (§4.1, §5.4). */
  readonly currentAccountSubjectId: string | undefined;
  readonly currentSessionRef: string | undefined;
  /**
   * PK-4: the action code and budget space a `step_up` challenge is bound to,
   * fixed at begin time from validated server-side state. The provider never
   * sees either value, and no callback field can change them -- the grant the
   * callback issues is built from these, not from anything the browser returns.
   */
  readonly boundAction: string | undefined;
  readonly boundSpaceId: string | undefined;
  status: "pending" | "consumed" | "terminated";
}

export interface IssuedChallenge {
  readonly record: ChallengeRecord;
  /** Raw values that traverse only the authorization redirect (§10.2). */
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

/** The protected PKCE verifier, released exactly once to the bounded exchange. */
export interface TakenChallenge {
  readonly record: ChallengeRecord;
  readonly codeVerifier: Buffer;
}

export function oneWayDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function pkceChallenge(verifier: Buffer): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export class ChallengeStoreFullError extends Error {
  constructor() {
    super("identity challenge store is at capacity; begin is refused until pending challenges expire");
    this.name = "ChallengeStoreFullError";
  }
}

interface Slot {
  readonly record: ChallengeRecord;
  verifier: Buffer | undefined;
}

export class ChallengeStore {
  readonly #byState: Record<string, Slot | undefined> = Object.create(null);
  readonly #byChallenge: Record<string, Slot | undefined> = Object.create(null);
  #size = 0;
  readonly #capacity: number;
  readonly #now: () => Date;

  /** PROTO-ACTIVATION-001 A9 (RC-04): deadline-owned expiry, independent of traffic. */
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #schedule: ((run: () => void, delayMs: number) => ReturnType<typeof setTimeout>) | undefined;

  /**
   * `scheduler` (default: `setTimeout`) arms one unref'd timer for the earliest pending deadline, so
   * an idle challenge's PKCE verifier is zeroed at its own deadline with no further traffic; `null`
   * disables the timer (tests that drive the clock by hand). `stop()` releases it on shutdown.
   */
  constructor(now: () => Date = () => new Date(), capacity = 10_000, scheduler: ((run: () => void, delayMs: number) => ReturnType<typeof setTimeout>) | null = (run, delayMs) => { const timer = setTimeout(run, delayMs); timer.unref?.(); return timer; }) {
    this.#now = now;
    this.#capacity = capacity;
    this.#schedule = scheduler ?? undefined;
  }

  get size(): number {
    return this.#size;
  }

  /** Sweeps every slot past its deadline now and re-arms the deadline timer; safe to call at any time. */
  sweep(now: Date = this.#now()): void {
    this.#sweep(now);
    this.#arm(now);
  }

  /** Releases the deadline timer (process shutdown). */
  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #arm(now: Date): void {
    if (!this.#schedule) return;
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
    let earliest: number | undefined;
    for (const key of Object.keys(this.#byChallenge)) {
      const slot = this.#byChallenge[key];
      if (!slot) continue;
      const due = slot.record.status === "pending" ? slot.record.expiresAt.getTime() : slot.record.expiresAt.getTime() + 60_000;
      if (earliest === undefined || due < earliest) earliest = due;
    }
    if (earliest === undefined) return;
    this.#timer = this.#schedule(() => { this.#timer = undefined; this.sweep(this.#now()); }, Math.max(1, earliest - now.getTime()));
  }

  #forget(slot: Slot): void {
    slot.verifier?.fill(0);
    slot.verifier = undefined;
    delete this.#byState[slot.record.stateDigest];
    delete this.#byChallenge[slot.record.challengeId];
    this.#size -= 1;
  }

  /**
   * PROTO-IDENTITY-API-001 correction C4 (review R04): an abandoned pending
   * challenge (no callback ever arrives) previously stayed `pending`
   * forever and its PKCE buffer was never released, so enough abandoned
   * `begin` calls exhausted capacity until restart (reproduced at capacity
   * one: a one-second challenge left pending still filled a size-one store
   * two minutes later). A pending challenge past its own deadline now
   * expires here -- zeroing and releasing its verifier exactly like
   * `terminate()` -- so its capacity is bounded by its own lifetime plus
   * the same 60-second tombstone grace every other terminal record gets,
   * not by a restart. The tombstone still exists for that grace window so
   * a replay of the known expired state terminates cleanly (§7) before
   * being forgotten and its slot reclaimed.
   */
  #sweep(now: Date): void {
    for (const key of Object.keys(this.#byChallenge)) {
      const slot = this.#byChallenge[key];
      if (!slot) continue;
      if (slot.record.status === "pending" && slot.record.expiresAt.getTime() <= now.getTime()) this.terminate(slot.record.challengeId);
      if (slot.record.status !== "pending" && slot.record.expiresAt.getTime() + 60_000 <= now.getTime()) this.#forget(slot);
    }
  }

  /**
   * Correction round 3 RC-04 (security S04 residual): the full `#sweep`
   * above only ever ran from `issue()`, so a challenge nobody re-issued
   * against (looked up only through `find()`/`findByChallengeId()`, or
   * simply left alone) stayed `pending` and kept its live PKCE verifier
   * buffer past its own deadline until some unrelated `begin()` elsewhere
   * happened to sweep the whole store. Every read path now expires a
   * single slot in place, in O(1), the instant it is touched past its
   * deadline -- so an expired pending challenge is never returned as
   * still-pending and its verifier is zeroed at the deadline, independent
   * of any other traffic. PROTO-ACTIVATION-001 A9 added the store-wide
   * deadline timer (`#arm`/`sweep`/`stop`) the earlier round left out: an
   * unref'd timer for the earliest deadline, re-armed after every sweep, so
   * expiry is owned by the deadline itself and not by any later access.
   */
  #expireIfDue(slot: Slot | undefined, now: Date): Slot | undefined {
    if (slot && slot.record.status === "pending" && slot.record.expiresAt.getTime() <= now.getTime()) this.terminate(slot.record.challengeId);
    return slot;
  }

  issue(input: {
    readonly environmentId: string;
    readonly ceremony: Ceremony;
    readonly initiatingOrigin: string;
    readonly callbackUri: string;
    readonly postResultDestinationId: string;
    readonly lifetimeSeconds: number;
    readonly currentAccountSubjectId?: string | undefined;
    readonly currentSessionRef?: string | undefined;
    readonly boundAction?: string | undefined;
    readonly boundSpaceId?: string | undefined;
  }): IssuedChallenge {
    const now = this.#now();
    this.#sweep(now);
    if (this.#size >= this.#capacity) throw new ChallengeStoreFullError();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = Buffer.from(randomBytes(32).toString("base64url"), "ascii");
    const record: ChallengeRecord = {
      challengeId: globalThis.crypto.randomUUID(),
      environmentId: input.environmentId,
      ceremony: input.ceremony,
      initiatingOrigin: input.initiatingOrigin,
      callbackUri: input.callbackUri,
      postResultDestinationId: input.postResultDestinationId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + input.lifetimeSeconds * 1000),
      stateDigest: oneWayDigest(state),
      nonceDigest: oneWayDigest(nonce),
      currentAccountSubjectId: input.currentAccountSubjectId,
      currentSessionRef: input.currentSessionRef,
      boundAction: input.boundAction,
      boundSpaceId: input.boundSpaceId,
      status: "pending",
    };
    const slot: Slot = { record, verifier };
    this.#byState[record.stateDigest] = slot;
    this.#byChallenge[record.challengeId] = slot;
    this.#arm(now);
    this.#size += 1;
    return { record, state, nonce, codeChallenge: pkceChallenge(verifier) };
  }

  /** Looks a callback's raw state up by its one-way digest without changing state, other than expiring it in place past its own deadline (RC-04). */
  find(state: string): ChallengeRecord | undefined {
    return this.#expireIfDue(this.#byState[oneWayDigest(state)], this.#now())?.record;
  }

  findByChallengeId(challengeId: string): ChallengeRecord | undefined {
    return this.#expireIfDue(this.#byChallenge[challengeId], this.#now())?.record;
  }

  /**
   * §4.2: consumes the challenge exactly once before any subject or session
   * effect. Returns `undefined` when the state is unknown, already consumed,
   * terminated or expired (an expired pending challenge is terminated here).
   */
  take(state: string, now: Date = this.#now()): TakenChallenge | undefined {
    const slot = this.#expireIfDue(this.#byState[oneWayDigest(state)], now);
    if (!slot || slot.record.status !== "pending") return undefined;
    const verifier = slot.verifier;
    slot.verifier = undefined;
    if (!verifier) return undefined;
    slot.record.status = "consumed";
    return { record: slot.record, codeVerifier: verifier };
  }

  /** §7: a known challenge terminates on wrong environment/origin/method, mismatch or malformed input. */
  terminate(challengeId: string): void {
    const slot = this.#byChallenge[challengeId];
    if (!slot) return;
    slot.verifier?.fill(0);
    slot.verifier = undefined;
    slot.record.status = "terminated";
  }
}
