import {
  type AccessLogCursor,
  type AccessLogEntry,
  type AccessToLog,
} from '../../domain/access-log';

/**
 * Where an access to a patient's data is written down, and where the patient
 * reads it back (card I-06).
 *
 * **Two methods, and one of them is the whole point: there is no third.** The
 * port offers no update and no delete, so no caller in this codebase — no use
 * case, no job, no future module — has a way to change a record or to remove
 * one. That is the card's third acceptance criterion written as a type, and
 * the database holds the other half of it: the table refuses an `update` and a
 * `delete` outright (`0004_identity_access_log_append_only.sql`), because a
 * trail that the code merely *chooses* not to rewrite is a trail one careless
 * query undoes.
 *
 * Like the ports next door it is not an abstraction per table (CLAUDE.md rule
 * 5): it is the two things the platform does with the log, and it exists so
 * `application/` holds no Drizzle and so both sides can be driven without a
 * database.
 */
export const ACCESS_LOG_REPOSITORY = Symbol('fit-app.identity.accessLogRepository');

export interface AccessLogRepository {
  /**
   * Writes one record. Nothing is read first and nothing is deduplicated: each
   * call is one access that really happened, and two identical rows a minute
   * apart are two visits, not a mistake to be collapsed.
   *
   * @param access what the domain built (`accessToLog`), with the instant of
   *   the access already decided
   */
  append(access: AccessToLog): Promise<void>;

  /**
   * One page of the patient's own records, **newest first**.
   *
   * @param patientProfileId whose data was accessed. It is the only filter,
   *   and it is what makes "paciente vê só os próprios registros" a condition
   *   of the query rather than a check somebody has to remember.
   * @param limit how many rows to read. The use case asks for one more than
   *   the page it is going to answer, which is how it knows there is a next
   *   page without counting the table.
   * @param before where the previous page ended: only records strictly older
   *   than that instant, and — at the same instant — only the rows after that
   *   id. Absent on the first page.
   */
  findPage(
    patientProfileId: string,
    limit: number,
    before?: AccessLogCursor,
  ): Promise<readonly AccessLogEntry[]>;
}
