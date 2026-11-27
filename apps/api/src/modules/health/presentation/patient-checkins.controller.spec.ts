import { checkinListSchema } from '@fit-app/contracts';
import request from 'supertest';

import { signAccessToken } from '../../../shared/auth/local-access-token.spec-support';
import { InMemoryCheckinRepository } from '../application/in-memory-checkin-repository.spec-support';
import { bootHealthApp, type HealthApp } from './health-app.spec-support';

/**
 * `GET /v1/patients/{patientId}/checkins` over the real `AppModule`
 * (card P-02).
 *
 * It is the card's third acceptance criterion from both sides: **"profissional
 * com acesso consegue ler; sem acesso, 404"**. The rule that decides which of
 * the two it is belongs to `identity` and is tested there (ADR 0017); what is
 * proved here is that this route asks it, that the refusal comes out as a 404
 * with nothing of the patient in it, and that a reading that did happen leaves
 * exactly one row in the patient's access log — with its own resource.
 *
 * The guard, the interceptor, the validation pipe, the serializer and the error
 * filter are the API's own; only the four names `identity/index.ts` exports and
 * the check-in repository are stood in for
 * (`health-app.spec-support.ts`).
 */
const PROFESSIONAL = '33333333-3333-4333-8333-333333333333';
const PATIENT = '11111111-1111-4111-8111-111111111111';
const SOMEBODY_ELSE = '22222222-2222-4222-8222-222222222222';

const PERIOD = { from: '2026-11-20', to: '2026-11-27' };

function authorization(): Promise<string> {
  return signAccessToken().then((token) => `Bearer ${token}`);
}

/** Two days of a synthetic patient, and one day of another one. */
async function twoDays(): Promise<InMemoryCheckinRepository> {
  const checkins = new InMemoryCheckinRepository();

  const save = (patientProfileId: string, date: string): Promise<unknown> =>
    checkins.save({
      patientProfileId,
      date,
      energy: 2,
      sleepQuality: 4,
      hunger: 3,
      symptoms: ['bloating'],
      otherSymptom: null,
      note: 'treino pesado',
      savedAt: new Date(`${date}T12:00:00.000Z`),
    });

  await save(PATIENT, '2026-11-22');
  await save(PATIENT, '2026-11-21');
  await save(SOMEBODY_ELSE, '2026-11-23');

  return checkins;
}

