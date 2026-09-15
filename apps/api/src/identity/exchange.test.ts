import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { oneWayDigest } from "./challenge.ts";
import type { LateSettlement } from "./exchange.ts";
import { EXCHANGE_STEP_ORDER, runBoundedExchange } from "./exchange.ts";
import type { ExchangeOutcome } from "./exchange.ts";
import { LocalIssuer } from "./local-issuer.ts";
import type { LocalScenario, ProviderTransport } from "./local-issuer.ts";
import { CALLBACK_URI, CLIENT_ID, ISSUER } from "./test-support/harness.ts";

interface Prepared { readonly issuer: LocalIssuer; readonly code: string; readonly verifier: Buffer; readonly nonce: string; readonly issuedAt: Date }

function prepare(scenario: LocalScenario, issuer = new LocalIssuer({ issuer: ISSUER, clientId: CLIENT_ID, callbackUri: CALLBACK_URI })): Prepared {
  const verifier = Buffer.from(randomBytes(32).toString("base64url"), "ascii");
  const nonce = randomBytes(32).toString("base64url");
  const authorized = issuer.authorize({ client_id: CLIENT_ID, redirect_uri: CALLBACK_URI, response_type: "code", scope: "openid", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "s".repeat(43), nonce });
  assert.ok(authorized.ok);
  const target = issuer.choose(authorized.requestId, scenario);
  assert.ok(target);
  const code = new URL(target).searchParams.get("code");
  assert.ok(code);
  return { issuer, code, verifier, nonce, issuedAt: new Date() };
}

async function exchange(prepared: Prepared, overrides: { readonly transport?: ProviderTransport; readonly maxLifetimeMs?: number; readonly cleanupDeadlineMs?: number; readonly onLateSettlement?: (settled: LateSettlement) => void; readonly nonceDigest?: string; readonly verifier?: Buffer; readonly code?: string; readonly issuer?: string; readonly clientId?: string } = {}): Promise<ExchangeOutcome> {
  return runBoundedExchange({
    transport: overrides.transport ?? prepared.issuer, code: overrides.code ?? prepared.code, codeVerifier: overrides.verifier ?? Buffer.from(prepared.verifier), redirectUri: CALLBACK_URI, clientId: overrides.clientId ?? CLIENT_ID, issuer: overrides.issuer ?? ISSUER,
    allowedAlgorithms: ["RS256"], nonceDigest: overrides.nonceDigest ?? oneWayDigest(prepared.nonce), digest: oneWayDigest, receiptTime: new Date(), challengeIssuedAt: prepared.issuedAt, clockSkewSeconds: 30, maxLifetimeMs: overrides.maxLifetimeMs ?? 2_000,
    cleanupDeadlineMs: overrides.cleanupDeadlineMs, onLateSettlement: overrides.onLateSettlement,
  });
}

function stepsOf(outcome: ExchangeOutcome): string[] {
  return outcome.evidence.steps.map((step) => step.step);
}

