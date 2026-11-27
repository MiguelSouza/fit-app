import {
  CheckinPeriodTooLongError,
  CheckinWindowClosedError,
  InvalidCheckinDateError,
  InvalidCheckinPeriodError,
} from './health-errors';

/**
 * The daily check-in: what the patient says about their own day, and the two
 * rules that make it one record per day (card P-02).
 *
 * Pure: no NestJS, no Drizzle, no I/O (CLAUDE.md rule 4). The vocabulary is
 * declared here and not imported from `@fit-app/contracts`, as `identity`'s
 * domain declares its own — the rules are written against the domain, and the
 * contract is one of its readers; the two are checked against each other at
 * the boundary, by the controller and by the presenter.
 *
 * Two things deliberately do **not** live here. Nothing reads a check-in as a
 * score, a trend or a flag: "merece revisão" is a rule of `insights`, and this
 * module answers what the person said, not what it means (CLAUDE.md, "Saúde e
 * LGPD": linguagem de apoio, nunca de diagnóstico). And nothing here decides
 * who may read a check-in — that is `identity`'s access rule (ADR 0017), asked
 * by the use case.
 */

/** The bottom of every scale of a check-in. */
export const CHECKIN_SCALE_MIN = 1;

/** The top of every scale. Five, because the patient answers with one tap. */
export const CHECKIN_SCALE_MAX = 5;

/**
 * One answer on the scale of 1 to 5.
 *
 * A `number` and not a union of five literals: the bound is checked here, in
 * one place, and a union would only move the check to every caller that has a
 * number in hand and has to narrow it.
 *
 * **It is an order, not a quantity.** `4` of energy is the fourth of five
 * words a screen shows, so nothing in this module adds, averages or compares
 * two of them.
 */
export type CheckinScale = number;

/**
 * What the patient may report having felt, in the order the screen shows the
 * chips and the API answers the list.
 *
 * A closed vocabulary: a symptom is only countable across weeks while the word
 * for it means one thing. `other` means "algo que não está nesta lista", and
 * what it was goes in `otherSymptom` beside it.
 *
 * The order is the product's, which is why it is written out here instead of
 * being sorted: related complaints sit together, and `other` is last because
 * it is the escape hatch.
 */
export const CHECKIN_SYMPTOMS = [
  'bloating',
  'nausea',
  'heartburn',
  'constipation',
  'diarrhea',
  'headache',
  'cramps',
  'muscle_soreness',
  'dizziness',
  'other',
] as const;

export type CheckinSymptom = (typeof CHECKIN_SYMPTOMS)[number];

/** The symptom that carries a free-text detail with it, and the only one. */
const OTHER_SYMPTOM: CheckinSymptom = 'other';

/**
 * A day of the patient's life, as `YYYY-MM-DD`, read in **their** time zone.
 *
 * Not an instant, and that is the whole point: a check-in belongs to a
 * Tuesday, and which Tuesday depends on where the person is (CLAUDE.md, "Dados
 * de saúde" — UTC in the database, the zone on the profile). The instants of
 * the row say when it was saved; this says what it is about.
 */
export type CheckinDate = string;

/** The shape a check-in's date has to have before anybody asks what day it is. */
const CHECKIN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * The longest period one listing may ask for, in days, both ends included.
 *
 * A year and a day. The ceiling is the platform's and not the caller's: the
 * contract bounds the query as a courtesy to a client, and this is what the use
 * case actually applies — including to a caller that is not HTTP.
 */
export const MAX_CHECKIN_PERIOD_DAYS = 366;

/**
 * The date, checked to be a day that exists.
 *
 * The pattern is not enough and the difference is not theoretical:
 * `2026-02-31` is four digits, a dash and two more, and it is not a day. What
 * makes it safe is rebuilding the date from the parsed numbers and asking
 * whether it came back as the same three — which is how February is told that
 * it has no 31st, leap years included.
 *
 * @throws InvalidCheckinDateError when the text is not a day of the calendar
 *   (400)
 */
export function checkinDateOf(raw: string): CheckinDate {
  const match = CHECKIN_DATE_PATTERN.exec(raw);

  if (match === null) throw new InvalidCheckinDateError();

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  // `Date.UTC` rolls over instead of refusing: the 31st of February comes back
  // as the 3rd of March, and the only honest check is whether the trip was
  // lossless.
  if (toCheckinDate(parsed) !== raw) throw new InvalidCheckinDateError();

  return raw;
}

/**
 * Which day it is **for this patient**, right now.
 *
 * `Intl` carries the IANA database the platform runs on, which is the only
 * honest source for "é terça onde essa pessoa está": a zone is not an offset,
 * and arithmetic on minutes gets daylight saving wrong twice a year. It is a
 * language built-in and no more I/O than the `Date` this domain already uses
 * (CLAUDE.md rule 4) — `identity`'s own domain asks it the same question when
 * it validates a zone.
 *
 * @param timeZone the IANA name on the patient's profile
 * @param instant the moment being read, in UTC as everything else is
 * @throws Error when the runtime does not know the zone. A bug and not a
 *   refusal: the profile only ever stores a zone `identity` resolved when it
 *   was written, so an unknown one here means a row was written past that
 *   check. The stack points at this line.
 */
