/**
 * CBD-232-AC03 and the calendar/cadence half of AC08: the complete current
 * anchored period plus at least three following periods, inclusive dates and
 * lengths, cadence/anchor, and applicable adjustments, across every cadence.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CadenceDefinition } from "@cobudget/budget-domain/schedule";
import { addDays, toISODate } from "@cobudget/budget-domain/shared";
import { computeSchedulePreview } from "./preview.ts";

function assertChronologyAndContiguity(periods: readonly { start: string; end: string }[]): void {
  assert.equal(periods.length, 4);
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index]!;
    assert.ok(period.start <= period.end, `period ${index} start must not be after end`);
    if (index > 0) {
      const previous = periods[index - 1]!;
      const expectedNextStart = addDays(toISODate(previous.end), 1);
      assert.equal(period.start, expectedNextStart, `period ${index} must start the day after period ${index - 1} ends`);
    }
  }
}

describe("CBD-232-AC03: weekly cadence", () => {
  it("returns the current period containing budgetDate plus three following, inclusive", () => {
    const definition: CadenceDefinition = { cadence: "weekly", anchor: "monday" };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "America/New_York");
    assertChronologyAndContiguity(preview.periods);
    assert.equal(preview.periods[0]!.relation, "current");
    assert.equal(preview.periods[0]!.start, "2026-09-14");
    assert.equal(preview.periods[0]!.end, "2026-09-20");
    assert.equal(preview.periods[0]!.lengthInDays, 7);
    assert.deepEqual(preview.adjustments, []);
    assert.equal(preview.cadence, "weekly");
    assert.equal(preview.timeZone, "America/New_York");
  });
});

describe("CBD-232-AC08: every weekday boundary class (weekly)", () => {
  for (const anchor of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const) {
    it(`generates four contiguous periods anchored on ${anchor}`, () => {
      const definition: CadenceDefinition = { cadence: "weekly", anchor };
      const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
      assertChronologyAndContiguity(preview.periods);
      preview.periods.forEach((period) => assert.equal(period.lengthInDays, 7));
    });
  }
});

describe("CBD-232-AC03/AC08: monthly cadence", () => {
  it("numbered anchor within range", () => {
    const definition: CadenceDefinition = { cadence: "monthly", anchor: { kind: "day-of-month", day: 15 } };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-20"), "UTC");
    assertChronologyAndContiguity(preview.periods);
    assert.equal(preview.periods[0]!.start, "2026-09-15");
    assert.equal(preview.periods[1]!.start, "2026-10-15");
  });

  it("last-day anchor", () => {
    const definition: CadenceDefinition = { cadence: "monthly", anchor: { kind: "last-day" } };
    const preview = computeSchedulePreview(definition, toISODate("2026-02-01"), "UTC");
    assertChronologyAndContiguity(preview.periods);
    assert.equal(preview.periods[0]!.start, "2026-01-31");
    assert.equal(preview.periods[1]!.start, "2026-02-28");
  });

  it("day-31 anchor clamps in short months and surfaces an adjustment plus warning", () => {
    const definition: CadenceDefinition = { cadence: "monthly", anchor: { kind: "day-of-month", day: 31 } };
    // budgetDate sits exactly on April's clamped boundary, so period[0] is the
    // clamped period itself (April has 30 days; the 31st anchor clamps to 30).
    const preview = computeSchedulePreview(definition, toISODate("2026-04-30"), "UTC");
    assertChronologyAndContiguity(preview.periods);
    assert.equal(preview.periods[0]!.start, "2026-04-30");
    const clamp = preview.adjustments.find((a) => a.kind === "monthly-anchor-clamp");
    assert.ok(clamp, "expected a monthly-anchor-clamp adjustment");
    if (clamp && clamp.kind === "monthly-anchor-clamp") {
      assert.equal(clamp.unadjustedDay, 31);
      assert.equal(clamp.adjustedDate, "2026-04-30");
    }
    assert.ok(preview.warnings.some((w) => w.kind === "monthly-anchor-clamp"));
  });

  it("February in a common year and a leap year both clamp day 29/30/31 correctly", () => {
    const definition: CadenceDefinition = { cadence: "monthly", anchor: { kind: "day-of-month", day: 30 } };
    const commonYear = computeSchedulePreview(definition, toISODate("2027-02-28"), "UTC");
    assert.equal(commonYear.periods[0]!.start, "2027-02-28");
    const leapYear = computeSchedulePreview(definition, toISODate("2028-02-29"), "UTC");
    assert.equal(leapYear.periods[0]!.start, "2028-02-29");
  });

  it("January/year rollover produces a contiguous December-to-January boundary", () => {
    const definition: CadenceDefinition = { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } };
    const preview = computeSchedulePreview(definition, toISODate("2026-12-20"), "UTC");
    assertChronologyAndContiguity(preview.periods);
    assert.equal(preview.periods[0]!.start, "2026-12-01");
    assert.equal(preview.periods[1]!.start, "2027-01-01");
  });
});

describe("CBD-232-AC03/AC08: custom-fixed-length cadence", () => {
  it("length of 1 day", () => {
    const definition: CadenceDefinition = { cadence: "custom-fixed-length", startBoundary: toISODate("2026-01-01"), lengthInDays: 1 };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
    assertChronologyAndContiguity(preview.periods);
    preview.periods.forEach((period) => assert.equal(period.lengthInDays, 1));
    assert.deepEqual(preview.adjustments, []);
  });

  it("length of 366 days", () => {
    const definition: CadenceDefinition = {
      cadence: "custom-fixed-length",
      startBoundary: toISODate("2020-01-01"),
      lengthInDays: 366,
    };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
    assertChronologyAndContiguity(preview.periods);
    preview.periods.forEach((period) => assert.equal(period.lengthInDays, 366));
  });

  it("interior length value", () => {
    const definition: CadenceDefinition = {
      cadence: "custom-fixed-length",
      startBoundary: toISODate("2026-01-15"),
      lengthInDays: 45,
    };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
    assertChronologyAndContiguity(preview.periods);
    preview.periods.forEach((period) => assert.equal(period.lengthInDays, 45));
  });
});

describe("CBD-232-AC03/AC08: paycheck cadence, all six patterns and three business-day policies", () => {
  const policies = ["previous-business-day", "next-business-day", "keep-original-date"] as const;

  it("weekly pattern under every business-day policy", () => {
    for (const businessDayPolicy of policies) {
      const definition: CadenceDefinition = {
        cadence: "paycheck",
        pattern: { kind: "weekly", weekday: "friday" },
        businessDayPolicy,
      };
      const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
      assertChronologyAndContiguity(preview.periods);
    }
  });

  it("twice-per-week pattern", () => {
    const definition: CadenceDefinition = {
      cadence: "paycheck",
      pattern: { kind: "twice-per-week", weekdays: ["tuesday", "friday"] },
      businessDayPolicy: "previous-business-day",
    };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
    assertChronologyAndContiguity(preview.periods);
  });

  it("every-two-weeks pattern", () => {
    const definition: CadenceDefinition = {
      cadence: "paycheck",
      pattern: { kind: "every-two-weeks", weekday: "friday", recurrenceOrigin: toISODate("2026-01-02") },
      businessDayPolicy: "next-business-day",
    };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
    assertChronologyAndContiguity(preview.periods);
  });

  it("twice-per-month pattern", () => {
    const definition: CadenceDefinition = {
      cadence: "paycheck",
      pattern: {
        kind: "twice-per-month",
        anchors: [{ kind: "day-of-month", day: 1 }, { kind: "day-of-month", day: 15 }],
      },
      businessDayPolicy: "keep-original-date",
    };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
    assertChronologyAndContiguity(preview.periods);
  });

  it("monthly pattern", () => {
    const definition: CadenceDefinition = {
      cadence: "paycheck",
      pattern: { kind: "monthly", anchor: { kind: "last-day" } },
      businessDayPolicy: "previous-business-day",
    };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
    assertChronologyAndContiguity(preview.periods);
  });

  it("custom-weekly-interval pattern", () => {
    const definition: CadenceDefinition = {
      cadence: "paycheck",
      pattern: {
        kind: "custom-weekly-interval",
        weekday: "wednesday",
        everyWeeks: 3,
        recurrenceOrigin: toISODate("2026-01-07"),
      },
      businessDayPolicy: "next-business-day",
    };
    const preview = computeSchedulePreview(definition, toISODate("2026-09-16"), "UTC");
    assertChronologyAndContiguity(preview.periods);
  });

  it("surfaces a business-day adjustment with full provenance when a payday lands on a holiday", () => {
    // budgetDate is in mid-December 2026, well inside verified coverage
    // (2026-2030) even after the horizon's backward margin. The "following"
    // period boundary is 2027-01-01 (New Year's Day, a Friday); previous-
    // business-day moves it back to 2026-12-31.
    const definition: CadenceDefinition = {
      cadence: "paycheck",
      pattern: { kind: "monthly", anchor: { kind: "day-of-month", day: 1 } },
      businessDayPolicy: "previous-business-day",
    };
    const preview = computeSchedulePreview(definition, toISODate("2026-12-15"), "UTC");
    const adjustment = preview.adjustments.find((a) => a.kind === "business-day" && a.unadjustedDate === "2027-01-01");
    assert.ok(adjustment, "expected an adjustment for the New Year's Day anchor");
    if (adjustment && adjustment.kind === "business-day") {
      assert.equal(adjustment.adjustedDate, "2026-12-31");
      assert.equal(adjustment.policy, "previous-business-day");
      assert.ok(adjustment.reason !== null);
      assert.equal(adjustment.calendarDataVersion, "frfs-2026-2030");
    }
  });
});

describe("CBD-232-AC08: property tests", () => {
  it("every preview has exactly four periods, chronological, contiguous, non-overlapping, containing budgetDate", () => {
    const cases: Array<{ definition: CadenceDefinition; budgetDate: string }> = [
      { definition: { cadence: "weekly", anchor: "wednesday" }, budgetDate: "2026-03-01" },
      { definition: { cadence: "monthly", anchor: { kind: "day-of-month", day: 10 } }, budgetDate: "2026-11-30" },
      { definition: { cadence: "custom-fixed-length", startBoundary: toISODate("2026-01-01"), lengthInDays: 10 }, budgetDate: "2026-05-05" },
    ];
    for (const { definition, budgetDate } of cases) {
      const preview = computeSchedulePreview(definition, toISODate(budgetDate), "UTC");
      assertChronologyAndContiguity(preview.periods);
      const current = preview.periods[0]!;
      assert.ok(current.start <= budgetDate && budgetDate <= current.end);
    }
  });
});
