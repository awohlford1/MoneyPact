"use client";
/**
 * The financial calendar, month and agenda (CBD-323, event contract CBD-321; UI-BUILD-PLAN.md section 4.6).
 *
 * One fetch feeds both presentations (CBD-323-AC01): `MonthGrid` and `AgendaList` are two pure projections
 * (`monthGridCells`/`agendaGroups`, in `../../../../../api/calendar`) of the same `events` array this component
 * holds in state, so they cannot disagree by construction, and switching between them touches nothing else --
 * `withPresentation` carries the range, filters and selection over unchanged.
 *
 * CBD-323-AC02: "Today" is resolved once, from the server's own `today` field on the most recent response, and
 * every navigation (Previous/Next/Today/the month input) computes its next request from that server-supplied
 * date or from the month already on screen -- never from the device clock. This file contains no `Date.now()`
 * and no `new Date()` anywhere; `calendar.test.ts` greps it (and `../../../../../api/calendar.ts`) to prove it.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import {
  CALENDAR_EVENT_KINDS, INITIAL_CALENDAR_VIEW_STATE, addMonths, agendaGroups, createCalendarClient,
  gridRangeForMonth, monthGridCells, monthStartOf, withKind, withMonthStart, withPresentation,
  withSelectedDate,
} from "../../../../../api/calendar";
import type {
  CalendarCell, CalendarEventKind, CalendarViewState, WireCalendar, WireCalendarEvent,
} from "../../../../../api/calendar";
import { ApiError } from "../../../../../api/client";
import { apiBase } from "@/api/runtime-mode";
import { useSession } from "../../../../../session/SessionProvider";
import { Alert } from "../../../../../components/Alert";
import { Button } from "../../../../../components/Button";
import { Checkbox } from "../../../../../components/Choice";
import { Input } from "../../../../../components/Input";
// CBD-35: the polite live region, the uniform denial and the failure classifier are shared shapes.
import { DeniedState, StatusRegion, classifyFailure, useResource } from "../../../../../ui/resource";

const KIND_LABELS: Record<CalendarEventKind, string> = {
  period_start: "Period starts", period_end: "Period ends", payday: "Paydays",
};
const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthLabel(monthStart: string): string {
  const [year, month] = monthStart.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}
function dayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}
function monthInputValue(monthStart: string): string {
  return monthStart.slice(0, 7);
}

function useCalendarClient() {
  return useMemo(() => createCalendarClient(apiBase), []);
}

function eventSummary(events: readonly WireCalendarEvent[]): string {
  if (events.length === 0) return "";
  return events.map(event => KIND_LABELS[event.kind]).join(", ");
}

// ---------------------------------------------------------------------------
// The toolbar: navigation, the month input, and the kind filters.
// ---------------------------------------------------------------------------

function CalendarToolbar({ monthStart, kinds, onPrevious, onNext, onToday, onGoToMonth, onKindChange }: {
  monthStart: string; kinds: readonly CalendarEventKind[];
  onPrevious(): void; onNext(): void; onToday(): void; onGoToMonth(monthStart: string): void;
  onKindChange(kind: CalendarEventKind, enabled: boolean): void;
}) {
  return <div className="flex flex-wrap items-end gap-4">
    <div className="flex items-end gap-2">
      <Button variant="secondary" onClick={onPrevious}>Previous month</Button>
      <Button variant="secondary" onClick={onToday}>Today</Button>
      <Button variant="secondary" onClick={onNext}>Next month</Button>
    </div>
    <Input
      id="calendar-go-to-month" type="month" label="Go to month" value={monthInputValue(monthStart)}
      onChange={event => { const value = event.target.value; if (/^\d{4}-\d{2}$/.test(value)) onGoToMonth(`${value}-01`); }}
    />
    <fieldset className="flex flex-wrap gap-4">
      <legend className="text-sm font-semibold text-on-surface">Show</legend>
      {CALENDAR_EVENT_KINDS.map(kind => (
        <Checkbox
          key={kind} id={`calendar-kind-${kind}`} label={KIND_LABELS[kind]}
          checked={kinds.includes(kind)} onChange={event => onKindChange(kind, event.target.checked)}
        />
      ))}
    </fieldset>
  </div>;
}

// ---------------------------------------------------------------------------
// The month grid: a semantic table, roving-tabindex date cells, no keyboard trap (CBD-323-AC04).
// ---------------------------------------------------------------------------

function MonthGrid({ monthStart, cells, today, selectedDate, onOpenDate }: {
  monthStart: string; cells: readonly CalendarCell[]; today: string; selectedDate: string | null;
  onOpenDate(date: string): void;
}) {
  const [focusedIndex, setFocusedIndex] = useState(() => {
    const todayIndex = cells.findIndex(cell => cell.date === today);
    return todayIndex >= 0 ? todayIndex : 0;
  });
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function moveFocus(nextIndex: number) {
    const clamped = Math.max(0, Math.min(cells.length - 1, nextIndex));
    setFocusedIndex(clamped);
    refs.current[clamped]?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowRight": event.preventDefault(); moveFocus(index + 1); break;
      case "ArrowLeft": event.preventDefault(); moveFocus(index - 1); break;
      case "ArrowDown": event.preventDefault(); moveFocus(index + 7); break;
      case "ArrowUp": event.preventDefault(); moveFocus(index - 7); break;
      case "Home": event.preventDefault(); moveFocus(index - (index % 7)); break;
      case "End": event.preventDefault(); moveFocus(index - (index % 7) + 6); break;
      // Enter/Space fall through to the button's native activation (onClick), which opens the date's detail.
      default: break;
    }
  }

  const caption = `${monthLabel(monthStart)} calendar`;
  return <div className="space-y-2">
    <table role="grid" aria-describedby="calendar-grid-instructions" className="w-full border-collapse text-on-surface">
      <caption className="px-1 py-2 text-left font-semibold">{caption}</caption>
      <thead>
        <tr role="row">
          {WEEKDAY_LABELS.map(weekday => <th key={weekday} scope="col" role="columnheader" className="border border-border px-1 py-1 text-xs font-semibold">
            <span className="sm:hidden" aria-hidden="true">{weekday.slice(0, 3)}</span>
            <span className="hidden sm:inline">{weekday}</span>
          </th>)}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: cells.length / 7 }, (_unused, week) => (
          <tr role="row" key={week}>
            {cells.slice(week * 7, week * 7 + 7).map((cell, column) => {
              const index = week * 7 + column;
              const isToday = cell.date === today;
              const isSelected = cell.date === selectedDate;
              const summary = eventSummary(cell.events);
              const dayOfMonth = Number(cell.date.slice(8, 10));
              const label = [
                `${WEEKDAY_LABELS[column]}, ${dayLabel(cell.date)}`,
                cell.inMonth ? "" : "outside this month",
                isToday ? "Today" : "",
                isSelected ? "Selected" : "",
                cell.events.length === 0 ? "no events" : `${cell.events.length} event${cell.events.length === 1 ? "" : "s"}: ${summary}`,
              ].filter(Boolean).join(", ");
              return <td role="gridcell" key={cell.date} className={`border border-border p-0 align-top ${cell.inMonth ? "" : "bg-surface"}`}>
                <button
                  type="button"
                  ref={node => { refs.current[index] = node; }}
                  tabIndex={index === focusedIndex ? 0 : -1}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={label}
                  data-testid={`calendar-cell-${cell.date}`}
                  onFocus={() => setFocusedIndex(index)}
                  onKeyDown={event => onKeyDown(event, index)}
                  onClick={() => onOpenDate(cell.date)}
                  className={`flex min-h-11 w-full flex-col gap-1 p-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-interactive ${cell.inMonth ? "text-on-surface" : "text-on-surface-muted"}`}
                >
                  <span className="text-sm font-semibold">
                    {dayOfMonth}{isToday && <span className="ml-1 font-normal">(Today)</span>}{isSelected && <span className="ml-1 font-normal">(Selected)</span>}
                  </span>
                  {cell.events.map(cellEvent => <span key={cellEvent.eventId} className="truncate text-xs text-on-surface-muted">{KIND_LABELS[cellEvent.kind]}</span>)}
                </button>
              </td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
    <p id="calendar-grid-instructions" className="sr-only">
      This grid has {cells.length} dates. Use arrow keys to move between dates, Home and End to reach the start
      and end of a week. Press Enter or Space to view a date&apos;s events. Press Tab to leave the calendar grid.
    </p>
  </div>;
}

// ---------------------------------------------------------------------------
// The agenda: the same events, grouped and sorted by date (CBD-323-AC01, CBD-323-AC05's narrow-width substitute).
// ---------------------------------------------------------------------------

function AgendaList({ events, today, selectedDate, onOpenDate }: {
  events: readonly WireCalendarEvent[]; today: string; selectedDate: string | null; onOpenDate(date: string): void;
}) {
  const groups = agendaGroups(events);
  if (groups.length === 0) return <Alert>No events in this range yet.</Alert>;
  return <ol className="space-y-3" aria-label="Agenda">
    {groups.map(group => {
      const isToday = group.date === today;
      const isSelected = group.date === selectedDate;
      return <li key={group.date} className="rounded-md border border-border p-3">
        <button type="button" data-testid={`agenda-date-${group.date}`} onClick={() => onOpenDate(group.date)} className="min-h-11 w-full text-left font-semibold">
          {dayLabel(group.date)}{isToday ? " (Today)" : ""}{isSelected ? " (Selected)" : ""}
        </button>
        <ul className="mt-1 space-y-1">
          {group.events.map(event => <li key={event.eventId} className="text-on-surface-muted">
            {KIND_LABELS[event.kind]} &middot; {event.status === "actual" ? "actual" : "projected"}
          </li>)}
        </ul>
      </li>;
    })}
  </ol>;
}

// ---------------------------------------------------------------------------
// Event detail: a dialog naming kind, date meaning, projected/actual, freshness and any link (CBD-323-AC03);
// focus returns to the originating cell on close, which the platform's own `showModal`/`close` already does as
// long as the triggering button stays in the DOM -- true here, since neither grid nor agenda unmount on open.
// ---------------------------------------------------------------------------

const KIND_MEANING: Record<CalendarEventKind, string> = {
  period_start: "The first day of a budget period.", period_end: "The last day of a budget period.",
  payday: "An expected payday for this budget's income schedule.",
};

function EventDetail({ date, events, dialogRef }: { date: string | null; events: readonly WireCalendarEvent[]; dialogRef: RefObject<HTMLDialogElement | null> }) {
  const titleId = "calendar-event-detail-heading";
  return <dialog ref={dialogRef} aria-labelledby={titleId} className="m-auto w-[min(100%,28rem)] rounded-lg border border-border bg-surface-raised p-6 text-on-surface shadow-overlay backdrop:bg-on-surface/60">
    <h2 id={titleId} className="mb-3 font-display text-xl font-semibold">{date ? dayLabel(date) : "Date detail"}</h2>
    {events.length === 0 ? <p className="mb-4 text-on-surface-muted">No events on this date.</p> : <ul className="mb-4 space-y-3">
      {events.map(event => <li key={event.eventId} className="border-t border-border pt-3 first:border-0 first:pt-0">
        <p className="font-semibold">{KIND_LABELS[event.kind]}</p>
        <p className="text-on-surface-muted">{KIND_MEANING[event.kind]}</p>
        <p className="text-on-surface-muted">{event.status === "actual" ? "Actual" : "Projected"}, {event.freshness === "stale" ? "captured earlier" : "current"}.</p>
        {event.href && <a className="text-interactive underline" href={event.href}>Open</a>}
      </li>)}
    </ul>}
    <div className="flex justify-end">
      <Button variant="secondary" onClick={() => dialogRef.current?.close()}>Close</Button>
    </div>
  </dialog>;
}

// ---------------------------------------------------------------------------
// The view.
// ---------------------------------------------------------------------------

function RegionFailure({ error, retry }: { error: unknown; retry(): void }) {
  const kind = classifyFailure(error);
  if (kind === "denied") return <DeniedState><p>Your current session cannot see the calendar for this budget.</p></DeniedState>;
  return <Alert tone="danger" title="Unable to load the calendar">
    <p>{kind === "terminal" ? "This budget's calendar cannot be opened from here." : "We could not load the calendar. You can try again."}</p>
    {kind !== "terminal" && <Button variant="secondary" onClick={retry}>Try again</Button>}
  </Alert>;
}

function UnavailableKindsNotice({ unavailableKinds }: { unavailableKinds: readonly string[] }) {
  if (unavailableKinds.length === 0) return null;
  const names = unavailableKinds.map(kind => KIND_LABELS[kind as CalendarEventKind] ?? kind).join(", ");
  return <Alert title="Some events are not shown">{names} could not be included. The events shown above are complete for the kinds that loaded.</Alert>;
}

export function CalendarView({ id }: { id: string }) {
  const { session } = useSession();
  const api = useCalendarClient();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [state, setState] = useState<CalendarViewState>(INITIAL_CALENDAR_VIEW_STATE);
  const identity = `${session.sessionRef}:${session.sessionVersion}:${id}:${state.monthStart}:${state.kinds.join(",")}`;
  const load = useCallback((signal: AbortSignal): Promise<WireCalendar> => {
    const range = state.monthStart === "" ? { from: "", to: "" } : gridRangeForMonth(state.monthStart);
    return api.calendar(id, range.from, range.to, state.kinds, signal);
  }, [api, id, state.monthStart, state.kinds]);
  const calendar = useResource(identity, load);

  // REV-UIP06-BOOT: the bootstrap read (monthStart === "") resolves to a server-chosen month; this mirrors
  // reports-view.tsx's `knownPeriodId` pattern of adopting a server-supplied identity during render rather than
  // in an effect, so the adoption commits in the same pass the response arrives in. It intentionally does NOT
  // change `state.monthStart` (which would trigger a second, redundant fetch) -- `displayMonthStart` below is
  // the month actually on screen, independent of whether a concrete request has been made yet.
  const [knownMonthStart, setKnownMonthStart] = useState("");
  const freshMonthStart = calendar.value ? monthStartOf(calendar.value.today) : undefined;
  if (state.monthStart === "" && freshMonthStart && freshMonthStart !== knownMonthStart) setKnownMonthStart(freshMonthStart);
  const displayMonthStart = state.monthStart || knownMonthStart;
  const today = calendar.value?.today;

  function openDetail(date: string) {
    setState(previous => withSelectedDate(previous, date));
    dialogRef.current?.showModal();
  }

  const loading = !calendar.value && !calendar.error;
  const denied = calendar.error instanceof ApiError && (calendar.error.status === 401 || calendar.error.status === 403);
  if (denied) return <section className="space-y-6"><h1 className="font-display text-3xl font-semibold">Calendar</h1>
    <DeniedState><p>Your current session cannot open the calendar for this budget.</p></DeniedState>
  </section>;

  const events = calendar.value?.events ?? [];
  const selectedEvents = state.selectedDate ? events.filter(event => event.date === state.selectedDate) : [];

  return <section className="space-y-6" aria-labelledby="calendar-heading">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 id="calendar-heading" className="font-display text-3xl font-semibold">Calendar</h1>
      <div className="flex gap-2" role="radiogroup" aria-label="View">
        <Button
          variant={state.presentation === "month" ? "primary" : "secondary"} aria-pressed={state.presentation === "month"}
          onClick={() => setState(previous => withPresentation(previous, "month"))}
        >Month</Button>
        <Button
          variant={state.presentation === "agenda" ? "primary" : "secondary"} aria-pressed={state.presentation === "agenda"}
          onClick={() => setState(previous => withPresentation(previous, "agenda"))}
        >Agenda</Button>
      </div>
    </div>
    <StatusRegion id="calendar" message={calendar.refreshed ? "Calendar refreshed." : ""} />
    {calendar.error ? <RegionFailure error={calendar.error} retry={calendar.refresh} />
      : loading ? <Alert loading>Loading the calendar…</Alert>
      : <>
        <CalendarToolbar
          monthStart={displayMonthStart} kinds={state.kinds}
          onPrevious={() => setState(previous => withMonthStart(previous, addMonths(displayMonthStart, -1)))}
          onNext={() => setState(previous => withMonthStart(previous, addMonths(displayMonthStart, 1)))}
          onToday={() => { if (today) setState(previous => withMonthStart(previous, monthStartOf(today))); }}
          onGoToMonth={monthStart => setState(previous => withMonthStart(previous, monthStart))}
          onKindChange={(kind, enabled) => setState(previous => withKind(previous, kind, enabled))}
        />
        <UnavailableKindsNotice unavailableKinds={calendar.value?.unavailableKinds ?? []} />
        {events.length === 0 && <Alert>No events in this range yet.</Alert>}
        {/* CBD-323-AC05: below `sm`, the month grid is replaced by the agenda -- the same events, not a lesser
           set -- regardless of the "Month"/"Agenda" toggle above; the toggle additionally lets a person choose
           the agenda at any width. */}
        <div className={state.presentation === "agenda" ? "hidden" : "hidden sm:block"}>
          {/* REV-UIP06-1: `displayMonthStart` can still be "" on the one throwaway render pass where React is
             about to re-run this component after the bootstrap `setKnownMonthStart` call above (the same
             "adjust state during render" pattern `reports-view.tsx`'s `knownPeriodId` already uses) --
             `monthGridCells("", ...)` would throw before that re-run ever happens, so this guards on it too. */}
          {today && displayMonthStart && <MonthGrid monthStart={displayMonthStart} cells={monthGridCells(displayMonthStart, events)} today={today} selectedDate={state.selectedDate} onOpenDate={openDetail} />}
        </div>
        <div className={state.presentation === "agenda" ? "block" : "sm:hidden"}>
          {today && <AgendaList events={events} today={today} selectedDate={state.selectedDate} onOpenDate={openDetail} />}
        </div>
        {calendar.value && <p className="text-on-surface-muted">Data as of {calendar.value.dataAsOf}.</p>}
      </>}
    <EventDetail date={state.selectedDate} events={selectedEvents} dialogRef={dialogRef} />
  </section>;
}
