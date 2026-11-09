import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_POOL } from '../../../shared/database/database.module';
import { type PatientAccessRepository } from '../application/ports/patient-access.port';
import { type CareRelationship } from '../domain/care-relationship';
import { SHARE_WITH_PROFESSIONAL, type PatientAccessFacts } from '../domain/patient-access';
import {
  careRelationship,
  consent,
  identityTables,
  organizationMember,
  professional,
} from './identity.schema';

/**
 * The facts of the access rule over Postgres (card I-04).
 *
 * It reads the `identity` schema and nothing else, and it only ever reads
 * (CLAUDE.md rule 2). The two queries below go out **together**: they share no
 * value, so one round trip of latency answers both, and the check sits in
 * front of every request that touches a patient.
 *
 * Nothing is cached, deliberately. A consent revoked a second ago has to cut
 * the access off at once (CLAUDE.md, "Saúde e LGPD": "revogar consentimento
 * corta o acesso na hora"), and a cache with a time to live is exactly the
 * copy that ignores it. What makes that affordable is the shape of the
 * queries: a primary key lookup, an index on `care_relationship`'s unique pair
 * and the partial unique index on the consents in force.
 *
 * **Nothing is logged here.** Which patient a professional asked about is a
 * pair of ids and the service is what writes it, once, when the answer is no.
 */
@Injectable()
export class DrizzlePatientAccessRepository implements PatientAccessRepository {
  private readonly db: NodePgDatabase<typeof identityTables>;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema: identityTables });
  }

  async findFacts(
    professionalProfileId: string,
    patientProfileId: string,
  ): Promise<PatientAccessFacts> {
    const [rows, shareWithProfessionalInForce] = await Promise.all([
      this.professionalAndLinks(professionalProfileId, patientProfileId),
      this.consentInForce(patientProfileId),
    ]);

    const [first] = rows;

    // No row at all: that id is nobody's professional profile. The service
    // answers the same thing it answers for a patient of another practice.
    if (first === undefined) {
      return {
        professionalType: null,
        careRelationships: [],
        shareWithProfessionalInForce,
      };
    }

    return {
      professionalType: first.professionalType,
      careRelationships: rows.flatMap((row) => (row.link === null ? [] : [linkOf(row.link)])),
      shareWithProfessionalInForce,
    };
  }

  /**
   * The professional, and the links between the practices they belong to and
   * this patient — one query, because the second question is "of this
   * professional's practices" and the join is what says so.
   *
   * Two `leftJoin`s and not inner ones: a professional with no practice, or
   * with a practice that does not follow this patient, still has to come back
   * as **a professional with no link**. An inner join would answer the same
   * empty set for an id that is not a professional at all, and the refusal
   * written in the log would name the wrong reason.
   *
   * One row per membership of the professional, which is one row today (ADR
   * 0014) and stays small in a clinic.
   */
  private professionalAndLinks(professionalProfileId: string, patientProfileId: string) {
    return this.db
      .select({ professionalType: professional.professionalType, link: careRelationship })
      .from(professional)
      .leftJoin(organizationMember, eq(organizationMember.profileId, professional.profileId))
      .leftJoin(
        careRelationship,
        and(
          eq(careRelationship.organizationId, organizationMember.organizationId),
          eq(careRelationship.patientProfileId, patientProfileId),
        ),
      )
      .where(eq(professional.profileId, professionalProfileId));
  }

  /**
   * Whether the patient's `share_with_professional` consent is in force: one
   * row of that purpose with no `revoked_at`.
   *
   * A revocation is a new state of the row and never a delete (card I-03), so
   * "in force" is the `is null` and not the existence of the row — and the
   * partial unique index on exactly this condition is what makes it one probe.
   * The consent belongs to the patient's profile, which is why the practice is
   * not in this query: whose patient they are is what the link above says.
   */
  private async consentInForce(patientProfileId: string): Promise<boolean> {
    const [found] = await this.db
      .select({ id: consent.id })
      .from(consent)
      .where(
        and(
          eq(consent.profileId, patientProfileId),
          eq(consent.type, SHARE_WITH_PROFESSIONAL),
          isNull(consent.revokedAt),
        ),
      )
      .limit(1);

    return found !== undefined;
  }
}

/** The row as the domain reads a link. `created_at` is bookkeeping and stays here. */
function linkOf(row: typeof careRelationship.$inferSelect): CareRelationship {
  return {
    id: row.id,
    organizationId: row.organizationId,
    patientProfileId: row.patientProfileId,
    invitationId: row.invitationId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}
