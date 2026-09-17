/**
 * CBD-190 §4.3 ID-token validation. One parser and one validator for every
 * transport (§9): nothing here knows whether the token came from the local
 * issuer or an HTTPS provider.
 *
 * Only the allowlisted canonical fields leave this module, in a bounded
 * token-free result. The raw token, its header, and every other claim
 * (email, username, groups, custom attributes) are discarded before return.
 */
import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { hasControlOrFormatCharacter, MAX_DISPLAY_NAME_LENGTH } from "../../../../packages/data-access/src/financial-profile.ts";
import type { Jwk } from "./local-issuer.ts";

export const SUBJECT_MAX_LENGTH = 256;
const SEGMENT_MAX_LENGTH = 16_384;

export type TokenRejection =
  | "serialization"
  | "header"
  | "algorithm"
  | "key"
  | "signature"
  | "issuer"
  | "subject"
  | "audience"
  | "time"
  | "auth_time"
  | "nonce"
  | "token_use";

export interface ValidatedIdentityClaims {
  readonly issuer: string;
  readonly providerSubject: string;
  readonly authTime: Date;
  readonly issuedAt: Date;
  /**
   * CBD-190 identity amendments proposal §2.1-2.2: the standard OIDC `name`
   * claim, admitted only in trimmed, bounded form (1..80 code points, the
   * same bound `writeDisplayName` enforces). Not an identity key -- never
   * used for `sub` resolution, binding lookup, or any authorization
   * decision. An absent, non-string, empty-after-trim, or oversized claim is
   * `undefined`: a silent skip, never a ceremony failure (§2.2).
   */
  readonly name: string | undefined;
}

export type TokenValidation = { readonly ok: true; readonly claims: ValidatedIdentityClaims } | { readonly ok: false; readonly rejection: TokenRejection };

export interface TokenExpectations {
  readonly issuer: string;
  readonly clientId: string;
  readonly allowedAlgorithms: readonly string[];
  readonly nonceDigest: string;
  readonly digest: (value: string) => string;
  readonly receiptTime: Date;
  readonly challengeIssuedAt: Date;
  readonly clockSkewSeconds: number;
}

/** Bounded issuer key set: unknown or stale `kid` permits one refresh per exchange, then fails closed. */
export interface KeySource {
  keyFor(kid: string): Promise<KeyObject | undefined>;
}

