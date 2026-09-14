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

  it("PROTO-IDENTITY-API-001 RC-04: find() alone expires a due pending challenge and zeroes its verifier, with no other traffic at all", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = new ChallengeStore(() => now, 10);
    const issued = store.issue(BASE_INPUT);
    now = new Date(now.getTime() + 120_000); // well past the 1s lifetime; no second issue(), no take(), no terminate().
    // Before RC-04, this find() alone left the record "pending" forever, still holding its verifier.
    const found = store.find(issued.state);
    assert.ok(found, "still resolvable as a tombstone within the 60s grace window");
    assert.equal(found.status, "terminated", "find() expired the due pending record in place");
    assert.equal(store.take(issued.state), undefined, "the verifier is gone: an expired challenge is never consumable, even immediately after find()");
  });

  it("PROTO-IDENTITY-API-001 RC-04: findByChallengeId() alone expires a due pending challenge the same way", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = new ChallengeStore(() => now, 10);
    const issued = store.issue(BASE_INPUT);
    now = new Date(now.getTime() + 120_000);
    const found = store.findByChallengeId(issued.record.challengeId);
    assert.ok(found);
    assert.equal(found.status, "terminated");
  });
});

describe("PROTO-ACTIVATION-001 A9 (RC-04): expiry is owned by the deadline, not by later traffic", () => {
  it("an idle pending challenge is terminated and its verifier zeroed by the deadline timer with no access of any kind", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const timers: { run: () => void; delayMs: number }[] = [];
    const store = new ChallengeStore(() => now, 10, (run, delayMs) => { timers.push({ run, delayMs }); return setTimeout(() => undefined, 0); });
    const issued = store.issue(BASE_INPUT);
    assert.equal(timers.length, 1, "issuing armed one deadline timer");
    assert.equal(timers[0]!.delayMs, 1_000, "armed for the challenge's own deadline");
    now = new Date(now.getTime() + 1_000);
    timers[0]!.run(); // the deadline fires: nothing else has touched the store.
    assert.equal(issued.record.status, "terminated", "the deadline terminated the idle challenge without any find/take/issue");
    assert.equal(store.take(issued.state), undefined, "the verifier is gone: nothing can consume it after the deadline");
    assert.equal(store.findByChallengeId(issued.record.challengeId)?.status, "terminated");
    assert.equal(timers.length, 2, "the sweep re-armed for the tombstone grace deadline");
    now = new Date(now.getTime() + 60_000);
    timers[1]!.run();
    assert.equal(store.size, 0, "the tombstone slot was reclaimed at its grace deadline");
    assert.equal(store.find(issued.state), undefined);
    store.stop();
  });

  it("the default scheduler arms a real unref'd timer that fires without traffic", async () => {
    let now = new Date();
    const store = new ChallengeStore(() => now, 10);
    const issued = store.issue({ ...BASE_INPUT, lifetimeSeconds: 1 });
    // Deadline clocks are the store's `now`; move it past the deadline and let the (real, 1 s) timer fire.
    now = new Date(now.getTime() + 2_000);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.equal(issued.record.status, "terminated", "the real timer expired the idle challenge");
    assert.equal(store.take(issued.state), undefined);
    store.stop();
  });
});
