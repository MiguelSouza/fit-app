import { randomUUID } from 'node:crypto';

import { DEFAULT_ACCESS_LOG_PAGE_SIZE, MAX_ACCESS_LOG_PAGE_SIZE } from '../domain/access-log';
import {
  CallerIsNotPatientError,
  InvalidAccessLogCursorError,
  ProfileNotFoundError,
} from '../domain/identity-errors';
import { AccessLogService } from './access-log.service';
import { InMemoryAccessLogRepository } from './in-memory-access-log.spec-support';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from './in-memory-identity-registry.spec-support';
import { ListMyAccessLogUseCase } from './list-my-access-log.use-case';
import { LoadPatientCaller } from './load-patient-caller';

/**
 * The two halves of card I-06, driven without a database: `identity.logAccess`
 * writing a record, and the patient reading their own.
 *
 * Three acceptance criteria are in here. **"Abrir a ficha gera exatamente um
 * registro por visita"** — the service writes one row per call and never
 * collapses two visits into one; the HTTP half of that criterion, which is
 * that one request to the chart calls this once, is
 * `patient-access-log.interceptor.spec.ts`. **"Paciente vê só os próprios
 * registros"** — the subject is the token, and another patient's rows are not
 * reachable from this use case at all. **"Registros não podem ser editados nem
 * apagados pela API"** — there is no method here that would, and the half of
 * it that lives in SQL is the integration suite next door.
 *
 * No data of a real person: the ids are random and the names are labels.
 */
const PATIENT_AUTH_USER_ID = 'auth-user-of-the-patient';
const PROFESSIONAL_AUTH_USER_ID = 'auth-user-of-the-professional';

interface Fixture {
  readonly patientProfileId: string;
  readonly professionalProfileId: string;
  readonly records: InMemoryAccessLogRepository;
  readonly log: AccessLogService;
  readonly list: ListMyAccessLogUseCase;
}

function aPatientAndTheirProfessional(): Fixture {
  const patient = patientIdentity();
  const professional = professionalIdentity();

  const registry = new InMemoryIdentityRegistry({
    [PATIENT_AUTH_USER_ID]: patient,
    [PROFESSIONAL_AUTH_USER_ID]: professional,
  });

  const records = new InMemoryAccessLogRepository({
    [professional.personId]: { name: 'Ana Souza', professionalType: 'nutritionist' },
  });

  return {
    patientProfileId: patient.personId,
    professionalProfileId: professional.personId,
    records,
    log: new AccessLogService(records),
    list: new ListMyAccessLogUseCase(new LoadPatientCaller(registry), records),
  };
}

describe('logAccess', () => {
  it('writes exactly one record for one visit', async () => {
    const { log, records, professionalProfileId, patientProfileId } =
      aPatientAndTheirProfessional();

    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'view');

    expect(records.rows).toHaveLength(1);
    expect(records.rows[0]).toMatchObject({
      actorProfileId: professionalProfileId,
      patientProfileId,
      resource: 'patient_chart',
      action: 'view',
    });
  });

  it('writes a second record for a second visit, and never collapses the two', async () => {
    // Two visits are two facts. Deduplicating them inside a window would hide
    // the second one from the patient, which is the only reader this table has.
    const { log, records, professionalProfileId, patientProfileId } =
      aPatientAndTheirProfessional();

    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'view');
    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'view');

    expect(records.countFor(patientProfileId)).toBe(2);
  });

  it('records an export as an export', async () => {
    const { log, records, professionalProfileId, patientProfileId } =
      aPatientAndTheirProfessional();

    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'export');

    expect(records.rows[0]?.action).toBe('export');
  });

  it('stamps the record with the instant of the access', async () => {
    const { log, records, professionalProfileId, patientProfileId } =
      aPatientAndTheirProfessional();

    const before = Date.now();
    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'view');

    const occurredAt = records.rows[0]?.occurredAt.getTime() ?? 0;

    expect(occurredAt).toBeGreaterThanOrEqual(before);
    expect(occurredAt).toBeLessThanOrEqual(Date.now());
  });

  it('refuses to record a patient as the actor of their own access', async () => {
    const { log, patientProfileId, records } = aPatientAndTheirProfessional();

    await expect(
      log.logAccess(patientProfileId, patientProfileId, 'patient_chart', 'view'),
    ).rejects.toThrow(/never the patient/);

    expect(records.rows).toHaveLength(0);
  });
});

