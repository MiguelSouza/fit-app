import { addDays, addMinutes, differenceInCalendarDays, isValid, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Dates and instants, the way the API stores them.
 *
 * CLAUDE.md ("Dados de saúde") fixes three things this module exists to
 * honour: every instant is UTC, the patient's time zone lives on the profile,
 * and a night of sleep is identified by the local date it *started*. So every
 * record carries both — the local calendar date it belongs to, which is what a
 * professional reads, and the UTC instant it happened at, which is what gets
 * compared.
 *
 * The conversion goes through `date-fns-tz` rather than a hard-coded `-03:00`.
 * São Paulo has had no daylight saving since 2019 and the offset would be
 * right today, which is exactly what makes it the wrong thing to write down:
 * the moment a patient has another time zone on their profile, the data would
 * be silently off by hours.
 */

/** The time zone every synthetic patient is in. */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** A local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;

/** The format of a local date, used for both parsing and printing. */
const DATE_FORMAT = 'yyyy-MM-dd';

/**
 * Reads a `YYYY-MM-DD` as midnight UTC, which is how this module carries a
 * calendar date: a date is not an instant, and anchoring it to UTC keeps the
 * arithmetic from depending on the time zone of whoever runs the script.
 */
function asUtcMidnight(date: LocalDate): Date {
  const parsed = parseISO(`${date}T00:00:00Z`);

  if (!isValid(parsed)) throw new Error(`not a date in YYYY-MM-DD: ${date}`);

  return parsed;
}

/** Whether `value` is a `YYYY-MM-DD` that exists. */
export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = parseISO(`${value}T00:00:00Z`);

  // `parseISO` accepts the shape and then rolls an impossible day over, so the
  // round trip is the actual check: `2026-02-30` comes back as March 2nd.
  return isValid(parsed) && formatInTimeZone(parsed, 'UTC', DATE_FORMAT) === value;
}

/** The local date `days` before `date`. */
export function dateMinusDays(date: LocalDate, days: number): LocalDate {
  return formatInTimeZone(addDays(asUtcMidnight(date), -days), 'UTC', DATE_FORMAT);
}

/** Today, in UTC: the default end of the window. */
export function todayUtc(now: Date = new Date()): LocalDate {
  return formatInTimeZone(now, 'UTC', DATE_FORMAT);
}

/** How many calendar days separate two local dates (`to - from`). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return differenceInCalendarDays(asUtcMidnight(to), asUtcMidnight(from));
}

/**
 * The UTC instant of a wall clock time on a local date, in a time zone.
 *
 * @returns an ISO 8601 string in UTC, as the API would store it
 */
export function instantAt(date: LocalDate, hour: number, minute: number, timezone: string): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const instant = fromZonedTime(`${date}T${pad(hour)}:${pad(minute)}:00`, timezone);

  if (!isValid(instant)) {
    throw new Error(`no instant for ${date} ${pad(hour)}:${pad(minute)} in ${timezone}`);
  }

  return instant.toISOString();
}

/** `minutes` after an ISO instant, still in UTC. */
export function instantPlusMinutes(instant: string, minutes: number): string {
  return addMinutes(parseISO(instant), minutes).toISOString();
}

/** The local date an instant falls on, in a time zone. */
export function localDateOf(instant: string, timezone: string): LocalDate {
  return formatInTimeZone(parseISO(instant), timezone, DATE_FORMAT);
}
