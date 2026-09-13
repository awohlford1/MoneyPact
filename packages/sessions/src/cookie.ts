/**
 * §5.1 cookie attribute profile and CSRF check (CBD-191-AC02, `CT-191-001`).
 * Framework-free: returns header values a caller (apps/api/src/sessions)
 * sets on the actual response.
 */
import { verifyPepperedDigest } from "./crypto.ts";
import { SESSION_COOKIE_NAME } from "./config.ts";

export { SESSION_COOKIE_NAME };

function formatExpires(date: Date): string {
  return date.toUTCString();
}

/** Builds the exact `Set-Cookie` header value for issuance/rotation. */
export function buildSessionCookieHeader(cookieValue: string, absoluteExpiresAt: Date, now: Date): string {
  const maxAgeSeconds = Math.max(0, Math.floor((absoluteExpiresAt.getTime() - now.getTime()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${cookieValue}`,
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${formatExpires(absoluteExpiresAt)}`,
  ].join("; ");
}

/** Builds the exact deletion `Set-Cookie` header (§5.1 "Deletion" row). */
export function buildSessionCookieDeletionHeader(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    `Expires=${formatExpires(new Date(0))}`,
  ].join("; ");
}

/** Parses the raw `Cookie` request header for exactly the configured session cookie name; no fallback/unprefixed alias is read. */
export function readSessionCookieValue(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name === SESSION_COOKIE_NAME) return part.slice(index + 1).trim();
  }
  return undefined;
}

export interface CsrfCheckInput {
  readonly method: string;
  readonly origin: string | undefined;
  readonly allowedOrigin: string;
  readonly secFetchSite: string | undefined;
  readonly csrfHeaderValue: string | undefined;
  readonly csrfDigest: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** §5.1: cookie-authenticated mutations require exact origin, same-origin fetch metadata, and a valid session-bound CSRF header. Safe methods are exempt. */
export function checkCsrf(pepper: Buffer, input: CsrfCheckInput): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (input.origin !== input.allowedOrigin) return false;
  if (input.secFetchSite !== "same-origin") return false;
  if (!input.csrfHeaderValue) return false;
  return verifyPepperedDigest(pepper, input.csrfHeaderValue, input.csrfDigest);
}
