/**
 * CBD-190 §4.2 callback envelope. The only accepted query shapes are the
 * success shape (exactly one non-empty `code`, one non-empty `state`) and the
 * provider-declared failure shape (one `error`, optional `error_description`
 * and `error_uri`, one non-empty `state`). Everything else -- duplicate keys,
 * both success and error fields, fragments, unexpected security-meaningful
 * fields, oversized values, invalid percent encoding, malformed Unicode -- is
 * `malformed_result`.
 *
 * The parser works on the raw query text rather than a framework's parsed
 * object so duplicate keys are visible instead of silently collapsed. Error
 * descriptions and URIs are validated for shape and then discarded: they are
 * diagnostic input only and never select an outcome (§4.2).
 */
export const STATE_LENGTH = 43;
const CODE_MAX_LENGTH = 512;
const ERROR_MAX_LENGTH = 64;
const DIAGNOSTIC_MAX_LENGTH = 1_024;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[A-Za-z0-9_.~-]{1,512}$/;
const ERROR_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const KNOWN_KEYS = new Set(["code", "state", "error", "error_description", "error_uri"]);
/** Keys a real provider never sends on a callback but whose presence would be security-meaningful if honoured. */
const SECURITY_MEANINGFUL_KEYS = new Set(["id_token", "access_token", "refresh_token", "token", "sub", "iss", "client_id", "redirect_uri", "nonce", "code_verifier", "session_state"]);

export type CallbackEnvelope =
  | { readonly kind: "success"; readonly code: string; readonly state: string }
  | { readonly kind: "provider_error"; readonly error: string; readonly state: string }
  | { readonly kind: "malformed" };

function decode(component: string): string | undefined {
  try {
    const decoded = decodeURIComponent(component.replaceAll("+", " "));
    if (decoded.includes("\u0000") || decoded.includes("\uFFFD")) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

/** Parses the raw text after `?` in the request target. `undefined` query means no parameters at all. */
export function parseCallbackEnvelope(rawQuery: string | undefined): CallbackEnvelope {
  const malformed: CallbackEnvelope = { kind: "malformed" };
  if (rawQuery === undefined || rawQuery.length === 0 || rawQuery.length > 8_192) return malformed;
  if (rawQuery.includes("#")) return malformed;
  const seen = new Map<string, string>();
  for (const pair of rawQuery.split("&")) {
    if (pair.length === 0) return malformed;
    const separator = pair.indexOf("=");
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? "" : pair.slice(separator + 1);
    const key = decode(rawKey);
    const value = decode(rawValue);
    if (key === undefined || value === undefined) return malformed;
    if (seen.has(key)) return malformed;
    if (SECURITY_MEANINGFUL_KEYS.has(key)) return malformed;
    if (!KNOWN_KEYS.has(key)) return malformed;
    seen.set(key, value);
  }
  const state = seen.get("state");
  if (state === undefined || !STATE_PATTERN.test(state) || state.length !== STATE_LENGTH) return malformed;
  const code = seen.get("code");
  const error = seen.get("error");
  if (code !== undefined && error !== undefined) return malformed;
  if (code !== undefined) {
    if (seen.has("error_description") || seen.has("error_uri")) return malformed;
    if (code.length === 0 || code.length > CODE_MAX_LENGTH || !CODE_PATTERN.test(code)) return malformed;
    return { kind: "success", code, state };
  }
  if (error === undefined) return malformed;
  if (error.length === 0 || error.length > ERROR_MAX_LENGTH || !ERROR_PATTERN.test(error)) return malformed;
  for (const diagnostic of ["error_description", "error_uri"]) {
    const value = seen.get(diagnostic);
    if (value !== undefined && value.length > DIAGNOSTIC_MAX_LENGTH) return malformed;
  }
  // error_description / error_uri are validated for size only and dropped here.
  return { kind: "provider_error", error, state };
}

/**
 * PROTO-IDENTITY-API-001 correction C5 (review R05): CBD-190 §7 requires a
 * *known* challenge to terminate even when the rest of the callback is
 * malformed (duplicate `code`, both `code` and `error`, an oversized
 * `code`, an unexpected security-meaningful key, and so on) -- a malformed
 * envelope must never leave a known state usable for a later, well-formed
 * replay. This performs only the narrow, safe extraction needed to find
 * the one candidate `state` value for termination; it never accepts the
 * envelope itself (the caller still returns `invalid_or_expired` either
 * way) and it refuses to guess when the `state` field is itself ambiguous
 * (duplicated with a different value) or invalid in shape.
 *
 * Correction round 3 RC-03 (review R05 residual): an oversized query (over
 * the same 8,192-byte bound `parseCallbackEnvelope` enforces) previously
 * returned `undefined` for the *whole* query even when a valid, unique
 * `state` appeared complete at the very start -- so an oversized malformed
 * callback left its known, still-pending challenge usable for a later,
 * well-formed replay. Parsing now stays bounded (it never scans more than
 * the first 8,192 characters, so cost cannot grow with an attacker-supplied
 * tail) but no longer refuses the whole input outright: it scans only the
 * complete `&`-separated pairs inside that bounded prefix, discarding a
 * trailing pair that the truncation may have cut in half.
 */
export function extractStateForTermination(rawQuery: string | undefined): string | undefined {
  if (rawQuery === undefined || rawQuery.length === 0) return undefined;
  const withoutFragment = rawQuery.split("#")[0] ?? "";
  const PREFIX_BOUND = 8_192;
  let bounded = withoutFragment;
  if (bounded.length > PREFIX_BOUND) {
    const prefix = bounded.slice(0, PREFIX_BOUND);
    const lastCompleteBoundary = prefix.lastIndexOf("&");
    // No complete pair fits in the bounded prefix at all (one enormous pair): nothing safe to parse.
    bounded = lastCompleteBoundary === -1 ? "" : prefix.slice(0, lastCompleteBoundary);
  }
  let candidate: string | undefined;
  for (const pair of bounded.split("&")) {
    if (pair.length === 0) continue;
    const separator = pair.indexOf("=");
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const key = decode(rawKey);
    if (key !== "state") continue;
    const rawValue = separator === -1 ? "" : pair.slice(separator + 1);
    const value = decode(rawValue);
    if (value === undefined || !STATE_PATTERN.test(value)) return undefined;
    if (candidate !== undefined && candidate !== value) return undefined;
    candidate = value;
  }
  return candidate;
}
