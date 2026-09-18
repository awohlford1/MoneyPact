/** DEVELOPMENT ONLY (CBD-323, event contract CBD-321; UI-BUILD-PLAN.md section 4.6). Registered in the mock
 * route module registry (`mock-registry.ts`); imported by `mock-server.ts` only, never by browser components.
 *
 * Reads the same stored `MockSpace.schedule` `mock-server.ts` already keeps and calls the same domain-engine
 * boundary adapters `mock-server.ts` itself calls when it derives a proposal's setup preview
 * (`weeklyMonthlyBoundaries` / `customBoundaries` / `buildPaycheckSchedule`). No new period-boundary rule is
 * introduced -- this module only reads the existing rule over a different, caller-chosen date range instead of
 * the fixed four-period setup preview. `mock-server.ts` itself is not edited beyond the registry line in
 * `mock-registry.ts` (the UI-P04/UI-P06 binding correction), so `localDate` below is a deliberate, minimal
 * restatement of `mock-server.ts`'s own private helper of the same name -- unavoidable duplication given that
 * helper is a private closure in a file this packet may not alter. Recorded as a finding, not silently absorbed.
 *
 * Mock-fidelity limits (a consequence of "invent no new value", not a product choice):
 *  - A period event's `href` is always `null`. Only the space's *current* active period carries a real
 *    `periodId` in this mock (the same limit `mock-reports.ts` documents); a boundary the calendar reports for
 *    any other period is derived, not stored, so there is no id to link to yet.
 *  - `freshness` is always `"current"`. This mock has no caching layer to go stale; the wire field and the view
 *    branch that reads it both exist so the surface is correct once a real cache sits in front of this read.
 *  - Payday events exist only for the `"paycheck"` cadence, which is the one cadence with an income schedule
 *    (CBD-27/CBD-29's own split). A weekly, monthly or custom-fixed-length budget honestly reports zero paydays
 *    rather than inventing an income schedule; requesting `kinds=payday` against one still returns 200 with an
 *    empty set for that kind, not `unavailableKinds` -- that field names only a kind with *no registered
 *    source at all* (bills/goals/income) or a source that could not be read for this request (an uncovered
 *    holiday-calendar year for a paycheck cadence's business-day adjustment).
 */
import {
  buildPaycheckSchedule, customBoundaries, periodAfter, periodContaining, weeklyMonthlyBoundaries,
} from "@cobudget/budget-domain/schedule";
import type { BoundaryFunctions, CadenceDefinition, PaycheckOccurrence, ValidatedCadenceDefinition } from "@cobudget/budget-domain/schedule";
import { compareDates, toISODate } from "@cobudget/budget-domain/shared";
import type { ISODate } from "@cobudget/budget-domain/shared";
import {
  CALENDAR_EVENT_KINDS, gridRangeForMonth, monthStartOf,
} from "./calendar.ts";
import type { CalendarEventKind, WireCalendar, WireCalendarEvent } from "./calendar.ts";
import { ApiError } from "./client.ts";
import type { MockDirectory } from "./mock-invitations.ts";
import { activeMembership } from "./mock-invitations.ts";
import type { MockRouteModule } from "./mock-registry.ts";

// The subset of `mock-server.ts`'s private `MockSpace` shape this module reads. Structural, not imported --
// `mock-server.ts` exports no such type, and this packet does not edit that file beyond the registry line.
interface CalendarSpace {
  detail: { space: { budgetSpaceId: string; timeZone: string } };
  schedule: CadenceDefinition;
}

const noStore = { "Cache-Control": "no-store" };
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...noStore, "content-type": "application/json" } });
}

function calendarSpaceOf(directory: MockDirectory, accountSubjectId: string, id: string): CalendarSpace {
  const spaces = directory.spaces as Map<string, CalendarSpace>;
  const value = spaces.get(id);
  if (!value || !activeMembership(directory, id, accountSubjectId)) throw new ApiError(403, "authorization_denied");
  return value;
}

/** Restatement of `mock-server.ts`'s own private `localDate`: the calendar date `now` falls on in `timeZone`. */
function localDate(now: number, timeZone: string): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return toISODate(`${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}-${parts.find(part => part.type === "day")!.value}`);
}

/** `MockSpace.schedule` is stored as the plain `CadenceDefinition` field type, which loses the validated brand
 * on assignment even though `mock-server.ts` only ever stores a value that has already passed
 * `parseCadenceDefinition` (its proposal-confirmation flow, `normalizedInputs.schedule`). Re-asserting the brand
 * here is sound for the same reason `mock-server.ts`'s own boundary-adapter call site does not re-validate
 * either: nothing in this mock can populate `MockSpace.schedule` any other way. */
function asValidated(schedule: CadenceDefinition): ValidatedCadenceDefinition {
  return schedule as ValidatedCadenceDefinition;
}

interface CadenceAdapter {
  boundaries: BoundaryFunctions;
  paycheckOccurrences: readonly PaycheckOccurrence[];
}

function adapterFor(schedule: CadenceDefinition, range: { from: ISODate; to: ISODate }): CadenceAdapter {
  const validated = asValidated(schedule);
  if (validated.cadence === "custom-fixed-length") return { boundaries: customBoundaries(validated), paycheckOccurrences: [] };
  if (validated.cadence === "paycheck") {
    const built = buildPaycheckSchedule(validated, { from: range.from, through: range.to });
    return { boundaries: built.boundaries, paycheckOccurrences: built.occurrences };
  }
  return { boundaries: weeklyMonthlyBoundaries(validated), paycheckOccurrences: [] };
}

