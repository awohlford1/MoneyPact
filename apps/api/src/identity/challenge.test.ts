/**
 * PROTO-IDENTITY-API-001 correction C4 (review R04 / security S04): an
 * abandoned pending challenge (no callback ever arrives) must not exhaust
 * capacity forever. This reproduces the review's exact capacity-one
 * repro: issue a one-second challenge, advance the clock well past its
 * deadline without ever calling `take`/`terminate`, and confirm a fresh
 * `issue()` recovers the slot instead of throwing `ChallengeStoreFullError`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChallengeStore } from "./challenge.ts";

const BASE_INPUT = {
  environmentId: "test",
  ceremony: "sign_in" as const,
  initiatingOrigin: "http://localhost:3000",
  callbackUri: "http://localhost:3000/v1/identity/callback",
  postResultDestinationId: "home",
  lifetimeSeconds: 1,
};

describe("PROTO-IDENTITY-API-001 C4: abandoned pending challenges recover capacity", () => {
  it("PROTO-IDENTITY-API-001 C4 (closing test): a fresh issue succeeds once the abandoned challenge's grace window has elapsed", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = new ChallengeStore(() => now, 1);
    const first = store.issue(BASE_INPUT);
    now = new Date(now.getTime() + 120_000); // past both the 1s lifetime and the 60s tombstone grace.
    const second = store.issue(BASE_INPUT);
    assert.equal(store.size, 1, "the abandoned slot was reclaimed, not merely tolerated over capacity");
    assert.notEqual(second.record.challengeId, first.record.challengeId);
    // The stale state is now unknown (forgotten), consistent with an ordinary expired/replayed input (§7).
    assert.equal(store.find(first.state), undefined);
  });

  it("a replay of the abandoned challenge's known state still terminates cleanly inside the tombstone grace window", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = new ChallengeStore(() => now, 10);
    const issued = store.issue(BASE_INPUT);
    now = new Date(now.getTime() + 2_000); // past the 1s lifetime, inside the 60s tombstone grace.
    store.issue(BASE_INPUT); // triggers a sweep that expires (but does not yet forget) the abandoned record.
    const known = store.find(issued.state);
    assert.ok(known, "the tombstone is still resolvable for replay classification within the grace window");
    assert.equal(known.status, "terminated");
    assert.equal(store.take(issued.state), undefined, "a terminated challenge is never consumable");
  });
});