export function checkinDateIn(timeZone: string, instant: Date): CheckinDate {
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
  } catch {
    // The name is deliberately not in the message: it travels to Sentry, and
    // where somebody lives is theirs (CLAUDE.md, "Saúde e LGPD").
    throw new Error('the time zone on the patient profile is not one this runtime knows');
  }

  const of = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  // Assembled from the parts and never from a formatted string: a locale
  // decides the order and the separators of a formatted date, and the parts
  // are the same three numbers in every locale.
  return `${of('year')}-${of('month')}-${of('day')}`;
}

/**
 * Whether the check-in of `date` may still be written: the card's "um por dia,
 * editável no mesmo dia".
 *
 * The window is the day itself, in the patient's zone. Not a number of hours
 * after it, and not "until the next one is filled in": a check-in is somebody
 * saying how **today** went, and a Tuesday filled in on Friday is a memory,
 * which is a different and much worse kind of data to hang a follow-up on.
 * Nothing stops the patient from telling their nutritionist about Tuesday —
 * that is a note, and it is dated honestly.
 *
 * It follows that a future day is closed too, and for the plainer reason: it
 * has not happened.
 */
export function isCheckinWindowOpen(date: CheckinDate, timeZone: string, now: Date): boolean {
  return date === checkinDateIn(timeZone, now);
}

/**
 * The same, as the line a use case writes before it saves anything.
 *
 * @throws CheckinWindowClosedError when the day is not the patient's today
 *   (422 — the request is well formed and a rule refuses it)
 */
export function assertCheckinWindowIsOpen(date: CheckinDate, timeZone: string, now: Date): void {
  if (!isCheckinWindowOpen(date, timeZone, now)) throw new CheckinWindowClosedError();
}

/** What the patient answered, before this module has normalized any of it. */
export interface CheckinAnswers {
  readonly energy: CheckinScale;
  readonly sleepQuality: CheckinScale;
  readonly hunger: CheckinScale;
  /** Repetitions and order are meaningless and are normalized away. */
  readonly symptoms: readonly CheckinSymptom[];
  readonly otherSymptom?: string | undefined;
  readonly note?: string | undefined;
}

/**
 * A check-in as it gets written: the patient, the day, the answers and the
 * instant of the request.
 *
 * `savedAt` is one field and becomes two columns, which is the honest shape of
 * an upsert: on the first save it is both `recorded_at` and `updated_at`, and
 * on a correction it is only the second — the day the patient first answered
 * does not move because they fixed a tap.
 */
export interface CheckinToRecord {
  readonly patientProfileId: string;
  readonly date: CheckinDate;
  readonly energy: CheckinScale;
  readonly sleepQuality: CheckinScale;
  readonly hunger: CheckinScale;
  readonly symptoms: readonly CheckinSymptom[];
  /** `null` and never `''`: a detail nobody typed is a detail that is not there. */
  readonly otherSymptom: string | null;
  readonly note: string | null;
  readonly savedAt: Date;
}

/**
 * The record to write for one check-in, with everything normalized.
 *
 * Four normalizations happen here and nowhere else, so that the same answers
 * always produce the same row whichever client sent them:
 *
 * - the symptoms are deduplicated and put in the order of the vocabulary;
 * - `otherSymptom` is trimmed, and **dropped unless `other` was chosen** — a
 *   detail without the chip it details is a value no screen would show;
 * - the note is trimmed, and blank becomes `null`;
 * - nothing is inferred: a missing symptom list is an empty one, which means
 *   "nada a relatar" and not "não respondi".
 *
 * @throws Error when a scale is outside 1 to 5 or is not a whole number, or
 *   when the patient id is blank. Not a domain error and not a refusal: the
 *   contract already answers 400 for all of those at the HTTP boundary
 *   (`recordCheckinRequestSchema`), so whatever gets here with one is a caller
 *   this module cannot write an honest row for — the same treatment
 *   `identity`'s `accessToLog` gives its own impossible inputs.
 */
export function checkinToRecord(
  patientProfileId: string,
  date: CheckinDate,
  answers: CheckinAnswers,
  savedAt: Date,
): CheckinToRecord {
  if (patientProfileId.trim() === '') {
    throw new Error('a check-in is written with the profile id of the patient');
  }

  const symptoms = symptomsInVocabularyOrder(answers.symptoms);

  return {
    patientProfileId,
    date: checkinDateOf(date),
    energy: scaleOf(answers.energy, 'energy'),
    sleepQuality: scaleOf(answers.sleepQuality, 'sleepQuality'),
    hunger: scaleOf(answers.hunger, 'hunger'),
    symptoms,
    otherSymptom: symptoms.includes(OTHER_SYMPTOM) ? textOrNull(answers.otherSymptom) : null,
    note: textOrNull(answers.note),
    savedAt,
  };
}

