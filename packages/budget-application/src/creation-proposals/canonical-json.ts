/**
 * Canonical JSON serialization and content digests (CBD-232 §7.1).
 *
 * `previewDigest` and the normalized-command digest are both defined as
 * base64url SHA-256 over RFC 8785 (JSON Canonicalization Scheme) canonical
 * JSON. Every value this application serializes is plain JSON data (strings,
 * finite numbers, booleans, null, arrays, and objects) produced by our own
 * normalization and preview code, so this module implements the subset of
 * JCS that matters for that data — sorted object keys, no whitespace, and
 * `JSON.stringify`'s own number/string escaping, which agrees with JCS for
 * every integer and simple decimal this application ever produces. It does
 * not implement JCS's full ECMA-262 `Number::toString` algorithm for exotic
 * floating-point values, because none reach this module.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Cannot canonicalize non-finite number ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
}

/** RFC 8785 canonical JSON (restricted to the plain-JSON subset this application uses). */
export function canonicalJSON(value: unknown): string {
  return canonicalize(value);
}

/** base64url SHA-256 over a UTF-8 string. */
export function sha256Base64Url(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("base64url");
}

/** base64url SHA-256 over the canonical JSON of a value. */
export function digestOf(value: unknown): string {
  return sha256Base64Url(canonicalJSON(value));
}

/** base64url HMAC-SHA-256 of `payload` under `key`. */
export function hmacSha256Base64Url(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

/** Constant-time comparison of two opaque tokens of possibly different length. */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    // Still run a comparison of equal cost so that a length mismatch does not
    // itself become a timing signal, even though the buffers cannot be equal.
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
