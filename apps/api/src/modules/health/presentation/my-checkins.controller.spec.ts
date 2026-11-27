import { checkinListSchema, checkinSchema } from '@fit-app/contracts';
import request from 'supertest';

import { signAccessToken } from '../../../shared/auth/local-access-token.spec-support';
import { InMemoryCheckinRepository } from '../application/in-memory-checkin-repository.spec-support';
import { checkinDateIn } from '../domain/checkin';
import { bootHealthApp, type HealthApp } from './health-app.spec-support';

/**
 * The two routes of `/v1/me/checkins` over the real `AppModule` (card P-02).
 *
 * What this suite is about is the HTTP surface and the use cases behind it: the
 * status codes, the shape of the bodies as the contract declares them, who gets
 * refused, what the event carries and what the access log is **not** asked to
 * write. The rules themselves are the domain's and are covered as unit tests;
 * the SQL is the integration suite's.
 *
 * Neither route is `@Public()`, so the global guard answers 401 without a token
 * (ADR 0007).
 *
 * **"Hoje" is read and not fixed.** Which day may be written depends on the
 * patient's zone and on the clock, and this suite does not freeze either: it
 * asks the domain which day it is for the patient it built — the same function
 * the use case asks — and asserts relationships between instants rather than
 * instants, which is how the rest of this codebase tests what `new Date()`
 * produces. What the zone does to the answer is proved below with two patients
 * a day apart, which needs no clock at all.
 */
const PATIENT = {
  profileId: '11111111-1111-4111-8111-111111111111',
  timeZone: 'America/Sao_Paulo',
};

const SOMEBODY_ELSE = '22222222-2222-4222-8222-222222222222';

const ANSWERS = { energy: 4, sleepQuality: 3, hunger: 2 };

/** The patient's today, read exactly as the use case reads it. */
function today(timeZone: string = PATIENT.timeZone): string {
  return checkinDateIn(timeZone, new Date());
}

/** The day before a `YYYY-MM-DD`, which is always a closed window. */
function dayBefore(date: string): string {
  const before = new Date(`${date}T00:00:00.000Z`);

  before.setUTCDate(before.getUTCDate() - 1);

  return before.toISOString().slice(0, 10);
}

function authorization(): Promise<string> {
  return signAccessToken().then((token) => `Bearer ${token}`);
}

/** Long enough for two saves to land on two different milliseconds. */
function aMoment(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2));
}

