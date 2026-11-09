import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_POOL } from '../../../shared/database/database.module';
import { type AccessLogRepository } from '../application/ports/access-log.port';
import { type AccessLogCursor, type AccessLogEntry, type AccessToLog } from '../domain/access-log';
import { accessLog, identityTables, professional, profile } from './identity.schema';

/**
 * The `AccessLogRepository` over Postgres (card I-06).
 *
 * It reads and writes the `identity` schema and nothing else (CLAUDE.md rule
 * 2). The Drizzle handle is built here, over the pool the whole API shares,
 * and knows only this module's tables.
 *
 * Three things are deliberate:
 *
 * - **There is no `update` and no `delete` in this file**, and there is no
 *   method that could grow one — the port has two. The database says the same
 *   thing with a trigger (`0004_identity_access_log_append_only.sql`), which
 *   is the acceptance criterion "registros não podem ser editados nem apagados
 *   pela API" answered by Postgres instead of by this class behaving itself.
 * - **The page is keyset, never an offset.** The log only grows and is read
 *   newest first, so an offset would shift under a patient between two pages
 *   and the row it skipped would be the one access they never saw. The
 *   comparison is on the pair `(occurred_at, id)`, which is exactly the index
 *   on the table — one range scan per page, whatever the size of the log.
 * - **Who accessed is read in the same query.** An `inner join` to `profile`
 *   for the name and a `left join` to `professional` for the licence: left,
 *   because what is recorded is a person and the answer must not invent a
 *   licence for somebody who has none.
 *
 * **Nothing is logged here.** Who opened whose chart is personal data on both
 * sides (CLAUDE.md, "Saúde e LGPD"); the row is the record, and the patient is
 * its reader.
 */
@Injectable()
export class DrizzleAccessLogRepository implements AccessLogRepository {
  private readonly db: NodePgDatabase<typeof identityTables>;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema: identityTables });
  }

  /**
   * One row, one access. No `on conflict` and nothing read first: every call
   * is a visit that really happened, and two identical rows are two visits.
   */
  async append(access: AccessToLog): Promise<void> {
    await this.db.insert(accessLog).values({
      actorProfileId: access.actorProfileId,
      patientProfileId: access.patientProfileId,
      resource: access.resource,
      action: access.action,
      occurredAt: access.occurredAt,
    });
  }

  async findPage(
    patientProfileId: string,
    limit: number,
    before?: AccessLogCursor,
  ): Promise<readonly AccessLogEntry[]> {
    const rows = await this.db
      .select({
        id: accessLog.id,
        resource: accessLog.resource,
        action: accessLog.action,
        occurredAt: accessLog.occurredAt,
        actorName: profile.fullName,
        actorProfessionalType: professional.professionalType,
      })
      .from(accessLog)
      .innerJoin(profile, eq(profile.id, accessLog.actorProfileId))
      .leftJoin(professional, eq(professional.profileId, accessLog.actorProfileId))
      .where(and(eq(accessLog.patientProfileId, patientProfileId), olderThan(before)))
      .orderBy(desc(accessLog.occurredAt), desc(accessLog.id))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      actor: { name: row.actorName, professionalType: row.actorProfessionalType },
      resource: row.resource,
      action: row.action,
      occurredAt: row.occurredAt,
    }));
  }
}

/**
 * Strictly before the cursor, as one row comparison.
 *
 * `(occurred_at, id) < (instant, id)` and not two `or`ed conditions: it says
 * the same thing, Postgres matches it against the composite index directly,
 * and it is the one form that cannot be written subtly wrong. The casts are
 * there because a parameter inside a row constructor has no type Postgres can
 * infer; the values come from a cursor this API minted and validated
 * (`decodeAccessLogCursor`), so neither cast can be reached with junk.
 */
function olderThan(cursor: AccessLogCursor | undefined) {
  if (cursor === undefined) return undefined;

  return sql`(${accessLog.occurredAt}, ${accessLog.id}) < (${cursor.occurredAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
}
