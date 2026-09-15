/**
 * Destination canonicalization, the destination token, the one-way code
 * verifier, the ceremony secret digest, the channel-challenge digest and the
 * abuse fingerprint (design proposal SS4.1, SS4.2, SS4.4, SS5.3;
 * `SEC-PK2-F07`).
 *
 * Every digest here is a **keyed** HMAC, not a bare hash, and every one is
 * bound to the record it belongs to. The reason is the same in each case and
 * is worth stating once: the plaintexts are small. A six-digit channel
 * challenge has 10^6 possible values and a presented bearer is compared
 * against stored material, so an unkeyed digest of either is reversible by
 * enumeration by anybody who can read the column. `SEC-PK2-F07` says exactly
 * this about `channel_challenge_digest` and `abuse_fingerprint`; the same
 * argument makes the destination token -- an HMAC over an address, and
 * addresses are guessable -- keyed too, which is what the `destination_token`
 * column comment already claims ("under the CBD-246 field-encryption key
 * derivation").
 *
 * The key is *derived* from the field-encryption provider's current key
 * rather than being that key: {@link createKeyedDigest} runs one HKDF-style
 * extraction per purpose, so a digest key never equals the key that decrypts
 * the outbox ciphertext, and a compromise of one purpose's key tells an
 * attacker nothing about another's.
 *
 * No raw value is ever returned by a read in this module and nothing here is
 * stored: `bearer`, `challenge` and the ceremony secret exist only as
 * function arguments and as the values the caller hands to the delivery
 * adapter and the customer.
 */
