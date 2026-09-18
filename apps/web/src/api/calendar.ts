/**
 * UI-P06 (CBD-323, event contract CBD-321; UI-BUILD-PLAN.md section 4.6): the financial calendar client, in the
 * one-endpoint shape section 4.6 states verbatim. A new client module, matching the precedent every other
 * surface's own client set (`reports.ts`, `invitations.ts`): a new surface gets its own module, never an
 * extension of `ApiClient` in `client.ts`.
 *
 * CBD-323-AC02: `today` is the BUDGET-SPACE date, resolved by the server, never the device's. This module (and
 * `calendar-view.tsx`, which reads it) must never call `Date.now()` or `new Date()` to resolve "today" -- the
 * grep test in `calendar.test.ts` asserts neither token appears in either file. Both files may still do ordinary
 * calendar-day arithmetic on an *ISO date string the server already supplied* (a month label, a grid range, a
 * "next month" jump): that is date arithmetic, not a device-clock read, and section 6.3.1's "no client-side
 * arithmetic on money" does not reach it -- nothing here is a minor-unit figure.
 *
 * Bootstrap: the very first read of a freshly opened calendar has no server-supplied date yet to build a range
 * from, and guessing one from the device clock is exactly what AC02 forbids. So an empty `from`/`to` (the literal
 * shape the packet's own endpoint line shows, `?from=&to=&kinds=`) is a deliberate second meaning of this
 * endpoint, not a validation gap: the mock (`mock-calendar.ts`) answers it with the month containing its own
 * `today`, and every subsequent read (Previous/Next/Today/a direct date) supplies a concrete range computed from
 * a server-supplied date already on hand (the last response's `today`, or the month currently on screen).
 */
import { addDays, compareDates, dayOfWeekIndex, lastDayOfMonth, partsOf, toISODate } from "@cobudget/budget-domain/shared";
import type { ISODate } from "@cobudget/budget-domain/shared";
import { ApiError } from "./client.ts";

// ---------------------------------------------------------------------------
// Wire shape -- UI-BUILD-PLAN.md section 4.6, verbatim, plus `unavailableKinds` (see the finding in this
// packet's result: the plan's "partial -- one event source failed, the gap is named" state needs a field to
// name the gap in, and none exists on the wire shape as written).
// ---------------------------------------------------------------------------

export type CalendarEventKind = "period_start" | "period_end" | "payday";
/** Every kind the toolbar can filter by today. Bills, goals and income arrive with their own future packets
 * (out of this packet's scope) through the mock's append-only `EVENT SOURCE REGISTRY`; requesting one of those
 * kinds today is exactly the "requested kind has no source yet" case `unavailableKinds` names. */
export const CALENDAR_EVENT_KINDS: readonly CalendarEventKind[] = ["period_start", "period_end", "payday"];

export interface WireCalendarEvent {
  eventId: string;
  kind: CalendarEventKind;
  date: string;
  label: string;
  status: "projected" | "actual";
  freshness: "current" | "stale";
  href: string | null;
}
export interface WireCalendar {
  budgetSpaceId: string;
  timeZone: string;
  /** The budget-space's current date, server-resolved. Never derived from the device clock (CBD-323-AC02). */
  today: string;
  from: string;
  to: string;
  dataAsOf: string;
  events: readonly WireCalendarEvent[];
  /** Requested kinds this response could not include, because no event source is registered for them yet. */
  unavailableKinds: readonly string[];
}

// ---------------------------------------------------------------------------
// The client.
// ---------------------------------------------------------------------------

export interface CalendarClient {
  /** `from`/`to` are ISO dates, or both `""` to ask for the month containing the server's own `today`. */
  calendar(budgetSpaceId: string, from: string, to: string, kinds: readonly CalendarEventKind[], signal?: AbortSignal): Promise<WireCalendar>;
}

