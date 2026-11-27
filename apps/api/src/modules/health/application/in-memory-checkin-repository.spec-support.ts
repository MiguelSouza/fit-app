import { type CheckinPeriod, type CheckinToRecord, type RecordedCheckin } from '../domain/checkin';
import { type CheckinRepository } from './ports/checkin-repository.port';

/** A row of `health.checkin`, as this double keeps it. */
interface CheckinRow extends RecordedCheckin {
  readonly patientProfileId: string;
}

/**
 * The check-ins without a database, for the tests that are about the use cases
 * and not about the SQL (card P-02).
 *
 * What it reproduces faithfully is the one thing the use cases lean on: **one
 * row per patient per day**. A second save of the same day replaces the
 * answers and keeps the first `recorded_at`, which is what the unique index
 * and the `on conflict do update` of the real one do — so a unit test can
 * assert "atualiza, não duplica" and "a correção não move a data" without
 * Postgres.
 *
 * What only the real one can prove is that the index is what decides a race,
 * and that a period reads in order from the database; that is
 * `checkins.use-case.integration-spec.ts` (CLAUDE.md, "Testes").
 *
 * No data of a real person goes in here: a patient is an id, a symptom is a
 * code and the values are the ones a synthetic patient would answer.
 *
 * Not a `*.spec.ts` file, so jest does not read it as a suite, and excluded
 * from `tsconfig.build.json`, so it never reaches `dist/`.
 */
export class InMemoryCheckinRepository implements CheckinRepository {
  /** Every row there is, in no particular order. */
  readonly rows: CheckinRow[] = [];

  save(checkin: CheckinToRecord): Promise<RecordedCheckin> {
    const index = this.rows.findIndex(
      (row) => row.patientProfileId === checkin.patientProfileId && row.date === checkin.date,
    );

    const existing = index < 0 ? undefined : this.rows[index];

    const row: CheckinRow = {
      patientProfileId: checkin.patientProfileId,
      date: checkin.date,
      energy: checkin.energy,
      sleepQuality: checkin.sleepQuality,
      hunger: checkin.hunger,
      symptoms: checkin.symptoms,
      otherSymptom: checkin.otherSymptom,
      note: checkin.note,

      // What `on conflict do update` does: the first instant stays, the second
      // one moves.
      recordedAt: existing?.recordedAt ?? checkin.savedAt,
      updatedAt: checkin.savedAt,
    };

    if (existing === undefined) {
      this.rows.push(row);
    } else {
      this.rows[index] = row;
    }

    return Promise.resolve(toRecordedCheckin(row));
  }

  findInPeriod(
    patientProfileId: string,
    period: CheckinPeriod,
  ): Promise<readonly RecordedCheckin[]> {
    // The dates are `YYYY-MM-DD`, so comparing them as text is comparing them
    // as days — which is also why the column is a `date` and not a timestamp.
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.patientProfileId === patientProfileId &&
            row.date >= period.from &&
            row.date <= period.to,
        )
        .sort((one, other) => one.date.localeCompare(other.date))
        .map(toRecordedCheckin),
    );
  }

  /** The check-in of one day, for an assertion about the row and not the answer. */
  rowOf(patientProfileId: string, date: string): RecordedCheckin | undefined {
    const row = this.rows.find(
      (candidate) => candidate.patientProfileId === patientProfileId && candidate.date === date,
    );

    return row === undefined ? undefined : toRecordedCheckin(row);
  }
}

function toRecordedCheckin(row: CheckinRow): RecordedCheckin {
  return {
    date: row.date,
    energy: row.energy,
    sleepQuality: row.sleepQuality,
    hunger: row.hunger,
    symptoms: row.symptoms,
    otherSymptom: row.otherSymptom,
    note: row.note,
    recordedAt: row.recordedAt,
    updatedAt: row.updatedAt,
  };
}