export class RefreshOnceKeySource implements KeySource {
  #keys: readonly Jwk[] | undefined;
  #refreshed = false;
  readonly #load: () => Promise<{ readonly keys: readonly Jwk[] } | undefined>;
  constructor(load: () => Promise<{ readonly keys: readonly Jwk[] } | undefined>, cached?: readonly Jwk[]) {
    this.#load = load;
    this.#keys = cached;
  }
  get keys(): readonly Jwk[] | undefined { return this.#keys; }
  async #refresh(): Promise<boolean> {
    const loaded = await this.#load();
    if (!loaded) return false;
    this.#keys = loaded.keys;
    return true;
  }
  async keyFor(kid: string): Promise<KeyObject | undefined> {
    if (this.#keys === undefined && !(await this.#refresh())) return undefined;
    let matches = (this.#keys ?? []).filter((key) => key.kid === kid);
    if (matches.length !== 1 && !this.#refreshed) {
      this.#refreshed = true;
      if (!(await this.#refresh())) return undefined;
      matches = (this.#keys ?? []).filter((key) => key.kid === kid);
    }
    const jwk = matches.length === 1 ? matches[0] : undefined;
    if (!jwk || jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string" || (jwk.use !== undefined && jwk.use !== "sig") || (jwk.alg !== undefined && jwk.alg !== "RS256")) return undefined;
    try {
      return createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
    } catch {
      return undefined;
    }
  }
}

function decodeSegment(segment: string): unknown {
  if (segment.length === 0 || segment.length > SEGMENT_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(segment)) return undefined;
  try {
    const text = Buffer.from(segment, "base64url").toString("utf8");
    if (Buffer.from(text, "utf8").toString("base64url") !== segment.replace(/=+$/, "")) return undefined;
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function numericDate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** §2.2: trimmed, 1..80 code points (`[...trimmed].length`, matching `writeDisplayName`'s own count), else `undefined`. */
/**
 * The first-sign-in seed from the provider `name` claim. A claim outside the
 * 1..80-code-point bound, or one carrying a Unicode control or format
 * character (SEC-F06-OBS1 / SEC-C190-OBS1: bidi override, zero-width), is
 * treated as absent -- never a sign-in failure.
 */
function boundedName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > MAX_DISPLAY_NAME_LENGTH) return undefined;
  return hasControlOrFormatCharacter(trimmed) ? undefined : trimmed;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Validates a compact signed JWT under §4.3 and extracts only the canonical allowlisted fields. */
export async function validateIdToken(token: string, expectations: TokenExpectations, keys: KeySource): Promise<TokenValidation> {
  const reject = (rejection: TokenRejection): TokenValidation => ({ ok: false, rejection });
  if (typeof token !== "string" || token.length === 0 || token.length > 3 * SEGMENT_MAX_LENGTH) return reject("serialization");
  const segments = token.split(".");
  if (segments.length !== 3) return reject("serialization");
  const [encodedHeader, encodedPayload, encodedSignature] = segments as [string, string, string];
  const header = decodeSegment(encodedHeader) as Record<string, unknown> | undefined;
  const payload = decodeSegment(encodedPayload) as Record<string, unknown> | undefined;
  if (!header || !payload) return reject("header");
  if (typeof header.alg !== "string" || !expectations.allowedAlgorithms.includes(header.alg)) return reject("algorithm");
  if (header.typ !== undefined && header.typ !== "JWT") return reject("header");
  if (header.enc !== undefined || header.crit !== undefined) return reject("header");
  if (typeof header.kid !== "string" || header.kid.length === 0 || header.kid.length > 256) return reject("key");
  const publicKey = await keys.keyFor(header.kid);
  if (!publicKey) return reject("key");
  if (encodedSignature.length === 0 || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) return reject("signature");
  let signatureValid = false;
  try {
    signatureValid = verify("sha256", Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"), publicKey, Buffer.from(encodedSignature, "base64url"));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return reject("signature");

  if (payload.iss !== expectations.issuer) return reject("issuer");
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > SUBJECT_MAX_LENGTH) return reject("subject");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.every((audience) => typeof audience === "string") || !audiences.includes(expectations.clientId)) return reject("audience");
  if (audiences.length > 1 && payload.azp !== expectations.clientId) return reject("audience");
  if (payload.azp !== undefined && payload.azp !== expectations.clientId) return reject("audience");

  const now = expectations.receiptTime.getTime() / 1000;
  const skew = expectations.clockSkewSeconds;
  const exp = numericDate(payload.exp);
  const iat = numericDate(payload.iat);
  if (exp === undefined || iat === undefined) return reject("time");
  if (exp <= now - skew) return reject("time");
  if (iat > now + skew) return reject("time");
  if (iat + skew < expectations.challengeIssuedAt.getTime() / 1000) return reject("time");
  const authTime = numericDate(payload.auth_time);
  if (authTime === undefined || authTime > now + skew) return reject("auth_time");
  if (typeof payload.nonce !== "string" || payload.nonce.length === 0 || !constantTimeEqual(expectations.digest(payload.nonce), expectations.nonceDigest)) return reject("nonce");
  if (payload.token_use !== "id") return reject("token_use");
  for (const name of ["jti", "origin_jti"]) {
    const value = payload[name];
    if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > 256)) return reject("header");
  }
  return { ok: true, claims: { issuer: expectations.issuer, providerSubject: sub, authTime: new Date(authTime * 1000), issuedAt: new Date(iat * 1000), name: boundedName(payload.name) } };
}
