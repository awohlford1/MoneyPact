import type { DataAccessClient } from "@cobudget/data-access";
import type { CadenceDefinition } from "@cobudget/budget-domain/schedule";
import { computeSchedulePreview } from "../creation-proposals/preview.ts";
import { localDateOf } from "../creation-proposals/time-zone.ts";
import type { Clock, PreviewPeriod } from "../creation-proposals/ports.ts";

export interface BudgetSpaceDetail {
  readonly space: { readonly budgetSpaceId: string; readonly name: string; readonly nameVersion: number;
    readonly timeZone: string; readonly currencyCode: string; readonly lifecycle: string; readonly lifecycleVersion: number };
  readonly scheduleVersion: { readonly scheduleVersionId: string; readonly sequence: number; readonly cadenceDefinition: CadenceDefinition };
  readonly budgetDate: string;
  readonly activePeriod: PreviewPeriod;
  readonly nextPeriods: readonly PreviewPeriod[];
}

/** Reads only the authorized tenant on the boundary's transaction client.
 * Membership predicates are defense in depth, never a policy substitute.
 * Period dates are resolved from today's budget-local date, not the creation
 * transaction's original current_period_id or persisted preview horizon. */
export async function readBudgetSpaceDetail(client: DataAccessClient, budgetSpaceId: string,
  subjectId: string, membershipId: string, clock: Clock): Promise<BudgetSpaceDetail | null> {
  const membership = await client.tenantSelect({ table: "budget_space_membership", budgetSpaceId,
    conditions: [{ column: "account_subject_id", value: subjectId }, { column: "membership_id", value: membershipId }, { column: "status", value: "active" }] });
  if (membership.rows.length !== 1) return null;
  const spaces = await client.tenantSelect({ table: "budget_space", budgetSpaceId });
  const space = spaces.rows[0] as { name: string; name_version: number; time_zone: string; currency_code: string;
    lifecycle: string; lifecycle_version: number; current_schedule_version_id: string } | undefined;
  if (!space) return null;
  const schedules = await client.tenantSelect({ table: "budget_space_schedule_version", budgetSpaceId,
    conditions: [{ column: "schedule_version_id", value: space.current_schedule_version_id }, { column: "status", value: "authoritative" }] });
  const schedule = schedules.rows[0] as { schedule_version_id: string; sequence: number; cadence_definition: CadenceDefinition } | undefined;
  if (!schedule) return null;
  const budgetDate = localDateOf(clock.now(), space.time_zone);
  const preview = computeSchedulePreview(schedule.cadence_definition, budgetDate, space.time_zone);
  const activePeriod = preview.periods[0];
  if (!activePeriod || preview.periods.length !== 4) throw new Error("budget_space_periods_unavailable");
  return { space: { budgetSpaceId, name: space.name, nameVersion: space.name_version, timeZone: space.time_zone,
    currencyCode: space.currency_code, lifecycle: space.lifecycle, lifecycleVersion: space.lifecycle_version },
    scheduleVersion: { scheduleVersionId: schedule.schedule_version_id, sequence: schedule.sequence, cadenceDefinition: schedule.cadence_definition },
    budgetDate, activePeriod, nextPeriods: preview.periods.slice(1) };
}
