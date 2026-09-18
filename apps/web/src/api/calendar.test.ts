/**
 * UI-P06 (CBD-323, event contract CBD-321) unit tests: range arithmetic on the request (dates, not money), the
 * no-device-clock assertion (CBD-323-AC02), identical event sets across the month and agenda presentations with
 * a preserved selection when switching (CBD-323-AC01), and the mock's own derivation reconciling against the
 * existing schedule engine's boundary adapters.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApiError } from "./client.ts";
import { createMockClient, handleMockRequest } from "./mock-server.ts";
import type { MockWire } from "./mock-server.ts";
import {
  INITIAL_CALENDAR_VIEW_STATE, addMonths, agendaGroups, createCalendarClient, eventIdentity, gridRangeForMonth,
  monthGridCells, monthStartOf, withKind, withMonthStart, withPresentation, withSelectedDate,
} from "./calendar.ts";
import type { WireCalendarEvent } from "./calendar.ts";

// --- CBD-323-AC02: no device-clock read in the today-resolution path -------------------------------------------

test("CBD-323-AC02: calendar.ts and calendar-view.tsx contain no Date.now() or new Date() call", () => {
  for (const relativePath of ["./calendar.ts", "../app/(app)/budgets/[id]/calendar/calendar-view.tsx"]) {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    const source = readFileSync(path, "utf8");
    // REV-UIP04-5-style: comment lines are excluded, the same way `reports.test.ts`'s own arithmetic check
    // does, so this module's own doc comments *about* the forbidden calls (there are several, explaining why
    // they are absent) do not trip the very check they document.
    const codeLines = source.split("\n").filter(line => !/^\s*(?:\/\/|\*|\/\*\*)/u.test(line));
    const code = codeLines.join("\n");
    assert.equal(/Date\.now\s*\(/u.test(code), false, `${relativePath} must never call Date.now()`);
    assert.equal(/new\s+Date\s*\(/u.test(code), false, `${relativePath} must never construct a Date`);
  }
});

// --- Pure range arithmetic ---------------------------------------------------------------------------------------

test("monthStartOf, addMonths and gridRangeForMonth compute exact ranges from a server-supplied date", () => {
  assert.equal(monthStartOf("2026-09-15"), "2026-09-01");
  assert.equal(addMonths("2026-09-01", 1), "2026-10-01");
  assert.equal(addMonths("2026-09-01", -1), "2026-08-01");
  assert.equal(addMonths("2026-01-01", -1), "2025-12-01", "a December wrap carries the year back");
  assert.equal(addMonths("2026-12-01", 1), "2027-01-01", "a January wrap carries the year forward");

  // 2026-09-01 is a Tuesday; the grid's Monday-first week starts the Monday before it, 2026-08-31, and ends the
  // Sunday after the month's last day (2026-09-30, a Wednesday), 2026-10-04.
  assert.deepEqual(gridRangeForMonth("2026-09-01"), { from: "2026-08-31", to: "2026-10-04" });
});

// --- CBD-323-AC01: identical event sets across presentations, and switching preserves everything else ----------

function sampleEvents(): WireCalendarEvent[] {
  return [
    { eventId: "period-start:2026-09-01", kind: "period_start", date: "2026-09-01", label: "Period starts", status: "actual", freshness: "current", href: null },
    { eventId: "period-end:2026-09-30", kind: "period_end", date: "2026-09-30", label: "Period ends", status: "projected", freshness: "current", href: null },
    { eventId: "payday:2026-09-04:2026-09-04", kind: "payday", date: "2026-09-04", label: "Payday", status: "actual", freshness: "current", href: null },
  ];
}

test("CBD-323-AC01: the month grid and the agenda project identical event identities from the same fetch", () => {
  const events = sampleEvents();
  const cells = monthGridCells("2026-09-01", events);
  const fromGrid = new Set(cells.flatMap(cell => cell.events).map(eventIdentity));
  const groups = agendaGroups(events);
  const fromAgenda = new Set(groups.flatMap(group => group.events).map(eventIdentity));
  assert.deepEqual(fromGrid, new Set(events.map(eventIdentity)));
  assert.deepEqual(fromAgenda, new Set(events.map(eventIdentity)));
  assert.deepEqual(fromGrid, fromAgenda);
});

test("CBD-323-AC01: switching presentation preserves the selected date, range and filters", () => {
  const base = withKind(withSelectedDate(withMonthStart(INITIAL_CALENDAR_VIEW_STATE, "2026-09-01"), "2026-09-04"), "payday", false);
  const switched = withPresentation(base, "agenda");
  assert.equal(switched.monthStart, base.monthStart);
  assert.equal(switched.selectedDate, base.selectedDate);
  assert.deepEqual(switched.kinds, base.kinds);
  assert.equal(switched.presentation, "agenda");
  assert.notEqual(switched.presentation, base.presentation);
});

// --- Over the mock: reconciles against the existing schedule engine's own boundary adapters ---------------------

function csrfFetcher(mock: MockWire, origin = "http://localhost"): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(input), origin);
    const headers = new Headers(init?.headers);
    headers.set("origin", origin); headers.set("sec-fetch-site", "same-origin");
    const request = new Request(target, { method: init?.method ?? "GET", headers, ...(init?.body === undefined ? {} : { body: init.body }) });
    return handleMockRequest(mock, request, target.pathname.replace(/^\/v1\//, "").split("/"));
  }) as typeof fetch;
}

async function setUpBudget(clock: () => number, schedule: unknown) {
  const client = createMockClient(clock);
  await client.me();
  const proposal = await client.createProposal(
    { name: "Calendar household", timeZone: "America/New_York", currencyCode: "USD", schedule },
    "proposal-key-0000000002",
  );
  const confirmed = await client.confirmProposal(proposal.proposalId, proposal.confirmationBinding, "confirm-key-0000000002", { kind: "primary_owner_self", version: 1 });
  return { client, mock: client.mock, budgetSpaceId: confirmed.budgetSpaceId };
}

test("CBD-323: a monthly-cadence calendar's bootstrap read reports the server's own today and a Monday-first, full-week grid range", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z"); // a Tuesday, America/New_York
  const { mock, budgetSpaceId } = await setUpBudget(clock, { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } });
  const calendar = createCalendarClient("/v1", csrfFetcher(mock));

  const result = await calendar.calendar(budgetSpaceId, "", "", ["period_start", "period_end"]);
  assert.equal(result.today, "2026-09-15");
  assert.equal(result.from, "2026-08-31");
  assert.equal(result.to, "2026-10-04");
  assert.equal(result.unavailableKinds.length, 0);
  // The grid range spans four monthly boundaries (August's end, September's start and end, October's start);
  // `find` alone would land on whichever sorts first, so each assertion names its own exact date.
  const septemberStart = result.events.find(event => event.kind === "period_start" && event.date === "2026-09-01");
  assert.equal(septemberStart?.status, "actual", "the period started before today");
  const septemberEnd = result.events.find(event => event.kind === "period_end" && event.date === "2026-09-30");
  assert.equal(septemberEnd?.status, "projected", "the period has not ended yet");
  const augustEnd = result.events.find(event => event.kind === "period_end" && event.date === "2026-08-31");
  assert.equal(augustEnd?.status, "actual", "August's period end is already in the past");
});

test("CBD-323: a paycheck-cadence calendar reports a payday event for every Friday in range, and Previous/Next request exact ranges", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId } = await setUpBudget(clock, { cadence: "paycheck", pattern: { kind: "weekly", weekday: "friday" }, businessDayPolicy: "previous-business-day" });
  const calendar = createCalendarClient("/v1", csrfFetcher(mock));

  const bootstrap = await calendar.calendar(budgetSpaceId, "", "", ["payday"]);
  const fridays = bootstrap.events.filter(event => event.kind === "payday");
  assert.ok(fridays.length >= 4, "September 2026's grid range spans at least four Fridays");
  for (const payday of fridays) assert.equal(new Date(`${payday.date}T00:00:00Z`).getUTCDay(), 5, "every payday falls on a Friday");

  // CBD-323-AC02: Previous/Next request exact ranges computed from the month already on screen, never a guess.
  const previousMonth = addMonths(monthStartOf(bootstrap.today), -1);
  const { from, to } = gridRangeForMonth(previousMonth);
  const previous = await calendar.calendar(budgetSpaceId, from, to, ["payday"]);
  assert.equal(previous.from, from); assert.equal(previous.to, to);
  assert.equal(previous.today, bootstrap.today, "today does not move when navigating");
});

test("CBD-323: a custom-fixed-length cadence's period boundaries walk correctly, extrapolating backward from its start boundary", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z"); // a Tuesday, America/New_York
  const { mock, budgetSpaceId } = await setUpBudget(clock, { cadence: "custom-fixed-length", startBoundary: "2026-09-01", lengthInDays: 14 });
  const calendar = createCalendarClient("/v1", csrfFetcher(mock));

  const result = await calendar.calendar(budgetSpaceId, "", "", ["period_start", "period_end"]);
  assert.equal(result.today, "2026-09-15");
  assert.equal(result.unavailableKinds.length, 0);
  // Fourteen-day periods from 2026-09-01, extrapolated backward: ...2026-08-18..2026-08-31, 2026-09-01..09-14,
  // 2026-09-15..09-28, 2026-09-29..10-12... The Monday-first grid range for September (2026-08-31 to 2026-10-04)
  // spans three period-start boundaries and three period-end boundaries.
  const starts = result.events.filter(event => event.kind === "period_start").map(event => event.date).sort();
  assert.deepEqual(starts, ["2026-09-01", "2026-09-15", "2026-09-29"]);
  const ends = result.events.filter(event => event.kind === "period_end").map(event => event.date).sort();
  assert.deepEqual(ends, ["2026-08-31", "2026-09-14", "2026-09-28"]);
  const currentPeriodStart = result.events.find(event => event.kind === "period_start" && event.date === "2026-09-15");
  assert.equal(currentPeriodStart?.status, "actual", "the current fourteen-day period starts today, which counts as already arrived");
});

test("CBD-323: a kind with no registered source is named in unavailableKinds; registered kinds still render", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId } = await setUpBudget(clock, { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } });
  const calendar = createCalendarClient("/v1", csrfFetcher(mock));
  const result = await calendar.calendar(budgetSpaceId, "", "", ["period_start", "bill" as never]);
  assert.deepEqual(result.unavailableKinds, ["bill"]);
  assert.ok(result.events.every(event => event.kind === "period_start"));
  assert.ok(result.events.length > 0);
});

test("CBD-323: an invalid range is refused 400, and a subject with no membership is refused 403", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId } = await setUpBudget(clock, { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } });
  const calendar = createCalendarClient("/v1", csrfFetcher(mock));
  await assert.rejects(() => calendar.calendar(budgetSpaceId, "2026-09-30", "2026-09-01", ["period_start"]), (error: unknown) => error instanceof ApiError && error.status === 400);
  await assert.rejects(() => calendar.calendar(budgetSpaceId, "2026-09-01", "", ["period_start"]), (error: unknown) => error instanceof ApiError && error.status === 400);

  const outsider = createMockClient(clock);
  const outsiderCalendar = createCalendarClient("/v1", csrfFetcher(outsider.mock));
  await assert.rejects(() => outsiderCalendar.calendar(budgetSpaceId, "2026-09-01", "2026-09-30", ["period_start"]), (error: unknown) => error instanceof ApiError && error.status === 403);
});
