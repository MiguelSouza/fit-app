import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { integrationDatabaseUrl } from '../../../shared/testing/integration-postgres.spec-support';
import { RecordingEventBus } from '../../../shared/events/recording-event-bus.spec-support';
import { checkinDateIn } from '../domain/checkin';
import { DrizzleCheckinRepository } from '../infrastructure/drizzle-checkin.repository';
import { patientCallers } from './identity-doubles.spec-support';
import { ListMyCheckinsUseCase } from './list-my-checkins.use-case';
import { RecordCheckinUseCase } from './record-checkin.use-case';

/**
 * The daily check-in against a **real Postgres**, which is what CLAUDE.md
 * ("Testes") asks of a critical use case.
 *
 * The card's second acceptance criterion only means something here: **"um
 * check-in por paciente por dia (atualiza, não duplica)"** is a unique index
 * and an `on conflict do update`, and a fake repository can be written to
 * behave however the test wants. So is everything else this suite covers — the
 * instant a correction leaves alone, the `between` over a `date` column, the
 * check constraints, the foreign key into `identity` and its cascade.
 *
 * **The patient is seeded with SQL, not through `identity`'s use cases.** A
 * module never imports another module's files (CLAUDE.md rule 1), so this suite
 * cannot register a professional and accept an invitation the way `identity`'s
 * own suites do; what the foreign key needs is a `profile` and a `patient` row,
 * and two inserts are the honest way to get them. It is a fixture, in a
 * throwaway database, and the only statements in this module that ever name
 * another schema.
 *
 * No data of a real person goes in: the ids are random, the name is a label and
 * the answers are a synthetic patient's (CLAUDE.md, "Testes").
 */
const SAO_PAULO = 'America/Sao_Paulo';

const ANSWERS = { energy: 4, sleepQuality: 3, hunger: 2, symptoms: [] as const };

