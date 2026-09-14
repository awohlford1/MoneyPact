import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import type { CompletionResult } from "./ceremony.ts";
import { setSubjectLifecycle } from "./store.ts";
import { APPLICATION_ORIGIN, buildHarness, cookieValueFrom } from "./test-support/harness.ts";
import type { IdentityHarness } from "./test-support/harness.ts";

interface Counts { subjects: number; profiles: number; activeProfiles: number; bindings: number; callbacks: number; handoffs: number; consumed: number; prepared: number; terminalFailed: number; sessions: number; activeSessions: number }

function counts(h: IdentityHarness): Counts {
  const db = h.db;
  return {
    subjects: db.count("account_subject"), profiles: db.count("financial_profile"), activeProfiles: db.count("financial_profile", [{ column: "profile_state", value: "active" }]),
    bindings: db.count("identity_binding"), callbacks: db.count("identity_callback"), handoffs: db.count("identity_session_handoff"),
    consumed: db.count("identity_session_handoff", [{ column: "state", value: "consumed" }]), prepared: db.count("identity_session_handoff", [{ column: "state", value: "prepared" }]),
    terminalFailed: db.count("identity_session_handoff", [{ column: "state", value: "terminal_failed" }]),
    sessions: db.count("account_session"), activeSessions: db.count("account_session", [{ column: "state", value: "active" }]),
  };
}

const ZERO: Counts = { subjects: 0, profiles: 0, activeProfiles: 0, bindings: 0, callbacks: 0, handoffs: 0, consumed: 0, prepared: 0, terminalFailed: 0, sessions: 0, activeSessions: 0 };

function success(result: CompletionResult): Extract<CompletionResult, { kind: "success" }> {
  assert.equal(result.kind, "success", JSON.stringify(result));
  return result as Extract<CompletionResult, { kind: "success" }>;
}

function outcome(result: CompletionResult): string {
  assert.equal(result.kind, "outcome", JSON.stringify(result));
  return (result as Extract<CompletionResult, { kind: "outcome" }>).outcome;
}

/** The raw cookie value, as `readSessionCookieValue` would extract it from the Cookie header. */
function sessionCookie(result: CompletionResult): string {
  const value = cookieValueFrom(success(result).setCookie, SESSION_COOKIE_NAME);
  assert.ok(value);
  return value;
}

