import {
  type CheckinPeriod,
  type CheckinToRecord,
  type RecordedCheckin,
} from '../../domain/checkin';

/**
 * Where the daily check-ins are read and written (card P-02).
 *
 * Not an abstraction per table (CLAUDE.md rule 5): it is the two things the
 * use cases do — save the check-in of a day, read the check-ins of a period —
 * and it exists so `application/` holds no Drizzle and so the use cases can be
 * driven without a database.
 *
 * It reads and writes the `health` schema and nothing else (rule 2). Which
 * patient a check-in belongs to is a `identity.profile.id` and arrives as an
 * argument: whether the caller may touch it is decided before anything here
 * runs, by `identity`'s access rule (ADR 0017).
 *
 * What only a real Postgres can prove — that the unique index on
 * (patient, day) makes a second save an update and never a second row, that a
 * correction keeps the first `recorded_at`, that a period reads in order — is
 * `checkins.use-case.integration-spec.ts` (CLAUDE.md, "Testes").
 */
export const CHECKIN_REPOSITORY = Symbol('fit-app.health.checkinRepository');

export interface CheckinRepository {
  /**
   * Writes the check-in of a day and answers the check-in that is there
   * afterwards.
   *
   * **One row per patient per day, and the database is what says so.** This is
   * an upsert on (patient, day), so two requests arriving at the same instant
   * produce one check-in and both callers are answered the one that holds —
   * which is the card's acceptance criterion ("atualiza, não duplica") decided
   * by a unique index instead of by a check somebody could race past.
   *
   * A correction replaces the answers and **keeps `recorded_at`**: the day the
   * patient first answered does not move because they fixed a tap. Which of
   * the two happened is read from the answer (`wasCorrected`), not reported
   * here, so the port says nothing a test double would have to fake.
   */
  save(checkin: CheckinToRecord): Promise<RecordedCheckin>;

  /**
   * The check-ins of this patient inside the period, both ends included, from
   * the oldest day to the newest.
   *
   * **Days with no check-in are simply absent.** Nothing is filled in with
   * empty values: a day nobody answered is not a check-in with zeros, and
   * inventing one would be this module answering for the patient.
   *
   * Never cached, for the same reason `identity`'s access facts are not
   * (ADR 0017): a professional whose consent was revoked a second ago must
   * stop seeing these on the next request, and the only way that holds is if
   * the read happens when it is asked for.
   *
   * @param patientProfileId `identity.profile.id` of the patient — ours, never
   *   the Supabase user id
   */
  findInPeriod(
    patientProfileId: string,
    period: CheckinPeriod,
  ): Promise<readonly RecordedCheckin[]>;
}
