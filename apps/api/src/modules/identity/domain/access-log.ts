import { InvalidAccessLogCursorError } from './identity-errors';
import { type ProfessionalType } from './person';

/**
 * The access log: what the platform records when somebody opens or exports a
 * patient's data, and how the patient reads it back (card I-06).
 *
 * Pure: no NestJS, no Drizzle, no I/O (CLAUDE.md rule 4). The vocabulary is
 * declared here and not imported from `@fit-app/contracts`, as `person.ts` and
 * `consent.ts` next door declare theirs — the rules are written against the
 * domain, and the contract is one of its readers; the two are checked against
 * each other at the boundary, by the controller and by the presenter.
 *
 * Two things are not in this file, deliberately. **Nothing deletes and nothing
 * rewrites**: a record of an access is a fact, and there is no function here
 * that takes one and gives back a different one. And **no rule decides whether
 * an access is allowed** — that is `patient-access.ts`, which answers a
 * different question (ADR 0017); by the time something is logged, the access
 * already happened.
 */

/**
 * What was accessed. One value today, because the platform has one thing that
 * opens a patient: a ficha.
 *
 * A closed vocabulary, for the reason written on the contract: a record is
 * auditable only while the words in it mean one thing, and the patient's
 * screen needs a code it can translate, not a sentence the API wrote.
 */
export type AccessLogResource = 'patient_chart';

/**
 * What was done to it: read on the screen, or taken out of the platform.
 *
 * `export` is not a kind of `view` and the card asks for both ("ao abrir a
 * ficha do paciente e em qualquer exportação"): an export leaves a copy of the
 * patient's health data outside the platform, which is the part of "quem viu
 * meus dados" that matters most and the part a screen view does not imply.
 */
export type AccessLogAction = 'view' | 'export';

/**
 * An access, as it gets written: who, about whom, what, and when.
 *
 * The instant is decided by the caller and not defaulted by the database, as
 * everywhere else in this module: a seed, a test and a request all land on the
 * same one, and the column is what the patient is shown.
 */
export interface AccessToLog {
  readonly actorProfileId: string;
  readonly patientProfileId: string;
  readonly resource: AccessLogResource;
  readonly action: AccessLogAction;
  readonly occurredAt: Date;
}

/**
 * The record to write for one access.
 *
 * @param actorProfileId `identity.profile.id` of whoever accessed — ours,
 *   never the Supabase user id
 * @param patientProfileId `identity.profile.id` of the patient whose data was
 *   accessed
 * @param occurredAt the instant of the access, which is the instant of the
 *   request that produced it
 * @throws Error when either id is blank, or when the two are the same person.
 *   Not a domain error and not a refusal: this list answers "quem viu meus
 *   dados", and a row saying the patient saw their own would be a lie about
 *   the one thing the endpoint exists to tell. Both cases are bugs in the
 *   caller, and the stack points at the line that wrote them — the same
 *   treatment a route decorated by mistake gets in `patient-access.guard.ts`.
 */
export function accessToLog(
  actorProfileId: string,
  patientProfileId: string,
  resource: AccessLogResource,
  action: AccessLogAction,
  occurredAt: Date,
): AccessToLog {
  if (actorProfileId.trim() === '' || patientProfileId.trim() === '') {
    throw new Error('an access is logged with the profile id of the actor and of the patient');
  }

  if (actorProfileId === patientProfileId) {
    throw new Error("the access log records who saw the patient's data, never the patient");
  }

  return { actorProfileId, patientProfileId, resource, action, occurredAt };
}

/** Who accessed, as the patient is told: a name and, when there is one, a licence. */
export interface AccessLogActor {
  readonly name: string;
  readonly professionalType: ProfessionalType | null;
}

/**
 * One record, read back.
 *
 * The `id` is in here and **not** in the answer the patient gets: it is half of
 * the cursor below, because an instant alone cannot order two accesses that
 * happened in the same millisecond, and a page that cannot be ordered strictly
 * is a page that repeats a row or skips one.
 */
export interface AccessLogEntry {
  readonly id: string;
  readonly actor: AccessLogActor;
  readonly resource: AccessLogResource;
  readonly action: AccessLogAction;
  readonly occurredAt: Date;
}

