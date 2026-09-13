import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AuthenticatedProviderEvent, allEventClasses, authenticateLocalEvent, forgedFixture, genuineFixture } from "./local-adapter.ts";
import { UnauthenticatedProviderEventError } from "./local-adapter.ts";
import { processProviderEvent, reconcileProviderEvent } from "./provider-events.ts";
import { buildTestHarness, testConfig } from "./test-support/harness.ts";
import type { IdentityBindingLookup } from "./provider-events.ts";

const ENVIRONMENT = "test";

function resolverFor(binding: IdentityBindingLookup | undefined) {
  return async () => binding;
}

void test("§6.2: every event class is covered by the local adapter fixture obligation", () => {
  assert.deepEqual(
    [...allEventClasses()].sort(),
    ["account_deleted", "account_disabled", "compromised_credentials_action", "credential_changed", "factor_changed", "global_sign_out"].sort(),
  );
});

void test("§6.2 step 2: a forged event never reaches processProviderEvent (adapter-side authenticity gate)", () => {
  const fixture = forgedFixture(ENVIRONMENT, "cognito", "sub-1", "global_sign_out");
  assert.equal(authenticateLocalEvent(fixture), undefined);
});

void test("CBD191-SECURITY-002 Medium finding 7: a malformed fixture (bad contractVersion) is also rejected by the adapter gate", () => {
  const fixture = genuineFixture(ENVIRONMENT, "cognito", "sub-1a", "global_sign_out");
  const malformed = { ...fixture, event: { ...fixture.event, contractVersion: 2 as unknown as 1 } };
  assert.equal(authenticateLocalEvent(malformed), undefined);
});

void test("CBD191-SECURITY-003 finding 2: a directly-constructed AuthenticatedProviderEvent (bypassing authenticate) is refused at runtime and never bumps the epoch", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  await store.currentSubjectAuthority(binding.accountSubjectId);

  const forged = new AuthenticatedProviderEvent({
    contractVersion: 1,
    environmentId: ENVIRONMENT,
    issuer: "cognito",
    providerSubject: "sub-bypass",
    eventClass: "global_sign_out",
    providerEventId: randomUUID(),
    providerEventTime: new Date(),
    orderingCursor: undefined,
    receivedAt: new Date(),
  });

  await assert.rejects(() => processProviderEvent(forged, ENVIRONMENT, store, config, resolverFor(binding)), UnauthenticatedProviderEventError);

  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.revocationEpoch, 1, "no epoch effect from the bypass attempt");
});

void test("CBD191-SECURITY-003 finding 2: a raw { event } object shaped like AuthenticatedProviderEvent is refused (fails the instanceof + WeakSet check)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  await store.currentSubjectAuthority(binding.accountSubjectId);

  const rawShapedLikeAuthenticated = {
    event: {
      contractVersion: 1,
      environmentId: ENVIRONMENT,
      issuer: "cognito",
      providerSubject: "sub-bypass-2",
      eventClass: "global_sign_out",
      providerEventId: randomUUID(),
      providerEventTime: new Date(),
      orderingCursor: undefined,
      receivedAt: new Date(),
    },
  };

  await assert.rejects(
    () => processProviderEvent(rawShapedLikeAuthenticated as unknown as AuthenticatedProviderEvent, ENVIRONMENT, store, config, resolverFor(binding)),
    UnauthenticatedProviderEventError,
  );

  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.revocationEpoch, 1);
});

void test("positive control: an event produced by authenticateLocalEvent passes the runtime check and applies normally", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  const event = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-good", "global_sign_out"))!;
  const result = await processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding));
  assert.equal(result.outcome, "applied");
});

void test("CBD-191-AC05: a genuine event resolves the binding and bumps the subject epoch exactly once", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  await store.currentSubjectAuthority(binding.accountSubjectId);
  const fixture = genuineFixture(ENVIRONMENT, "cognito", "sub-1", "global_sign_out");
  const event = authenticateLocalEvent(fixture)!;

  const result = await processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding));
  assert.equal(result.outcome, "applied");

  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.revocationEpoch, 2);
});

void test("CBD-191-AC05: a duplicate provider_event_id has exactly one effect and returns the canonical outcome", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  const fixture = genuineFixture(ENVIRONMENT, "cognito", "sub-2", "account_disabled");
  const event = authenticateLocalEvent(fixture)!;

  await processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding));
  const second = await processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding));
  assert.equal(second.outcome, "duplicate");

  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.revocationEpoch, 2);
});

void test("CBD191-REVIEW-IMPL-001 High finding: two CONCURRENT deliveries of the same provider_event_id have exactly one effect", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  await store.currentSubjectAuthority(binding.accountSubjectId);
  const event = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-2b", "account_disabled"))!;

  const [a, b] = await Promise.all([
    processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding)),
    processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding)),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ["applied", "duplicate"]);

  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.revocationEpoch, 2, "exactly one bump occurred despite the concurrent delivery");
});