import { createHmac, hkdfSync, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import { InvitationError } from "./records.ts";

/** The purposes a digest key is derived for. One key per purpose; never shared, never the encryption key itself. */
export const DIGEST_PURPOSES = [
  "destination-token", "code-verifier", "ceremony-secret", "channel-challenge", "abuse-fingerprint",
] as const;
export type DigestPurpose = (typeof DIGEST_PURPOSES)[number];

/** The derivation label, versioned so a later change to the construction is visible rather than silent. */
const DERIVATION_INFO_PREFIX = "cbd73-invitation-digest-v1:";
const DERIVED_KEY_BYTES = 32;

/** What this module needs from a key provider: the current key material, and nothing else. */
export interface DigestKeySource {
  currentKey(): Promise<{ readonly key: Buffer | Uint8Array }> | { readonly key: Buffer | Uint8Array };
}

/** A keyed, purpose-separated digest. The only way this module turns a secret into a stored column. */
export interface KeyedDigest {
  (purpose: DigestPurpose, message: string): Promise<string>;
}

/**
 * Derive one digest key per purpose from the field-encryption provider's
 * current key and return the keyed-digest function the commands take as a
 * port. Derivation is per call and not cached, so a key rotation is picked up
 * without a process restart.
 */
export function createKeyedDigest(source: DigestKeySource): KeyedDigest {
  return async (purpose, message) => {
    const { key } = await source.currentKey();
    const derived = Buffer.from(hkdfSync("sha256", Buffer.from(key), Buffer.alloc(0), DERIVATION_INFO_PREFIX + purpose, DERIVED_KEY_BYTES));
    try {
      return createHmac("sha256", derived).update(message, "utf8").digest("hex");
    } finally {
      derived.fill(0);
    }
  };
}

/** Constant-time comparison of two hex digests. A short-circuiting `===` on a verifier leaks its prefix by timing. */
export function digestsEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// The destination.
// ---------------------------------------------------------------------------

/**
 * The canonical form of an email destination: trimmed and lower-cased, with
 * nothing else normalized. Plus-addressing and dots are deliberately *not*
 * folded -- `OI-73-010`'s alias rule is not in this increment, and folding
 * them here would silently merge two people's addresses into one
 * destination token.
 */
export function canonicalizeEmailDestination(raw: unknown): string {
  if (typeof raw !== "string") throw new InvitationError("destination_invalid", "destination");
  const canonical = raw.trim().toLowerCase();
  if (canonical.length === 0 || canonical.length > 254) throw new InvitationError("destination_invalid", "destination");
  // One @, a non-empty local part, and a domain with at least one dot and no
  // whitespace. A stricter grammar than this belongs to the delivery provider
  // that does not exist yet (PROVIDERS-LOCAL-001).
  const at = canonical.indexOf("@");
  if (at <= 0 || at !== canonical.lastIndexOf("@")) throw new InvitationError("destination_invalid", "destination");
  const domain = canonical.slice(at + 1);
  if (domain.length < 3 || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    throw new InvitationError("destination_invalid", "destination");
  }
  if (/[\s<>,;"\\]/u.test(canonical)) throw new InvitationError("destination_invalid", "destination");
  return canonical;
}

/**
 * The owner-visible masked form, the only destination shape CBD-72 SS5.7 lets
 * the inviter see: the first character of the local part, then a fixed-width
 * mask, then the domain. The mask is fixed width so its length does not leak
 * the length of the address.
 */
export function maskEmailDestination(canonical: string): string {
  const at = canonical.indexOf("@");
  const local = canonical.slice(0, at);
  const domain = canonical.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

/** The privacy-preserving normalized-destination token. Never reversible, never the address. */
export function destinationToken(digest: KeyedDigest, canonical: string): Promise<string> {
  return digest("destination-token", canonical);
}

// ---------------------------------------------------------------------------
// The code, the ceremony secret and the channel challenge.
// ---------------------------------------------------------------------------

/**
 * The secret half of the bearer `TR-73-02` generates exactly once, 256 bits
 * of entropy in a URL-safe alphabet. The verifier is bound over this half
 * alone; the selector is a locator, not a secret, and never enters the HMAC.
 */
export function generateBearer(): string {
  return `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
}

// 32 bytes of unpadded base64url is always exactly 43 characters, the shape
// packages/sessions gives session_selector (CBD-191 SS3.2). The selector is
// parsed by this exact shape so a short guessed half is malformed rather
// than a lookup.
const CODE_SELECTOR_BYTES = 32;
const CODE_SELECTOR_LENGTH = 43;
const CODE_SELECTOR_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${CODE_SELECTOR_LENGTH}}$`);
const CODE_BEARER_SEPARATOR = ".";

/**
 * `PK5-F02`: the opaque random handle a code row is looked up by. It encodes
 * nothing -- not the space, not the record, not the recipient (`IC-73-002`)
 * -- and is the shape `packages/sessions` uses for `session_selector`.
 */
export function generateCodeSelector(): string {
  return randomBytes(CODE_SELECTOR_BYTES).toString("base64url");
}

/** The presented value `<selector>.<secret>`, as the session cookie is `<selector>.<verifier>`. */
export function composeBearer(selector: string, secret: string): string {
  assertSecret(secret, "code");
  if (!CODE_SELECTOR_PATTERN.test(selector)) throw new InvitationError("invalid_request", "code");
  return `${selector}${CODE_BEARER_SEPARATOR}${secret}`;
}

export interface PresentedCodeParts {
  readonly selector: string;
  readonly secret: string;
}

/**
 * Split a presented value into its selector and secret halves, or `undefined`
 * when it does not carry a well-formed selector. A value without the
 * separator is the pre-selector bearer shape, which the locator still answers
 * by the scan over rows that have no selector; a value whose first half is
 * not exactly the selector shape is malformed and locates nothing. Returning
 * rather than throwing lets the caller keep its fixed-shape work.
 */
export function splitPresentedCode(presented: string): PresentedCodeParts | undefined {
  if (typeof presented !== "string") return undefined;
  const index = presented.indexOf(CODE_BEARER_SEPARATOR);
  if (index <= 0 || index === presented.length - 1) return undefined;
  const selector = presented.slice(0, index);
  const secret = presented.slice(index + 1);
  if (secret.includes(CODE_BEARER_SEPARATOR) || !CODE_SELECTOR_PATTERN.test(selector)) return undefined;
  return { selector, secret };
}

/** Whether a presented value carries the separator at all, which is what decides the locator's path. */
export function hasSelectorShape(presented: string): boolean {
  return typeof presented === "string" && presented.includes(CODE_BEARER_SEPARATOR);
}

/** The opaque one-time ceremony token the server sets as the `__Host-mp_invitation_ceremony` cookie. */
export function generateCeremonySecret(): string {
  return `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
}

/** The six-digit code the simulated adapter "delivers" beside the link (SS5.3). */
export function generateChannelChallenge(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface CodeVerifierBinding {
  readonly invitationId: string;
  readonly invitationVersion: number;
  readonly destinationToken: string;
}

/**
 * The one-way verifier of `DR-73-02`: HMAC-SHA-256 over the raw bearer, keyed
 * by the derived code-verifier key and bound to the invitation, its version
 * and the destination token. The binding is what makes a bearer useless
 * against any other record even if the digest column were copied there, and
 * it is why `TR-73-05` invalidating the predecessor's code cannot be undone
 * by presenting the same raw value to the successor.
 */
export function codeVerifierDigest(digest: KeyedDigest, binding: CodeVerifierBinding, secret: string): Promise<string> {
  assertSecret(secret, "code");
  return digest("code-verifier", `${binding.invitationId}|${binding.invitationVersion}|${binding.destinationToken}|${secret}`);
}

/** The ceremony cookie's digest, bound to the ceremony row it opens. */
export function ceremonySecretDigest(digest: KeyedDigest, ceremonyId: string, secret: string): Promise<string> {
  assertSecret(secret, "ceremony");
  return digest("ceremony-secret", `${ceremonyId}|${secret}`);
}

/** The channel challenge's digest, bound to the ceremony so the same six digits are useless elsewhere. */
export function channelChallengeDigest(digest: KeyedDigest, ceremonyId: string, challenge: string): Promise<string> {
  assertSecret(challenge, "channelCode");
  return digest("channel-challenge", `${ceremonyId}|${challenge}`);
}

/**
 * The non-reversible fingerprint of a presented value, for `TR-73-14` abuse
 * counting. Keyed for the reason in this file's header: the presented value
 * may be a real bearer, and an unkeyed fingerprint of one is a stored
 * equality oracle for it.
 */
export function abuseFingerprint(digest: KeyedDigest, presented: string): Promise<string> {
  return digest("abuse-fingerprint", presented);
}

function assertSecret(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new InvitationError("invalid_request", field);
}