describe("CBD-190-AC03 identity mapping (CT-190-001/002, CBD190-PROFILE-ATOMIC-001)", () => {
  it("CT-190-001 first valid use: from zero isolated counts exactly one subject, one active profile, one binding, one callback, one consumed hand-off and one session exist, all correlated to the challenge", async () => {
    const h = buildHarness();
    assert.deepEqual(counts(h), ZERO);
    const result = success(await h.signIn("subject-a"));
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, consumed: 1, sessions: 1, activeSessions: 1 });
    assert.equal(result.firstDelivery, true);
    assert.equal(result.navigateTo, `${APPLICATION_ORIGIN}/`);
    assert.ok(cookieValueFrom(result.setCookie, SESSION_COOKIE_NAME));
    // C9 (Manager ruling): the raw CSRF value is never a cookie -- exactly one Set-Cookie header (the
    // session cookie), and the value reaches the browser only through the same-origin `view()`/`/me`
    // bootstrap response, held in browser memory (CBD-191 §5.1).
    assert.equal(result.setCookie.length, 1, "only the session cookie is ever set");
    assert.ok(result.setCookie[0]!.includes("HttpOnly") && result.setCookie[0]!.includes("Secure") && result.setCookie[0]!.includes("SameSite=Lax"));
    const sessionCookieValue = cookieValueFrom(result.setCookie, SESSION_COOKIE_NAME)!;
    const bootstrap = await h.ceremony.view(sessionCookieValue);
    assert.ok(bootstrap?.csrfValue, "the raw CSRF value is recoverable, in-process, through the bootstrap view");
    const callback = h.db.rows("identity_callback")[0]!;
    assert.equal(callback.challenge_id, result.challengeId);
    assert.equal(callback.processing_state, "handoff_ready");
    assert.ok(callback.commit_at instanceof Date, "finalized success marker");
    const handoff = h.db.rows("identity_session_handoff")[0]!;
    assert.equal(handoff.challenge_id, result.challengeId);
    assert.equal(handoff.state, "consumed");
    assert.equal(handoff.issued_session_reference, result.sessionRef);
    const binding = h.db.rows("identity_binding")[0]!;
    assert.equal(binding.provider_subject, h.issuer.subjectFor("subject-a"));
    assert.equal(binding.account_subject_id, result.accountSubjectId);
    assert.equal(h.db.rows("financial_profile")[0]!.account_subject_id, result.accountSubjectId);
    assert.equal(h.db.rows("account_session")[0]!.identity_binding_id, binding.identity_binding_id);
    assert.ok(h.runtime.evidence.some((event) => event.class === "handoff_consumed" && event.challengeId === result.challengeId && event.fidelity === "simulated"));
  });

  it("CT-190-002 existing immutable subject: a second ceremony reuses the same subject and binding, consumes its own hand-off and issues one more session", async () => {
    const h = buildHarness();
    const first = success(await h.signIn("subject-a"));
    const second = success(await h.signIn("subject-a"));
    assert.equal(second.accountSubjectId, first.accountSubjectId);
    assert.notEqual(second.sessionRef, first.sessionRef);
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 2, handoffs: 2, consumed: 2, sessions: 2, activeSessions: 2 });
  });

  it("distinct provider subjects with identical synthetic contact data are distinct account subjects (section 8.1 item 5)", async () => {
    const h = buildHarness();
    const a = success(await h.signIn("subject-a"));
    const b = success(await h.signIn("subject-b"));
    assert.notEqual(a.accountSubjectId, b.accountSubjectId);
    assert.equal(counts(h).subjects, 2);
    assert.equal(counts(h).bindings, 2);
  });

  it("CT-190-003 duplicate delivery of one challenge converges on one hand-off and one session; the duplicate sees the committed destination without a second cookie", async () => {
    const h = buildHarness();
    const { callbackUrl } = await h.callbackFor("subject-a");
    const [first, second] = await Promise.allSettled([h.deliver(callbackUrl), h.deliver(callbackUrl)]);
    assert.equal(first.status, "fulfilled"); assert.equal(second.status, "fulfilled");
    const results = [first, second].map((settled) => success((settled as PromiseFulfilledResult<CompletionResult>).value));
    assert.equal(results.filter((result) => result.firstDelivery).length, 1);
    assert.equal(results.filter((result) => result.setCookie.length === 0).length, 1);
    assert.equal(results[0]!.sessionRef, results[1]!.sessionRef);
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, consumed: 1, sessions: 1, activeSessions: 1 });
    const later = success(await h.deliver(callbackUrl));
    assert.equal(later.firstDelivery, false);
    assert.deepEqual(later.setCookie, []);
    assert.equal(counts(h).sessions, 1);
  });

  it("CT-190-003 synchronized concurrent callbacks for one provider identity converge on exactly one subject, one profile and one binding through the whole-transaction retry", async () => {
    let waiting = 0;
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const retries: number[] = [];
    const h = buildHarness({
      mappingHooks: {
        beforeResolve: async (attempt) => { if (attempt === 1) { waiting += 1; if (waiting === 2) release(); await barrier; } },
        onRetry: (attempt) => { retries.push(attempt); },
      },
    });
    const one = await h.callbackFor("subject-a");
    const two = await h.callbackFor("subject-a");
    const settled = await Promise.allSettled([h.deliver(one.callbackUrl), h.deliver(two.callbackUrl)]);
    const results = settled.map((entry) => success((entry as PromiseFulfilledResult<CompletionResult>).value));
    assert.equal(results[0]!.accountSubjectId, results[1]!.accountSubjectId);
    assert.ok(retries.length >= 1, "the losing attempt rolled back and restarted from step 1");
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 2, handoffs: 2, consumed: 2, sessions: 2, activeSessions: 2 });
  });

  it("CT-190-004 account switch rotates exactly one session to the resolved subject; an injected failure leaves the previous session unchanged", async () => {
    const h = buildHarness();
    const a = success(await h.signIn("subject-a"));
    const cookie = sessionCookie(a);
    const failed = await h.signIn("bad-signature", "account_switch", cookie);
    assert.equal(outcome(failed), "invalid_or_expired");
    assert.equal(h.db.count("account_session", [{ column: "session_ref", value: a.sessionRef }, { column: "state", value: "active" }]), 1, "previous session untouched by the failed switch");
    const b = success(await h.signIn("subject-b", "account_switch", cookie));
    assert.notEqual(b.accountSubjectId, a.accountSubjectId);
    const previous = h.db.rows("account_session").find((row) => row.session_ref === a.sessionRef)!;
    assert.equal(previous.state, "rotated");
    assert.equal(previous.superseded_by_session_ref, b.sessionRef);
    assert.equal(h.db.count("identity_binding"), 2, "old bindings remain unchanged");
    assert.equal(counts(h).activeSessions, 1);
    const withoutSession = await h.ceremony.begin({ ceremony: "account_switch", postResultDestinationId: "home", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.deepEqual(withoutSession, { ok: false, reason: "session_required" });
  });

  it("PROTO-IDENTITY-API-001 C8: a same-subject reauthentication that fails to revoke the prior browser row never delivers success with two active rows", async () => {
    const h = buildHarness();
    const a = success(await h.signIn("subject-a"));
    const cookie = sessionCookie(a);
    // Same-subject "account_switch" (a browser-initiated reauthentication naming the currently
    // signed-in subject again) mints a fresh lineage and must end the prior row atomically.
    // Faulting `revocation_outbox` (only touched by `revokeSession`'s outbox insert, never by
    // `resolveSession`'s idle-expiry slide) targets exactly the C8 revocation step.
    h.db.failStatement("revocation_outbox", "insert", "XX000");
    const failed = await h.signIn("subject-a", "account_switch", cookie);
    assert.equal(outcome(failed), "still_processing", "the revocation failure aborts the whole issuance rather than delivering success");
    assert.equal(h.db.count("account_session", [{ column: "state", value: "active" }]), 1, "still exactly one active row: the original, untouched");
    assert.equal(h.db.count("account_session"), 1, "no second session was minted alongside the failed revocation");
    // Once the fault clears, the same prepared hand-off is retryable and converges on exactly one active row.
    const retried = success(await h.signIn("subject-a", "account_switch", cookie));
    assert.equal(retried.accountSubjectId, a.accountSubjectId);
    assert.equal(h.db.count("account_session", [{ column: "state", value: "active" }]), 1, "exactly one active row after the prior row was revoked atomically with the fresh lineage");
    assert.equal(h.db.count("account_session", [{ column: "state", value: "revoked" }]), 1);
    assert.notEqual(h.db.rows("account_session").find((row) => row.state === "active")!.session_ref, a.sessionRef, "a fresh lineage, not the original row");
  });

  it("CT-190-005 disabled, deletion-pending and security-blocked subjects resolve to the same binding, produce account_unavailable and never a session or a remapping", async () => {
    for (const lifecycle of ["disabled", "deletion_pending", "security_blocked"] as const) {
      const h = buildHarness();
      const a = success(await h.signIn("subject-a"));
      await setSubjectLifecycle(h.client, a.accountSubjectId, lifecycle);
      const before = counts(h);
      const again = await h.signIn("subject-a");
      assert.equal(outcome(again), "account_unavailable", lifecycle);
      assert.deepEqual(counts(h), { ...before, callbacks: before.callbacks + 1 }, lifecycle);
      const callback = h.db.rows("identity_callback").find((row) => row.processing_state === "terminal")!;
      assert.equal(callback.terminal_outcome, "account_unavailable");
      assert.equal(callback.account_subject_id, a.accountSubjectId);
      assert.equal(h.db.count("identity_binding"), 1, `${lifecycle}: no remapping`);
    }
  });

  it("profile integrity: an existing subject without exactly one active profile fails closed with callback_failure and no hand-off", async () => {
    const h = buildHarness();
    const a = success(await h.signIn("subject-a"));
    // Corrupt the invariant outside the guarded transaction path (the fake enforces it only at COMMIT of a transaction).
    h.db.rows("financial_profile")[0]!.profile_state = "deleted";
    const before = counts(h);
    const again = await h.signIn("subject-a");
    assert.equal(outcome(again), "callback_failure");
    assert.deepEqual(counts(h), { ...before, callbacks: before.callbacks + 1 });
    assert.equal(h.db.rows("identity_callback").filter((row) => row.terminal_outcome === "callback_failure").length, 1);
    assert.ok(h.runtime.evidence.some((event) => event.class === "mapping_integrity"));
    assert.equal(a.accountSubjectId, h.db.rows("account_subject")[0]!.account_subject_id);
  });
});

