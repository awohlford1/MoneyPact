import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDependencyFingerprint, createOrRegenerateProposal, readProposal } from "./application.ts";
import { isoDate } from "./date.ts";
import { InMemoryProposalStore } from "./in-memory-store.ts";
import { validateCreateProposalRequest } from "./normalize.ts";
import { localMidnightInstant } from "./time-zone.ts";
import { FakeClock, FakeCurrencyContextReader, SequentialIdGenerator, testAuthContext, testPorts } from "./support.ts";
import type { BudgetCreationProposalStore, ProposalContextKey } from "./ports.ts";

const BODY = {
  name: "Groceries",
  timeZone: "America/New_York",
  currencyCode: "USD",
  schedule: { cadence: "weekly", anchor: "monday" },
};
const request = (context = testAuthContext(), key = "correction-key-0001") => ({
  subjectContext: context, idempotencyKeyHeader: key, body: BODY,
});
function contextKey(context: ReturnType<typeof testAuthContext>, proposalId: string): ProposalContextKey {
  return { ...context, proposalId };
}

describe("CBD-232-AC01: corrected canonical validation", () => {
  it("uses required codes for missing time zone and currency", () => {
    const result = validateCreateProposalRequest("validation-key-01", {
      name: BODY.name, schedule: BODY.schedule,
    }, { currencyContextReader: new FakeCurrencyContextReader(), subjectContext: testAuthContext() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.fieldErrors.map(({ code, path }) => ({ code, path })), [
      { code: "time-zone.required", path: "timeZone" },
      { code: "currency.required", path: "currencyCode" },
    ]);
  });

  it("reports schedule unknown fields alongside an invalid cadence", () => {
    const result = validateCreateProposalRequest("validation-key-02", {
      ...BODY, schedule: { cadence: "bogus", evil: true },
    }, { currencyContextReader: new FakeCurrencyContextReader(), subjectContext: testAuthContext() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.fieldErrors.map(({ code, path }) => ({ code, path })), [
      { code: "cadence.unsupported", path: "schedule.cadence" },
      { code: "input.unknown-field", path: "schedule.evil" },
    ]);
  });

  it("reports pattern unknown fields alongside an invalid paycheck pattern", () => {
    const result = validateCreateProposalRequest("validation-key-03", {
      ...BODY,
      schedule: { cadence: "paycheck", pattern: { kind: "bogus", evil: true },
        businessDayPolicy: "previous-business-day" },
    }, { currencyContextReader: new FakeCurrencyContextReader(), subjectContext: testAuthContext() });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const pairs = result.fieldErrors.map(({ code, path }) => ({ code, path }));
      assert.ok(pairs.some((value) => value.code === "paycheck.unsupported-pattern" && value.path === "schedule.pattern.kind"));
      assert.ok(pairs.some((value) => value.code === "input.unknown-field" && value.path === "schedule.pattern.evil"));
    }
  });

  it("preserves canonical schedule codes and prefixes their exact paths", () => {
    const cases: readonly [unknown, string, string][] = [
      [{ cadence: "weekly", anchor: 3 }, "field.expected-string", "schedule.anchor"],
      [{ cadence: "weekly", anchor: "funday" }, "weekday.unsupported", "schedule.anchor"],
      [{ cadence: "monthly", anchor: "last" }, "field.expected-object", "schedule.anchor"],
      [{ cadence: "monthly", anchor: { kind: "first" } }, "monthly-anchor.unsupported-kind", "schedule.anchor.kind"],
      [{ cadence: "monthly", anchor: { kind: "day-of-month", day: 2.5 } }, "monthly-anchor.not-an-integer", "schedule.anchor.day"],
      [{ cadence: "monthly", anchor: { kind: "day-of-month", day: 40 } }, "monthly-anchor.out-of-range", "schedule.anchor.day"],
      [{ cadence: "paycheck", pattern: { kind: "twice-per-week", weekdays: ["monday"] },
        businessDayPolicy: "previous-business-day" }, "field.expected-pair", "schedule.pattern.weekdays"],
      [{ cadence: "paycheck", pattern: { kind: "twice-per-week", weekdays: ["monday", "monday"] },
        businessDayPolicy: "previous-business-day" }, "paycheck.duplicate-weekday", "schedule.pattern.weekdays"],
      [{ cadence: "paycheck", pattern: { kind: "twice-per-month", anchors: [
        { kind: "day-of-month", day: 15 }, { kind: "day-of-month", day: 15 }] },
        businessDayPolicy: "previous-business-day" }, "paycheck.duplicate-monthly-anchor", "schedule.pattern.anchors"],
      [{ cadence: "paycheck", pattern: { kind: "every-two-weeks", weekday: "friday",
        recurrenceOrigin: "2026-01-01" }, businessDayPolicy: "previous-business-day" },
        "paycheck.origin-weekday-mismatch", "schedule.pattern.recurrenceOrigin"],
      [{ cadence: "paycheck", pattern: { kind: "custom-weekly-interval", weekday: "monday",
        recurrenceOrigin: "2026-01-05", everyWeeks: 5 }, businessDayPolicy: "previous-business-day" },
        "paycheck.interval-out-of-range", "schedule.pattern.everyWeeks"],
      [{ cadence: "paycheck", pattern: { kind: "weekly", weekday: "friday" },
        businessDayPolicy: "nearest" }, "business-day-policy.unsupported", "schedule.businessDayPolicy"],
      [{ cadence: "custom-fixed-length", startBoundary: "bad", lengthInDays: 10 },
        "field.expected-calendar-date", "schedule.startBoundary"],
      [{ cadence: "custom-fixed-length", startBoundary: "2026-01-01", lengthInDays: 1.5 },
        "custom.length-not-an-integer", "schedule.lengthInDays"],
      [{ cadence: "custom-fixed-length", startBoundary: "2026-01-01", lengthInDays: 367 },
        "custom.length-out-of-range", "schedule.lengthInDays"],
    ];
    for (const [schedule, code, path] of cases) {
      const result = validateCreateProposalRequest("schedule-code-key", { ...BODY, schedule }, {
        currencyContextReader: new FakeCurrencyContextReader(), subjectContext: testAuthContext(),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.fieldErrors.some((error) => error.code === code && error.path === path), `${code} at ${path}`);
    }
  });
});

describe("CBD-232-AC05: complete dependency freshness", () => {
  it("stales a proposal when currency compatibility changes without a catalog-version change", async () => {
    const ports = testPorts();
    const created = await createOrRegenerateProposal(request(), ports);
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    const changed = { ...ports, currencyContextReader: new FakeCurrencyContextReader({ incompatibleCode: "USD" }) };
    const read = await readProposal(contextKey(testAuthContext(), created.response.proposalId), changed);
    assert.equal(read.kind, "found");
    if (read.kind === "found") assert.deepEqual(read.response.lifecycle, {
      status: "invalidated", reason: "dependency_changed", regenerateRequired: true,
    });
  });

  it("stales a proposal for time-zone-data and constraint version changes", async () => {
    let constraintVersion = "constraint-1";
    const ports = testPorts({ constraintReader: { currentConstraintVersion: () => constraintVersion } });
    const created = await createOrRegenerateProposal(request(), ports);
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    constraintVersion = "constraint-2";
    let read = await readProposal(contextKey(testAuthContext(), created.response.proposalId), ports);
    assert.equal(read.kind === "found" && read.response.lifecycle.status, "invalidated");
    constraintVersion = "constraint-1";
    read = await readProposal(contextKey(testAuthContext(), created.response.proposalId), {
      ...ports, timeZoneDataVersion: "tzdata-test-2",
    });
    assert.equal(read.kind === "found" && read.response.lifecycle.status, "invalidated");
  });

  it("fingerprints every governing version and the binding version", () => {
    const base = {
      context: testAuthContext(), normalizedInputs: { ...BODY, schedule: BODY.schedule as never },
      governingVersions: { proposalContractVersion: "proposal-1", periodContractVersion: "period-1",
        calendarDataVersion: "calendar-1", timeZoneDataVersion: "zone-1", currencyCatalogVersion: "currency-1" },
      budgetDate: "2026-09-15", constraintVersion: "constraint-1", currencyContextCompatible: true,
      bindingVersion: "binding-1",
    };
    const original = buildDependencyFingerprint(base);
    for (const field of ["proposalContractVersion", "periodContractVersion", "calendarDataVersion",
      "timeZoneDataVersion", "currencyCatalogVersion"] as const) {
      assert.notEqual(buildDependencyFingerprint({ ...base,
        governingVersions: { ...base.governingVersions, [field]: `${field}-2` } }), original);
    }
    assert.notEqual(buildDependencyFingerprint({ ...base, constraintVersion: "constraint-2" }), original);
    assert.notEqual(buildDependencyFingerprint({ ...base, bindingVersion: "binding-2" }), original);
    assert.notEqual(buildDependencyFingerprint({ ...base, currencyContextCompatible: false }), original);
  });
});

describe("CBD-232-AC08: DST and context-first storage", () => {
  it("derives 23-hour and 25-hour local days from calendar midnights", () => {
    const spring = localMidnightInstant(isoDate("2026-03-09"), "America/New_York").getTime() -
      localMidnightInstant(isoDate("2026-03-08"), "America/New_York").getTime();
    const fall = localMidnightInstant(isoDate("2026-11-02"), "America/New_York").getTime() -
      localMidnightInstant(isoDate("2026-11-01"), "America/New_York").getTime();
    assert.equal(spring, 23 * 60 * 60 * 1000);
    assert.equal(fall, 25 * 60 * 60 * 1000);
  });

  it("stores colliding opaque IDs independently under environment and subject context", async () => {
    const store = new InMemoryProposalStore();
    const alpha = testAuthContext({ environment: "alpha", subjectId: "subject-a" });
    const beta = testAuthContext({ environment: "beta", subjectId: "subject-b" });
    const alphaResult = await createOrRegenerateProposal(request(alpha, "context-key-alpha"),
      testPorts({ store, idGenerator: new SequentialIdGenerator() }));
    const betaResult = await createOrRegenerateProposal(request(beta, "context-key-beta-1"),
      testPorts({ store, idGenerator: new SequentialIdGenerator() }));
    assert.equal(alphaResult.kind, "created");
    assert.equal(betaResult.kind, "created");
    if (alphaResult.kind !== "created" || betaResult.kind !== "created") return;
    assert.equal(alphaResult.response.proposalId, betaResult.response.proposalId);
    assert.equal((await store.loadForContext(contextKey(alpha, alphaResult.response.proposalId)))?.environment, "alpha");
    assert.equal((await store.loadForContext(contextKey(beta, betaResult.response.proposalId)))?.environment, "beta");
  });
});

describe("CBD-232-AC08: confirmation versus edit concurrency", () => {
  it("a confirmed predecessor cannot be edited and an edited predecessor cannot later be confirmed", async () => {
    const store = new InMemoryProposalStore();
    const ports = testPorts({ store });
    const first = await createOrRegenerateProposal(request(), ports);
    assert.equal(first.kind, "created");
    if (first.kind !== "created") return;
    await store.recordConfirmed(first.response.proposalId, "budget-space-1");
    const edit = await createOrRegenerateProposal({ ...request(testAuthContext(), "confirm-edit-key-1"),
      body: { ...BODY, name: "Edited", supersedesProposalId: first.response.proposalId } }, ports);
    assert.equal(edit.kind, "predecessor_not_found");

    const second = await createOrRegenerateProposal(request(testAuthContext(), "confirm-edit-key-2"), ports);
    assert.equal(second.kind, "created");
    if (second.kind !== "created") return;
    const successor = await createOrRegenerateProposal({ ...request(testAuthContext(), "confirm-edit-key-3"),
      body: { ...BODY, name: "Successor", supersedesProposalId: second.response.proposalId } }, ports);
    assert.equal(successor.kind, "created");
    await store.recordConfirmed(second.response.proposalId, "budget-space-2");
    const predecessor = await store.loadForContext(contextKey(testAuthContext(), second.response.proposalId));
    assert.equal(predecessor?.status, "invalidated");
  });
});

describe("CBD-232-AC01/AC08: failure atomicity", () => {
  it("binding failure leaves proposal storage empty", async () => {
    const store = new InMemoryProposalStore();
    const ports = testPorts({ store, bindingKeyring: {
      bindingVersion: "bcp-hmac-sha256/v1", sign: () => { throw new Error("signing unavailable"); }, verify: () => false,
    } });
    await assert.rejects(() => createOrRegenerateProposal(request(), ports), /signing unavailable/u);
    assert.equal(await store.loadForContext(contextKey(testAuthContext(), "bcp_00000000000000000000000000000001")), null);
  });

  it("a persistence-port failure does not create a record in the backing adapter", async () => {
    const backing = new InMemoryProposalStore();
    const failing: BudgetCreationProposalStore = {
      createOrReplay: async () => { throw new Error("store unavailable"); },
      replaceCurrent: (command) => backing.replaceCurrent(command),
      loadForContext: (key) => backing.loadForContext(key),
      invalidate: (key, revision, reason) => backing.invalidate(key, revision, reason),
    };
    await assert.rejects(() => createOrRegenerateProposal(request(), testPorts({ store: failing })), /store unavailable/u);
    assert.equal(await backing.loadForContext(contextKey(testAuthContext(), "bcp_00000000000000000000000000000001")), null);
  });

  it("holiday-coverage failure occurs before any proposal write", async () => {
    const store = new InMemoryProposalStore();
    const clock = new FakeClock("2040-09-15T12:00:00.000Z");
    const body = { ...BODY, schedule: { cadence: "paycheck", pattern: { kind: "weekly", weekday: "friday" },
      businessDayPolicy: "previous-business-day" } };
    await assert.rejects(() => createOrRegenerateProposal({ ...request(), body }, testPorts({ store, clock })));
    assert.equal(await store.loadForContext(contextKey(testAuthContext(), "bcp_00000000000000000000000000000001")), null);
  });
});
