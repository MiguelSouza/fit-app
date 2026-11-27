import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_POOL } from '../../../shared/database/database.module';
import { type CheckinRepository } from '../application/ports/checkin-repository.port';
import { type CheckinPeriod, type CheckinToRecord, type RecordedCheckin } from '../domain/checkin';
import { checkin, healthTables } from './health.schema';

/**
 * What a check-in is read as. The row id and the patient are bookkeeping and
 * stay in here: the day names the check-in, and who it belongs to is what the
 * caller asked for.
 */
const CHECKIN_COLUMNS = {
  date: checkin.date,
  energy: checkin.energy,
  sleepQuality: checkin.sleepQuality,
  hunger: checkin.hunger,
  symptoms: checkin.symptoms,
  otherSymptom: checkin.otherSymptom,
  note: checkin.note,
  recordedAt: checkin.recordedAt,
  updatedAt: checkin.updatedAt,
};

/**
 * Why there is no mapping function under this one: the columns above come back
 * typed as `RecordedCheckin` already — Drizzle types an array of a pg enum as
 * the closed union of its values, and the two lists are checked against each
 * other at compile time in `health.schema.ts` (`CheckinSymptomDrift`). So the
 * row **is** the domain's shape, and a conversion here would only be a place
 * for the two to drift.
 */

/**
 * The `CheckinRepository` over Postgres (card P-02).
 *
 * It reads and writes the `health` schema and nothing else (CLAUDE.md rule 2).
 * The Drizzle handle is built here, over the pool the whole API shares, and
 * knows only this module's tables — so there is no statement in this file that
 * could join into `identity`, however convenient a name would be.
 *
 * Two things are deliberate, and each is an acceptance criterion decided by the
 * database instead of by this process:
 *
 * - **One check-in per patient per day.** `insert ... on conflict do update` on
 *   the unique index `checkin_patient_profile_id_date_idx`, so "atualiza, não
 *   duplica" survives a double tap and two requests arriving together: one row,
 *   and both callers answered the one that holds.
 * - **A correction keeps the first `recorded_at`.** The `set` of the upsert
 *   does not name that column, which is what makes "editável no mesmo dia"
 *   readable afterwards — the instant the patient first answered does not move
 *   because they fixed a tap.
 *
 * **Nothing is logged.** Every column of this table except the two instants is
 * health data (CLAUDE.md, "Saúde e LGPD").
 */
@Injectable()
export class DrizzleCheckinRepository implements CheckinRepository {
  private readonly db: NodePgDatabase<typeof healthTables>;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema: healthTables });
  }

  /**
   * The check-in, written or replaced in one statement.
   *
   * One statement and no transaction: the upsert is the whole write, and the
   * index is what decides a race. There is no read before it either — a
   * `select` followed by an `insert` is exactly the pair that produces two rows
   * when two requests arrive together.
   *
   * The whole set of answers is replaced, including the ones that became empty:
   * a patient who removes a symptom or clears the note has to end up with a row
   * that says so, and an upsert that only set what was present would keep
   * yesterday's chips on today's check-in.
   */
  async save(toRecord: CheckinToRecord): Promise<RecordedCheckin> {
    const values = {
      patientProfileId: toRecord.patientProfileId,
      date: toRecord.date,
      energy: toRecord.energy,
      sleepQuality: toRecord.sleepQuality,
      hunger: toRecord.hunger,
      symptoms: [...toRecord.symptoms],
      otherSymptom: toRecord.otherSymptom,
      note: toRecord.note,
      updatedAt: toRecord.savedAt,
    };

    const [saved] = await this.db
      .insert(checkin)
      .values({ ...values, recordedAt: toRecord.savedAt })
      .onConflictDoUpdate({
        target: [checkin.patientProfileId, checkin.date],

        // `recordedAt` is absent on purpose: see the note on the class.
        set: values,
      })
      .returning(CHECKIN_COLUMNS);

    if (saved === undefined) {
      // Unreachable: an upsert on a unique index either inserts or updates, and
      // both return the row.
      throw new Error('the check-in that was saved did not come back');
    }

    return saved;
  }

  /**
   * The check-ins of the period, both ends included, oldest day first.
   *
   * `between` on a `date` column is a comparison between days, with no clock
   * and no zone in it — which is why the day is stored as a `date`. The unique
   * index answers this with one range scan per patient, and the `order by` is
   * the index's own order, so no sort is needed.
   */
  async findInPeriod(
    patientProfileId: string,
    period: CheckinPeriod,
  ): Promise<readonly RecordedCheckin[]> {
    return this.db
      .select(CHECKIN_COLUMNS)
      .from(checkin)
      .where(
        and(
          eq(checkin.patientProfileId, patientProfileId),
          between(checkin.date, period.from, period.to),
        ),
      )
      .orderBy(asc(checkin.date));
  }
}