describe("CBD-190-AC04 deterministic safe outcomes (CT-190-006..011)", () => {
  const zeroRows = (h: IdentityHarness): void => { assert.deepEqual(counts(h), ZERO); };

  it("CT-190-006 missing, unknown, expired and replayed state create no subject or session", async () => {
    const h = buildHarness();
    assert.equal(outcome(await h.deliver(`${APPLICATION_ORIGIN}/v1/identity/callback?code=${"c".repeat(43)}&state=${randomBytes(32).toString("base64url")}`)), "invalid_or_expired");
    assert.equal(outcome(await h.deliver(`${APPLICATION_ORIGIN}/v1/identity/callback`)), "invalid_or_expired");
    const expired = await h.callbackFor("subject-a");
    assert.equal(outcome(await h.deliver(expired.callbackUrl, { receiptTime: new Date(Date.now() + 601_000) })), "invalid_or_expired");
    assert.equal(outcome(await h.deliver(expired.callbackUrl)), "invalid_or_expired", "a terminated challenge stays terminated");
    const cancelled = await h.callbackFor("cancel");
    assert.equal(outcome(await h.deliver(cancelled.callbackUrl)), "cancelled");
    assert.equal(outcome(await h.deliver(cancelled.callbackUrl)), "invalid_or_expired", "replay of a consumed failure");
    zeroRows(h);
    assert.ok(h.runtime.evidence.every((event) => event.fidelity === "simulated"));
  });

  it("CT-190-007 wrong origin, callback path, method or environment terminates the known challenge before mapping", async () => {
    const contexts = [
      { observedOrigin: "http://evil.invalid:3000" }, { path: "/v1/identity/callback/extra" }, { method: "POST" }, { observedOrigin: "https://localhost:3000" },
    ];
    for (const context of contexts) {
      const h = buildHarness();
      const { callbackUrl } = await h.callbackFor("subject-a");
      assert.equal(outcome(await h.deliver(callbackUrl, context)), "invalid_or_expired", JSON.stringify(context));
      assert.equal(outcome(await h.deliver(callbackUrl)), "invalid_or_expired", `terminated: ${JSON.stringify(context)}`);
      zeroRows(h);
      assert.ok(h.runtime.evidence.some((event) => event.class === "callback_wrong_context"));
    }
    const other = buildHarness({ environment: { NODE_ENV: "development", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development" } });
    const foreign = buildHarness();
    const { callbackUrl } = await foreign.callbackFor("subject-a");
    assert.equal(outcome(await other.deliver(callbackUrl)), "invalid_or_expired", "a challenge from another environment is unknown input");
    zeroRows(other);
  });

  it("CT-190-008 PKCE, nonce, signature, algorithm, time, issuer, audience and token-use mismatches fail closed before mapping", async () => {
    for (const scenario of ["bad-signature", "wrong-issuer", "wrong-audience", "expired-token", "future-token", "nonce-mismatch", "use-not-id", "unknown-kid", "alg-none", "alg-hs256", "missing-sub", "malformed-token"] as const) {
      const h = buildHarness();
      assert.equal(outcome(await h.signIn(scenario)), "invalid_or_expired", scenario);
      zeroRows(h);
      assert.ok(h.runtime.evidence.some((event) => event.class === "exchange_rejected" && event.detail === "token_invalid"), scenario);
    }
  });

  it("CT-190-009 malformed, duplicate and oversized callback parameters fail closed with uniform output", async () => {
    const h = buildHarness();
    const { callbackUrl } = await h.callbackFor("subject-a");
    const url = new URL(callbackUrl);
    const state = url.searchParams.get("state")!;
    const code = url.searchParams.get("code")!;
    for (const query of [`code=${code}&code=${code}&state=${state}`, `code=${code}&state=${state}&error=x`, `code=${code}&state=${state}&id_token=x`, `code=${"z".repeat(600)}&state=${state}`, `code=${code}&state=${state}#f`]) {
      const result = await h.ceremony.complete({ rawQuery: query, method: "GET", observedOrigin: url.origin, path: url.pathname, receiptTime: new Date() });
      assert.equal(outcome(result), "invalid_or_expired", query.slice(0, 40));
      assert.equal(result.navigateTo, `${APPLICATION_ORIGIN}/identity/result?outcome=invalid_or_expired`);
    }
    zeroRows(h);
    // PROTO-IDENTITY-API-001 correction C5 (review R05): a malformed callback naming a known,
    // still-pending state must terminate that challenge (§7) rather than leave it usable -- this
    // reverses the previous (defective) assertion that the original callback still succeeded
    // afterward. The very first malformed query above already consumed/terminated this state.
    assert.equal(outcome(await h.deliver(callbackUrl)), "invalid_or_expired", "the known challenge named by the malformed attempts is terminated, not still usable");
    assert.ok(h.runtime.evidence.some((event) => event.class === "callback_malformed" && event.challengeId !== undefined), "the malformed evidence carries the terminated challenge's id, not undefined");
    // A genuinely untouched challenge is unaffected and still completes normally.
    const fresh = await h.callbackFor("subject-a");
    assert.equal(success(await h.deliver(fresh.callbackUrl)).firstDelivery, true, "positive control: an untouched challenge still completes");
  });

  it("PROTO-IDENTITY-API-001 RC-03: an oversized malformed callback with a valid state at the start still terminates its own, independently fresh known challenge", async () => {
    const h = buildHarness();
    const { callbackUrl } = await h.callbackFor("subject-a");
    const url = new URL(callbackUrl);
    const state = url.searchParams.get("state")!;
    const code = url.searchParams.get("code")!;
    // state appears complete well within the first 8,192 characters; the query is oversized only
    // because of the trailing duplicate 9,000-character code.
    const oversized = `state=${state}&code=${code}&code=${"z".repeat(9_000)}`;
    assert.ok(oversized.length > 8_192);
    const result = await h.ceremony.complete({ rawQuery: oversized, method: "GET", observedOrigin: url.origin, path: url.pathname, receiptTime: new Date() });
    assert.equal(outcome(result), "invalid_or_expired");
    zeroRows(h);
    // Before RC-03, extractStateForTermination refused the entire oversized query, so the known
    // challenge stayed usable and this replay of the original, well-formed callback would succeed.
    assert.equal(outcome(await h.deliver(callbackUrl)), "invalid_or_expired", "the known challenge named at the start of the oversized query is terminated, not still usable");
  });

  it("CT-190-010 verification pending, cancelled and denied are non-enumerating safe outcomes with no effect", async () => {
    const h = buildHarness();
    assert.equal(outcome(await h.signIn("verification-pending")), "verification_pending");
    assert.equal(outcome(await h.signIn("cancel")), "cancelled");
    assert.equal(outcome(await h.signIn("deny")), "not_completed");
    zeroRows(h);
    for (const result of h.runtime.evidence) assert.equal(result.class, "provider_error");
  });

  it("CT-190-011 provider outage at authorization, token, JWKS and revocation endpoints is bounded and fail-closed with no mapping, profile, hand-off or session", async () => {
    const h = buildHarness();
    assert.equal(outcome(await h.signIn("outage")), "temporarily_unavailable");
    h.issuer.setTokenEndpoint("outage");
    assert.equal(outcome(await h.signIn("subject-a")), "temporarily_unavailable");
    h.issuer.setTokenEndpoint("ok");
    h.issuer.setJwksEndpoint("outage");
    assert.equal(outcome(await h.signIn("subject-a")), "invalid_or_expired");
    h.issuer.setJwksEndpoint("ok");
    h.issuer.setRevocation("outage");
    assert.equal(outcome(await h.signIn("subject-a")), "temporarily_unavailable");
    h.issuer.setRevocation("ambiguous");
    assert.equal(outcome(await h.signIn("subject-a")), "temporarily_unavailable");
    zeroRows(h);
    assert.ok(h.events.some((event) => event.outcome === "error" && event.operation === "request"));
    assert.ok(h.events.every((event) => Object.keys(event).every((key) => ["service", "version", "operation", "outcome", "errorClass"].includes(key))));
  });
});

describe("CBD-190 section 6 / CT-190-012 commit-boundary fault injection", () => {
  it("a retryable conflict inside the mapping transaction restarts the whole algorithm from a fresh snapshot and still converges", async () => {
    const retries: [number, string | undefined][] = [];
    const h = buildHarness({ mappingHooks: { onRetry: (attempt, sqlState) => { retries.push([attempt, sqlState]); } } });
    h.db.failStatement("identity_session_handoff", "insert", "40001");
    const result = success(await h.signIn("subject-a"));
    assert.deepEqual(retries, [[1, "40001"]]);
    assert.equal(result.firstDelivery, true);
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, consumed: 1, sessions: 1, activeSessions: 1 });
  });

  it("before mapping commit: a non-retryable failure leaves every delta at zero and a temporarily_unavailable outcome", async () => {
    const h = buildHarness();
    h.db.failStatement("identity_callback", "insert", "XX000");
    assert.equal(outcome(await h.signIn("subject-a")), "temporarily_unavailable");
    assert.deepEqual(counts(h), ZERO);
  });

  it("exhausted retries settle only an absent mapping as terminal callback_failure, creating no subject, binding, hand-off or session", async () => {
    const h = buildHarness({ environment: { COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "2" } });
    h.db.failStatement("identity_binding", "insert", "40001", 2);
    assert.equal(outcome(await h.signIn("subject-a")), "callback_failure");
    assert.deepEqual(counts(h), { ...ZERO, callbacks: 1 });
    assert.equal(h.db.rows("identity_callback")[0]!.terminal_outcome, "callback_failure");
  });

  it("after mapping commit but before the CBD-191 commit: one subject, one active profile, one binding and one prepared hand-off remain with zero sessions; the same hand-off is consumed on retry", async () => {
    const h = buildHarness();
    h.db.failStatement("account_session", "insert", "XX000");
    const { callbackUrl, challengeId } = await h.callbackFor("subject-a");
    const first = await h.deliver(callbackUrl);
    assert.equal(outcome(first), "still_processing");
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, prepared: 1 });
    const handoffId = h.db.rows("identity_session_handoff")[0]!.session_handoff_id;
    const second = success(await h.deliver(callbackUrl));
    assert.equal(second.firstDelivery, true);
    assert.equal(second.challengeId, challengeId);
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, consumed: 1, sessions: 1, activeSessions: 1 });
    assert.equal(h.db.rows("identity_session_handoff")[0]!.session_handoff_id, handoffId, "the same hand-off, never a second one");
    assert.equal(Number(h.db.rows("identity_session_handoff")[0]!.attempt_count), 2);
  });

  it("PROTO-IDENTITY-API-001 C1: a finalization failure now rolls back the session issuance atomically -- no orphaned account_session, and a retry issues exactly one session", async () => {
    // Before C1, session issuance (CBD-191) and hand-off/callback finalization were separate
    // transactions: a failure here left an active `account_session` row with an unconsumed hand-off.
    // `createSessionStore(scoped)` now binds issuance to the same transaction as
    // `markHandoffConsumed`/`markCallbackCommitted`, so this failure rolls back the session too.
    const h = buildHarness();
    h.db.failStatement("identity_session_handoff", "update", "XX000");
    const { callbackUrl } = await h.callbackFor("subject-a");
    assert.equal(outcome(await h.deliver(callbackUrl)), "still_processing");
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, prepared: 1 }, "no account_session row survives the failed finalization");
    const replay = success(await h.deliver(callbackUrl));
    assert.equal(replay.firstDelivery, true);
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, consumed: 1, sessions: 1, activeSessions: 1 }, "the retry issued exactly one session");
    assert.equal(h.db.rows("account_session")[0]!.session_ref, replay.sessionRef);
  });

  it("PROTO-IDENTITY-API-001 C1: a session_delivery_result insert failure rolls back the whole issuance; a callback retry issues exactly one session", async () => {
    const h = buildHarness();
    h.db.failStatement("session_delivery_result", "insert", "XX000");
    const { callbackUrl } = await h.callbackFor("subject-a");
    assert.equal(outcome(await h.deliver(callbackUrl)), "still_processing");
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, prepared: 1 }, "no account_session row survives the failed delivery-result insert");
    const retry = success(await h.deliver(callbackUrl));
    assert.equal(retry.firstDelivery, true);
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, consumed: 1, sessions: 1, activeSessions: 1 }, "the retry issued exactly one session");
  });

  it("exhaustion after mapping commit: an expired prepared hand-off becomes terminal_failed and callback_failure while the immutable subject, profile and binding remain with zero sessions", async () => {
    let clock = new Date();
    const h = buildHarness({ now: () => clock, environment: { COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: "5" } });
    h.db.failStatement("account_session", "insert", "XX000");
    const { callbackUrl } = await h.callbackFor("subject-a");
    assert.equal(outcome(await h.deliver(callbackUrl)), "still_processing");
    clock = new Date(clock.getTime() + 10_000);
    assert.equal(outcome(await h.deliver(callbackUrl)), "callback_failure");
    assert.deepEqual(counts(h), { ...ZERO, subjects: 1, profiles: 1, activeProfiles: 1, bindings: 1, callbacks: 1, handoffs: 1, terminalFailed: 1 });
    assert.equal(h.db.rows("identity_callback")[0]!.terminal_outcome, "callback_failure");
    assert.equal(outcome(await h.deliver(callbackUrl)), "callback_failure", "terminal stays terminal");
    assert.equal(counts(h).sessions, 0);
  });
});