describe('GET /v1/patients/{patientId}/checkins', () => {
  let health: HealthApp;

  afterEach(async () => {
    await health.app.close();
  });

  it('answers the check-ins of the patient, exactly as the patient wrote them', async () => {
    health = await bootHealthApp({
      professionalId: PROFESSIONAL,
      accessGranted: true,
      checkins: await twoDays(),
    });

    const response = await request(health.app.getHttpServer())
      .get(`/v1/patients/${PATIENT}/checkins`)
      .query(PERIOD)
      .set('Authorization', await authorization())
      .expect(200);

    expect(response.body).toEqual({
      ...PERIOD,
      checkins: [
        {
          date: '2026-11-21',
          energy: 2,
          sleepQuality: 4,
          hunger: 3,
          symptoms: ['bloating'],
          note: 'treino pesado',
          recordedAt: '2026-11-21T12:00:00.000Z',
          updatedAt: '2026-11-21T12:00:00.000Z',
        },
        {
          date: '2026-11-22',
          energy: 2,
          sleepQuality: 4,
          hunger: 3,
          symptoms: ['bloating'],
          note: 'treino pesado',
          recordedAt: '2026-11-22T12:00:00.000Z',
          updatedAt: '2026-11-22T12:00:00.000Z',
        },
      ],
    });

    // The same contract the patient's own route answers: nothing added for the
    // professional, no score, no reading of the values (CLAUDE.md, "Saúde e
    // LGPD").
    expect(checkinListSchema.safeParse(response.body).success).toBe(true);
  });

  it('records exactly one access, as reading the check-ins and not the ficha', async () => {
    health = await bootHealthApp({
      professionalId: PROFESSIONAL,
      accessGranted: true,
      checkins: await twoDays(),
    });

    await request(health.app.getHttpServer())
      .get(`/v1/patients/${PATIENT}/checkins`)
      .query(PERIOD)
      .set('Authorization', await authorization())
      .expect(200);

    expect(health.accesses).toEqual([
      {
        actorProfileId: PROFESSIONAL,
        patientProfileId: PATIENT,
        resource: 'patient_checkins',
        action: 'view',
      },
    ]);
  });

  it('answers 404 without access, and says nothing about the patient', async () => {
    health = await bootHealthApp({
      professionalId: PROFESSIONAL,
      accessGranted: false,
      checkins: await twoDays(),
    });

    const response = await request(health.app.getHttpServer())
      .get(`/v1/patients/${PATIENT}/checkins`)
      .query(PERIOD)
      .set('Authorization', await authorization())
      .expect(404);

    // The same answer a patient who does not exist gets: no link, no consent
    // and no such person are one answer, so ids cannot be tried (ADR 0017).
    expect(response.body.error.code).toBe('identity.patient.not_found');
    expect(response.body.error.message).toBe('Paciente não encontrado.');
  });

  it('records nothing when the access was refused', async () => {
    health = await bootHealthApp({
      professionalId: PROFESSIONAL,
      accessGranted: false,
      checkins: await twoDays(),
    });

    await request(health.app.getHttpServer())
      .get(`/v1/patients/${PATIENT}/checkins`)
      .query(PERIOD)
      .set('Authorization', await authorization())
      .expect(404);

    // The log says what was really seen, which is why the row is written after
    // the handler answers (card I-06).
    expect(health.accesses).toEqual([]);
  });

  it('answers 404 for an id that could not be a patient', async () => {
    health = await bootHealthApp({ professionalId: PROFESSIONAL, accessGranted: true });

    const response = await request(health.app.getHttpServer())
      .get('/v1/patients/nao-e-um-id/checkins')
      .query(PERIOD)
      .set('Authorization', await authorization())
      .expect(404);

    // Not a 400: which ids are even shaped like a patient is one more thing a
    // caller does not get to learn.
    expect(response.body.error.code).toBe('identity.patient.not_found');
  });

  it('answers 403 for a patient calling it: this is the professional side', async () => {
    health = await bootHealthApp({ patient: { profileId: PATIENT, timeZone: 'UTC' } });

    const response = await request(health.app.getHttpServer())
      .get(`/v1/patients/${PATIENT}/checkins`)
      .query(PERIOD)
      .set('Authorization', await authorization())
      .expect(403);

    expect(response.body.error.code).toBe('identity.professional.required');
    expect(health.accesses).toEqual([]);
  });

  it('refuses an impossible period, and records no access for it', async () => {
    health = await bootHealthApp({ professionalId: PROFESSIONAL, accessGranted: true });

    const response = await request(health.app.getHttpServer())
      .get(`/v1/patients/${PATIENT}/checkins`)
      .query({ from: '2026-11-27', to: '2026-11-01' })
      .set('Authorization', await authorization())
      .expect(400);

    expect(response.body.error.code).toBe('health.checkin.invalid_period');
    expect(health.accesses).toEqual([]);
  });

  it('answers 401 without a token, before anything else is asked', async () => {
    health = await bootHealthApp({ professionalId: PROFESSIONAL, accessGranted: true });

    await request(health.app.getHttpServer())
      .get(`/v1/patients/${PATIENT}/checkins`)
      .query(PERIOD)
      .expect(401);

    expect(health.accesses).toEqual([]);
  });

  it('has no route that writes a check-in for somebody else', async () => {
    health = await bootHealthApp({ professionalId: PROFESSIONAL, accessGranted: true });

    // A check-in is what the patient said. There is no handler here, so Nest
    // answers 404 for the method itself.
    await request(health.app.getHttpServer())
      .put(`/v1/patients/${PATIENT}/checkins/2026-11-22`)
      .set('Authorization', await authorization())
      .send({ energy: 5, sleepQuality: 5, hunger: 1 })
      .expect(404);
  });
});
