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

export type Ceremony = "register" | "verify" | "sign_in" | "enroll_factor" | "account_switch";
export const CEREMONIES: readonly Ceremony[] = Object.freeze(["register", "verify", "sign_in", "enroll_factor", "account_switch"]);

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
  /** Present only for an authenticated account switch; taken from server state, never sent to the provider (§4.1, §5.4). */
  readonly currentAccountSubjectId: string | undefined;
  readonly currentSessionRef: string | undefined;
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

  constructor(now: () => Date = () => new Date(), capacity = 10_000) {
    this.#now = now;
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#size;
  }

  #forget(slot: Slot): void {
    slot.verifier?.fill(0);
    slot.verifier = undefined;
    delete this.#byState[slot.record.stateDigest];
    delete this.#byChallenge[slot.record.challengeId];
    this.#size -= 1;
  }

  /** Drops expired non-pending records lazily; pending expired records stay until observed so replay of a known expired state terminates it (§7). */
  #sweep(now: Date): void {
    for (const key of Object.keys(this.#byChallenge)) {
      const slot = this.#byChallenge[key];
      if (slot && slot.record.status !== "pending" && slot.record.expiresAt.getTime() + 60_000 <= now.getTime()) this.#forget(slot);
    }
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
      status: "pending",
    };
    const slot: Slot = { record, verifier };
    this.#byState[record.stateDigest] = slot;
    this.#byChallenge[record.challengeId] = slot;
    this.#size += 1;
    return { record, state, nonce, codeChallenge: pkceChallenge(verifier) };
  }

  /** Looks a callback's raw state up by its one-way digest without changing state. */
  find(state: string): ChallengeRecord | undefined {
    return this.#byState[oneWayDigest(state)]?.record;
  }

  findByChallengeId(challengeId: string): ChallengeRecord | undefined {
    return this.#byChallenge[challengeId]?.record;
  }

  /**
   * §4.2: consumes the challenge exactly once before any subject or session
   * effect. Returns `undefined` when the state is unknown, already consumed,
   * terminated or expired (an expired pending challenge is terminated here).
   */
  take(state: string, now: Date = this.#now()): TakenChallenge | undefined {
    const slot = this.#byState[oneWayDigest(state)];
    if (!slot || slot.record.status !== "pending") return undefined;
    if (slot.record.expiresAt.getTime() <= now.getTime()) {
      this.terminate(slot.record.challengeId);
      return undefined;
    }
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
