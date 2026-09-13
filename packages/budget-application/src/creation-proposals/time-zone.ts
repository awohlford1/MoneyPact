/**
 * Named IANA time-zone validation, canonicalization, and budget-local date
 * arithmetic (CBD-232 §5.2, §6.1, §7.2).
 *
 * Assumption (contract gap, stated per the task packet): the contract requires
 * a "named IANA time zone" and rejects "offset, abbreviation, unknown zone".
 * The IANA database itself contains legacy backward-compatibility links such
 * as `EST`, `PST8PDT`, and `UTC` that Node's `Intl` accepts as valid time
 * zones but that are not what a user picking a place-based zone means, and at
 * least one of them (observed: `EST` under this runtime's ICU data) resolves
 * through `Intl.DateTimeFormat#resolvedOptions` to a real `Area/Location`
 * zone that merely shares its offset (`America/Panama`), which would defeat a
 * check performed only on the resolved name. This module therefore requires
 * the *input itself*, not merely its resolved form, to already look like a
 * named `Area/Location` zone, and only then asks `Intl` to validate (and,
 * when the runtime canonicalizes an alias, resolve) it. That accepts every
 * real named zone (`America/New_York`, `Australia/Lord_Howe`, ...) and
 * rejects bare abbreviations, `UTC`, and fixed-offset strings alike.
 */

import { toISODate, type ISODate } from "@cobudget/budget-domain/shared";

const NAMED_ZONE_PATTERN = /^[A-Za-z_+\-]+(?:\/[A-Za-z_+\-0-9]+)+$/u;

/** Canonicalize and validate a named IANA time zone, or return `null` if invalid. */
export function canonicalizeTimeZone(candidate: string): string | null {
  if (!NAMED_ZONE_PATTERN.test(candidate)) return null;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
  return NAMED_ZONE_PATTERN.test(resolved) ? resolved : null;
}

function formatToParts(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

/** The instant's offset from UTC in minutes, in the given zone. */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = formatToParts(instant, timeZone);
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * The UTC instant corresponding to a civil wall-clock time in `timeZone`.
 *
 * DST-aware by construction: it iterates the offset lookup against its own
 * output until it converges, which self-corrects across a spring-forward or
 * fall-back transition. Two iterations are sufficient for every real IANA
 * zone (transitions do not move the local offset by more than a few hours).
 */
function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  let guessMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = offsetMinutesAt(new Date(guessMillis), timeZone);
    const nextGuess = Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000;
    if (nextGuess === guessMillis) break;
    guessMillis = nextGuess;
  }
  return new Date(guessMillis);
}

/** The calendar date "today" is in `timeZone`, at instant `now` (CBD-67 INV-11). */
export function localDateOf(now: Date, timeZone: string): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return toISODate(`${map["year"]}-${map["month"]}-${map["day"]}`);
}

/** The UTC instant of local midnight (00:00:00) at the start of `date` in `timeZone`. */
export function localMidnightInstant(date: ISODate, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return zonedTimeToInstant(year, month, day, 0, 0, 0, timeZone);
}