const MAX_PERIODS_WALKED = 512;

function periodEvents(adapter: CadenceAdapter, range: { from: ISODate; to: ISODate }, today: ISODate, edge: "start" | "end"): WireCalendarEvent[] {
  const events: WireCalendarEvent[] = [];
  let current = periodContaining(adapter.boundaries, range.from);
  for (let guard = 0; guard < MAX_PERIODS_WALKED && compareDates(current.start, range.to) <= 0; guard++) {
    const date = edge === "start" ? current.start : current.end;
    if (compareDates(date, range.from) >= 0 && compareDates(date, range.to) <= 0) {
      events.push({
        eventId: `period-${edge}:${date}`,
        kind: edge === "start" ? "period_start" : "period_end",
        date, label: edge === "start" ? "Period starts" : "Period ends",
        status: compareDates(date, today) <= 0 ? "actual" : "projected",
        freshness: "current", href: null,
      });
    }
    current = periodAfter(adapter.boundaries, current);
  }
  return events;
}

function paydayEvents(adapter: CadenceAdapter, today: ISODate): WireCalendarEvent[] {
  return adapter.paycheckOccurrences.map(occurrence => ({
    eventId: `payday:${occurrence.adjustedDate}:${occurrence.unadjustedDate}`,
    kind: "payday" as const,
    date: occurrence.adjustedDate, label: "Payday",
    status: compareDates(occurrence.adjustedDate, today) <= 0 ? "actual" as const : "projected" as const,
    freshness: "current" as const, href: null,
  }));
}

/** EVENT SOURCE REGISTRY -- append-only. `adapter` is computed once per request and shared across every kind's
 * source, so a later bills/goals/income packet registers its own entry here (and its own field on `CalendarSpace`
 * above, if it needs stored state) without editing anything above this block. A source throws to report its own
 * kind unavailable for this request; it never partially populates `events` and never touches another kind's
 * entry, so one failing source cannot corrupt another's result. */
const EVENT_SOURCE_REGISTRY: ReadonlyMap<CalendarEventKind, (adapter: CadenceAdapter, range: { from: ISODate; to: ISODate }, today: ISODate) => readonly WireCalendarEvent[]> = new Map([
  ["period_start", (adapter, range, today) => periodEvents(adapter, range, today, "start")],
  ["period_end", (adapter, range, today) => periodEvents(adapter, range, today, "end")],
  ["payday", (adapter, _range, today) => paydayEvents(adapter, today)],
]);

function parseKinds(raw: string | null): readonly string[] {
  const requested = (raw ?? "").split(",").map(value => value.trim()).filter(Boolean);
  return requested.length ? requested : CALENDAR_EVENT_KINDS;
}

function handleCalendar(space: CalendarSpace, url: URL, now: number): WireCalendar {
  const timeZone = space.detail.space.timeZone;
  const today = localDate(now, timeZone);
  const rawFrom = url.searchParams.get("from") ?? "";
  const rawTo = url.searchParams.get("to") ?? "";
  let from: ISODate; let to: ISODate;
  // CBD-323-AC02: an empty from/to is the bootstrap request -- the mock answers with the month containing its
  // own `today`, never the caller's guess, so the very first read needs no device-clock arithmetic at all.
  if (!rawFrom && !rawTo) { const grid = gridRangeForMonth(monthStartOf(today)); from = grid.from; to = grid.to; }
  else {
    if (!rawFrom || !rawTo) throw new ApiError(400, "validation_failed");
    from = toISODate(rawFrom); to = toISODate(rawTo);
    if (compareDates(from, to) > 0) throw new ApiError(400, "validation_failed");
  }
  const requestedKinds = parseKinds(url.searchParams.get("kinds"));
  const events: WireCalendarEvent[] = [];
  const unavailableKinds: string[] = [];
  let adapter: CadenceAdapter | undefined;
  let adapterFailed = false;
  for (const kind of requestedKinds) {
    const source = EVENT_SOURCE_REGISTRY.get(kind as CalendarEventKind);
    if (!source) { unavailableKinds.push(kind); continue; }
    if (adapterFailed) { unavailableKinds.push(kind); continue; }
    try {
      if (!adapter) adapter = adapterFor(space.schedule, { from, to });
      events.push(...source(adapter, { from, to }, today));
    } catch {
      adapterFailed = true;
      unavailableKinds.push(kind);
    }
  }
  events.sort((a, b) => compareDates(toISODate(a.date), toISODate(b.date)) || a.eventId.localeCompare(b.eventId));
  return {
    budgetSpaceId: space.detail.space.budgetSpaceId, timeZone, today, from, to,
    dataAsOf: new Date(now).toISOString(), events, unavailableKinds,
  };
}

/** CBD-35: one path prefix, `budget-spaces/{id}/calendar`; `undefined` for anything else so the loop falls through. */
export const handleMockCalendarRequest: MockRouteModule = async (directory, session, request, path, _body, now) => {
  if (!(path[0] === "budget-spaces" && path.length === 3 && path[2] === "calendar")) return undefined;
  if (request.method !== "GET") return undefined;
  if (!session) throw new ApiError(403, "authorization_denied");
  try {
    const space = calendarSpaceOf(directory, session.accountSubjectId, path[1]!);
    const url = new URL(request.url);
    return json(handleCalendar(space, url, now()));
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code }, error.status);
    return json({ error: "request_failed" }, 503);
  }
};