describe("CBD-190-AC02 bounded exchange state machine (section 10.1, CT-190-016 shape, fidelity=simulated)", () => {
  it("positive control: follows the exact step order, revokes the token family at the issuer, zeroes every buffer and releases only canonical fields", async () => {
    const prepared = prepare("subject-a");
    const verifierCopy = Buffer.from(prepared.verifier);
    const outcome = await exchange(prepared, { verifier: verifierCopy });
    assert.equal(outcome.status, "verified");
    if (outcome.status !== "verified") return;
    assert.deepEqual(stepsOf(outcome), [...EXCHANGE_STEP_ORDER]);
    for (let i = 1; i < outcome.evidence.steps.length; i += 1) assert.ok(outcome.evidence.steps[i]!.atMs >= outcome.evidence.steps[i - 1]!.atMs, "monotonic step times");
    assert.equal(outcome.evidence.buffersZeroed, true);
    assert.ok(verifierCopy.every((byte) => byte === 0), "PKCE verifier buffer destroyed");
    assert.deepEqual(Object.keys(outcome.claims).sort(), ["authTime", "issuedAt", "issuer", "name", "providerSubject"]);
    assert.equal(outcome.claims.issuer, ISSUER);
    assert.equal(outcome.claims.providerSubject, prepared.issuer.subjectFor("subject-a"));
    // CBD-190 identity amendments proposal §2.1-2.2: the local issuer's fixture name claim for
    // subject-a, trimmed, is the only extra allowlisted field the exchange releases.
    assert.equal(outcome.claims.name, "Ada A. Local");
    assert.ok(!JSON.stringify(outcome).includes("synthetic@example.invalid"), "contact attribute never leaves the exchange");
    assert.deepEqual(prepared.issuer.familyCounts(), { issued: 1, revoked: 1 });
    assert.equal(prepared.issuer.revocations.length, 1, "issuer-side revocation hook invoked exactly once");
    assert.deepEqual(prepared.issuer.egress.map((event) => event.destination), ["token", "jwks", "revocation"], "destination/phase-scoped egress only");
    assert.ok(outcome.evidence.durationMs < 2_000);
  });

  it("post-revocation probe: the access token from the exchange is dead at the issuer, so it is not reusable after the exchange", async () => {
    const prepared = prepare("subject-a");
    let captured: string | undefined;
    const observing: ProviderTransport = {
      exchange: async (input) => { const result = await prepared.issuer.exchange(input); if (result.ok) captured = result.tokens.access_token; return result; },
      revoke: (input) => prepared.issuer.revoke(input),
      jwks: () => prepared.issuer.jwks(),
    };
    const outcome = await exchange(prepared, { transport: observing });
    assert.equal(outcome.status, "verified");
    assert.ok(captured);
    assert.deepEqual(prepared.issuer.probeAccessToken(captured), { active: false });
  });

  it("a missing refresh token, a failed, ambiguous or unreachable revocation each fail closed before any canonical result is released", async () => {
    const missing = await exchange(prepare("no-refresh"));
    assert.equal(missing.status, "rejected");
    assert.equal(missing.status === "rejected" && missing.rejection, "revocation_missing_token");
    assert.ok(!stepsOf(missing).includes("revocation_confirmed"));
    for (const [mode, rejection] of [["fail", "revocation_failed"], ["outage", "revocation_failed"], ["ambiguous", "revocation_uncertain"]] as const) {
      const prepared = prepare("subject-a");
      prepared.issuer.setRevocation(mode);
      const outcome = await exchange(prepared);
      assert.equal(outcome.status, "rejected");
      assert.equal(outcome.status === "rejected" && outcome.rejection, rejection, mode);
      assert.ok(stepsOf(outcome).includes("revocation_requested") && !stepsOf(outcome).includes("revocation_confirmed"), mode);
      assert.equal(outcome.evidence.buffersZeroed, true);
      assert.ok(!("claims" in outcome));
    }
  });

  it("CT-190-011: token-endpoint, JWKS and provider outages are bounded fail-closed results", async () => {
    const tokenOutage = prepare("subject-a"); tokenOutage.issuer.setTokenEndpoint("outage");
    const outage = await exchange(tokenOutage);
    assert.equal(outage.status === "rejected" && outage.rejection, "provider_unavailable");
    assert.deepEqual(stepsOf(outage), ["buffers_destroyed", "execution_terminated"]);
    const jwksOutage = prepare("subject-a"); jwksOutage.issuer.setJwksEndpoint("outage");
    const keys = await exchange(jwksOutage);
    assert.equal(keys.status === "rejected" && keys.rejection, "token_invalid");
    assert.equal(keys.evidence.tokenRejection, "key");
    const hanging: ProviderTransport = { exchange: () => new Promise(() => undefined), revoke: async () => "revoked", jwks: async () => ({ keys: [] }) };
    const timeout = await exchange(prepare("subject-a"), { transport: hanging, maxLifetimeMs: 50 });
    assert.equal(timeout.status === "rejected" && timeout.rejection, "exchange_timeout");
    assert.equal(timeout.evidence.buffersZeroed, true);
  });

  it("CT-190-007/008: issuer, audience, key, signature, algorithm, time, nonce, token-use, subject and serialization mismatches fail closed before mapping", async () => {
    const cases: [LocalScenario, string][] = [
      ["wrong-issuer", "issuer"], ["wrong-audience", "audience"], ["unknown-kid", "key"], ["bad-signature", "signature"],
      ["alg-none", "algorithm"], ["alg-hs256", "algorithm"], ["expired-token", "time"], ["future-token", "time"],
      ["nonce-mismatch", "nonce"], ["use-not-id", "token_use"], ["missing-sub", "subject"], ["malformed-token", "serialization"],
    ];
    for (const [scenario, rejection] of cases) {
      const outcome = await exchange(prepare(scenario));
      assert.equal(outcome.status, "rejected", scenario);
      assert.equal(outcome.status === "rejected" && outcome.rejection, "token_invalid", scenario);
      assert.equal(outcome.evidence.tokenRejection, rejection, scenario);
      assert.ok(!stepsOf(outcome).includes("canonical_fields_extracted"), scenario);
    }
    const wrongExpectedIssuer = await exchange(prepare("subject-a"), { issuer: `${ISSUER}-env2` });
    assert.equal(wrongExpectedIssuer.evidence.tokenRejection, "issuer");
    const wrongClient = await exchange(prepare("subject-a"), { clientId: "other-client" });
    assert.equal(wrongClient.status === "rejected" && wrongClient.rejection, "grant_rejected");
  });

  it("CT-190-006/008: a replayed code, a wrong PKCE verifier and a consumed code are grant rejections with zero canonical output", async () => {
    const prepared = prepare("subject-a");
    const first = await exchange(prepared);
    assert.equal(first.status, "verified");
    const replay = await exchange(prepared);
    assert.equal(replay.status === "rejected" && replay.rejection, "grant_rejected");
    const wrongVerifier = await exchange(prepare("subject-a"), { verifier: Buffer.from(randomBytes(32).toString("base64url"), "ascii") });
    assert.equal(wrongVerifier.status === "rejected" && wrongVerifier.rejection, "grant_rejected");
    const unknownCode = await exchange(prepare("subject-a"), { code: randomBytes(32).toString("base64url") });
    assert.equal(unknownCode.status === "rejected" && unknownCode.rejection, "grant_rejected");
  });

  it("PROTO-IDENTITY-API-001 C6: an invalid ID token still yields exactly one cleanup revocation of the received token family", async () => {
    const prepared = prepare("bad-signature");
    const outcome = await exchange(prepared);
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.status === "rejected" && outcome.rejection, "token_invalid");
    assert.equal(prepared.issuer.revocations.length, 1, "the family received before validation failed still gets one cleanup revocation");
    assert.deepEqual(prepared.issuer.familyCounts(), { issued: 1, revoked: 1 });
  });

  it("PROTO-IDENTITY-API-001 C6: a timeout settles the late transport response and still revokes the family it minted, without affecting the returned outcome", async () => {
    const prepared = prepare("subject-a");
    let resolveLate!: (value: import("./local-issuer.ts").ExchangeTransportResult) => void;
    const late = new Promise<import("./local-issuer.ts").ExchangeTransportResult>((resolve) => { resolveLate = resolve; });
    const hangingThenLate: ProviderTransport = {
      exchange: () => late,
      revoke: (input) => prepared.issuer.revoke(input),
      jwks: () => prepared.issuer.jwks(),
    };
    const outcome = await exchange(prepared, { transport: hangingThenLate, maxLifetimeMs: 30 });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.status === "rejected" && outcome.rejection, "exchange_timeout");
    assert.equal(prepared.issuer.revocations.length, 0, "no post-return issuance or revocation has happened yet");
    // The transport call the exchange abandoned at the deadline now resolves with a real token family.
    resolveLate(await prepared.issuer.exchange({ code: prepared.code, codeVerifier: prepared.verifier.toString("ascii"), redirectUri: CALLBACK_URI, clientId: CLIENT_ID }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(prepared.issuer.revocations.length, 1, "the late-minted family was cleaned up exactly once");
    assert.deepEqual(prepared.issuer.familyCounts(), { issued: 1, revoked: 1 });
  });

  it("PROTO-IDENTITY-API-001 RC-01: a timeout during JWKS/validation (after tokens were received) still revokes the received family exactly once", async () => {
    const prepared = prepare("subject-a");
    const hangingJwks: ProviderTransport = {
      exchange: (input) => prepared.issuer.exchange(input),
      revoke: (input) => prepared.issuer.revoke(input),
      jwks: () => new Promise(() => undefined), // never resolves: validation hangs until the shared deadline fires.
    };
    const outcome = await exchange(prepared, { transport: hangingJwks, maxLifetimeMs: 30 });
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.status === "rejected" && outcome.rejection, "exchange_timeout");
    assert.equal(outcome.evidence.buffersZeroed, true);
    assert.equal(prepared.issuer.revocations.length, 1, "the family received before the JWKS timeout still gets exactly one cleanup revocation");
    assert.deepEqual(prepared.issuer.familyCounts(), { issued: 1, revoked: 1 }, "no unrevoked family survives a validation-stage timeout");
  });

  it("key rotation: a token signed by a freshly rotated key is accepted after one bounded JWKS refresh; a retired key fails closed", async () => {
    const issuer = new LocalIssuer({ issuer: ISSUER, clientId: CLIENT_ID, callbackUri: CALLBACK_URI });
    const stale = (await issuer.jwks())!.keys;
    issuer.rotateSigningKey();
    const rotated = prepare("subject-a", issuer);
    const accepted = await runBoundedExchange({ transport: issuer, code: rotated.code, codeVerifier: Buffer.from(rotated.verifier), redirectUri: CALLBACK_URI, clientId: CLIENT_ID, issuer: ISSUER, allowedAlgorithms: ["RS256"], nonceDigest: oneWayDigest(rotated.nonce), digest: oneWayDigest, receiptTime: new Date(), challengeIssuedAt: rotated.issuedAt, clockSkewSeconds: 30, maxLifetimeMs: 2_000, cachedKeys: stale });
    assert.equal(accepted.status, "verified");
    const second = prepare("subject-a", issuer);
    issuer.rotateSigningKey();
    issuer.retireOldKeys();
    const retired = await exchange(second);
    assert.equal(retired.evidence.tokenRejection, "key");
  });
});