describe("CBD-190-AC02 custody through the whole ceremony (CT-190-013 sink inspection, fidelity=simulated)", () => {
  it("no provider token, code, verifier, state or nonce reaches a persisted row, an evidence record or a reliability event", async () => {
    const h = buildHarness();
    const { callbackUrl } = await h.callbackFor("subject-a");
    const url = new URL(callbackUrl);
    const code = url.searchParams.get("code")!;
    const state = url.searchParams.get("state")!;
    const captured: string[] = [];
    const transport = h.issuer;
    const originalExchange = transport.exchange.bind(transport);
    transport.exchange = async (input) => {
      const result = await originalExchange(input);
      if (result.ok) { const issued = result.tokens; captured.push(issued.id_token); captured.push(issued.access_token); captured.push(issued.refresh_token ?? ""); }
      captured.push(input.codeVerifier);
      return result;
    };
    success(await h.deliver(callbackUrl));
    assert.equal(captured.length, 4);
    const sinks = JSON.stringify({ tables: [...h.db.tables.entries()], evidence: h.runtime.evidence, events: h.events, audit: h.runtime.audit?.snapshot() });
    for (const secret of [code, state, ...captured.filter((value) => value.length > 0)]) assert.ok(!sinks.includes(secret), "credential material must be absent from every sink");
    assert.ok(!sinks.includes("eyJ"), "no compact JWT in any sink");
    assert.deepEqual(h.issuer.familyCounts(), { issued: 1, revoked: 1 });
  });
});

