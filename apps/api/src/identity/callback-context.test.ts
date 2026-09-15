/**
 * PROTO-HARDENING-001 (GUARD-STAGES-F03): the callback origin and
 * context-validity logic has one implementation, and it cannot drift.
 *
 * Two halves, because either alone would be a weaker claim than the finding
 * asks for. The behavioural half pins what the shared predicate decides. The
 * structural half proves that the ceremony's own check and the rate-limit
 * gate's prediction are that predicate rather than two copies that happen to
 * agree today: no other file under apps/api/src may derive an origin from the
 * forwarding headers or rebuild the context comparison out of its parts, and
 * both callers must be seen to call in.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { IDENTITY_CALLBACK_PATH } from "./config.ts";
import { LOOPBACK_PEERS, callbackContextMatches, observedOrigin, requestPath } from "./callback-context.ts";
import type { OriginObservable } from "./callback-context.ts";

const API_SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = join(API_SRC, "identity", "callback-context.ts");

const request = (overrides: Partial<OriginObservable> = {}): OriginObservable => ({
  ip: "127.0.0.1", protocol: "http", host: "127.0.0.1:3001", headers: {}, ...overrides,
});

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { found.push(...sourceFiles(path)); continue; }
    if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

describe("the identity callback origin and context check (GUARD-STAGES-F03)", () => {
  it("honours a forwarded host only from a loopback peer, and only in host shape", () => {
    assert.equal(observedOrigin(request()), "http://127.0.0.1:3001", "no forwarding: the request's own protocol and host");
    assert.equal(observedOrigin(request({ headers: { "x-forwarded-host": "localhost:3000" } })), "http://localhost:3000");
    assert.equal(observedOrigin(request({ headers: { "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "https" } })), "https://localhost:3000");
    assert.equal(observedOrigin(request({ headers: { "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "gopher" } })), "http://localhost:3000", "an unknown protocol is http, never echoed");
    assert.equal(observedOrigin(request({ ip: "10.0.0.4", headers: { "x-forwarded-host": "evil.example" } })), "http://127.0.0.1:3001", "a non-loopback peer's forwarding header is ignored");
    assert.equal(observedOrigin(request({ headers: { "x-forwarded-host": "evil.example/path" } })), "http://127.0.0.1:3001", "anything not in host shape is ignored");
    assert.equal(observedOrigin(request({ headers: { "x-forwarded-host": ["a", "b"] } })), "http://127.0.0.1:3001", "a repeated header is not a string and is ignored");
    for (const ip of LOOPBACK_PEERS) {
      assert.equal(observedOrigin(request({ ip, headers: { "x-forwarded-host": "localhost:3000" } })), "http://localhost:3000", ip);
    }
  });

  it("accepts only the exact GET on the exact path, from the challenge's own origin and environment", () => {
    const issued = { callbackUri: `http://localhost:3000${IDENTITY_CALLBACK_PATH}`, environmentId: "development" };
    const observed = { method: "GET", path: IDENTITY_CALLBACK_PATH, observedOrigin: "http://localhost:3000" };
    assert.equal(callbackContextMatches(observed, issued, "development"), true);
    assert.equal(callbackContextMatches({ ...observed, method: "POST" }, issued, "development"), false, "method");
    assert.equal(callbackContextMatches({ ...observed, path: "/v1/identity/callback/extra" }, issued, "development"), false, "path");
    assert.equal(callbackContextMatches({ ...observed, observedOrigin: "http://127.0.0.1:3001" }, issued, "development"), false, "origin");
    assert.equal(callbackContextMatches({ ...observed, observedOrigin: "https://localhost:3000" }, issued, "development"), false, "scheme");
    assert.equal(callbackContextMatches(observed, issued, "staging"), false, "environment of the process");
    assert.equal(callbackContextMatches(observed, { ...issued, environmentId: "staging" }, "development"), false, "environment of the challenge");
  });

  it("strips the query string and only the query string from a request URL", () => {
    assert.equal(requestPath(`${IDENTITY_CALLBACK_PATH}?code=a&state=b`), IDENTITY_CALLBACK_PATH);
    assert.equal(requestPath(IDENTITY_CALLBACK_PATH), IDENTITY_CALLBACK_PATH);
    assert.equal(requestPath(""), "");
  });

  it("is the only implementation: no second copy can exist in apps/api/src", () => {
    // The literals a second copy would have to contain. Finding one outside the
    // shared module (or this test) means the logic has been duplicated again,
    // which is exactly how the prediction and the ceremony drifted apart before.
    const copies: string[] = [];
    for (const path of sourceFiles(API_SRC)) {
      if (path === SHARED || path === fileURLToPath(import.meta.url)) continue;
      const source = readFileSync(path, "utf8");
      const name = relative(API_SRC, path).replaceAll("\\", "/");
      if (source.includes("x-forwarded-host")) copies.push(`${name}: derives an origin from x-forwarded-host`);
      if (/\$\{[^}]*observedOrigin[^}]*\}\$\{IDENTITY_CALLBACK_PATH\}/u.test(source)) copies.push(`${name}: rebuilds the callback URI comparison`);
    }
    assert.deepEqual(copies, [], "origin derivation and the context comparison live in identity/callback-context.ts only");
  });

  it("is what both the ceremony and the rate-limit prediction call", () => {
    // A change in one place is a change in both because there is only one
    // place: each caller imports the shared module and calls the predicate.
    for (const [name, expected] of [
      ["identity/ceremony.ts", ["callbackContextMatches"]],
      ["sessions/runtime.ts", ["callbackContextMatches", "observedOrigin", "requestPath"]],
      ["identity/http.ts", ["observedOrigin", "requestPath"]],
    ] as const) {
      const source = readFileSync(join(API_SRC, name), "utf8");
      assert.match(source, /from "\.\.?\/(?:identity\/)?callback-context\.ts"/u, `${name} imports the shared module`);
      for (const symbol of expected) assert.ok(source.includes(`${symbol}(`), `${name} calls ${symbol}`);
    }
  });
});
