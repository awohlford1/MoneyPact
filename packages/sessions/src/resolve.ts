/**
 * §3.3 server-side resolution and the `SC-191-001A` uniform-timing profile.
 *
 * Every rejection branch returns the identical `{ status: "not_authenticated" }`
 * shape (CBD-191-AC01, CT-191-002); the reason a caller might want for
 * restricted security evidence travels only in `diagnostic`, which
 * `fact-source.ts` never forwards into policy input.
 *
 * CBD191-CORRECTION-001 item 6 (CBD191-REVIEW-IMPL-001 High finding
 * "SC-191-001A timing normalization is not implemented"): every branch now
 * performs the *same* fixed-shape sequence of work -- parse-or-synthesize a
 * candidate, look the (real or synthetic) selector up in the store, compare
 * a (real or dummy, but always correctly-shaped) digest, and read a (real
 * or synthetic) authority row -- before a decision table picks the outcome.
 * Nothing branches early. Timing is then released at `floorMs + jitterMs`
 * measured from function entry, using cryptographically random jitter
 * (`cryptoRandomJitterMs`, not `Math.random()`), by subtracting the work
 * already spent rather than sleeping the full bucket *in addition to* the
 * work (which would make slower branches visibly slower).
 */
import { randomUUID } from "node:crypto";
import { cryptoRandomJitterMs, parseCookieValue, pepperedDigest, syntheticCandidate, verifyPepperedDigest } from "./crypto.ts";
import type { SessionConfig } from "./config.ts";
import type { SessionStore } from "./store.ts";
import type { AccountSubjectId, Environment, SessionRef, SessionVersion } from "./types.ts";

export type ResolutionDiagnostic =
  | "malformed"
  | "unknown_selector"
  | "verifier_mismatch"
  | "other_environment"
  | "expired"
  | "missing_authority"
  | "revoked_epoch"
  | "store_unavailable";

export interface ResolvedSession {
  readonly status: "resolved";
  readonly accountSubjectId: AccountSubjectId;
  readonly sessionRef: SessionRef;
  readonly sessionVersion: SessionVersion;
  readonly assurance: {
    readonly level: "session" | "fresh";
    readonly boundAction: string | undefined;
    readonly boundSpaceId: string | undefined;
    readonly expiresAt: Date | undefined;
  };
}

export interface RejectedSession {
  readonly status: "not_authenticated";
  readonly diagnostic: ResolutionDiagnostic;
}

