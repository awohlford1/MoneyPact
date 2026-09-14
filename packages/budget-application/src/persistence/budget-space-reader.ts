import type { DataAccessClient } from "@cobudget/data-access";
import type { CadenceDefinition } from "@cobudget/budget-domain/schedule";
import { inclusiveDayCount, toISODate } from "@cobudget/budget-domain/shared";
import type { ISODate } from "@cobudget/budget-domain/shared";
import { computeSchedulePreview } from "../creation-proposals/preview.ts";
import { localDateOf } from "../creation-proposals/time-zone.ts";
import type { Clock, PreviewPeriod } from "../creation-proposals/ports.ts";

/** The stored active period: a persisted `budget_space_period` row, so it carries the row's identifier. */
export interface StoredPeriod extends PreviewPeriod {
  readonly periodId: string;
  readonly scheduleVersionId: string;
  readonly status: string;
}

export interface BudgetSpaceDetail {
  readonly space: { readonly budgetSpaceId: string; readonly name: string; readonly nameVersion: number;
    readonly timeZone: string; readonly currencyCode: string; readonly lifecycle: string; readonly lifecycleVersion: number };
  readonly scheduleVersion: { readonly scheduleVersionId: string; readonly sequence: number; readonly cadenceDefinition: CadenceDefinition };
  readonly budgetDate: string;
  readonly activePeriod: StoredPeriod;
  readonly nextPeriods: readonly PreviewPeriod[];
}

interface PeriodRow { readonly periodId: string; readonly scheduleVersionId: string; readonly status: string; readonly start: ISODate; readonly end: ISODate }

/** `date` columns arrive as driver `Date`s at local midnight or as text; read calendar parts, never UTC ones. */
function dateText(value: unknown): ISODate {
  if (typeof value === "string") return toISODate(value.slice(0, 10));
  if (value instanceof Date) return toISODate(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`);
  throw new TypeError("expected a date");
}

/** Reads only the authorized tenant on the boundary's transaction client.
 * Membership predicates are defense in depth, never a policy substitute.
 *
 * PROTO-ACTIVATION-001 (proposals review F2, ACT-06): the active period is a
 * stored `budget_space_period` row of the current schedule version, chosen as
 * the row containing today's budget-local date and, when no stored row
 * contains it, the space's `current_period_id` row. Only the three periods
 * that follow it are recomputed from the schedule; the active period's
 * identifier and dates are the persisted ones, so the plan route and the
 * detail route agree on `periodId`. */
export async function readBudgetSpaceDetail(client: DataAccessClient, budgetSpaceId: string,
  subjectId: string, membershipId: string, clock: Clock): Promise<BudgetSpaceDetail | null> {
  const membership = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId,
    conditions: [{ column: "account_subject_id", value: subjectId }, { column: "membership_id", value: membershipId }, { column: "status", value: "active" }] });
  if (membership.rows.length !== 1) return null;
  const spaces = await client.tenantSelect({ table: "budget_space", budgetSpaceId });
  const space = spaces.rows[0] as { name: string; name_version: number; time_zone: string; currency_code: string;
    lifecycle: string; lifecycle_version: number; current_schedule_version_id: string; current_period_id: string } | undefined;
  if (!space) return null;
  const schedules = await client.tenantSelect({ table: "budget_space_schedule_version", budgetSpaceId,
    conditions: [{ column: "schedule_version_id", value: space.current_schedule_version_id }, { column: "status", value: "authoritative" }] });
  const schedule = schedules.rows[0] as { schedule_version_id: string; sequence: number; cadence_definition: CadenceDefinition } | undefined;
  if (!schedule) return null;
  const budgetDate = localDateOf(clock.now(), space.time_zone);
  const stored = await client.tenantSelect({ table: "budget_space_period", budgetSpaceId,
    columns: ["period_id", "schedule_version_id", "status", "period_start_date", "period_end_date"],
    conditions: [{ column: "schedule_version_id", value: schedule.schedule_version_id }] });
  const rows: PeriodRow[] = (stored.rows as Record<string, unknown>[]).map((row) => ({
    periodId: String(row.period_id), scheduleVersionId: String(row.schedule_version_id), status: String(row.status),
    start: dateText(row.period_start_date), end: dateText(row.period_end_date),
  }));
  const active = rows.find((row) => row.start <= budgetDate && row.end >= budgetDate) ?? rows.find((row) => row.periodId === space.current_period_id);
  if (!active) throw new Error("budget_space_periods_unavailable");
  // Recompute from the active period's own start so the following three periods continue the stored one.
  const preview = computeSchedulePreview(schedule.cadence_definition, active.start, space.time_zone);
  if (preview.periods.length !== 4) throw new Error("budget_space_periods_unavailable");
  const activePeriod: StoredPeriod = { periodId: active.periodId, scheduleVersionId: active.scheduleVersionId, status: active.status,
    ordinal: 0, relation: "current", start: active.start, end: active.end, lengthInDays: inclusiveDayCount(active.start, active.end) };
  return { space: { budgetSpaceId, name: space.name, nameVersion: space.name_version, timeZone: space.time_zone,
    currencyCode: space.currency_code, lifecycle: space.lifecycle, lifecycleVersion: space.lifecycle_version },
    scheduleVersion: { scheduleVersionId: schedule.schedule_version_id, sequence: schedule.sequence, cadenceDefinition: schedule.cadence_definition },
    budgetDate, activePeriod, nextPeriods: preview.periods.slice(1) };
}