/** The symptoms, each once, in the order of `CHECKIN_SYMPTOMS`. */
export function symptomsInVocabularyOrder(
  symptoms: readonly CheckinSymptom[],
): readonly CheckinSymptom[] {
  const chosen = new Set(symptoms);

  return CHECKIN_SYMPTOMS.filter((symptom) => chosen.has(symptom));
}

/**
 * One check-in, read back — the same shape for the patient who wrote it and for
 * the professional who follows them.
 *
 * There is no id: a patient has one check-in per day, so the day names it.
 */
export interface RecordedCheckin {
  readonly date: CheckinDate;
  readonly energy: CheckinScale;
  readonly sleepQuality: CheckinScale;
  readonly hunger: CheckinScale;
  readonly symptoms: readonly CheckinSymptom[];
  readonly otherSymptom: string | null;
  readonly note: string | null;
  /** When it was saved the first time. It never moves. */
  readonly recordedAt: Date;
  /** When it last changed. Equal to `recordedAt` while nobody corrected it. */
  readonly updatedAt: Date;
}

/** A span of days, both ends included. */
export interface CheckinPeriod {
  readonly from: CheckinDate;
  readonly to: CheckinDate;
}

/**
 * The period a listing may read.
 *
 * Bounded and not paged, which is the shape this data has: one row per day is
 * read as a calendar, and a cursor over at most a year of them would be
 * machinery nobody uses. The bound is refused rather than clamped — a client
 * asking for five years and silently getting one would draw a chart that is
 * wrong without saying so.
 *
 * @throws InvalidCheckinDateError when either end is not a day of the calendar
 *   (400)
 * @throws InvalidCheckinPeriodError when the first day is after the last (400)
 * @throws CheckinPeriodTooLongError when the span is longer than
 *   `MAX_CHECKIN_PERIOD_DAYS` (400)
 */
export function checkinPeriod(from: string, to: string): CheckinPeriod {
  const period = { from: checkinDateOf(from), to: checkinDateOf(to) };
  const days = daysInPeriod(period);

  if (days < 1) throw new InvalidCheckinPeriodError();
  if (days > MAX_CHECKIN_PERIOD_DAYS) throw new CheckinPeriodTooLongError(MAX_CHECKIN_PERIOD_DAYS);

  return period;
}

/**
 * How many days the period covers, both ends included — so a period of one day
 * is 1 and a reversed one is zero or less.
 *
 * The arithmetic is done at UTC midnight on purpose: both ends are plain days
 * with no zone of their own, and reading them in any single zone makes the
 * subtraction exact. Daylight saving cannot reach it, because no local clock
 * is involved.
 */
export function daysInPeriod(period: CheckinPeriod): number {
  const day = 24 * 60 * 60 * 1000;

  return (
    (Date.parse(`${period.to}T00:00:00.000Z`) - Date.parse(`${period.from}T00:00:00.000Z`)) / day +
    1
  );
}

/** `YYYY-MM-DD` of a date read in UTC. The inverse of `checkinDateOf`'s parse. */
function toCheckinDate(date: Date): CheckinDate {
  return date.toISOString().slice(0, 10);
}

/** One scale, checked. The name is in the message so a bug says which field. */
function scaleOf(value: CheckinScale, field: string): CheckinScale {
  if (!Number.isInteger(value) || value < CHECKIN_SCALE_MIN || value > CHECKIN_SCALE_MAX) {
    throw new Error(
      `${field} of a check-in is a whole number from ${CHECKIN_SCALE_MIN} to ${CHECKIN_SCALE_MAX}`,
    );
  }

  return value;
}

/**
 * Free text as the database keeps it: trimmed, or `null`.
 *
 * Blank becomes `null` and not `''` so there is one way of saying "nothing
 * here" — two would have every reader of these rows handle both, and the one
 * who forgets renders an empty quote on a professional's screen.
 */
function textOrNull(value: string | undefined): string | null {
  const text = value?.trim() ?? '';

  return text === '' ? null : text;
}

/** The check-ins of one period, as a listing answers them. */
export interface CheckinsInPeriod {
  readonly period: CheckinPeriod;
  /** From the oldest day to the newest. Days with no check-in are absent. */
  readonly checkins: readonly RecordedCheckin[];
}

/**
 * Whether a save replaced a check-in that was already there.
 *
 * Read off the row and not off a flag the database returned: on a first save
 * `recorded_at` **is** the instant of the request, and on a correction it is
 * the instant of the first one, which is earlier. One comparison, no
 * `xmax` trick, and it means the same thing in a test double as in Postgres.
 *
 * The one case it reads as new is two saves of the same day in the same
 * millisecond, which is a double tap faster than a millisecond. What it costs
 * then is a `corrected: false` on an event, and nothing else: the row is right
 * either way.
 */
export function wasCorrected(checkin: RecordedCheckin, savedAt: Date): boolean {
  return checkin.recordedAt.getTime() !== savedAt.getTime();
}
