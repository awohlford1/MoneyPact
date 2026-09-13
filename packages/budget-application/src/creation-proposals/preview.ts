/**
 * Server-side schedule preview assembly (CBD-232 §6).
 */

import {
  FEDERAL_RESERVE_CALENDAR,
  SETUP_PREVIEW_PERIOD_COUNT,
  buildPaycheckSchedule,
  customBoundaries,
  describeCadence,
  periodLengthInDays,
  setupPreview,
  weeklyMonthlyBoundaries,
} from "@cobudget/budget-domain/schedule";
import type { CadenceDefinition } from "@cobudget/budget-domain/schedule";
import type { ISODate } from "@cobudget/budget-domain/shared";
import { addCalendarDays, compareCalendarDates } from "./date.ts";
import type { PreviewAdjustment, PreviewPeriod, PreviewWarning, SchedulePreview } from "./ports.ts";

const PAYCHECK_BACKWARD_MARGIN_DAYS = 60;
const PAYCHECK_FORWARD_MARGIN_DAYS = 420;

/**
 * Assemble a preview from a schedule already accepted by request validation.
 *
 * `parseCadenceDefinition` is called exactly once per §6.1 for a live HTTP
 * request. Preview assembly consumes that normalized definition directly and
 * does not invoke the parser a second time.
 */
export function computeSchedulePreview(
  definition: CadenceDefinition,
  budgetDate: ISODate,
  timeZone: string,
): SchedulePreview {
  const validated = definition;
  const periods: PreviewPeriod[] = [];
  const adjustments: PreviewAdjustment[] = [];
  const warnings: PreviewWarning[] = [];

  if (validated.cadence === "weekly" || validated.cadence === "monthly") {
    const boundaries = weeklyMonthlyBoundaries(validated as Parameters<typeof weeklyMonthlyBoundaries>[0]);
    const generated = setupPreview(boundaries, budgetDate);
    generated.forEach((period, index) => {
      periods.push(toPreviewPeriod(period, index));
      if (validated.cadence === "monthly" && validated.anchor.kind === "day-of-month") {
        const clamp = monthlyClampAdjustment(validated.anchor.day, period.start);
        if (clamp !== null) {
          adjustments.push(clamp);
          warnings.push({
            kind: "monthly-anchor-clamp",
            periodOrdinal: index as 0 | 1 | 2 | 3,
            message: `Day ${clamp.unadjustedDay} does not exist in this month; the period starts ${clamp.adjustedDate} instead.`,
          });
        }
      }
    });
  } else if (validated.cadence === "custom-fixed-length") {
    const boundaries = customBoundaries(validated as Parameters<typeof customBoundaries>[0]);
    const generated = setupPreview(boundaries, budgetDate);
    generated.forEach((period, index) => periods.push(toPreviewPeriod(period, index)));
  } else {
    const horizon = {
      from: addCalendarDays(budgetDate, -PAYCHECK_BACKWARD_MARGIN_DAYS),
      through: addCalendarDays(budgetDate, PAYCHECK_FORWARD_MARGIN_DAYS),
    };
    const paycheckSchedule = buildPaycheckSchedule(validated as Parameters<typeof buildPaycheckSchedule>[0], horizon);
    const generated = setupPreview(paycheckSchedule.boundaries, budgetDate);
    generated.forEach((period, index) => periods.push(toPreviewPeriod(period, index)));

    const previewStart = periods[0]?.start;
    const previewEnd = periods[periods.length - 1]?.end;
    if (previewStart !== undefined && previewEnd !== undefined) {
      for (const occurrence of paycheckSchedule.occurrences) {
        if (occurrence.adjustment.reason === null) continue;
        if (
          compareCalendarDates(occurrence.adjustedDate, previewStart) < 0 ||
          compareCalendarDates(occurrence.adjustedDate, previewEnd) > 0
        ) {
          continue;
        }
        adjustments.push({
          kind: "business-day",
          unadjustedDate: occurrence.unadjustedDate,
          adjustedDate: occurrence.adjustedDate,
          policy: validated.businessDayPolicy,
          reason: occurrence.adjustment.reason,
          calendarDataVersion: occurrence.adjustment.datasetVersion,
        });
      }
    }
  }

  return {
    budgetDate,
    timeZone,
    cadence: validated.cadence,
    cadenceDefinition: validated,
    cadenceSummary: describeCadence(validated),
    periodCount: SETUP_PREVIEW_PERIOD_COUNT,
    periods,
    adjustments,
    warnings,
  };
}

function toPreviewPeriod(
  period: { readonly start: ISODate; readonly end: ISODate },
  ordinal: number,
): PreviewPeriod {
  return {
    ordinal: ordinal as 0 | 1 | 2 | 3,
    relation: ordinal === 0 ? "current" : "following",
    start: period.start,
    end: period.end,
    lengthInDays: periodLengthInDays(period),
  };
}

type MonthlyAnchorClampAdjustment = Extract<PreviewAdjustment, { kind: "monthly-anchor-clamp" }>;

function monthlyClampAdjustment(anchorDay: number, periodStart: ISODate): MonthlyAnchorClampAdjustment | null {
  const day = Number(periodStart.slice(8, 10));
  if (day === anchorDay) return null;
  return { kind: "monthly-anchor-clamp", unadjustedDay: anchorDay, adjustedDate: periodStart };
}

export function calendarDataVersionFor(cadence: CadenceDefinition["cadence"]): string | null {
  return cadence === "paycheck" ? FEDERAL_RESERVE_CALENDAR.datasetVersion : null;
}