describe('listing my access log', () => {
  async function aLogOf(visits: number): Promise<Fixture> {
    const fixture = aPatientAndTheirProfessional();

    for (let visit = 0; visit < visits; visit += 1) {
      await fixture.log.logAccess(
        fixture.professionalProfileId,
        fixture.patientProfileId,
        'patient_chart',
        'view',
      );
    }

    return fixture;
  }

  it('answers who accessed, what and when', async () => {
    const { list } = await aLogOf(1);

    const page = await list.execute(PATIENT_AUTH_USER_ID);

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      actor: { name: 'Ana Souza', professionalType: 'nutritionist' },
      resource: 'patient_chart',
      action: 'view',
    });
  });

  it('answers only the records of whoever is calling', async () => {
    const { list, log, records, professionalProfileId } = await aLogOf(1);

    // The same professional opening somebody else's chart. The other
    // patient's record exists and is not this patient's to read.
    const anotherPatient = randomUUID();
    await log.logAccess(professionalProfileId, anotherPatient, 'patient_chart', 'view');

    const page = await list.execute(PATIENT_AUTH_USER_ID);

    expect(records.rows).toHaveLength(2);
    expect(page.entries).toHaveLength(1);
  });

  it('answers an empty page, with no cursor, for a patient nobody opened', async () => {
    const { list } = await aLogOf(0);

    await expect(list.execute(PATIENT_AUTH_USER_ID)).resolves.toEqual({
      entries: [],
      nextCursor: undefined,
    });
  });

  it('answers the newest access first', async () => {
    const { list, records } = await aLogOf(3);

    const page = await list.execute(PATIENT_AUTH_USER_ID);
    const instants = page.entries.map((entry) => entry.occurredAt.getTime());

    expect(page.entries).toHaveLength(records.rows.length);
    expect([...instants].sort((one, other) => other - one)).toEqual(instants);
  });

  it('pages by cursor without repeating or skipping a record', async () => {
    // Three accesses written in the same millisecond is the case the ordering
    // exists for: an instant alone cannot order them, and a page that cannot
    // be ordered strictly is a page that shows one record twice.
    const { list } = await aLogOf(3);

    const first = await list.execute(PATIENT_AUTH_USER_ID, { limit: 2 });
    const second = await list.execute(PATIENT_AUTH_USER_ID, {
      limit: 2,
      cursor: first.nextCursor,
    });

    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    expect(second.entries).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();

    const everything = [...first.entries, ...second.entries].map((entry) => entry.id);
    expect(new Set(everything).size).toBe(3);
  });

  it('reads at most a page, however many records there are', async () => {
    const { list } = await aLogOf(DEFAULT_ACCESS_LOG_PAGE_SIZE + 3);

    const page = await list.execute(PATIENT_AUTH_USER_ID);

    expect(page.entries).toHaveLength(DEFAULT_ACCESS_LOG_PAGE_SIZE);
    expect(page.nextCursor).toBeDefined();
  });

  it('never reads more than the platform answers at once', async () => {
    const { list } = await aLogOf(3);

    const page = await list.execute(PATIENT_AUTH_USER_ID, {
      limit: MAX_ACCESS_LOG_PAGE_SIZE * 10,
    });

    expect(page.entries).toHaveLength(3);
  });

  it('refuses a cursor this API did not mint', async () => {
    const { list } = await aLogOf(1);

    await expect(
      list.execute(PATIENT_AUTH_USER_ID, { cursor: 'nao-foi-esta-api-que-emitiu' }),
    ).rejects.toThrow(InvalidAccessLogCursorError);
  });

  it('refuses a professional: the log is the patient’s own', async () => {
    const { list } = await aLogOf(1);

    await expect(list.execute(PROFESSIONAL_AUTH_USER_ID)).rejects.toThrow(CallerIsNotPatientError);
  });

  it('refuses somebody who never finished the first access', async () => {
    const { list } = await aLogOf(1);

    await expect(list.execute('auth-user-with-no-profile')).rejects.toThrow(ProfileNotFoundError);
  });
});
