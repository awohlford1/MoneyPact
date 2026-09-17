/**
 * CBD-232-AC01: canonical field errors, ordering, unknown-field detection,
 * and the no-write rule (verified at the application layer in
 * application-create.test.ts, since the store is never even invoked when
 * validation fails).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateCreateProposalRequest, validateIdempotencyKeyHeader } from "./normalize.ts";
import { FakeCurrencyContextReader, testAuthContext } from "./support.ts";

const deps = () => ({
  currencyContextReader: new FakeCurrencyContextReader(),
  subjectContext: testAuthContext(),
});

const VALID_BODY = {
  name: "Groceries",
  timeZone: "America/New_York",
  currencyCode: "USD",
  schedule: { cadence: "weekly", anchor: "monday" },
};

describe("CBD-232-AC01: idempotency key header", () => {
  it("requires the header when absent", () => {
    assert.deepEqual(validateIdempotencyKeyHeader(undefined), [
      { code: "idempotency-key.required", path: "header.Idempotency-Key", message: "Provide an Idempotency-Key header." },
    ]);
  });

  it("requires the header when empty, and only that error", () => {
    assert.deepEqual(validateIdempotencyKeyHeader(""), [
      { code: "idempotency-key.required", path: "header.Idempotency-Key", message: "Provide an Idempotency-Key header." },
    ]);
  });

  it("rejects a too-short key", () => {
    assert.equal(validateIdempotencyKeyHeader("short")[0]?.code, "idempotency-key.invalid");
  });

  it("rejects a key with non-visible-ASCII characters", () => {
    assert.equal(validateIdempotencyKeyHeader(`café-key-${"x".repeat(20)}`)[0]?.code, "idempotency-key.invalid");
  });

  it("accepts a 16-character visible-ASCII key", () => {
    assert.deepEqual(validateIdempotencyKeyHeader("0123456789abcdef"), []);
  });

  it("accepts a 128-character visible-ASCII key", () => {
    assert.deepEqual(validateIdempotencyKeyHeader("a".repeat(128)), []);
  });

  it("rejects a 129-character key", () => {
    assert.equal(validateIdempotencyKeyHeader("a".repeat(129))[0]?.code, "idempotency-key.invalid");
  });
});

describe("CBD-232-AC01: name normalization", () => {
  it("rejects a non-string name", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name: 42 }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "name.expected-string"));
  });

  it("rejects an empty-after-trim name", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name: "   " }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "name.required"));
  });

  it("rejects a name over 100 code points", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name: "a".repeat(101) }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "name.too-long"));
  });

  it("SEC-F06-OBS1: rejects a name containing a Unicode control or format character with name.control-characters, ahead of the length check", () => {
    for (const name of ["Groceries \u202Eseirecorg", "Gro\u200Bceries", "Groceries\u0007", "\u2066Groceries\u2069", "Groceries\uFEFF", "\u0645\u06CC\u200C\u202E\u062E", "\u200D\u0D15\u0D4D\u0D37", "\u0645\u06CC\u200C", "\u0645\u06CC\u200C \u062E\u0648\u0627\u0647\u0645", "\u0D15\u0D4D \u200D\u0D37", "\u0645\u06CC\u200C\u200C\u062E", "\u0D15\u0D4D\u200D\u200D\u0D37", "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} fund"]) {
      const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name }, deps());
      assert.equal(result.ok, false, JSON.stringify(name));
      if (!result.ok) assert.deepEqual(result.fieldErrors.filter((e) => e.path === "name").map((e) => e.code), ["name.control-characters"], JSON.stringify(name));
    }
    const long = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name: `${"a".repeat(101)}\u202E` }, deps());
    assert.equal(long.ok, false);
    if (!long.ok) assert.deepEqual(long.fieldErrors.filter((e) => e.path === "name").map((e) => e.code), ["name.control-characters"], "reported before name.too-long");
  });

  it("SEC-F06-OBS1 / REV-NS-2: accents, CJK, Arabic, ZWJ-joined emoji, Persian ZWNJ and Malayalam/Sinhala ZWJ conjuncts still pass", () => {
    for (const name of ["Caf\u00E9 \u00C0 la carte", "\u5BB6\u8A08\u7C3F", "\u0645\u064A\u0632\u0627\u0646\u064A\u0629", "Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", "\u{1F3F3}\uFE0F\u200D\u{1F308} Pride fund", "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645", "\u0D15\u0D4D\u200D\u0D37", "\u0D9A\u0DCA\u200D\u0DBB"]) {
      const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name }, deps());
      assert.equal(result.ok, true, JSON.stringify(name));
      if (result.ok) assert.equal(result.normalizedInputs.name, name.normalize("NFC"));
    }
  });

  it("applies NFC and collapses internal whitespace runs", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name: "  Grocery   Budget  " }, deps());
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.normalizedInputs.name, "Grocery Budget");
  });

  it("two raw variants that normalize identically produce the same normalized name", () => {
    const a = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name: "Grocery Budget" }, deps());
    const b = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, name: "  Grocery Budget" }, deps());
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) assert.equal(a.normalizedInputs.name, b.normalizedInputs.name);
  });
});

describe("CBD-232-AC01: time-zone normalization", () => {
  it("rejects a non-string time zone", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, timeZone: 5 }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "time-zone.expected-string"));
  });

  it("rejects an empty time zone", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, timeZone: "" }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "time-zone.required"));
  });

  it("rejects a fixed offset", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, timeZone: "+05:00" }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "time-zone.invalid"));
  });

  it("rejects a bare abbreviation", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, timeZone: "EST" }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "time-zone.invalid"));
  });

  it("rejects an unknown zone name", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, timeZone: "Nowhere/Nothing" }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "time-zone.invalid"));
  });

  it("canonicalizes a known alias to its canonical IANA name", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, timeZone: "Asia/Chungking" }, deps());
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.normalizedInputs.timeZone, "Asia/Shanghai");
  });

  it("trims whitespace around a valid zone", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, timeZone: "  America/New_York  " }, deps());
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.normalizedInputs.timeZone, "America/New_York");
  });
});

describe("CBD-232-AC01: currency normalization", () => {
  it("rejects a non-string currency", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, currencyCode: 1 }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "currency.expected-string"));
  });

  it("rejects an empty currency", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, currencyCode: " " }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "currency.required"));
  });

  it("rejects an unsupported code", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, currencyCode: "ZZZ" }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "currency.invalid"));
  });

  it("trims and uppercases a valid lowercase code", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, currencyCode: " usd " }, deps());
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.normalizedInputs.currencyCode, "USD");
  });

  it("rejects a code incompatible with the subject's financial profile", () => {
    const incompatibleDeps = {
      currencyContextReader: new FakeCurrencyContextReader({ incompatibleCode: "EUR" }),
      subjectContext: testAuthContext(),
    };
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, currencyCode: "EUR" }, incompatibleDeps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "currency.context-mismatch"));
  });
});

describe("CBD-232-AC01: schedule shape and unknown fields", () => {
  it("rejects a missing schedule", () => {
    const { schedule: _schedule, ...withoutSchedule } = VALID_BODY;
    const result = validateCreateProposalRequest("k".repeat(16), withoutSchedule, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "input.expected-object" && e.path === "schedule"));
  });

  it("rejects an array schedule", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, schedule: [] }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "input.expected-object"));
  });

  it("prefixes domain schedule codes with schedule. and preserves the code", () => {
    const result = validateCreateProposalRequest(
      "k".repeat(16),
      { ...VALID_BODY, schedule: { cadence: "weekly", anchor: "funday" } },
      deps(),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      const error = result.fieldErrors.find((e) => e.code === "weekday.unsupported");
      assert.ok(error);
      assert.equal(error?.path, "schedule.anchor");
    }
  });

  it("flags a top-level unknown field", () => {
    const result = validateCreateProposalRequest("k".repeat(16), { ...VALID_BODY, extra: true }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "input.unknown-field" && e.path === "extra"));
  });

  it("flags an unknown field nested under schedule", () => {
    const result = validateCreateProposalRequest(
      "k".repeat(16),
      { ...VALID_BODY, schedule: { cadence: "weekly", anchor: "monday", oops: 1 } },
      deps(),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.fieldErrors.some((e) => e.code === "input.unknown-field" && e.path === "schedule.oops"));
    }
  });

  it("flags an unknown field nested under schedule.pattern for paycheck cadences", () => {
    const result = validateCreateProposalRequest(
      "k".repeat(16),
      {
        ...VALID_BODY,
        schedule: {
          cadence: "paycheck",
          pattern: { kind: "weekly", weekday: "friday", bogus: 1 },
          businessDayPolicy: "previous-business-day",
        },
      },
      deps(),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.fieldErrors.some((e) => e.code === "input.unknown-field" && e.path === "schedule.pattern.bogus"));
    }
  });

  it("rejects a malformed supersedesProposalId with a validation error, not a lookup", () => {
    const result = validateCreateProposalRequest(
      "k".repeat(16),
      { ...VALID_BODY, supersedesProposalId: "not-a-real-id" },
      deps(),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fieldErrors.some((e) => e.code === "supersedes-proposal-id.invalid"));
  });
});

describe("CBD-232-AC01: multiple simultaneous errors, stable ordering", () => {
  it("collects every independently detectable error, ordered header, top-level-unknown, then field order", () => {
    const result = validateCreateProposalRequest(undefined, { name: "", extra: 1, timeZone: "bogus", currencyCode: "" }, deps());
    assert.equal(result.ok, false);
    if (!result.ok) {
      const codes = result.fieldErrors.map((e) => `${e.path}:${e.code}`);
      // header first
      assert.equal(codes[0], "header.Idempotency-Key" + ":" + "idempotency-key.required");
      // top-level unknown field bucket next
      assert.equal(codes[1], "extra:input.unknown-field");
      // then declared field order: name, timeZone, currencyCode, schedule
      const nameIndex = codes.findIndex((c) => c.startsWith("name:"));
      const tzIndex = codes.findIndex((c) => c.startsWith("timeZone:"));
      const currencyIndex = codes.findIndex((c) => c.startsWith("currencyCode:"));
      const scheduleIndex = codes.findIndex((c) => c.startsWith("schedule:"));
      assert.ok(nameIndex < tzIndex);
      assert.ok(tzIndex < currencyIndex);
      assert.ok(currencyIndex < scheduleIndex);
    }
  });

  it("is deterministic across repeated calls with the same input", () => {
    const body = { name: "", extra: 1, timeZone: "bogus", currencyCode: "", schedule: { cadence: "nope" } };
    const first = validateCreateProposalRequest(undefined, body, deps());
    const second = validateCreateProposalRequest(undefined, body, deps());
    assert.deepEqual(first, second);
  });
});