export function createCalendarClient(base = "/v1", fetcher: typeof fetch = fetch): CalendarClient {
  return {
    async calendar(budgetSpaceId, from, to, kinds, signal) {
      const query = new URLSearchParams({ from, to, kinds: kinds.join(",") });
      const response = await fetcher(`${base}/budget-spaces/${encodeURIComponent(budgetSpaceId)}/calendar?${query.toString()}`, {
        method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store",
        ...(signal ? { signal } : {}),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new ApiError(response.status, typeof body.error === "string" ? body.error : "request_failed");
      return body as unknown as WireCalendar;
    },
  };
}

// ---------------------------------------------------------------------------
// Pure calendar-day arithmetic. No minor-unit figure and no device-clock read anywhere below.
// ---------------------------------------------------------------------------

/** The first of the month containing `date`. */
export function monthStartOf(date: string): ISODate {
  const { year, month } = partsOf(toISODate(date));
  return toISODate(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`);
}

/** `monthStart` shifted by whole months, always landing on the 1st. */
export function addMonths(monthStart: string, delta: number): ISODate {
  const { year, month } = partsOf(toISODate(monthStart));
  const zeroBased = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(zeroBased / 12);
  const shiftedMonth = (((zeroBased % 12) + 12) % 12) + 1;
  return toISODate(`${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}-01`);
}

/** The full Monday-through-Sunday weeks a month grid needs (CBD's own default weekly anchor, `definition.ts`
 * `DEFAULT_WEEKLY_ANCHOR`), so leading/trailing days from the adjacent month are real, fetched dates -- a period
 * boundary or payday landing on one of them is shown, never silently dropped because it fell outside the exact
 * calendar month. */
export function gridRangeForMonth(monthStart: string): { from: ISODate; to: ISODate } {
  const start = toISODate(monthStart);
  const end = lastDayOfMonth(start);
  const from = addDays(start, -dayOfWeekIndex(start));
  const to = addDays(end, 6 - dayOfWeekIndex(end));
  return { from, to };
}

/** One calendar cell: a real date, whether or not it falls in the displayed month. */
export interface CalendarCell {
  date: ISODate;
  inMonth: boolean;
  events: readonly WireCalendarEvent[];
}

/** CBD-323-AC01: the month grid's own presentation of the fetched events -- one row of `CalendarCell`s per
 * week, Monday first, spanning the full grid range `gridRangeForMonth` requested. */
export function monthGridCells(monthStart: string, events: readonly WireCalendarEvent[]): readonly CalendarCell[] {
  const start = toISODate(monthStart);
  const { year, month } = partsOf(start);
  const { from, to } = gridRangeForMonth(monthStart);
  const byDate = new Map<string, WireCalendarEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date);
    if (list) list.push(event); else byDate.set(event.date, [event]);
  }
  const cells: CalendarCell[] = [];
  for (let date = from; compareDates(date, to) <= 0; date = addDays(date, 1)) {
    const parts = partsOf(date);
    cells.push({ date, inMonth: parts.year === year && parts.month === month, events: byDate.get(date) ?? [] });
  }
  return cells;
}

/** One date's events, for the agenda list. */
export interface AgendaGroup {
  date: ISODate;
  events: readonly WireCalendarEvent[];
}

/** CBD-323-AC01: the agenda's own presentation of the *same* fetched events, grouped and sorted by date --
 * never a second fetch, so month and agenda cannot disagree by construction. */
export function agendaGroups(events: readonly WireCalendarEvent[]): readonly AgendaGroup[] {
  const byDate = new Map<string, WireCalendarEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date);
    if (list) list.push(event); else byDate.set(event.date, [event]);
  }
  return [...byDate.entries()].sort(([a], [b]) => compareDates(toISODate(a), toISODate(b))).map(([date, list]) => ({ date: toISODate(date), events: list }));
}

/** CBD-323-AC01: the identity a "same event set" comparison uses -- both presentations must produce exactly
 * this set from the same fetch. */
export function eventIdentity(event: WireCalendarEvent): string {
  return `${event.eventId}:${event.date}`;
}

// ---------------------------------------------------------------------------
// View state: one bundle carrying the fetched range, the active filters, the presentation and the selection, so
// switching presentation is provably a no-op on everything else (CBD-323-AC01's "switching preserves the
// selected date, range and filters").
// ---------------------------------------------------------------------------

export type CalendarPresentation = "month" | "agenda";

export interface CalendarViewState {
  /** `""` only before the bootstrap read resolves; a concrete month's 1st afterward. */
  monthStart: string;
  kinds: readonly CalendarEventKind[];
  selectedDate: string | null;
  presentation: CalendarPresentation;
}

export const INITIAL_CALENDAR_VIEW_STATE: CalendarViewState = {
  monthStart: "", kinds: CALENDAR_EVENT_KINDS, selectedDate: null, presentation: "month",
};

/** Switches presentation only -- every other field of `state` is carried over unchanged. */
export function withPresentation(state: CalendarViewState, presentation: CalendarPresentation): CalendarViewState {
  return { ...state, presentation };
}
export function withMonthStart(state: CalendarViewState, monthStart: string): CalendarViewState {
  return { ...state, monthStart, selectedDate: null };
}
export function withSelectedDate(state: CalendarViewState, selectedDate: string | null): CalendarViewState {
  return { ...state, selectedDate };
}
export function withKind(state: CalendarViewState, kind: CalendarEventKind, enabled: boolean): CalendarViewState {
  const kinds = enabled ? [...new Set([...state.kinds, kind])] : state.kinds.filter(existing => existing !== kind);
  return { ...state, kinds };
}
