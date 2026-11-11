import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_POOL } from '../../../shared/database/database.module';
import { type CareRelationshipRepository } from '../application/ports/care-relationship.port';
import { type CareRelationship, type EndedCareRelationship } from '../domain/care-relationship';
import { careRelationship, identityTables, organizationMember } from './identity.schema';

/**
 * What a link is read as. Everything but `created_at`, which is bookkeeping of
 * the row and not a fact about the follow-up.
 */
const CARE_RELATIONSHIP_COLUMNS = {
  id: careRelationship.id,
  organizationId: careRelationship.organizationId,
  patientProfileId: careRelationship.patientProfileId,
  invitationId: careRelationship.invitationId,
  startedAt: careRelationship.startedAt,
  endedAt: careRelationship.endedAt,
};

/**
 * The `CareRelationshipRepository` over Postgres (card I-07).
 *
 * It reads and writes the `identity` schema and nothing else (CLAUDE.md rule
 * 2). The Drizzle handle is built here, over the pool the whole API shares, and
 * knows only this module's tables.
 *
 * Two things are deliberate, and each is an acceptance criterion decided by the
 * database instead of by this process:
 *
 * - **There is no `delete` in this file.** Ending a follow-up is one `update`
 *   of one column, so "nenhum dado do paciente é apagado" is not a convention
 *   somebody has to keep — there is no statement here that could break it. The
 *   row stays as the audit trail of why that practice ever saw this patient
 *   (ADR 0016).
 * - **`is null` in the `where` is what decides a race.** The patient and the
 *   professional ending the same follow-up at the same instant date the row
 *   once; the second update touches nothing and answers nothing, and the first
 *   instant is the one that stands.
 *
 * **Nothing is logged.** Who stopped following whom is personal data on both
 * sides (CLAUDE.md, "Saúde e LGPD").
 */
@Injectable()
export class DrizzleCareRelationshipRepository implements CareRelationshipRepository {
  private readonly db: NodePgDatabase<typeof identityTables>;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema: identityTables });
  }

  /**
   * The links between the practices this professional belongs to and this
   * patient, ended ones included.
   *
   * The join to `organization_member` is the authorization, not a filter added
   * on top of one: a link of a practice the caller does not belong to cannot
   * come back from this query, so there is nothing to forget to check
   * afterwards. One row per practice of theirs that follows the patient, which
   * is one at most today (ADR 0014).
   *
   * It does **not** join `professional`, unlike `DrizzlePatientAccessRepository`:
   * that one has to tell "not a professional" from "no link" for the line it
   * writes in the log, and here the caller was already resolved as a
   * professional before the question was asked (`LoadProfessionalCaller`).
   */
  async findOfProfessional(
    professionalProfileId: string,
    patientProfileId: string,
  ): Promise<readonly CareRelationship[]> {
    return this.db
      .select(CARE_RELATIONSHIP_COLUMNS)
      .from(careRelationship)
      .innerJoin(
        organizationMember,
        eq(organizationMember.organizationId, careRelationship.organizationId),
      )
      .where(
        and(
          eq(careRelationship.patientProfileId, patientProfileId),
          eq(organizationMember.profileId, professionalProfileId),
        ),
      );
  }

  /**
   * The link with that id, when the patient asking is the patient on it.
   *
   * Both halves are in the `where` on purpose: the id alone would answer
   * another patient's link, and the port's contract is that this is not
   * findable. The primary key does the work and the second condition is what
   * makes "só o próprio paciente encerra o próprio vínculo" a condition of the
   * query.
   */
  async findOfPatient(
    patientProfileId: string,
    careRelationshipId: string,
  ): Promise<CareRelationship | undefined> {
    const [found] = await this.db
      .select(CARE_RELATIONSHIP_COLUMNS)
      .from(careRelationship)
      .where(
        and(
          eq(careRelationship.id, careRelationshipId),
          eq(careRelationship.patientProfileId, patientProfileId),
        ),
      )
      .limit(1);

    return found;
  }

  /**
   * The link, dated — one statement, and only if it is still active.
   *
   * `endedAt` is not read back from the row: the column is nullable and every
   * row this statement touched was ended at the instant it was given, so
   * reading it would hand the domain a `Date | null` that cannot be null. The
   * same reasoning as `DrizzleConsentRepository.revoke`.
   */
  async end(careRelationshipId: string, endedAt: Date): Promise<EndedCareRelationship | undefined> {
    const [ended] = await this.db
      .update(careRelationship)
      .set({ endedAt })
      .where(and(eq(careRelationship.id, careRelationshipId), isNull(careRelationship.endedAt)))
      .returning(CARE_RELATIONSHIP_COLUMNS);

    return ended === undefined ? undefined : { ...ended, endedAt };
  }
}