describe('/v1/me/checkins', () => {
  let health: HealthApp;

  afterEach(async () => {
    await health.app.close();
  });

  describe('PUT /v1/me/checkins/{date}', () => {
    it('saves the day and answers it as the contract declares it', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .set('Authorization', await authorization())
        .send({ ...ANSWERS, symptoms: ['headache', 'bloating'], note: ' dia corrido ' })
        .expect(200);

      expect(response.body).toMatchObject({
        date: today(),
        energy: 4,
        sleepQuality: 3,
        hunger: 2,

        // The order of the vocabulary, not the order they were sent in.
        symptoms: ['bloating', 'headache'],
        note: 'dia corrido',
      });

      // A first save: the two instants are the same one.
      expect(response.body.updatedAt).toBe(response.body.recordedAt);

      // What the app will do with it: read it as the contract.
      expect(checkinSchema.safeParse(response.body).success).toBe(true);
    });

    it('leaves out what the patient did not answer, instead of answering null', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .set('Authorization', await authorization())
        .send(ANSWERS)
        .expect(200);

      expect(response.body.symptoms).toEqual([]);
      expect(response.body).not.toHaveProperty('note');
      expect(response.body).not.toHaveProperty('otherSymptom');
    });

    it('updates and does not duplicate: one check-in per patient per day', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const put = async (body: object): Promise<request.Response> =>
        request(health.app.getHttpServer())
          .put(`/v1/me/checkins/${today()}`)
          .set('Authorization', await authorization())
          .send(body)
          .expect(200);

      const first = await put({ ...ANSWERS, symptoms: ['nausea'], note: 'primeira versão' });

      await aMoment();

      const corrected = await put({ energy: 2, sleepQuality: 2, hunger: 5 });

      expect(health.checkins.rows).toHaveLength(1);
      expect(corrected.body).toMatchObject({
        date: today(),
        energy: 2,
        sleepQuality: 2,
        hunger: 5,

        // The whole set of answers is replaced: what was taken out is gone.
        symptoms: [],
      });
      expect(corrected.body).not.toHaveProperty('note');

      // The day the patient first answered does not move because a tap was
      // fixed; the other instant does.
      expect(corrected.body.recordedAt).toBe(first.body.recordedAt);
      expect(Date.parse(corrected.body.updatedAt)).toBeGreaterThan(
        Date.parse(corrected.body.recordedAt),
      );
    });

    it('announces the check-in, and says whether it was a correction', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const put = async (body: object): Promise<void> => {
        await request(health.app.getHttpServer())
          .put(`/v1/me/checkins/${today()}`)
          .set('Authorization', await authorization())
          .send(body)
          .expect(200);
      };

      await put(ANSWERS);
      await aMoment();
      await put({ ...ANSWERS, energy: 1 });

      const published = health.events.payloadsOf('health.checkin.recorded');

      // Ids, a day, a flag and an instant. No value of the check-in travels on
      // the bus (CLAUDE.md, "Saúde e LGPD").
      expect(published).toEqual([
        expect.objectContaining({
          patientId: PATIENT.profileId,
          date: today(),
          corrected: false,
        }),
        expect.objectContaining({
          patientId: PATIENT.profileId,
          date: today(),
          corrected: true,
        }),
      ]);
      expect(Object.keys(published[0] ?? {}).sort()).toEqual([
        'corrected',
        'date',
        'patientId',
        'savedAt',
      ]);
    });

    it('keeps the detail of `other` and drops it without the chip', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const withChip = await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .set('Authorization', await authorization())
        .send({ ...ANSWERS, symptoms: ['other'], otherSymptom: 'queimação' })
        .expect(200);

      expect(withChip.body.otherSymptom).toBe('queimação');

      const withoutChip = await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .set('Authorization', await authorization())
        .send({ ...ANSWERS, symptoms: ['nausea'], otherSymptom: 'queimação' })
        .expect(200);

      expect(withoutChip.body).not.toHaveProperty('otherSymptom');
    });

    it('refuses yesterday: a check-in is corrected on its own day', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${dayBefore(today())}`)
        .set('Authorization', await authorization())
        .send(ANSWERS)
        .expect(422);

      expect(response.body.error.code).toBe('health.checkin.window_closed');
      expect(health.checkins.rows).toEqual([]);
      expect(health.events.published).toEqual([]);
    });

    it('reads today in the patient zone and not in the server one', async () => {
      // Kiritimati is at UTC+14 and Niue at UTC-11: twenty-five hours apart, so
      // their calendar day is never the same one. Whichever zone the machine
      // running this is in, exactly one of these two days is "hoje" for a
      // patient in Kiritimati.
      const ahead = 'Pacific/Kiritimati';
      const behind = 'Pacific/Niue';

      expect(today(ahead)).not.toBe(today(behind));

      health = await bootHealthApp({ patient: { ...PATIENT, timeZone: ahead } });

      await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today(ahead)}`)
        .set('Authorization', await authorization())
        .send(ANSWERS)
        .expect(200);

      await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today(behind)}`)
        .set('Authorization', await authorization())
        .send(ANSWERS)
        .expect(422);
    });

    it('refuses a day that is not a day of the calendar', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .put('/v1/me/checkins/2026-02-31')
        .set('Authorization', await authorization())
        .send(ANSWERS)
        .expect(400);

      expect(response.body.error.code).toBe('health.checkin.invalid_date');
    });

    it('refuses a date that is not even shaped like one, at the contract', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .put('/v1/me/checkins/ontem')
        .set('Authorization', await authorization())
        .send(ANSWERS)
        .expect(400);

      expect(response.body.error.code).toBe('api.request.invalid');
    });

    it('refuses an answer off the scale, naming the field and never the value', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .set('Authorization', await authorization())
        .send({ ...ANSWERS, hunger: 9 })
        .expect(400);

      expect(response.body.error.code).toBe('api.request.invalid');
      expect(response.body.error.message).toContain('hunger');
      expect(response.body.error.message).not.toContain('9');
    });

    it('refuses a symptom the vocabulary does not have', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .set('Authorization', await authorization())
        .send({ ...ANSWERS, symptoms: ['saudade'] })
        .expect(400);
    });

    it('answers 403 for a professional: nobody fills in somebody else day', async () => {
      health = await bootHealthApp({ professionalId: 'professional-profile-id' });

      const response = await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .set('Authorization', await authorization())
        .send(ANSWERS)
        .expect(403);

      expect(response.body.error.code).toBe('identity.patient.required');
      expect(health.checkins.rows).toEqual([]);
    });

    it('answers 401 without a token, like every route that is not public', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .send(ANSWERS)
        .expect(401);
    });

    it('records no access: the patient writing their own data is not a visit', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      await request(health.app.getHttpServer())
        .put(`/v1/me/checkins/${today()}`)
        .set('Authorization', await authorization())
        .send(ANSWERS)
        .expect(200);

      expect(health.accesses).toEqual([]);
    });
  });

  describe('GET /v1/me/checkins', () => {
    /** Three days of a synthetic patient, and one day of somebody else. */
    async function threeDays(): Promise<InMemoryCheckinRepository> {
      const checkins = new InMemoryCheckinRepository();

      const save = (patientProfileId: string, date: string): Promise<unknown> =>
        checkins.save({
          patientProfileId,
          date,
          energy: 3,
          sleepQuality: 3,
          hunger: 3,
          symptoms: [],
          otherSymptom: null,
          note: null,
          savedAt: new Date(`${date}T12:00:00.000Z`),
        });

      // Out of order on purpose: the order of the answer is the query's.
      await save(PATIENT.profileId, '2026-11-27');
      await save(PATIENT.profileId, '2026-11-20');
      await save(PATIENT.profileId, '2026-11-22');
      await save(SOMEBODY_ELSE, '2026-11-21');

      return checkins;
    }

    it('answers the period, oldest day first, and nobody else rows', async () => {
      health = await bootHealthApp({ patient: PATIENT, checkins: await threeDays() });

      const response = await request(health.app.getHttpServer())
        .get('/v1/me/checkins')
        .query({ from: '2026-11-20', to: '2026-11-22' })
        .set('Authorization', await authorization())
        .expect(200);

      expect(response.body.from).toBe('2026-11-20');
      expect(response.body.to).toBe('2026-11-22');

      // The 27th is outside the period and the 21st is another patient's. The
      // 21st of this patient does not exist and is not filled in.
      expect(response.body.checkins.map((checkin: { date: string }) => checkin.date)).toEqual([
        '2026-11-20',
        '2026-11-22',
      ]);

      expect(checkinListSchema.safeParse(response.body).success).toBe(true);
    });

    it('answers an empty list for a period with nothing in it', async () => {
      health = await bootHealthApp({ patient: PATIENT, checkins: await threeDays() });

      const response = await request(health.app.getHttpServer())
        .get('/v1/me/checkins')
        .query({ from: '2026-01-01', to: '2026-01-31' })
        .set('Authorization', await authorization())
        .expect(200);

      expect(response.body).toEqual({ from: '2026-01-01', to: '2026-01-31', checkins: [] });
    });

    it('refuses a period that runs backwards', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .get('/v1/me/checkins')
        .query({ from: '2026-11-27', to: '2026-11-20' })
        .set('Authorization', await authorization())
        .expect(400);

      expect(response.body.error.code).toBe('health.checkin.invalid_period');
    });

    it('refuses a period longer than the API answers in one go', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .get('/v1/me/checkins')
        .query({ from: '2020-01-01', to: '2026-11-27' })
        .set('Authorization', await authorization())
        .expect(400);

      expect(response.body.error.code).toBe('health.checkin.period_too_long');
    });

    it('refuses a request that does not say which period', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      const response = await request(health.app.getHttpServer())
        .get('/v1/me/checkins')
        .set('Authorization', await authorization())
        .expect(400);

      expect(response.body.error.code).toBe('api.request.invalid');
    });

    it('answers 403 for a professional: this route is about the caller', async () => {
      health = await bootHealthApp({ professionalId: 'professional-profile-id' });

      const response = await request(health.app.getHttpServer())
        .get('/v1/me/checkins')
        .query({ from: '2026-11-20', to: '2026-11-27' })
        .set('Authorization', await authorization())
        .expect(403);

      expect(response.body.error.code).toBe('identity.patient.required');
    });

    it('records no access: reading your own history is nobody else business', async () => {
      health = await bootHealthApp({ patient: PATIENT, checkins: await threeDays() });

      await request(health.app.getHttpServer())
        .get('/v1/me/checkins')
        .query({ from: '2026-11-20', to: '2026-11-27' })
        .set('Authorization', await authorization())
        .expect(200);

      expect(health.accesses).toEqual([]);
    });

    it('answers 401 without a token', async () => {
      health = await bootHealthApp({ patient: PATIENT });

      await request(health.app.getHttpServer())
        .get('/v1/me/checkins')
        .query({ from: '2026-11-20', to: '2026-11-27' })
        .expect(401);
    });
  });
});
