/**
 * PK4-03 (PROTO-INVITATIONS-PK4-STEPUP-001): the `step_up` ceremony.
 *
 * The criterion is that the step-up reuses the sign-in ceremony's state,
 * nonce, PKCE and callback-context checks, issues no session and maps no
 * subject, and that the grant it produces is write-once. This suite drives
 * the real `IdentityCeremony` over the real local Cognito-shaped issuer, so
 * the reuse is demonstrated rather than asserted: every negative case here
 * is a property of the shared machinery (`challenge.ts`, `exchange.ts`,
 * `token.ts`, `callback-context.ts`), reached through the step-up entry
 * points.
 *
 * "Issues no session and maps no subject" is checked against the tables
 * themselves -- the session row count, the subject row count and the binding
 * row count are all taken before and after -- because those are the two
 * things a step-up must never do however it fails.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import { buildHarness, cookieValueFrom, APPLICATION_ORIGIN } from "./test-support/harness.ts";
import type { IdentityHarness } from "./test-support/harness.ts";
import { IDENTITY_STEP_UP_CALLBACK_PATH } from "./config.ts";
import { protectedActions } from "./ceremony.ts";

const ACTION = "29.transfer_primary_ownership";

interface SignedIn {
  readonly harness: IdentityHarness;
  readonly cookie: string;
  readonly subjectId: string;
  readonly sessionRef: string;
  readonly spaceId: string;
}

function rows(harness: IdentityHarness, table: string): number {
  return (harness.db.tables.get(table) ?? []).length;
}

/** Signs a subject in through the real ceremony and gives it an active membership in one space. */
async function signedIn(harness = buildHarness({ scheduler: null })): Promise<SignedIn> {
  const result = await harness.signIn("subject-a");
  assert.equal(result.kind, "success");
  if (result.kind !== "success") throw new Error("unreachable");
  const cookie = cookieValueFrom(result.setCookie, SESSION_COOKIE_NAME);
  assert.ok(cookie);
  const spaceId = randomUUID();
  const memberships = harness.db.tables.get("budget_space_membership") ?? [];
  memberships.push({ membership_id: randomUUID(), budget_space_id: spaceId, account_subject_id: result.accountSubjectId, role: "primary_owner", status: "active" });
  harness.db.tables.set("budget_space_membership", memberships);
  return { harness, cookie: cookie!, subjectId: result.accountSubjectId, sessionRef: result.sessionRef, spaceId };
}

/** begin -> hosted authorize -> chooser -> the step-up callback URL, exactly as a browser would walk it. */
async function stepUpCallbackUrl(context: SignedIn, options: { readonly action?: string; readonly spaceId?: string; readonly scenario?: Parameters<IdentityHarness["callbackFor"]>[0] } = {}) {
  const begun = await context.harness.ceremony.beginStepUp({
    action: options.action ?? ACTION, budgetSpaceId: options.spaceId ?? context.spaceId, postResultDestinationId: "home",
    origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: context.cookie,
  });
  assert.ok(begun.ok, `beginStepUp rejected: ${begun.ok ? "" : begun.reason}`);
  if (!begun.ok) throw new Error("unreachable");
  const authorize = new URL(begun.navigateTo);
  const hosted = context.harness.issuer.authorize(Object.fromEntries(authorize.searchParams.entries()));
  assert.ok(hosted.ok, `authorize rejected: ${hosted.ok ? "" : hosted.error}`);
  if (!hosted.ok) throw new Error("unreachable");
  const callbackUrl = context.harness.issuer.choose(hosted.requestId, options.scenario ?? "subject-a");
  assert.ok(callbackUrl);
  return { callbackUrl: callbackUrl!, challengeId: begun.challengeId, authorize };
}