export type ResolutionOutcome = ResolvedSession | RejectedSession;

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * §3.3. Reads only the cookie value (never an `Authorization` header or any
 * other credential shape -- callers only ever pass this function the cookie
 * value in the first place, which is what makes "an IdP ID/access token is
 * never accepted here" true by construction, per §3.3's closing paragraph).
 */
export async function resolveSession(
  cookieValue: string | undefined,
  store: SessionStore,
  config: SessionConfig,
  environmentId: Environment,
  now: Date,
): Promise<ResolutionOutcome> {
  const startedAtMs = Date.now();

  const parsed = parseCookieValue(cookieValue);
  const malformed = parsed === undefined;
  const candidate = parsed ?? syntheticCandidate();

  // Fixed-shape step 1: selector lookup, real or synthetic, always attempted.
  let storeUnavailable = false;
  let lookup: Awaited<ReturnType<SessionStore["resolveBySelector"]>> = "not_found";
  try {
    lookup = await store.resolveBySelector(candidate.selector);
  } catch {
    storeUnavailable = true;
  }
  const row = lookup !== "not_found" ? lookup : undefined;

  // Fixed-shape step 2: one keyed-digest comparison, always attempted. A
  // dummy stored digest (same HMAC-SHA256/base64url shape as a real one) is
  // compared when there is no row, so the same primitive work runs either way.
  const storedDigest = row ? row.verifierDigest : pepperedDigest(config.pepper, candidate.selector);
  const verifierOk = verifyPepperedDigest(config.pepper, candidate.verifier, storedDigest);

  // Fixed-shape step 3: one authority-row read, always attempted, against
  // the real subject when resolved or a synthetic one otherwise.
  let authority: Awaited<ReturnType<SessionStore["readSubjectAuthorityStrict"]>>;
  try {
    authority = await store.readSubjectAuthorityStrict(row ? row.accountSubjectId : randomUUID());
  } catch {
    storeUnavailable = true;
    authority = undefined;
  }

  // Decision table -- evaluated only after every fixed-shape step above has
  // already run, so no branch skips work another branch performs.
  let diagnostic: ResolutionDiagnostic | undefined;
  if (storeUnavailable) diagnostic = "store_unavailable";
  else if (malformed) diagnostic = "malformed";
  else if (!row) diagnostic = "unknown_selector";
  else if (!verifierOk) diagnostic = "verifier_mismatch";
  else if (row.environmentId !== environmentId) diagnostic = "other_environment";
  // CBD191-REVIEW-IMPL-001 Medium finding: exact expiry must reject
  // (`>=`, not `>`) -- a request landing exactly on the boundary is expired,
  // not one tick away from it (CT-191-010).
  else if (row.state !== "active" || now.getTime() >= row.idleExpiresAt.getTime() || now.getTime() >= row.absoluteExpiresAt.getTime()) diagnostic = "expired";
  // CBD191-REVIEW-IMPL-001 Medium finding: a missing authority row for an
  // otherwise-live session row is an anomaly, not a bootstrap case; it fails
  // closed rather than fabricating one.
  else if (!authority) diagnostic = "missing_authority";
  else if (row.issuedRevocationEpoch !== authority.revocationEpoch) diagnostic = "revoked_epoch";

  const floorMs = storeUnavailable ? config.rejectionTimingTimeoutBucketMs : config.rejectionTimingFloorMs;
  const jitterMs = cryptoRandomJitterMs(config.rejectionTimingJitterMs);
  const targetElapsedMs = floorMs + jitterMs;

  if (diagnostic) {
    const alreadyElapsedMs = Date.now() - startedAtMs;
    await sleep(targetElapsedMs - alreadyElapsedMs);
    return { status: "not_authenticated", diagnostic };
  }

  // `row` and `authority` are both defined on every path that reaches here
  // (every `diagnostic`-setting branch above covers their absence).
  const liveRow = row!;

  // §5.1: idle expiry slides forward on every successfully resolved request.
  const slidIdleExpiry = new Date(Math.min(now.getTime() + config.idleTimeoutSeconds * 1000, liveRow.absoluteExpiresAt.getTime()));
  try {
    await store.extendIdleExpiry(liveRow.sessionRef, slidIdleExpiry);
  } catch {
    const alreadyElapsedMs = Date.now() - startedAtMs;
    await sleep(config.rejectionTimingTimeoutBucketMs - alreadyElapsedMs);
    return { status: "not_authenticated", diagnostic: "store_unavailable" };
  }

  // CBD191-REVIEW-IMPL-001 Medium finding: an expired fresh-assurance grant
  // reverts the *effective* assurance to `session` on the next read (§5.1:
  // "which then simply reverts the effective assurance to session on the
  // next read, with no rotation required for that reversion alone"). The
  // stored row is left untouched; only what this function reports degrades.
  const freshAssuranceLive = liveRow.freshAssurance && liveRow.freshAssurance.expiresAt.getTime() > now.getTime();

  return {
    status: "resolved",
    accountSubjectId: liveRow.accountSubjectId,
    sessionRef: liveRow.sessionRef,
    sessionVersion: liveRow.sessionVersion,
    assurance: {
      level: freshAssuranceLive ? "fresh" : "session",
      boundAction: freshAssuranceLive ? liveRow.freshAssurance?.boundAction : undefined,
      boundSpaceId: freshAssuranceLive ? liveRow.freshAssurance?.boundSpaceId : undefined,
      expiresAt: freshAssuranceLive ? liveRow.freshAssurance?.expiresAt : undefined,
    },
  };
}

/**
 * §7 / CBD-236 `PC-236-014` commit-boundary recheck (`CT-191-013`): a
 * mutation's precheck may have resolved a live session, but the commit-time
 * recheck must re-read the live row and require *exact* `sessionVersion`
 * equality before the write commits. This is the one primitive CBD-191
 * supplies for that boundary; wiring it into CBD-236's actual commit path is
 * outside `apps/api/src/authorization`, which this packet does not touch.
 */
export async function verifySessionStillLive(store: SessionStore, sessionRef: SessionRef, expectedSessionVersion: SessionVersion): Promise<boolean> {
  const row = await store.findBySessionRef(sessionRef);
  return Boolean(row && row.state === "active" && row.sessionVersion === expectedSessionVersion);
}
