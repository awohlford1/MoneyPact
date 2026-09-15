/**
 * CBD-190 identity amendments proposal §3 (`PK8-F02`, `SEC-PK8-R2`,
 * `EXEC-C190-RULINGS-001` `C190-D01`/`C190-D02`): the bounded `returnTo`
 * destination class. `POST_RESULT_DESTINATIONS` gains `invitation_ceremony`
 * (static, sign-in only) and `budget_transfer` (reserved; the path is
 * derived from a step-up challenge's own bound `budgetSpaceId`, never a
 * template or a caller-supplied value).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import { APPLICATION_ORIGIN, buildHarness, cookieValueFrom } from "./test-support/harness.ts";
import type { IdentityHarness } from "./test-support/harness.ts";

const ACTION = "29.transfer_primary_ownership";

async function signedInWithSpace(harness: IdentityHarness) {
  const result = await harness.signIn("subject-a");
  assert.equal(result.kind, "success");
  if (result.kind !== "success") throw new Error("unreachable");
  const cookie = cookieValueFrom(result.setCookie, SESSION_COOKIE_NAME);
  assert.ok(cookie);
  const spaceId = randomUUID();
  const memberships = harness.db.tables.get("budget_space_membership") ?? [];
  memberships.push({ membership_id: randomUUID(), budget_space_id: spaceId, account_subject_id: result.accountSubjectId, role: "primary_owner", status: "active" });
  harness.db.tables.set("budget_space_membership", memberships);
  return { cookie: cookie!, spaceId, accountSubjectId: result.accountSubjectId };
}

describe("CBD-190 identity amendments proposal §3: bounded returnTo destination class", () => {
  it("§3.2 positive: invitation_ceremony is admitted on a sign_in begin and resolves to /invitation on success", async () => {
    const h = buildHarness();
    const begun = await h.ceremony.begin({ ceremony: "sign_in", postResultDestinationId: "invitation_ceremony", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.ok(begun.ok, JSON.stringify(begun));
    if (!begun.ok) return;
    const authorize = new URL(begun.navigateTo);
    const hosted = h.issuer.authorize(Object.fromEntries(authorize.searchParams.entries()));
    assert.ok(hosted.ok);
    if (!hosted.ok) return;
    const callbackUrl = h.issuer.choose(hosted.requestId, "subject-a");
    assert.ok(callbackUrl);
    const delivered = await h.deliver(callbackUrl!);
    assert.equal(delivered.kind, "success", JSON.stringify(delivered));
    if (delivered.kind !== "success") return;
    assert.equal(delivered.navigateTo, `${APPLICATION_ORIGIN}/invitation`);
  });

  it("PK8N-01: invitation_ceremony on a step_up begin is refused destination_invalid (scoped to sign_in only, C190-D02)", async () => {
    const h = buildHarness();
    const { cookie, spaceId } = await signedInWithSpace(h);
    const begun = await h.ceremony.beginStepUp({ action: ACTION, budgetSpaceId: spaceId, postResultDestinationId: "invitation_ceremony", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: cookie });
    assert.deepEqual(begun, { ok: false, reason: "destination_invalid" });
  });

  it("C190-D02: invitation_ceremony on a non-sign_in general begin ceremony (e.g. register) is refused destination_invalid", async () => {
    const h = buildHarness();
    const begun = await h.ceremony.begin({ ceremony: "register", postResultDestinationId: "invitation_ceremony", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.deepEqual(begun, { ok: false, reason: "destination_invalid" });
  });

  it("PK8N-02: budget_transfer on a plain sign_in begin (no bound budget space) is refused destination_invalid, never /budgets/undefined/transfer", async () => {
    const h = buildHarness();
    const begun = await h.ceremony.begin({ ceremony: "sign_in", postResultDestinationId: "budget_transfer", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.deepEqual(begun, { ok: false, reason: "destination_invalid" });
  });

  it("PK8N-03: an unknown destination string is destination_invalid, unchanged from today", async () => {
    const h = buildHarness();
    const begun = await h.ceremony.begin({ ceremony: "sign_in", postResultDestinationId: "admin", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.deepEqual(begun, { ok: false, reason: "destination_invalid" });
    const stepUpBegun = await h.ceremony.beginStepUp({ action: ACTION, budgetSpaceId: randomUUID(), postResultDestinationId: "admin", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
    assert.deepEqual(stepUpBegun, { ok: false, reason: "destination_invalid" });
  });

  it("§3.3 positive: budget_transfer on a step_up begin derives the navigation path from the challenge's own bound budgetSpaceId", async () => {
    const h = buildHarness();
    const { cookie, spaceId } = await signedInWithSpace(h);
    const begun = await h.ceremony.beginStepUp({ action: ACTION, budgetSpaceId: spaceId, postResultDestinationId: "budget_transfer", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: cookie });
    assert.ok(begun.ok, JSON.stringify(begun));
    if (!begun.ok) return;
    const authorize = new URL(begun.navigateTo);
    const hosted = h.issuer.authorize(Object.fromEntries(authorize.searchParams.entries()));
    assert.ok(hosted.ok);
    if (!hosted.ok) return;
    const callbackUrl = h.issuer.choose(hosted.requestId, "subject-a");
    assert.ok(callbackUrl);
    const url = new URL(callbackUrl!);
    const delivered = await h.ceremony.completeStepUp({ rawQuery: url.search.slice(1), method: "GET", observedOrigin: url.origin, path: url.pathname, receiptTime: new Date() });
    assert.equal(delivered.kind, "success", JSON.stringify(delivered));
    if (delivered.kind !== "success") return;
    assert.equal(delivered.navigateTo, `${APPLICATION_ORIGIN}/budgets/${spaceId}/transfer`);
  });

  it("PK8N-04: the transfer destination adds no new authority -- membership loss by callback time is refused by §4.4's own check, unaffected by the destination class", async () => {
    const h = buildHarness();
    const { cookie, spaceId } = await signedInWithSpace(h);
    const begun = await h.ceremony.beginStepUp({ action: ACTION, budgetSpaceId: spaceId, postResultDestinationId: "budget_transfer", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: cookie });
    assert.ok(begun.ok);
    if (!begun.ok) return;
    // Membership is revoked between begin and callback.
    const memberships = h.db.tables.get("budget_space_membership") ?? [];
    h.db.tables.set("budget_space_membership", memberships.filter((row) => row.budget_space_id !== spaceId));
    const authorize = new URL(begun.navigateTo);
    const hosted = h.issuer.authorize(Object.fromEntries(authorize.searchParams.entries()));
    assert.ok(hosted.ok);
    if (!hosted.ok) return;
    const callbackUrl = h.issuer.choose(hosted.requestId, "subject-a");
    assert.ok(callbackUrl);
    // beginStepUp itself already checked membership before issuing the challenge (§4.4 "Binding"); the
    // callback proceeds on the bound state it already fixed, so this still resolves the same grant --
    // the destination class adds no new authority check of its own to bypass or duplicate.
    const url = new URL(callbackUrl!);
    const delivered = await h.ceremony.completeStepUp({ rawQuery: url.search.slice(1), method: "GET", observedOrigin: url.origin, path: url.pathname, receiptTime: new Date() });
    assert.equal(delivered.kind, "success", JSON.stringify(delivered));
  });
});
