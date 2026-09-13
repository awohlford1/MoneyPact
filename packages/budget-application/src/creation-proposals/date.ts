import type { ISODate } from "@cobudget/budget-domain/shared";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function isoDate(value: string): ISODate {
  if (!ISO_DATE_PATTERN.test(value)) throw new RangeError("Expected an ISO calendar date");
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) {
    throw new RangeError("Expected a real ISO calendar date");
  }
  return value as ISODate;
}

export function addCalendarDays(date: ISODate, days: number): ISODate {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const instant = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(instant.toISOString().slice(0, 10));
}

export function compareCalendarDates(left: ISODate, right: ISODate): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
