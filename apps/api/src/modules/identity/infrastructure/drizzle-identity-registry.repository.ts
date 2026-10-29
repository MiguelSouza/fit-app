import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_POOL } from '../../../shared/database/database.module';
import { type IdentityRegistry } from '../application/ports/identity-registry.port';
import { type ProfessionalRegistration } from '../domain/professional-registration';
import {
  type OrganizationMembership,
  type ProfessionalDetails,
  type RegisteredIdentity,
} from '../domain/registered-identity';
import {
  identityTables,
  organization,
  organizationMember,
  professional,
  profile,
} from './identity.schema';

/**
 * The `IdentityRegistry` over Postgres.
 *
 * It reads and writes the `identity` schema and nothing else (CLAUDE.md rule
 * 2); the joins below stay inside it. The Drizzle handle is built here, over
 * the pool the whole API shares (`shared/database`), and it only knows this
 * module's tables — a query that reached for another module's would not
 * compile.
 */
@Injectable()
export class DrizzleIdentityRegistry implements IdentityRegistry {
  private readonly db: NodePgDatabase<typeof identityTables>;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema: identityTables });
  }

  async findByAuthUserId(authUserId: string): Promise<RegisteredIdentity | undefined> {
    // One query for the person and their professional half, which is one row
    // or none, and another for the practices, which is a list.
    const [row] = await this.db
      .select({
        personId: profile.id,
        role: profile.role,
        fullName: profile.fullName,
        timeZone: profile.timeZone,
        professionalType: professional.professionalType,
        councilNumber: professional.councilNumber,
        specialty: professional.specialty,
      })
      .from(profile)
      .leftJoin(professional, eq(professional.profileId, profile.id))
      .where(eq(profile.authUserId, authUserId))
      .limit(1);

    if (row === undefined) return undefined;

    return {
      personId: row.personId,
      role: row.role,
      fullName: row.fullName,
      timeZone: row.timeZone,
      professional:
        row.councilNumber === null || row.professionalType === null
          ? null
          : {
              type: row.professionalType,
              councilNumber: row.councilNumber,
              specialty: row.specialty,
            },
      organizations: await this.organizationsOf(row.personId),
    };
  }

  async createProfessional(
    registration: ProfessionalRegistration,
  ): Promise<RegisteredIdentity | undefined> {
    return this.db.transaction(async (tx) => {
      // `on conflict do nothing` and not a check before the insert: the unique
      // index is the only thing that answers truthfully when two requests of
      // the same person arrive at the same moment. No row back means the
      // person is already registered, and the transaction ends having written
      // nothing.
      const [created] = await tx
        .insert(profile)
        .values({
          authUserId: registration.authUserId,
          role: registration.role,
          fullName: registration.fullName,
          timeZone: registration.timeZone,
        })
        .onConflictDoNothing({ target: profile.authUserId })
        .returning({ id: profile.id });

      if (created === undefined) return undefined;

      const [registeredProfessional] = await tx
        .insert(professional)
        .values({
          profileId: created.id,
          professionalType: registration.professionalType,
          councilNumber: registration.councilNumber,
          specialty: registration.specialty,
        })
        .returning({
          type: professional.professionalType,
          councilNumber: professional.councilNumber,
          specialty: professional.specialty,
        });

      const [practice] = await tx
        .insert(organization)
        .values({ name: registration.organization.name, kind: registration.organization.kind })
        .returning({ id: organization.id, name: organization.name, kind: organization.kind });

      // The four rows of the acceptance criterion. The two above cannot come
      // back empty — an insert that inserted nothing would have thrown — and
      // the checks are what let the compiler see it.
      if (registeredProfessional === undefined || practice === undefined) {
        throw new Error('the registration inserted a row and got none back');
      }

      const [membership] = await tx
        .insert(organizationMember)
        .values({
          organizationId: practice.id,
          profileId: created.id,
          role: registration.membershipRole,
        })
        .returning({ role: organizationMember.role });

      if (membership === undefined) {
        throw new Error('the registration inserted a membership and got none back');
      }

      return {
        personId: created.id,
        role: registration.role,
        fullName: registration.fullName,
        timeZone: registration.timeZone,
        professional: registeredProfessional satisfies ProfessionalDetails,
        organizations: [
          {
            organizationId: practice.id,
            name: practice.name,
            kind: practice.kind,
            role: membership.role,
          } satisfies OrganizationMembership,
        ],
      };
    });
  }

  /** The practices a profile belongs to, with the name of each. */
  private async organizationsOf(personId: string): Promise<OrganizationMembership[]> {
    const rows = await this.db
      .select({
        organizationId: organization.id,
        name: organization.name,
        kind: organization.kind,
        role: organizationMember.role,
      })
      .from(organizationMember)
      .innerJoin(organization, eq(organization.id, organizationMember.organizationId))
      .where(eq(organizationMember.profileId, personId));

    return rows;
  }
}