describe("PROTO-ACTIVATION-001 A9 (RC-01 residuals): every cleanup path is deadline-bounded", () => {
  it("a stalled revocation transport cannot hold buffer destruction open: the cleanup revocation is bounded and the outcome returns within the deadline", async () => {
    const prepared = prepare("subject-a");
    let revokeCalls = 0;
    const stalledRevoke: ProviderTransport = {
      exchange: (input) => prepared.issuer.exchange(input),
      jwks: () => new Promise(() => undefined), // validation hangs until the shared deadline fires, with a family already received.
      revoke: () => { revokeCalls++; return new Promise(() => undefined); }, // the cleanup revocation never settles.
    };
    const started = performance.now();
    const outcome = await exchange(prepared, { transport: stalledRevoke, maxLifetimeMs: 30, cleanupDeadlineMs: 40 });
    const elapsed = performance.now() - started;
    assert.equal(outcome.status === "rejected" && outcome.rejection, "exchange_timeout");
    assert.equal(revokeCalls, 1, "exactly one cleanup attempt was made");
    assert.equal(outcome.evidence.buffersZeroed, true, "buffers were destroyed although the revocation never settled");
    assert.ok(elapsed < 1_000, `returned within the bounded deadlines, not after an unbounded await (${elapsed.toFixed(0)} ms)`);
  });

  it("a timed-out initial exchange settles its late family with one bounded cleanup and reports the settlement; a transport that never answers is abandoned at the deadline", async () => {
    const prepared = prepare("subject-a");
    let resolveLate!: (value: import("./local-issuer.ts").ExchangeTransportResult) => void;
    const late = new Promise<import("./local-issuer.ts").ExchangeTransportResult>((resolve) => { resolveLate = resolve; });
    const settlements: string[] = [];
    const lateTransport: ProviderTransport = { exchange: () => late, revoke: (input) => prepared.issuer.revoke(input), jwks: () => prepared.issuer.jwks() };
    const outcome = await exchange(prepared, { transport: lateTransport, maxLifetimeMs: 30, cleanupDeadlineMs: 500, onLateSettlement: (settled) => settlements.push(settled) });
    assert.equal(outcome.status === "rejected" && outcome.rejection, "exchange_timeout");
    resolveLate(await prepared.issuer.exchange({ code: prepared.code, codeVerifier: prepared.verifier.toString("ascii"), redirectUri: CALLBACK_URI, clientId: CLIENT_ID }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(settlements, ["revoked"], "the late family was revoked exactly once and the settlement was reported");
    assert.deepEqual(prepared.issuer.familyCounts(), { issued: 1, revoked: 1 });

    const abandoned: string[] = [];
    const never: ProviderTransport = { exchange: () => new Promise(() => undefined), revoke: (input) => prepared.issuer.revoke(input), jwks: () => prepared.issuer.jwks() };
    const second = await exchange(prepare("subject-a"), { transport: never, maxLifetimeMs: 20, cleanupDeadlineMs: 40, onLateSettlement: (settled) => abandoned.push(settled) });
    assert.equal(second.status === "rejected" && second.rejection, "exchange_timeout");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(abandoned, ["abandoned"], "the settlement itself is bounded: a transport that never answers is released at the cleanup deadline, not retained for the process lifetime");
  });
});

describe("PROTO-ACTIVATION-001 B2 (SEC-ACT-R2-F01): abandonment cancels the initial exchange and retains cleanup ownership of a late response", () => {
  it("a transport that answers after the cleanup deadline (ignoring the cancellation) has its late family revoked and reported", async () => {
    const prepared = prepare("subject-a");
    let resolveLate!: (value: import("./local-issuer.ts").ExchangeTransportResult) => void;
    const late = new Promise<import("./local-issuer.ts").ExchangeTransportResult>((resolve) => { resolveLate = resolve; });
    const settlements: string[] = [];
    let observedSignal: AbortSignal | undefined;
    const ignoringCancellation: ProviderTransport = { exchange: (input) => { observedSignal = input.signal; return late; }, revoke: (input) => prepared.issuer.revoke(input), jwks: () => prepared.issuer.jwks() };
    const outcome = await exchange(prepared, { transport: ignoringCancellation, maxLifetimeMs: 20, cleanupDeadlineMs: 40, onLateSettlement: (settled) => settlements.push(settled) });
    assert.equal(outcome.status === "rejected" && outcome.rejection, "exchange_timeout");
    assert.equal(observedSignal?.aborted, false, "the exchange is not cancelled at the timeout: its late family is still expected within the cleanup deadline");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(settlements, ["abandoned"], "the cleanup deadline passed with no answer");
    assert.equal(observedSignal?.aborted, true, "abandonment cancelled the initial exchange through its signal");
    // The provider answers anyway, after the abandonment, with a real token family (the pre-B2 escape: settled unrevoked).
    resolveLate(await prepared.issuer.exchange({ code: prepared.code, codeVerifier: prepared.verifier.toString("ascii"), redirectUri: CALLBACK_URI, clientId: CLIENT_ID }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(settlements, ["abandoned", "late_revoked"], "the late family got its one cleanup revocation and the settlement was reported");
    assert.deepEqual(prepared.issuer.familyCounts(), { issued: 1, revoked: 1 }, "no family minted after abandonment stays live");
    assert.equal(prepared.issuer.revocations.length, 1, "exactly one revocation attempt");
  });

  it("a transport that honours the cancellation mints nothing after abandonment; a late family whose revocation fails is reported as such", async () => {
    const prepared = prepare("subject-a");
    const settlements: string[] = [];
    // The local issuer honours the signal: the exchange only reaches it after the abandonment.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const honouring: ProviderTransport = { exchange: async (input) => { await gate; return prepared.issuer.exchange(input); }, revoke: (input) => prepared.issuer.revoke(input), jwks: () => prepared.issuer.jwks() };
    const outcome = await exchange(prepared, { transport: honouring, maxLifetimeMs: 20, cleanupDeadlineMs: 40, onLateSettlement: (settled) => settlements.push(settled) });
    assert.equal(outcome.status === "rejected" && outcome.rejection, "exchange_timeout");
    await new Promise((resolve) => setTimeout(resolve, 80));
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(settlements, ["abandoned", "late_no_family"], "the cancelled exchange minted no family");
    assert.deepEqual(prepared.issuer.familyCounts(), { issued: 0, revoked: 0 });

    const second = prepare("subject-a");
    let resolveLate!: (value: import("./local-issuer.ts").ExchangeTransportResult) => void;
    const late = new Promise<import("./local-issuer.ts").ExchangeTransportResult>((resolve) => { resolveLate = resolve; });
    const failing: string[] = [];
    const failingRevoke: ProviderTransport = { exchange: () => late, revoke: async () => "failed", jwks: () => second.issuer.jwks() };
    await exchange(second, { transport: failingRevoke, maxLifetimeMs: 20, cleanupDeadlineMs: 40, onLateSettlement: (settled) => failing.push(settled) });
    await new Promise((resolve) => setTimeout(resolve, 80));
    resolveLate(await second.issuer.exchange({ code: second.code, codeVerifier: second.verifier.toString("ascii"), redirectUri: CALLBACK_URI, clientId: CLIENT_ID }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(failing, ["abandoned", "late_revocation_failed"], "a late family that could not be revoked is reported, never silently settled");
  });
});
