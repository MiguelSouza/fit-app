import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dateMinusDays,
  daysBetween,
  DEFAULT_TIMEZONE,
  instantAt,
  instantPlusMinutes,
  isLocalDate,
  localDateOf,
  todayUtc,
} from '../src/synthetic/time.ts';

/**
 * Dates and instants: UTC in the data, the patient's calendar locally, and the
 * conversion between them.
 *
 * The one case worth a test on its own is a time zone that changes offset.
 * São Paulo has not since 2019, so a hard-coded `-03:00` would pass every
 * assertion a Brazilian patient could produce — and be silently hours wrong on
 * the first patient anywhere else. Lisbon is here to hold that honest.
 */

test('a local date is a date that exists', () => {
  assert.ok(isLocalDate('2026-10-19'));
  assert.ok(isLocalDate('2024-02-29'));

  assert.ok(!isLocalDate('2026-02-30'), 'February 30th was accepted');
  assert.ok(!isLocalDate('2025-02-29'), 'a leap day of a non-leap year was accepted');
  assert.ok(!isLocalDate('2026-13-01'));
  assert.ok(!isLocalDate('19/10/2026'));
  assert.ok(!isLocalDate('2026-10-19T00:00:00Z'));
  assert.ok(!isLocalDate(''));
});

test('date arithmetic crosses months, years and a leap day', () => {
  assert.equal(dateMinusDays('2026-10-19', 0), '2026-10-19');
  assert.equal(dateMinusDays('2026-10-19', 89), '2026-07-22');
  assert.equal(dateMinusDays('2026-01-01', 1), '2025-12-31');
  assert.equal(dateMinusDays('2024-03-01', 1), '2024-02-29');

  assert.equal(daysBetween('2026-07-22', '2026-10-19'), 89);
  assert.equal(daysBetween('2026-10-19', '2026-10-19'), 0);
  assert.equal(daysBetween('2026-10-19', '2026-07-22'), -89);
});

test('today is read in UTC, not in whatever zone this machine is in', () => {
  // 23:30 in Tokyo on the 19th is still the 19th in UTC; 00:30 is the 20th
  // there and the 19th here. Either way the answer follows UTC, so a run in
  // one office and a run in another ask for the same window.
  assert.equal(todayUtc(new Date('2026-10-19T14:30:00Z')), '2026-10-19');
  assert.equal(todayUtc(new Date('2026-10-19T23:59:59Z')), '2026-10-19');
  assert.equal(todayUtc(new Date('2026-10-20T00:00:01Z')), '2026-10-20');
});

test('a wall clock time becomes the UTC instant of that zone', () => {
  // São Paulo is UTC-3 all year.
  assert.equal(instantAt('2026-10-19', 22, 45, DEFAULT_TIMEZONE), '2026-10-20T01:45:00.000Z');
  assert.equal(instantAt('2026-01-15', 7, 0, DEFAULT_TIMEZONE), '2026-01-15T10:00:00.000Z');

  // Lisbon is not: 23:00 is 22:00 UTC in summer and 23:00 UTC in winter. A
  // fixed offset would get one of these two wrong.
  assert.equal(instantAt('2026-07-15', 23, 0, 'Europe/Lisbon'), '2026-07-15T22:00:00.000Z');
  assert.equal(instantAt('2026-01-15', 23, 0, 'Europe/Lisbon'), '2026-01-15T23:00:00.000Z');
});

test('an instant reads back as the local date it happened on', () => {
  // The round trip is what the records rely on: a night that began at 22:45
  // local on the 19th is stored as an instant on the 20th in UTC, and is still
  // the night of the 19th.
  const startedAt = instantAt('2026-10-19', 22, 45, DEFAULT_TIMEZONE);

  assert.equal(localDateOf(startedAt, DEFAULT_TIMEZONE), '2026-10-19');
  assert.equal(localDateOf(startedAt, 'UTC'), '2026-10-20');
});

test('minutes are added to an instant, not to a wall clock', () => {
  assert.equal(instantPlusMinutes('2026-10-19T23:30:00.000Z', 450), '2026-10-20T07:00:00.000Z');

  // Across a Lisbon spring-forward: seven hours in bed is seven hours, even
  // though the clock on the wall moved by eight.
  const bedtime = instantAt('2026-03-28', 23, 0, 'Europe/Lisbon');
  const waking = instantPlusMinutes(bedtime, 420);

  assert.equal(bedtime, '2026-03-28T23:00:00.000Z');
  assert.equal(waking, '2026-03-29T06:00:00.000Z');
  assert.equal(localDateOf(waking, 'Europe/Lisbon'), '2026-03-29');
});

test('a date that does not exist is refused instead of rolled over', () => {
  assert.throws(() => dateMinusDays('2026-02-30', 1), /not a date/);
  assert.throws(() => dateMinusDays('not-a-date', 1), /not a date/);
});
