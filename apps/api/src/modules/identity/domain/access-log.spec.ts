import { randomUUID } from 'node:crypto';

import {
  accessLogPage,
  accessLogPageSize,
  accessToLog,
  decodeAccessLogCursor,
  encodeAccessLogCursor,
  DEFAULT_ACCESS_LOG_PAGE_SIZE,
  MAX_ACCESS_LOG_PAGE_SIZE,
  type AccessLogEntry,
} from './access-log';
import { InvalidAccessLogCursorError } from './identity-errors';

/**
 * The access log as the domain decides it (card I-06): what a record is, how a
 * page ends, and what a cursor is worth.
 *
 * Unit tests, because all of it is pure — no database, no HTTP, nothing to
 * mock (CLAUDE.md, "Testes": the domain's tests are mandatory). What only
 * Postgres can prove — that a row cannot be changed or removed, and that the
 * patient reads nobody else's — is `access-log.use-case.integration-spec.ts`.
 */
const ACTOR = randomUUID();
const PATIENT = randomUUID();
const NOW = new Date('2026-11-09T12:00:00.000Z');

/** A record read back, with the two fields the ordering leans on. */
function entry(id: string, occurredAt: string): AccessLogEntry {
  return {
    id,
    actor: { name: 'Ana Souza', professionalType: 'nutritionist' },
    resource: 'patient_chart',
    action: 'view',
    occurredAt: new Date(occurredAt),
  };
}

describe('accessToLog', () => {
  it('records who accessed, whose data, what and when', () => {
    expect(accessToLog(ACTOR, PATIENT, 'patient_chart', 'view', NOW)).toEqual({
      actorProfileId: ACTOR,
      patientProfileId: PATIENT,
      resource: 'patient_chart',
      action: 'view',
      occurredAt: NOW,
    });
  });

  it('records an export as its own action, next to the same resource', () => {
    expect(accessToLog(ACTOR, PATIENT, 'patient_chart', 'export', NOW).action).toBe('export');
  });

  it('refuses to record the patient as the actor of their own access', () => {
    // The endpoint answers "quem viu meus dados". A row saying the patient saw
    // their own would be a lie about the one thing it exists to tell.
    expect(() => accessToLog(PATIENT, PATIENT, 'patient_chart', 'view', NOW)).toThrow(
      /never the patient/,
    );
  });

  it('refuses to record an access with a blank id on either side', () => {
    expect(() => accessToLog('  ', PATIENT, 'patient_chart', 'view', NOW)).toThrow(/profile id/);
    expect(() => accessToLog(ACTOR, '', 'patient_chart', 'view', NOW)).toThrow(/profile id/);
  });
});

describe('accessLogPageSize', () => {
  it('answers the default when the request asked for nothing', () => {
    expect(accessLogPageSize(undefined)).toBe(DEFAULT_ACCESS_LOG_PAGE_SIZE);
  });

  it('answers what was asked for, inside the bounds', () => {
    expect(accessLogPageSize(5)).toBe(5);
  });

  it('clamps a page bigger than the platform reads at once', () => {
    expect(accessLogPageSize(5000)).toBe(MAX_ACCESS_LOG_PAGE_SIZE);
  });

  it('clamps a page of nothing, which would answer nothing forever', () => {
    expect(accessLogPageSize(0)).toBe(1);
    expect(accessLogPageSize(-3)).toBe(1);
  });
});

describe('accessLogPage', () => {
  const first = entry(randomUUID(), '2026-11-09T12:00:00.000Z');
  const second = entry(randomUUID(), '2026-11-09T11:00:00.000Z');
  const third = entry(randomUUID(), '2026-11-09T10:00:00.000Z');

  it('answers the rows that were asked for and a cursor, when one more was read', () => {
    const page = accessLogPage([first, second, third], 2);

    expect(page.entries).toEqual([first, second]);
    expect(page.nextCursor).toBeDefined();
  });

  it('points the cursor at the last row answered, never at the one held back', () => {
    const page = accessLogPage([first, second, third], 2);

    expect(decodeAccessLogCursor(page.nextCursor ?? '')).toEqual({
      occurredAt: second.occurredAt,
      id: second.id,
    });
  });

  it('answers no cursor on the last page', () => {
    // Exactly as many rows as were asked for: there was no extra one, so there
    // is nothing after this page.
    expect(accessLogPage([first, second], 2).nextCursor).toBeUndefined();
    expect(accessLogPage([first], 2).nextCursor).toBeUndefined();
  });

  it('answers an empty page for a patient nobody has opened', () => {
    expect(accessLogPage([], 20)).toEqual({ entries: [], nextCursor: undefined });
  });
});

describe('the cursor', () => {
  it('survives the round trip, to the millisecond', () => {
    const cursor = { occurredAt: new Date('2026-11-09T12:00:00.123Z'), id: randomUUID() };

    expect(decodeAccessLogCursor(encodeAccessLogCursor(cursor))).toEqual(cursor);
  });

  it('carries nothing a client is meant to read, but is no secret either', () => {
    const id = randomUUID();
    const encoded = encodeAccessLogCursor({ occurredAt: NOW, id });

    expect(encoded).not.toContain(id);
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(`${NOW.toISOString()}|${id}`);
  });

  it('refuses a cursor this API did not mint', () => {
    expect(() => decodeAccessLogCursor('not-a-cursor')).toThrow(InvalidAccessLogCursorError);
    expect(() => decodeAccessLogCursor('')).toThrow(InvalidAccessLogCursorError);
  });

  it('refuses a cursor with half of it missing', () => {
    const halves = [`${NOW.toISOString()}|`, `|${randomUUID()}`, `nao-e-uma-data|${randomUUID()}`];

    for (const half of halves) {
      expect(() => decodeAccessLogCursor(Buffer.from(half, 'utf8').toString('base64url'))).toThrow(
        InvalidAccessLogCursorError,
      );
    }
  });
});
