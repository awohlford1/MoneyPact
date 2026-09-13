import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCsrfValue, generateOpaqueIdentifier, parseCookieValue, pepperedDigest, syntheticCandidate, verifyPepperedDigest } from "./crypto.ts";

const pepper = Buffer.alloc(32, 7);

void test("SC-191-001: verifyPepperedDigest accepts the correct verifier and rejects any other", () => {
  const identifier = generateOpaqueIdentifier();
  const digest = pepperedDigest(pepper, identifier.verifier);
  assert.equal(verifyPepperedDigest(pepper, identifier.verifier, digest), true);
  assert.equal(verifyPepperedDigest(pepper, "wrong-verifier-value", digest), false);
});

void test("SC-191-001: a different pepper never verifies, even for the same verifier", () => {
  const identifier = generateOpaqueIdentifier();
  const digest = pepperedDigest(pepper, identifier.verifier);
  const otherPepper = Buffer.alloc(32, 9);
  assert.equal(verifyPepperedDigest(otherPepper, identifier.verifier, digest), false);
});

void test("parseCookieValue rejects malformed shapes (§3.3 case 1)", () => {
  assert.equal(parseCookieValue(undefined), undefined);
  assert.equal(parseCookieValue(""), undefined);
  assert.equal(parseCookieValue("no-separator"), undefined);
  assert.equal(parseCookieValue(".missing-selector"), undefined);
  assert.equal(parseCookieValue("missing-verifier."), undefined);
  assert.equal(parseCookieValue("a.b.c"), undefined);
  assert.equal(parseCookieValue("bad chars!.ok"), undefined);
});

void test("parseCookieValue accepts a well-formed selector.verifier pair", () => {
  const identifier = generateOpaqueIdentifier();
  const parsed = parseCookieValue(identifier.cookieValue);
  assert.deepEqual(parsed, { selector: identifier.selector, verifier: identifier.verifier });
});

void test("syntheticCandidate produces a fixed-shape candidate distinct each call", () => {
  const a = syntheticCandidate();
  const b = syntheticCandidate();
  assert.notEqual(a.selector, b.selector);
  assert.ok(a.selector.length > 0 && a.verifier.length > 0);
});

void test("generateOpaqueIdentifier produces >=256 bits per half and a parseable cookie value", () => {
  const identifier = generateOpaqueIdentifier();
  assert.ok(Buffer.from(identifier.selector, "base64url").byteLength >= 32);
  assert.ok(Buffer.from(identifier.verifier, "base64url").byteLength >= 32);
  assert.deepEqual(parseCookieValue(identifier.cookieValue), { selector: identifier.selector, verifier: identifier.verifier });
});

void test("generateCsrfValue produces distinct unpredictable values", () => {
  assert.notEqual(generateCsrfValue(), generateCsrfValue());
});