/** The page the app gets when it asks for no size in particular. */
export const DEFAULT_ACCESS_LOG_PAGE_SIZE = 20;

/**
 * The most one request may read. The ceiling is the platform's and not the
 * caller's: the rows of a patient only ever grow, and the contract's bound is
 * a courtesy to the client, while this one is what the use case actually
 * applies.
 */
export const MAX_ACCESS_LOG_PAGE_SIZE = 100;

/**
 * How many rows to read for a request that asked for `limit`.
 *
 * Clamped rather than refused: the contract already rejects a limit outside the
 * bounds with a 400 (`accessLogQuerySchema`), so what reaches here is either
 * inside them or a caller that is not HTTP — a job, a test, another use case —
 * and for those an unbounded page is a mistake worth correcting, not a failure
 * worth raising.
 */
export function accessLogPageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_ACCESS_LOG_PAGE_SIZE;

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_ACCESS_LOG_PAGE_SIZE);
}

/**
 * Where a page ended: the instant and the row.
 *
 * Both halves are needed because the log is ordered by the instant, and two
 * accesses can share one. The pair is what makes the order strict, so a page
 * taken a minute later continues exactly where the one before it stopped —
 * however many accesses were recorded in between.
 */
export interface AccessLogCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

/** A page of the log, and where the next one starts. */
export interface AccessLogPage {
  readonly entries: readonly AccessLogEntry[];
  /** Absent on the last page. */
  readonly nextCursor: string | undefined;
}

/**
 * The page the patient gets, out of the rows that were read.
 *
 * It expects **one row more than the page size** — that is the whole trick of
 * it: the extra row is not answered, it is the proof that there is a next page,
 * and it saves the `count(*)` over a table that only grows. Fewer rows than
 * that means this is the last page, and `nextCursor` is then absent, which is
 * how a client knows to stop without comparing numbers.
 *
 * @param rows the records read, newest first, up to `pageSize + 1` of them
 * @param pageSize how many the request asked for
 */
export function accessLogPage(rows: readonly AccessLogEntry[], pageSize: number): AccessLogPage {
  const entries = rows.slice(0, pageSize);
  const last = entries.at(-1);

  if (rows.length <= pageSize || last === undefined) {
    return { entries, nextCursor: undefined };
  }

  return {
    entries,
    nextCursor: encodeAccessLogCursor({ occurredAt: last.occurredAt, id: last.id }),
  };
}

/**
 * What separates the two halves inside a cursor. A character neither an ISO
 * instant nor a uuid contains, so the split is unambiguous.
 */
const CURSOR_SEPARATOR = '|';

/**
 * The cursor, as it travels to the client: base64url of the instant and the
 * row id.
 *
 * Encoded and not answered as two fields, because the shape of it is **ours**.
 * A client that could read it would start building one — guessing an instant,
 * skipping to a date — and the day the log is ordered by something else, every
 * such client breaks. What it is not is a secret: it is a date and an id of the
 * patient's own records, encoded so that nobody is tempted to take it apart.
 *
 * `Buffer` is a Node built-in and no more I/O than the `Date` and the `Intl`
 * this domain already uses (CLAUDE.md rule 4).
 */
export function encodeAccessLogCursor(cursor: AccessLogCursor): string {
  return Buffer.from(
    `${cursor.occurredAt.toISOString()}${CURSOR_SEPARATOR}${cursor.id}`,
    'utf8',
  ).toString('base64url');
}

/**
 * The cursor a client sent back, as the repository needs it.
 *
 * Everything is checked, because this is a value from the outside: the
 * encoding, the two halves, the instant and a non-empty id. Anything else is a
 * cursor this API did not mint.
 *
 * @throws InvalidAccessLogCursorError on anything that is not a cursor of ours
 *   (400). Not an empty page, which would tell a patient their log ended where
 *   a typo was.
 */
export function decodeAccessLogCursor(raw: string): AccessLogCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf(CURSOR_SEPARATOR);

  if (separator < 0) throw new InvalidAccessLogCursorError();

  const occurredAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);

  if (Number.isNaN(occurredAt.getTime()) || id === '') throw new InvalidAccessLogCursorError();

  return { occurredAt, id };
}
