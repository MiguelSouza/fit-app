import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_POOL } from '../../../shared/database/database.module';
import { type ConsentRepository } from '../application/ports/consent-repository.port';
import {
  type ConsentInForce,
  type ConsentToGrant,
  type ConsentType,
  type RevokedConsent,
} from '../domain/consent';
import { consent, identityTables } from './identity.schema';

/** What a consent is read as. The row id is bookkeeping and stays here. */
const CONSENT_COLUMNS = {
  type: consent.type,
  termsVersion: consent.termsVersion,
  grantedAt: consent.grantedAt,
};

/**
 * The `ConsentRepository` over Postgres (card I-05).
 *
 * It reads and writes the `identity` schema and nothing else (CLAUDE.md rule
 * 2). The Drizzle handle is built here, over the pool the whole API shares,
 * and knows only this module's tables.
 *
 * Two things are deliberate, and each is an acceptance criterion decided by the
 * database instead of by this process:
 *
 * - **A revocation is an update, never a delete.** There is no `delete` in this
 *   file, and the update only ever sets `revoked_at` on rows that still have
 *   none: `granted_at` and `terms_version` are left exactly as they were, which
 *   is "revogação nunca apaga o registro original" written as SQL. The `where`
 *   is also what makes it safe to run twice — the second one writes nothing and
 *   the first instant stands.
 * - **The partial unique index decides a race.** `consent_profile_id_type_in_force_idx`
 *   is what keeps a profile from holding two consents in force for the same
 *   purpose, so `grant` is an upsert that cannot duplicate however many
 *   requests arrive at once.
 *
 * **Nothing is logged.** Which purposes a patient gave or took back is personal
 * data about their health (CLAUDE.md, "Saúde e LGPD").
 */
@Injectable()
export class DrizzleConsentRepository implements ConsentRepository {
  private readonly db: NodePgDatabase<typeof identityTables>;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema: identityTables });
  }

  /**
   * The purposes in force: the rows with no `revoked_at`.
   *
   * No `order by`: the order is the product's and the domain sorts it
   * (`consentsInPurposeOrder`). The partial unique index answers this with
   * one range scan per profile.
   */
  async findInForce(profileId: string): Promise<readonly ConsentInForce[]> {
    return this.db
      .select(CONSENT_COLUMNS)
      .from(consent)
      .where(and(eq(consent.profileId, profileId), isNull(consent.revokedAt)));
  }

  /**
   * The consent, written if that purpose is not in force yet.
   *
   * `on conflict do nothing` and not a check before the insert: the partial
   * unique index is the only thing that answers truthfully when two requests of
   * the same patient arrive together, the same reasoning as everywhere else in
   * this module. When it writes nothing, the row that refused it is the answer
   * — the caller that lost the race is told the date and the version that
   * really hold, which are the winner's.
   */
  async grant(profileId: string, toGrant: ConsentToGrant): Promise<ConsentInForce> {
    const [written] = await this.db
      .insert(consent)
      .values({
        profileId,
        type: toGrant.type,
        termsVersion: toGrant.termsVersion,
        grantedAt: toGrant.grantedAt,
      })
      .onConflictDoNothing()
      .returning(CONSENT_COLUMNS);

    if (written !== undefined) return written;

    const [inForce] = await this.db
      .select(CONSENT_COLUMNS)
      .from(consent)
      .where(
        and(
          eq(consent.profileId, profileId),
          eq(consent.type, toGrant.type),
          isNull(consent.revokedAt),
        ),
      )
      .limit(1);

    if (inForce === undefined) {
      // Unreachable: the insert was refused because a row of that purpose is
      // in force.
      throw new Error('the consent that refused the insert was not found afterwards');
    }

    return inForce;
  }

  /**
   * The purposes, dated — one statement, in a transaction.
   *
   * One `update ... where type in (...)` and not one statement per purpose:
   * the cascade of `health_data` has to be all or nothing, and a single
   * statement is also a single pass over the rows this profile has in force.
   * The transaction is explicit all the same, so the day this grows a second
   * write the boundary is already where it belongs.
   *
   * The rows come back in whatever order the statement touched them, which is
   * the use case's to put right (`consentsInPurposeOrder`): a single
   * statement has a plan, not an `order by`.
   *
   * `isNull(revokedAt)` in the `where` is what makes the answer honest: a
   * purpose another request revoked a moment ago keeps the instant it was
   * really revoked at and simply does not come back here. It is also why
   * `revoked_at` is not read back from the rows — every row this statement
   * touched was revoked at the instant it was given, and the column is
   * nullable, so reading it would hand the domain a `Date | null` that cannot
   * be null.
   */
  async revoke(
    profileId: string,
    types: readonly ConsentType[],
    revokedAt: Date,
  ): Promise<readonly RevokedConsent[]> {
    if (types.length === 0) return [];

    const dated = await this.db.transaction(async (tx) =>
      tx
        .update(consent)
        .set({ revokedAt })
        .where(
          and(
            eq(consent.profileId, profileId),
            inArray(consent.type, [...types]),
            isNull(consent.revokedAt),
          ),
        )
        .returning(CONSENT_COLUMNS),
    );

    return dated.map((row) => ({ ...row, revokedAt }));
  }
}