function deliver(context: SignedIn, callbackUrl: string, overrides: { readonly method?: string; readonly observedOrigin?: string; readonly path?: string } = {}) {
  const url = new URL(callbackUrl);
  return context.harness.ceremony.completeStepUp({
    rawQuery: url.search.slice(1), method: overrides.method ?? "GET",
    observedOrigin: overrides.observedOrigin ?? url.origin, path: overrides.path ?? url.pathname, receiptTime: new Date(),
  });
}

describe("PK4-03: the step_up ceremony reuses the sign-in ceremony and issues no session", () => {
  it("the protected-action set is read from the released policy, not from a second list", () => {
    const actions = protectedActions();
    assert.ok(actions.has(ACTION), "the released policy marks transfer_primary_ownership protected");
    assert.ok(!actions.has("1.view_space"), "an unprotected cell is not step-up-able");
  });

  it("POST /v1/identity/begin refuses step_up by name: a step-up is not a sign-in intent a browser may pick", async () => {
    const harness = buildHarness({ scheduler: null });
    const result = await harness.ceremony.begin({ ceremony: "step_up", postResultDestinationId: "home", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.deepEqual(result, { ok: false, reason: "ceremony_invalid" });
  });

  it("begin refuses without a session, from a foreign origin, for an unprotected action, and for a space the subject is not a member of", async () => {
    const context = await signedIn();
    const begin = (input: Record<string, unknown>) => context.harness.ceremony.beginStepUp({
      action: ACTION, budgetSpaceId: context.spaceId, postResultDestinationId: "home",
      origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: context.cookie, ...input,
    } as Parameters<typeof context.harness.ceremony.beginStepUp>[0]);
    assert.deepEqual(await begin({ sessionCookie: undefined }), { ok: false, reason: "session_required" });
    assert.deepEqual(await begin({ origin: "https://evil.example" }), { ok: false, reason: "origin_rejected" });
    assert.deepEqual(await begin({ secFetchSite: "cross-site" }), { ok: false, reason: "origin_rejected" });
    assert.deepEqual(await begin({ action: "1.view_space" }), { ok: false, reason: "action_not_protected" });
    assert.deepEqual(await begin({ action: 42 }), { ok: false, reason: "action_not_protected" });
    assert.deepEqual(await begin({ budgetSpaceId: randomUUID() }), { ok: false, reason: "space_not_permitted" });
    assert.deepEqual(await begin({ budgetSpaceId: "" }), { ok: false, reason: "space_not_permitted" });
    assert.deepEqual(await begin({ postResultDestinationId: "elsewhere" }), { ok: false, reason: "destination_invalid" });
    assert.equal(rows(context.harness, "account_session_fresh_assurance"), 0, "no rejected begin wrote a grant");
  });

  it("the authorization redirect carries state, an S256 PKCE challenge and a nonce, and names the step-up redirect", async () => {
    const context = await signedIn();
    const { authorize } = await stepUpCallbackUrl(context);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.ok((authorize.searchParams.get("code_challenge") ?? "").length >= 43);
    assert.ok((authorize.searchParams.get("state") ?? "").length >= 43);
    assert.ok((authorize.searchParams.get("nonce") ?? "").length >= 43);
    assert.equal(new URL(authorize.searchParams.get("redirect_uri")!).pathname, IDENTITY_STEP_UP_CALLBACK_PATH);
    assert.notEqual(authorize.searchParams.get("state"), authorize.searchParams.get("nonce"));
  });

  it("a completed step-up issues one grant bound to the requested action and space, and no session, subject or binding", async () => {
    const context = await signedIn();
    const before = { sessions: rows(context.harness, "account_session"), subjects: rows(context.harness, "account_subject"), bindings: rows(context.harness, "identity_binding"), handoffs: rows(context.harness, "identity_session_handoff") };
    const { callbackUrl, challengeId } = await stepUpCallbackUrl(context);
    const result = await deliver(context, callbackUrl);
    assert.equal(result.kind, "success", JSON.stringify(result));
    if (result.kind !== "success") throw new Error("unreachable");
    assert.equal(result.firstDelivery, true);
    assert.equal(result.grant.boundAction, ACTION);
    assert.equal(result.grant.boundSpaceId, context.spaceId);
    assert.equal(result.grant.sessionRef, context.sessionRef);
    assert.equal(result.grant.accountSubjectId, context.subjectId);
    assert.equal(result.grant.challengeId, challengeId);
    assert.equal(result.grant.state, "issued");
    assert.equal(result.grant.expiresAt.getTime() - result.grant.issuedAt.getTime(), 300_000, "the configured five-minute window");
    assert.equal(rows(context.harness, "account_session"), before.sessions, "no session was minted or rotated");
    assert.equal(rows(context.harness, "account_subject"), before.subjects, "no subject was created");
    assert.equal(rows(context.harness, "identity_binding"), before.bindings, "no binding was created");
    assert.equal(rows(context.harness, "identity_session_handoff"), before.handoffs, "a step-up prepares no hand-off of its own; only the earlier sign-in has one");
  });

  it("the grant is write-once: replaying the same callback reports the same grant and creates no second row", async () => {
    const context = await signedIn();
    const { callbackUrl, challengeId } = await stepUpCallbackUrl(context);
    const first = await deliver(context, callbackUrl);
    const second = await deliver(context, callbackUrl);
    assert.equal(first.kind, "success");
    assert.equal(second.kind, "success");
    if (first.kind !== "success" || second.kind !== "success") throw new Error("unreachable");
    assert.equal(second.firstDelivery, false, "the replay did not issue a second grant");
    assert.equal(second.grant.freshAssuranceId, first.grant.freshAssuranceId);
    assert.equal(rows(context.harness, "account_session_fresh_assurance"), 1);
    assert.equal((await context.harness.ceremony.freshAssuranceFor(challengeId))?.freshAssuranceId, first.grant.freshAssuranceId);
  });

  it("a step-up state delivered to the sign-in callback is out of context: the challenge terminates and no grant exists", async () => {
    const context = await signedIn();
    const { callbackUrl } = await stepUpCallbackUrl(context);
    const wrongPath = await context.harness.deliver(callbackUrl);
    assert.equal(wrongPath.kind, "outcome");
    if (wrongPath.kind !== "outcome") throw new Error("unreachable");
    assert.equal(wrongPath.outcome, "invalid_or_expired");
    assert.equal(rows(context.harness, "account_session_fresh_assurance"), 0);
    // The challenge was terminated by that delivery, so the genuine step-up callback no longer completes either.
    const afterwards = await deliver(context, callbackUrl);
    assert.equal(afterwards.kind, "outcome");
  });

  it("the shared callback-context check rejects a wrong method, a wrong path and a foreign observed origin", async () => {
    for (const overrides of [{ method: "POST" }, { path: "/v1/identity/callback" }, { observedOrigin: "https://evil.example" }]) {
      const context = await signedIn();
      const { callbackUrl } = await stepUpCallbackUrl(context);
      const result = await deliver(context, callbackUrl, overrides);
      assert.equal(result.kind, "outcome", JSON.stringify(overrides));
      if (result.kind !== "outcome") throw new Error("unreachable");
      assert.equal(result.outcome, "invalid_or_expired");
      assert.equal(rows(context.harness, "account_session_fresh_assurance"), 0, JSON.stringify(overrides));
    }
  });

  it("a malformed envelope, an unknown state and a provider error all answer with a closed outcome and no grant", async () => {
    const context = await signedIn();
    const { callbackUrl } = await stepUpCallbackUrl(context);
    const url = new URL(callbackUrl);
    const malformed = await context.harness.ceremony.completeStepUp({ rawQuery: "code=only", method: "GET", observedOrigin: url.origin, path: url.pathname, receiptTime: new Date() });
    assert.equal(malformed.kind, "outcome");
    const unknown = await context.harness.ceremony.completeStepUp({ rawQuery: `code=x&state=${randomUUID()}`, method: "GET", observedOrigin: url.origin, path: url.pathname, receiptTime: new Date() });
    assert.equal(unknown.kind, "outcome");

    const cancelled = await signedIn();
    const denied = await stepUpCallbackUrl(cancelled, { scenario: "cancel" });
    const result = await deliver(cancelled, denied.callbackUrl);
    assert.equal(result.kind, "outcome");
    if (result.kind !== "outcome") throw new Error("unreachable");
    assert.equal(result.outcome, "cancelled");
    assert.equal(rows(cancelled.harness, "account_session_fresh_assurance"), 0);
  });

  it("a provider answer for a different person maps no subject and issues no grant", async () => {
    const context = await signedIn();
    const before = { subjects: rows(context.harness, "account_subject"), bindings: rows(context.harness, "identity_binding") };
    const { callbackUrl } = await stepUpCallbackUrl(context, { scenario: "subject-b" });
    const result = await deliver(context, callbackUrl);
    assert.equal(result.kind, "outcome");
    if (result.kind !== "outcome") throw new Error("unreachable");
    assert.equal(result.outcome, "invalid_or_expired");
    assert.equal(rows(context.harness, "account_session_fresh_assurance"), 0, "no grant for another person's authentication");
    assert.equal(rows(context.harness, "account_subject"), before.subjects, "the unknown provider subject was not mapped to a new subject");
    assert.equal(rows(context.harness, "identity_binding"), before.bindings, "no binding was created");
    assert.ok(context.harness.runtime.evidence.some((event) => event.class === "step_up_subject_mismatch"));
  });

  it("a rejected token (nonce mismatch, bad signature, wrong issuer, expired) issues no grant", async () => {
    for (const scenario of ["nonce-mismatch", "bad-signature", "wrong-issuer", "expired-token"] as const) {
      const context = await signedIn();
      const { callbackUrl } = await stepUpCallbackUrl(context, { scenario });
      const result = await deliver(context, callbackUrl);
      assert.equal(result.kind, "outcome", scenario);
      assert.equal(rows(context.harness, "account_session_fresh_assurance"), 0, scenario);
    }
  });

  it("a session revoked between begin and the callback collects no grant", async () => {
    const context = await signedIn();
    const { callbackUrl } = await stepUpCallbackUrl(context);
    const sessions = context.harness.db.tables.get("account_session") ?? [];
    for (const row of sessions) if (row.session_ref === context.sessionRef) { row.state = "revoked"; row.revocation_cause = "logout"; }
    const result = await deliver(context, callbackUrl);
    assert.equal(result.kind, "outcome");
    if (result.kind !== "outcome") throw new Error("unreachable");
    assert.equal(result.outcome, "invalid_or_expired");
    assert.equal(rows(context.harness, "account_session_fresh_assurance"), 0);
  });

  it("a second step-up for the same action and space does not replace the first grant", async () => {
    // The "one live grant per session, action and space" rule is a partial
    // unique index, which the in-memory double cannot express; the live proof
    // (fresh-assurance.live.test.ts) is where the index itself is exercised.
    // What this case pins here is the application half: a second ceremony
    // never rewrites, re-points or extends the grant the first one issued.
    const context = await signedIn();
    const first = await stepUpCallbackUrl(context);
    const issued = await deliver(context, first.callbackUrl);
    assert.equal(issued.kind, "success");
    if (issued.kind !== "success") throw new Error("unreachable");
    const second = await stepUpCallbackUrl(context);
    await deliver(context, second.callbackUrl);
    const original = await context.harness.ceremony.freshAssuranceFor(first.challengeId);
    assert.equal(original?.freshAssuranceId, issued.grant.freshAssuranceId);
    assert.equal(original?.expiresAt.getTime(), issued.grant.expiresAt.getTime());
    assert.equal(original?.boundAction, ACTION);
    assert.equal(original?.state, "issued");
  });
});
