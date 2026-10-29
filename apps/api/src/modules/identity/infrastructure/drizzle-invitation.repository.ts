import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_POOL } from '../../../shared/database/database.module';
import { type InvitationRepository } from '../application/ports/invitation-repository.port';
import { type Invitation, type InvitationToCreate } from '../domain/invitation';
import { identityTables, invitation } from './identity.schema';

/**
 * What an invitation is read as, everywhere in this repository.
 *
 * `token_hash` is **not** in the list, and that is the point: nothing above
 * can hand it out by accident, and the domain has no field for it to land in.
 * The column is written on the creation and read, one day, by the acceptance
 * looking a row up — never selected into an object that travels.
 */
const COLUMNS = {
  id: invitation.id,
  organizationId: invitation.organizationId,
  name: invitation.name,
  contact: invitation.contact,
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
  acceptedAt: invitation.acceptedAt,
  revokedAt: invitation.revokedAt,
};

/**
 * The `InvitationRepository` over Postgres.
 *
 * It reads and writes the `identity` schema and nothing else (CLAUDE.md rule
 * 2). The Drizzle handle is built here, over the pool the whole API shares,
 * and knows only this module's tables.
 *
 * Two things are deliberate. Every query is scoped by `organization_id`, even
 * the one that already has a primary key in hand: the scope is what makes "o
 * convite pertence à organização do profissional" true in SQL and not only in
 * the use case above. And the revocation is a conditional update, so the
 * database — not a value this process read a moment ago — is what decides a
 * revocation racing an acceptance.
 */
@Injectable()
export class DrizzleInvitationRepository implements InvitationRepository {
  private readonly db: NodePgDatabase<typeof identityTables>;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema: identityTables });
  }

  async create(toCreate: InvitationToCreate): Promise<Invitation> {
    const [created] = await this.db
      .insert(invitation)
      .values({
        organizationId: toCreate.organizationId,
        invitedByProfileId: toCreate.invitedByProfileId,
        tokenHash: toCreate.tokenHash,
        name: toCreate.name,
        contact: toCreate.contact,
        expiresAt: toCreate.expiresAt,
      })
      .returning(COLUMNS);

    if (created === undefined) {
      // An insert that inserted nothing would have thrown; the check is what
      // lets the compiler see it.
      throw new Error('the invitation was inserted and came back empty');
    }

    return created;
  }

  listByOrganization(organizationId: string): Promise<readonly Invitation[]> {
    return this.db
      .select(COLUMNS)
      .from(invitation)
      .where(eq(invitation.organizationId, organizationId))
      .orderBy(desc(invitation.createdAt));
  }

  async findById(invitationId: string, organizationId: string): Promise<Invitation | undefined> {
    const [found] = await this.db
      .select(COLUMNS)
      .from(invitation)
      .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, organizationId)))
      .limit(1);

    return found;
  }

  async revoke(
    invitationId: string,
    organizationId: string,
    revokedAt: Date,
  ): Promise<Invitation | undefined> {
    const [revoked] = await this.db
      .update(invitation)
      .set({ revokedAt })
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.organizationId, organizationId),
          // Still pending, asked of the database: never used, never revoked,
          // and not past its expiry at the instant of the write.
          isNull(invitation.acceptedAt),
          isNull(invitation.revokedAt),
          gte(invitation.expiresAt, revokedAt),
        ),
      )
      .returning(COLUMNS);

    return revoked;
  }
}
