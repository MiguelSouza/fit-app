import { randomUUID } from 'node:crypto';

import {
  type AccessLogActor,
  type AccessLogCursor,
  type AccessLogEntry,
  type AccessToLog,
} from '../domain/access-log';
import { type AccessLogRepository } from './ports/access-log.port';

/** A row of `identity.access_log`, as this double keeps it. */
interface AccessLogRow extends AccessToLog {
  readonly id: string;
  readonly actor: AccessLogActor;
}

/**
 * The access log without a database, for the tests that are about the use
 * cases and not about the SQL (card I-06).
 *
 * What it reproduces faithfully is what those tests lean on: rows only ever
 * arrive, they come back newest first, and a page continues strictly after the
 * cursor — including when two accesses share an instant, which is the case the
 * ordering exists for. **Nothing in here removes or rewrites a row**, as in
 * the real one.
 *
 * What only Postgres can prove is the half of the criterion that is written in
 * SQL: that the table itself refuses an `update` and a `delete`, and that the
 * index answers a page without reading the whole log. That is
 * `access-log.use-case.integration-spec.ts` (CLAUDE.md, "Testes"). No data of
 * a real person goes in here: the ids are random and the names are labels.
 */
export class InMemoryAccessLogRepository implements AccessLogRepository {
  /** Every row ever written, in the order they were written. */
  readonly rows: AccessLogRow[] = [];

  /**
   * @param actorsByProfileId who each actor is, as the real repository reads
   *   them off `profile` and `professional`
   */
  constructor(private readonly actorsByProfileId: Readonly<Record<string, AccessLogActor>> = {}) {}

  append(access: AccessToLog): Promise<void> {
    this.rows.push({
      ...access,
      id: randomUUID(),
      actor: this.actorsByProfileId[access.actorProfileId] ?? {
        name: 'Profissional de teste',
        professionalType: 'nutritionist',
      },
    });

    return Promise.resolve();
  }

  findPage(
    patientProfileId: string,
    limit: number,
    before?: AccessLogCursor,
  ): Promise<readonly AccessLogEntry[]> {
    const mine = this.rows.filter((row) => row.patientProfileId === patientProfileId);

    const page = [...mine]
      .sort(newestFirst)
      .filter((row) => before === undefined || isAfter(row, before))
      .slice(0, limit);

    return Promise.resolve(page.map(toEntry));
  }

  /** How many records this patient has, for a test that counts the visits. */
  countFor(patientProfileId: string): number {
    return this.rows.filter((row) => row.patientProfileId === patientProfileId).length;
  }
}

/** Newest first, and the id breaks a tie — the order of the real index. */
function newestFirst(one: AccessLogRow, other: AccessLogRow): number {
  const byInstant = other.occurredAt.getTime() - one.occurredAt.getTime();

  return byInstant !== 0 ? byInstant : other.id.localeCompare(one.id);
}

/** Strictly after the cursor, in that same order. */
function isAfter(row: AccessLogRow, cursor: AccessLogCursor): boolean {
  if (row.occurredAt.getTime() !== cursor.occurredAt.getTime()) {
    return row.occurredAt.getTime() < cursor.occurredAt.getTime();
  }

  return row.id.localeCompare(cursor.id) < 0;
}

function toEntry(row: AccessLogRow): AccessLogEntry {
  return {
    id: row.id,
    actor: row.actor,
    resource: row.resource,
    action: row.action,
    occurredAt: row.occurredAt,
  };
}
