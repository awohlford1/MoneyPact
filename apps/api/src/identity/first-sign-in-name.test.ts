/**
 * CBD-190 identity amendments proposal §2 (`P6-F01`, `EXEC-C190-RULINGS-001`
 * `C190-D03`): the first-sign-in `financial_profile.display_name` write.
 *
 * Every case here drives the real `IdentityCeremony`/local adapter through
 * `buildHarness()` (in-memory data-access double) exactly as `ceremony.test.ts`
 * does, so the claim travels the real `token.ts` -> `exchange.ts` ->
 * `mapping.ts` -> `store.ts` path -- nothing here constructs
 * `ValidatedIdentityClaims` or `VerifiedIdentityResultV1` directly.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHarness } from "./test-support/harness.ts";
import type { IdentityHarness } from "./test-support/harness.ts";

function displayNameFor(h: IdentityHarness, accountSubjectId: string): string | null {
  const row = h.db.rows("financial_profile").find((candidate) => candidate.account_subject_id === accountSubjectId);
  assert.ok(row, "the first-use branch always inserts a financial_profile row");
  return (row!.display_name as string | null | undefined) ?? null;
}

describe("CBD-190 identity amendments proposal §2: first-sign-in display-name write", () => {
  it("C190-N01: name claim present (the local chooser's fixture value) -> display_name is that value, trimmed, on first use only", async () => {
    const h = buildHarness();
    const result = await h.signIn("subject-a");
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(displayNameFor(h, result.accountSubjectId), "Ada A. Local", "leading/trailing whitespace trimmed (§2.2)");
    assert.equal(h.db.count("financial_profile"), 1, "one profile row, written in the same insert as the subject (CBD190-PROFILE-ATOMIC-001)");
  });

  it("C190-N02: name claim absent (no chooser value, the production/Cognito shape) -> display_name is NULL, exactly as today", async () => {
    const h = buildHarness();
    const result = await h.signIn("subject-b");
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(displayNameFor(h, result.accountSubjectId), null);
  });

  it("C190-N03: name claim present but 0 code points after trim -> treated as absent, NULL, never a ceremony failure", async () => {
    const h = buildHarness();
    const result = await h.signIn("name-blank");
    assert.equal(result.kind, "success", JSON.stringify(result));
    if (result.kind !== "success") return;
    assert.equal(displayNameFor(h, result.accountSubjectId), null);
  });

  it("C190-N03: name claim present but over 80 code points after trim -> treated as absent, NULL, never a ceremony failure", async () => {
    const h = buildHarness();
    const result = await h.signIn("name-oversized");
    assert.equal(result.kind, "success", JSON.stringify(result));
    if (result.kind !== "success") return;
    assert.equal(displayNameFor(h, result.accountSubjectId), null);
  });

  it("C190-N04/N05: a later sign-in with a different name never overwrites the value the first sign-in wrote", async () => {
    const h = buildHarness();
    const first = await h.signIn("subject-a");
    assert.equal(first.kind, "success");
    if (first.kind !== "success") return;
    assert.equal(displayNameFor(h, first.accountSubjectId), "Ada A. Local");
    // Same immutable provider `sub` as subject-a, a different valid name claim: the mapping resolves the
    // *existing* binding (mapping.ts's `else` branch), which never calls the display-name write.
    const second = await h.signIn("subject-a-second-name");
    assert.equal(second.kind, "success", JSON.stringify(second));
    if (second.kind !== "success") return;
    assert.equal(second.accountSubjectId, first.accountSubjectId, "the same subject resolves both times");
    assert.equal(displayNameFor(h, second.accountSubjectId), "Ada A. Local", "the second sign-in's different name claim never overwrote the first");
    assert.equal(h.db.count("financial_profile"), 1, "still exactly one profile row, no second write of any kind");
  });

  it("C190-D03: account_switch resolving a brand-new subject writes that subject's own name claim through the same first-use branch", async () => {
    const h = buildHarness();
    const first = await h.signIn("subject-a");
    assert.equal(first.kind, "success");
    if (first.kind !== "success") return;
    const { cookieValueFrom } = await import("./test-support/harness.ts");
    const { SESSION_COOKIE_NAME } = await import("@cobudget/sessions");
    const cookie = cookieValueFrom(first.setCookie, SESSION_COOKIE_NAME);
    assert.ok(cookie);
    const switched = await h.signIn("subject-b", "account_switch", cookie);
    assert.equal(switched.kind, "success", JSON.stringify(switched));
    if (switched.kind !== "success") return;
    assert.notEqual(switched.accountSubjectId, first.accountSubjectId, "account_switch resolved a different, brand-new subject");
    // subject-b's own scenario carries no name claim (C190-N02 shape) -- proving this is the *same*
    // first-use branch sign_in uses, not a second, account_switch-specific code path.
    assert.equal(displayNameFor(h, switched.accountSubjectId), null);
  });

  it("the raw claim value never reaches restricted evidence or reliability telemetry", async () => {
    const h = buildHarness();
    const result = await h.signIn("subject-a");
    assert.equal(result.kind, "success");
    const sink = JSON.stringify({ events: h.events, evidence: h.runtime.evidence });
    assert.ok(!sink.includes("Ada A. Local"), "§2.5: the name claim is never logged, not even in coarse evidence");
  });
});