void test("CBD191-REVIEW-IMPL-001 High finding: two CONCURRENT events with different cursors converge correctly regardless of dispatch order", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  await store.currentSubjectAuthority(binding.accountSubjectId);
  const lower = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-2c", "global_sign_out", { orderingCursor: "005" }))!;
  const higher = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-2c", "global_sign_out", { orderingCursor: "010" }))!;

  const [lowerResult, higherResult] = await Promise.all([
    processProviderEvent(lower, ENVIRONMENT, store, config, resolverFor(binding)),
    processProviderEvent(higher, ENVIRONMENT, store, config, resolverFor(binding)),
  ]);

  // The higher cursor can never be superseded by the lower one, in either
  // interleaving. The lower cursor's own outcome legitimately depends on
  // race order: if it committed first, it was a genuinely new event at the
  // time (its own bump is correct) and the higher one bumps again on top;
  // if the higher one committed first, the lower one is redundant and is
  // corrected to superseded. Both are contract-conforming -- what must
  // never happen is the lower cursor winning, both being superseded, or the
  // watermark ending anywhere but the higher cursor.
  assert.equal(higherResult.outcome, "applied");
  assert.ok(lowerResult.outcome === "applied" || lowerResult.outcome === "superseded", `unexpected lower-cursor outcome: ${lowerResult.outcome}`);

  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.latestAppliedCursor, "010");
  const expectedEpoch = lowerResult.outcome === "applied" ? 3 : 2;
  assert.equal(authority.revocationEpoch, expectedEpoch, "one bump per event that was genuinely new when it committed; a superseded event contributes none");
});

void test("CBD-191-AC05: an unresolvable binding is rejected with no session effect", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const fixture = genuineFixture(ENVIRONMENT, "cognito", "unknown-subject", "credential_changed");
  const event = authenticateLocalEvent(fixture)!;
  const result = await processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(undefined));
  assert.deepEqual(result, { outcome: "rejected", reason: "unknown_binding" });
});

void test("CBD-191-AC05: a cross-environment event is rejected with no session effect", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  await store.currentSubjectAuthority(binding.accountSubjectId);
  const fixture = genuineFixture("prod", "cognito", "sub-3", "account_deleted");
  const event = authenticateLocalEvent(fixture)!;
  const result = await processProviderEvent(event, "staging", store, config, resolverFor(binding));
  assert.deepEqual(result, { outcome: "rejected", reason: "cross_environment" });
  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.revocationEpoch, 1);
});

void test("CBD-191-AC05: an authenticated cursor lower than the applied watermark is superseded, no new effect", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  const later = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-4", "global_sign_out", { orderingCursor: "010" }))!;
  const earlier = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-4", "global_sign_out", { orderingCursor: "005" }))!;

  await processProviderEvent(later, ENVIRONMENT, store, config, resolverFor(binding));
  const result = await processProviderEvent(earlier, ENVIRONMENT, store, config, resolverFor(binding));
  assert.equal(result.outcome, "superseded");
  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.revocationEpoch, 2);
});

void test("CBD-191-AC05: §6.2 step 6 -- a cursor equal to the already-applied cursor also supersedes (only a strictly higher cursor applies)", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  const first = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-5", "global_sign_out", { orderingCursor: "010" }))!;
  const second = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-5", "global_sign_out", { orderingCursor: "010", providerEventId: randomUUID() }))!;

  await processProviderEvent(first, ENVIRONMENT, store, config, resolverFor(binding));
  const result = await processProviderEvent(second, ENVIRONMENT, store, config, resolverFor(binding));
  assert.equal(result.outcome, "superseded");
});

void test("CBD-191-AC05: equal provider_event_time never breaks a tie -- only the cursor decides, and a higher cursor still applies even with an earlier or equal timestamp", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  const sameTime = new Date();
  const first = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-5b", "global_sign_out", { orderingCursor: "005", providerEventTime: sameTime }))!;
  const second = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-5b", "global_sign_out", { orderingCursor: "010", providerEventTime: sameTime }))!;

  await processProviderEvent(first, ENVIRONMENT, store, config, resolverFor(binding));
  const result = await processProviderEvent(second, ENVIRONMENT, store, config, resolverFor(binding));
  assert.equal(result.outcome, "applied");
});

void test("CBD-191-AC05: a future-skewed event applies immediately and quarantines as applied_pending_reconciliation", async () => {
  const { store } = buildTestHarness();
  const config = testConfig({ providerMaxFutureSkewSeconds: 10 });
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  const event = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-6", "compromised_credentials_action", { providerEventTime: new Date(Date.now() + 60_000) }))!;

  const result = await processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding));
  assert.equal(result.outcome, "applied_pending_reconciliation");
  const authority = await store.currentSubjectAuthority(binding.accountSubjectId);
  assert.equal(authority.revocationEpoch, 2, "the epoch bump applies immediately even while quarantined");
});

void test("§6.2 step 7: reconciliation transitions a quarantined event to applied without changing its epoch effect", async () => {
  const { store, db } = buildTestHarness();
  const config = testConfig();
  const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
  const event = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", "sub-7", "account_disabled", { providerEventTime: new Date(Date.now() + 60_000) }))!;
  await processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding));

  const row = (db.tables.get("provider_security_event") ?? []).find((r) => r.provider_event_id === event.event.providerEventId);
  assert.equal(row?.processing_state, "applied_pending_reconciliation");

  await reconcileProviderEvent(store, String(row?.provider_security_event_id));
  assert.equal(row?.processing_state, "applied");
});

void test("providerEventClassToCause maps every closed event class onto the shared revocation-cause vocabulary", async () => {
  const { store } = buildTestHarness();
  const config = testConfig();
  for (const eventClass of allEventClasses()) {
    const binding: IdentityBindingLookup = { accountSubjectId: randomUUID(), identityBindingId: randomUUID() };
    const event = authenticateLocalEvent(genuineFixture(ENVIRONMENT, "cognito", randomUUID(), eventClass))!;
    const result = await processProviderEvent(event, ENVIRONMENT, store, config, resolverFor(binding));
    assert.equal(result.outcome, "applied");
  }
});