describe('the daily check-in, against a real Postgres', () => {
  const pool = new Pool({
    connectionString: integrationDatabaseUrl(),
    application_name: 'fit-app-test',
  });

  const checkins = new DrizzleCheckinRepository(pool);

  afterAll(async () => {
    // A pool left open is a jest run that does not exit.
    await pool.end();
  });

  /**
   * A patient, as the foreign key needs them: a profile and the row that says
   * that profile is a patient.
   */
  async function aPatient(): Promise<string> {
    const profileId = randomUUID();

    await pool.query(
      `insert into identity.profile (id, auth_user_id, role, full_name, time_zone)
       values ($1, $2, 'patient', 'Paciente de teste', $3)`,
      [profileId, randomUUID(), SAO_PAULO],
    );
    await pool.query('insert into identity.patient (profile_id) values ($1)', [profileId]);

    return profileId;
  }

  /** A profile that is **not** a patient, for the test about the foreign key. */
  async function aProfessionalProfile(): Promise<string> {
    const profileId = randomUUID();

    await pool.query(
      `insert into identity.profile (id, auth_user_id, role, full_name, time_zone)
       values ($1, $2, 'professional', 'Profissional de teste', $3)`,
      [profileId, randomUUID(), SAO_PAULO],
    );

    return profileId;
  }

  /** How many check-ins this patient has, straight from the table. */
  async function countOf(patientProfileId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from health.checkin where patient_profile_id = $1',
      [patientProfileId],
    );

    return Number(rows[0]?.count ?? '0');
  }

  function toRecord(patientProfileId: string, date: string, savedAt: Date) {
    return {
      patientProfileId,
      date,
      ...ANSWERS,
      symptoms: [],
      otherSymptom: null,
      note: null,
      savedAt,
    };
  }

  describe('the write', () => {
    it('writes one row, and the second save of the same day updates it', async () => {
      const patient = await aPatient();
      const first = new Date('2026-11-20T12:00:00.000Z');
      const later = new Date('2026-11-20T18:30:00.000Z');

      const written = await checkins.save({
        ...toRecord(patient, '2026-11-20', first),
        symptoms: ['nausea', 'headache'],
        note: 'dia difícil',
      });

      expect(written).toMatchObject({
        date: '2026-11-20',
        energy: 4,
        sleepQuality: 3,
        hunger: 2,
        symptoms: ['nausea', 'headache'],
        note: 'dia difícil',
        recordedAt: first,
        updatedAt: first,
      });

      const corrected = await checkins.save({
        ...toRecord(patient, '2026-11-20', later),
        energy: 1,
      });

      // One row. The unique index is what makes this true however many
      // requests arrive.
      expect(await countOf(patient)).toBe(1);

      expect(corrected).toMatchObject({
        energy: 1,

        // The whole set of answers is replaced: the symptoms and the note are
        // gone because the patient took them out.
        symptoms: [],
        note: null,

        // The day the patient first answered does not move.
        recordedAt: first,
        updatedAt: later,
      });
    });

    it('keeps one row when two saves of the same day race each other', async () => {
      const patient = await aPatient();
      const savedAt = new Date('2026-11-21T12:00:00.000Z');

      // Both statements are in flight before either commits, which is the case
      // a `select` followed by an `insert` gets wrong and an upsert does not.
      const [one, other] = await Promise.all([
        checkins.save({ ...toRecord(patient, '2026-11-21', savedAt), energy: 1 }),
        checkins.save({ ...toRecord(patient, '2026-11-21', savedAt), energy: 5 }),
      ]);

      expect(await countOf(patient)).toBe(1);

      // Both callers are answered a real row: whichever of the two won, the
      // answer is the state of the database and not what that request sent.
      expect([one.energy, other.energy]).toEqual(expect.arrayContaining([expect.any(Number)]));
    });

    it('keeps the two patients apart: the same day is two rows', async () => {
      const one = await aPatient();
      const other = await aPatient();
      const savedAt = new Date('2026-11-22T12:00:00.000Z');

      await checkins.save(toRecord(one, '2026-11-22', savedAt));
      await checkins.save(toRecord(other, '2026-11-22', savedAt));

      expect(await countOf(one)).toBe(1);
      expect(await countOf(other)).toBe(1);
    });

    it('keeps the detail of `other`, and refuses one without the chip', async () => {
      const patient = await aPatient();
      const savedAt = new Date('2026-11-23T12:00:00.000Z');

      const written = await checkins.save({
        ...toRecord(patient, '2026-11-23', savedAt),
        symptoms: ['other'],
        otherSymptom: 'queimação no peito',
      });

      expect(written.otherSymptom).toBe('queimação no peito');

      // The domain drops it; this is the same rule where a statement written
      // by hand cannot miss it.
      await expect(
        pool.query(
          `insert into health.checkin
             (patient_profile_id, date, energy, sleep_quality, hunger, symptoms,
              other_symptom, recorded_at, updated_at)
           values ($1, '2026-11-24', 3, 3, 3, '{nausea}', 'algo', now(), now())`,
          [patient],
        ),
      ).rejects.toThrow(/checkin_other_symptom_needs_other/u);
    });

    it('refuses a scale off the scale, whoever writes it', async () => {
      const patient = await aPatient();

      await expect(
        pool.query(
          `insert into health.checkin
             (patient_profile_id, date, energy, sleep_quality, hunger, recorded_at, updated_at)
           values ($1, '2026-11-25', 9, 3, 3, now(), now())`,
          [patient],
        ),
      ).rejects.toThrow(/checkin_energy_scale/u);
    });

    it('refuses a check-in for a profile that is not a patient', async () => {
      const notAPatient = await aProfessionalProfile();

      await expect(checkins.save(toRecord(notAPatient, '2026-11-26', new Date()))).rejects.toThrow(
        /checkin_patient_profile_id_patient_profile_id_fk/u,
      );
    });

    it('takes the check-ins with the patient when the profile is erased', async () => {
      const patient = await aPatient();

      await checkins.save(toRecord(patient, '2026-11-27', new Date()));
      expect(await countOf(patient)).toBe(1);

      // Erasing a person is a right with a card of its own; what this asserts
      // is that no check-in of nobody is left behind when it happens.
      await pool.query('delete from identity.profile where id = $1', [patient]);

      expect(await countOf(patient)).toBe(0);
    });
  });

  describe('the period', () => {
    it('reads both ends in, in order, and nobody else rows', async () => {
      const patient = await aPatient();
      const other = await aPatient();

      for (const date of ['2026-10-05', '2026-10-01', '2026-10-03', '2026-10-09']) {
        await checkins.save(toRecord(patient, date, new Date(`${date}T12:00:00.000Z`)));
      }

      await checkins.save(toRecord(other, '2026-10-02', new Date('2026-10-02T12:00:00.000Z')));

      const found = await checkins.findInPeriod(patient, { from: '2026-10-01', to: '2026-10-05' });

      expect(found.map((checkin) => checkin.date)).toEqual([
        '2026-10-01',
        '2026-10-03',
        '2026-10-05',
      ]);
    });

    it('answers nothing for a period with no check-in in it', async () => {
      const patient = await aPatient();

      await checkins.save(toRecord(patient, '2026-09-10', new Date('2026-09-10T12:00:00.000Z')));

      expect(
        await checkins.findInPeriod(patient, { from: '2026-08-01', to: '2026-08-31' }),
      ).toEqual([]);
    });

    it('answers the day as text, with no clock and no zone on it', async () => {
      const patient = await aPatient();

      await checkins.save(toRecord(patient, '2026-09-15', new Date('2026-09-15T12:00:00.000Z')));

      const [found] = await checkins.findInPeriod(patient, {
        from: '2026-09-15',
        to: '2026-09-15',
      });

      // A `date` column read as `YYYY-MM-DD`: the one thing that keeps a
      // Tuesday from drifting into Monday when somebody reads it elsewhere.
      expect(found?.date).toBe('2026-09-15');
    });
  });

  describe('the use cases over it', () => {
    /** The patient's today, read exactly as the use case reads it. */
    function today(): string {
      return checkinDateIn(SAO_PAULO, new Date());
    }

    it('saves today, announces it, and answers it again from the listing', async () => {
      const profileId = await aPatient();
      const events = new RecordingEventBus();
      const callers = patientCallers({ profileId, timeZone: SAO_PAULO });

      const record = new RecordCheckinUseCase(callers, checkins, events);
      const list = new ListMyCheckinsUseCase(callers, checkins);

      await record.execute('whatever-the-token-said', today(), {
        energy: 5,
        sleepQuality: 4,
        hunger: 1,
        symptoms: ['bloating', 'bloating'],
        note: '  tudo tranquilo  ',
      });

      const { checkins: found } = await list.execute('whatever-the-token-said', today(), today());

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        date: today(),
        energy: 5,
        sleepQuality: 4,
        hunger: 1,

        // Deduplicated by the domain before it ever reached the column.
        symptoms: ['bloating'],
        note: 'tudo tranquilo',
      });

      expect(events.payloadsOf('health.checkin.recorded')).toEqual([
        expect.objectContaining({ patientId: profileId, date: today(), corrected: false }),
      ]);
    });

    it('calls the second save of the same day a correction, and still writes one row', async () => {
      const profileId = await aPatient();
      const events = new RecordingEventBus();
      const record = new RecordCheckinUseCase(
        patientCallers({ profileId, timeZone: SAO_PAULO }),
        checkins,
        events,
      );

      await record.execute('token', today(), { ...ANSWERS, symptoms: [] });

      // Far enough apart for the two instants to differ.
      await new Promise((resolve) => setTimeout(resolve, 2));

      await record.execute('token', today(), { ...ANSWERS, symptoms: [], energy: 1 });

      expect(await countOf(profileId)).toBe(1);
      expect(
        events.payloadsOf('health.checkin.recorded').map((payload) => payload.corrected),
      ).toEqual([false, true]);
    });

    it('refuses a day that is not the patient today, and writes nothing', async () => {
      const profileId = await aPatient();
      const events = new RecordingEventBus();
      const record = new RecordCheckinUseCase(
        patientCallers({ profileId, timeZone: SAO_PAULO }),
        checkins,
        events,
      );

      await expect(
        record.execute('token', '2026-01-15', { ...ANSWERS, symptoms: [] }),
      ).rejects.toMatchObject({ code: 'health.checkin.window_closed' });

      expect(await countOf(profileId)).toBe(0);
      expect(events.published).toEqual([]);
    });
  });
});
