import { isSensitiveKey, redactSensitive, REDACTED, TRUNCATED } from './sensitive-data';

/**
 * The rule CLAUDE.md states ("Nunca logar dado de saúde nem dado pessoal"),
 * tested as a function: by field name, at any depth, without the caller having
 * to remember anything.
 */
describe('isSensitiveKey', () => {
  it('recognizes the fields the card lists, however they are spelled', () => {
    for (const key of [
      'name',
      'Name',
      'full_name',
      'patientName',
      'email',
      'contact_email',
      'phone',
      'professionalPhone',
      'token',
      'accessToken',
      'notes',
      'professional_notes',
      'checkInWeight',
      'check_in_values',
      'weight',
      'mood',
    ]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
  });

  it('leaves ids, codes and timings alone, which is what a log is for', () => {
    for (const key of [
      'patientId',
      'organizationId',
      'planId',
      'code',
      'status',
      'statusCode',
      'durationMs',
      'method',
      'path',
      'correlationId',
      'context',
      'professionalType',
      'consentKind',
    ]) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });
});

describe('redactSensitive', () => {
  it('masks a sensitive field wherever it sits', () => {
    expect(
      redactSensitive({
        patientId: 'pat_1',
        patient: { name: 'Ana Souza', email: 'ana@example.com', timezone: 'America/Sao_Paulo' },
      }),
    ).toEqual({
      patientId: 'pat_1',
      patient: { name: REDACTED, email: REDACTED, timezone: 'America/Sao_Paulo' },
    });
  });

  it('goes through arrays', () => {
    expect(
      redactSensitive({
        records: [
          { id: 'ci_1', notes: 'dormi mal', mood: 2 },
          { id: 'ci_2', notes: 'tudo bem', mood: 5 },
        ],
      }),
    ).toEqual({
      records: [
        { id: 'ci_1', notes: REDACTED, mood: REDACTED },
        { id: 'ci_2', notes: REDACTED, mood: REDACTED },
      ],
    });
  });

  it('masks a check-in collection whole, without looking inside', () => {
    // `checkIns` is itself a check-in field: whatever shape it has, it is the
    // patient reporting on themselves.
    expect(redactSensitive({ checkIns: [{ mood: 2 }], patientId: 'pat_1' })).toEqual({
      checkIns: REDACTED,
      patientId: 'pat_1',
    });
  });

  it('does not touch the object it is given', () => {
    const original = { patient: { email: 'ana@example.com' } };

    redactSensitive(original);

    expect(original.patient.email).toBe('ana@example.com');
  });

  it('cuts a structure that is too deep instead of walking it forever', () => {
    const cyclic: Record<string, unknown> = { level: 0 };
    cyclic.self = cyclic;

    expect(JSON.stringify(redactSensitive(cyclic))).toContain(TRUNCATED);
  });

  it('leaves values that carry their own serialization as they are', () => {
    const date = new Date('2026-10-10T12:00:00.000Z');
    const error = new Error('boom');

    const redacted = redactSensitive({ date, error, count: 3, enabled: false, missing: null });

    expect(redacted).toEqual({ date, error, count: 3, enabled: false, missing: null });
  });
});
