import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionCookieDeletionHeader, buildSessionCookieHeader, checkCsrf, readSessionCookieValue, SESSION_COOKIE_NAME } from "./cookie.ts";
import { pepperedDigest } from "./crypto.ts";

void test("CT-191-001: the cookie name is the exact __Host- prefixed name, no fallback", () => {
  assert.equal(SESSION_COOKIE_NAME, "__Host-cobudget_session");
});

void test("CT-191-001: the issuance Set-Cookie header carries every required attribute (CBD-191-AC02)", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const absoluteExpiresAt = new Date("2026-01-01T01:00:00Z");
  const header = buildSessionCookieHeader("selector.verifier", absoluteExpiresAt, now);
  assert.match(header, /^__Host-cobudget_session=selector\.verifier;/);
  assert.match(header, /;\s*Secure(;|$)/);
  assert.match(header, /;\s*HttpOnly(;|$)/);
  assert.match(header, /;\s*SameSite=Lax(;|$)/);
  assert.match(header, /;\s*Path=\/(;|$)/);
  assert.doesNotMatch(header, /Domain=/);
  assert.match(header, /Max-Age=3600(;|$)/);
  assert.match(header, new RegExp(`Expires=${absoluteExpiresAt.toUTCString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

void test("CT-191-001: Max-Age never goes negative for an already-expired absolute lifetime", () => {
  const now = new Date("2026-01-01T02:00:00Z");
  const absoluteExpiresAt = new Date("2026-01-01T01:00:00Z");
  const header = buildSessionCookieHeader("selector.verifier", absoluteExpiresAt, now);
  assert.match(header, /Max-Age=0(;|$)/);
});

void test("CT-191-001: the deletion header matches §5.1's exact deletion row", () => {
  const header = buildSessionCookieDeletionHeader();
  assert.match(header, /^__Host-cobudget_session=;/);
  assert.match(header, /;\s*Secure(;|$)/);
  assert.match(header, /;\s*HttpOnly(;|$)/);
  assert.match(header, /;\s*SameSite=Lax(;|$)/);
  assert.match(header, /;\s*Path=\/(;|$)/);
  assert.doesNotMatch(header, /Domain=/);
  assert.match(header, /Max-Age=0(;|$)/);
  assert.ok(new Date(header.match(/Expires=([^;]+)/)?.[1] ?? "").getTime() < Date.now());
});

void test("readSessionCookieValue reads only the exact configured cookie name, no fallback alias", () => {
  assert.equal(readSessionCookieValue("__Host-cobudget_session=abc.def"), "abc.def");
  assert.equal(readSessionCookieValue("other=1; __Host-cobudget_session=abc.def; more=2"), "abc.def");
  assert.equal(readSessionCookieValue("cobudget_session=abc.def"), undefined);
  assert.equal(readSessionCookieValue(undefined), undefined);
});

const pepper = Buffer.alloc(32, 5);

void test("CT-191-001: safe methods are exempt from the CSRF check", () => {
  const ok = checkCsrf(pepper, { method: "GET", origin: undefined, allowedOrigin: "https://cobudget.example", secFetchSite: undefined, csrfHeaderValue: undefined, csrfDigest: "x" });
  assert.equal(ok, true);
});

void test("CT-191-001: an unsafe method requires exact origin, same-origin fetch metadata, and a valid CSRF digest", () => {
  const csrfValue = "csrf-value";
  const csrfDigest = pepperedDigest(pepper, csrfValue);
  const valid = checkCsrf(pepper, { method: "POST", origin: "https://cobudget.example", allowedOrigin: "https://cobudget.example", secFetchSite: "same-origin", csrfHeaderValue: csrfValue, csrfDigest });
  assert.equal(valid, true);

  const wrongOrigin = checkCsrf(pepper, { method: "POST", origin: "https://evil.example", allowedOrigin: "https://cobudget.example", secFetchSite: "same-origin", csrfHeaderValue: csrfValue, csrfDigest });
  assert.equal(wrongOrigin, false);

  const wrongFetchSite = checkCsrf(pepper, { method: "POST", origin: "https://cobudget.example", allowedOrigin: "https://cobudget.example", secFetchSite: "cross-site", csrfHeaderValue: csrfValue, csrfDigest });
  assert.equal(wrongFetchSite, false);

  const missingToken = checkCsrf(pepper, { method: "POST", origin: "https://cobudget.example", allowedOrigin: "https://cobudget.example", secFetchSite: "same-origin", csrfHeaderValue: undefined, csrfDigest });
  assert.equal(missingToken, false);

  const wrongToken = checkCsrf(pepper, { method: "POST", origin: "https://cobudget.example", allowedOrigin: "https://cobudget.example", secFetchSite: "same-origin", csrfHeaderValue: "stale-token", csrfDigest });
  assert.equal(wrongToken, false);
});