describe("identity view and logout", () => {
  it("returns the resolved subject, profile and binding identifiers for a live session and nothing after logout", async () => {
    const h = buildHarness();
    const signedIn = success(await h.signIn("subject-a"));
    const cookie = cookieValueFrom(signedIn.setCookie, SESSION_COOKIE_NAME)!;
    const view = await h.ceremony.view(cookie);
    assert.ok(view);
    assert.equal(view.accountSubjectId, signedIn.accountSubjectId);
    assert.equal(view.profileId, h.db.rows("financial_profile")[0]!.profile_id);
    assert.equal(view.sessionRef, signedIn.sessionRef);
    assert.ok(view.csrfValue, "C9: the raw CSRF bootstrap value is recoverable in-process before logout");
    assert.equal(view.sessionVersion, 1, "CBD-191 section 5.1: the per-session version is a permitted client hint");
    assert.deepEqual(Object.keys(view).sort(), ["accountSubjectId", "assurance", "csrfValue", "environmentId", "identityBindingId", "profileId", "sessionRef", "sessionVersion"]);
    const csrf = await h.ceremony.csrfDigestFor(cookie);
    assert.ok(csrf);
    const deletion = await h.ceremony.logout(csrf.sessionRef);
    // C9: only the session cookie is ever deleted -- there is no CSRF cookie to delete.
    assert.equal(deletion.length, 1);
    assert.ok(deletion.every((header) => header.includes("Max-Age=0")));
    assert.equal(await h.ceremony.view(cookie), undefined);
    assert.equal(h.db.count("account_session", [{ column: "state", value: "revoked" }]), 1);
    assert.equal(h.db.count("revocation_outbox", [{ column: "cause", value: "logout" }]), 1);
    assert.equal(await h.ceremony.view(undefined), undefined);
    assert.equal(await h.ceremony.view("not-a-cookie"), undefined);
  });

  it("PROTO-IDENTITY-API-001 RC-06 / PROTO-ACTIVATION-001: the raw CSRF bootstrap value is returned on every bootstrap read of a live session (a reload must be able to mutate again), bounded by the session's absolute expiry and erased at logout", async () => {
    let now = new Date();
    const h = buildHarness({ now: () => now });
    const signedIn = success(await h.signIn("subject-a"));
    const cookie = cookieValueFrom(signedIn.setCookie, SESSION_COOKIE_NAME)!;
    const first = await h.ceremony.view(cookie);
    assert.ok(first?.csrfValue, "the first bootstrap read returns the raw value");
    const second = await h.ceremony.view(cookie);
    assert.equal(second?.csrfValue, first.csrfValue, "a reload's bootstrap read receives the same session-bound value: it is held only in browser memory (CBD-191 section 5.1)");
    now = new Date(now.getTime() + 3601 * 1000);
    const expired = await h.ceremony.view(cookie);
    assert.equal(expired, undefined, "the session itself has passed its absolute lifetime");
    assert.equal((await h.ceremony.csrfDigestFor(cookie)), undefined);
  });

  it("PROTO-ACTIVATION-001: the CSRF bootstrap entry is erased at logout", async () => {
    const h = buildHarness();
    const signedIn = success(await h.signIn("subject-a"));
    const cookie = cookieValueFrom(signedIn.setCookie, SESSION_COOKIE_NAME)!;
    const csrf = await h.ceremony.csrfDigestFor(cookie);
    assert.ok(csrf);
    await h.ceremony.logout(csrf.sessionRef);
    assert.equal(await h.ceremony.view(cookie), undefined, "the revoked session no longer resolves");
  });

  it("begin refuses a foreign origin, an unknown ceremony and an unknown destination before creating any challenge", async () => {
    const h = buildHarness();
    assert.deepEqual(await h.ceremony.begin({ ceremony: "sign_in", postResultDestinationId: "home", origin: "http://evil.invalid", secFetchSite: "cross-site", sessionCookie: undefined }), { ok: false, reason: "origin_rejected" });
    assert.deepEqual(await h.ceremony.begin({ ceremony: "recover", postResultDestinationId: "home", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined }), { ok: false, reason: "ceremony_invalid" });
    assert.deepEqual(await h.ceremony.begin({ ceremony: "sign_in", postResultDestinationId: "https://evil.invalid", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined }), { ok: false, reason: "destination_invalid" });
    const begun = await h.ceremony.begin({ ceremony: "register", postResultDestinationId: undefined, origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.ok(begun.ok);
    const target = new URL(begun.navigateTo);
    assert.equal(`${target.origin}${target.pathname}`, `${h.ceremony.config.authorizationEndpoint}`);
    assert.equal(target.searchParams.get("scope"), "openid");
    assert.equal(target.searchParams.get("code_challenge_method"), "S256");
    assert.equal(target.searchParams.get("response_type"), "code");
    assert.notEqual(target.searchParams.get("state"), target.searchParams.get("nonce"));
  });
});
