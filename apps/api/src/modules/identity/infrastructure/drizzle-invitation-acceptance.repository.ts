import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_POOL } from '../../../shared/database/database.module';
import { type InvitationAcceptanceRepository } from '../application/ports/invitation-acceptance.port';
import { type ConsentType } from '../domain/consent';
import { ProfileIsNotPatientError } from '../domain/identity-errors';
import { type Invitation } from '../domain/invitation';
import {
  type AcceptedInvitation,
  type InvitationAcceptance,
  type PatientToEnsure,
} from '../domain/invitation-acceptance';
import {
  careRelationship,
  consent,
  identityTables,
  invitation,
  patient,
  profile,
} from './identity.schema';

/** What an invitation is read as. `token_hash` is not in it, as everywhere else. */
const INVITATION_COLUMNS = {
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
 * The `InvitationAcceptanceRepository` over Postgres: the whole of a patient
 * joining a practice, in one transaction (card I-03).
 *
 * It reads and writes the `identity` schema and nothing else (CLAUDE.md rule
 * 2). The Drizzle handle is built here, over the pool the whole API shares,
 * and knows only this module's tables.
 *
 * Three things are deliberate, and each of them is an acceptance criterion
 * decided by the database instead of by this process:
 *
 * - **The invitation is consumed first**, by a conditional update. If it writes
 *   no row the link was already used, revoked or expired, and the transaction
 *   ends having written nothing — which is "convite usado não pode ser
 *   reutilizado", even for two acceptances of the same link in the same
 *   instant. It also takes the row's lock before anything else, so the second
 *   acceptance waits for the first to finish instead of racing it.
 * - **Every insert is an upsert on a unique key.** The profile on the Supabase
 *   user id, the patient on the profile, the care link on the pair
 *   (organization, patient), the consent on the partial index of the ones in
 *   force. A patient who is already on the platform gains the new link and
 *   nothing else, however many times the request arrives.
 * - **Nothing is logged.** No name, no consent, no token (CLAUDE.md, "Saúde e
 *   LGPD").
 */
@Injectable()
export class DrizzleInvitationAcceptanceRepository implements InvitationAcceptanceRepository {
  private readonly db: NodePgDatabase<typeof identityTables>;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema: identityTables });
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | undefined> {
    const [found] = await this.db
      .select(INVITATION_COLUMNS)
      .from(invitation)
      .where(eq(invitation.tokenHash, tokenHash))
      .limit(1);

    return found;
  }

  async accept(acceptance: InvitationAcceptance): Promise<AcceptedInvitation | undefined> {
    return this.db.transaction(async (tx) => {
      // Still acceptable, asked of the database: never used, never revoked and
      // not past its expiry at the instant of the write.
      const [consumed] = await tx
        .update(invitation)
        .set({ acceptedAt: acceptance.acceptedAt })
        .where(
          and(
            eq(invitation.id, acceptance.invitationId),
            isNull(invitation.acceptedAt),
            isNull(invitation.revokedAt),
            gte(invitation.expiresAt, acceptance.acceptedAt),
          ),
        )
        .returning({ id: invitation.id });

      if (consumed === undefined) return undefined;

      const profileId = await ensurePatientProfile(tx, acceptance.patient);
      const careRelationshipId = await ensureCareRelationship(tx, acceptance, profileId);
      const consents = await grantConsents(tx, acceptance, profileId);

      return {
        profileId,
        organizationId: acceptance.organizationId,
        careRelationshipId,
        acceptedAt: acceptance.acceptedAt,
        consents,
      };
    });
  }
}

/** The transaction handle, as Drizzle types it for this module's tables. */
type Transaction = Parameters<
  Parameters<NodePgDatabase<typeof identityTables>['transaction']>[0]
>[0];

/**
 * The patient's profile and patient row, created if they are not there.
 *
 * `on conflict do nothing` and not a check before the insert: the unique index
 * on the Supabase user id is the only thing that answers truthfully when two
 * requests of the same person arrive together, which is the same reasoning as
 * in `drizzle-identity-registry.repository.ts`. No row back means the person
 * was already registered, and then **nothing about them is rewritten** — not
 * the name, not the time zone: what they filled in the first time is theirs,
 * and the acceptance criterion is that they only gain the new link.
 *
 * @throws ProfileIsNotPatientError when the account is a professional's. Inside
 *   the transaction, so the invitation consumed a moment ago is rolled back
 *   with it: a link refused is a link still usable.
 */
async function ensurePatientProfile(tx: Transaction, toEnsure: PatientToEnsure): Promise<string> {
  const [created] = await tx
    .insert(profile)
    .values({
      authUserId: toEnsure.authUserId,
      role: toEnsure.role,
      fullName: toEnsure.fullName,
      timeZone: toEnsure.timeZone,
    })
    .onConflictDoNothing({ target: profile.authUserId })
    .returning({ id: profile.id, role: profile.role });

  const person = created ?? (await profileOf(tx, toEnsure.authUserId));

  if (person.role !== 'patient') throw new ProfileIsNotPatientError();

  // The patient half. Keyed by the profile, so a second acceptance of the same
  // person writes nothing here either.
  await tx.insert(patient).values({ profileId: person.id }).onConflictDoNothing();

  return person.id;
}

/** The profile that refused the insert, by the key that refused it. */
async function profileOf(
  tx: Transaction,
  authUserId: string,
): Promise<{ id: string; role: 'professional' | 'patient' }> {
  const [found] = await tx
    .select({ id: profile.id, role: profile.role })
    .from(profile)
    .where(eq(profile.authUserId, authUserId))
    .limit(1);

  if (found === undefined) {
    // Unreachable: the insert was refused because the row exists.
    throw new Error('the profile that refused the insert was not found afterwards');
  }

  return found;
}

/**
 * The active link between the practice and the patient.
 *
 * The unique index on the pair is what keeps one practice from following the
 * same patient twice. Two cases hang off it: a link that is **still active**
 * stays exactly as it is, with the date it really started, and the acceptance
 * answers it; a link that had **ended** starts again, from this invitation and
 * this instant, which is what makes the card's "cria `care_relationship`
 * ativo" true even for a patient coming back to a practice that had closed
 * their follow-up.
 */
async function ensureCareRelationship(
  tx: Transaction,
  acceptance: InvitationAcceptance,
  patientProfileId: string,
): Promise<string> {
  const [written] = await tx
    .insert(careRelationship)
    .values({
      organizationId: acceptance.organizationId,
      patientProfileId,
      invitationId: acceptance.invitationId,
      startedAt: acceptance.acceptedAt,
    })
    .onConflictDoUpdate({
      target: [careRelationship.organizationId, careRelationship.patientProfileId],
      set: {
        invitationId: acceptance.invitationId,
        startedAt: acceptance.acceptedAt,
        endedAt: null,
      },
      // Only a follow-up that had ended is restarted. An active one is left
      // alone, so re-accepting does not move the date it began.
      setWhere: isNotNull(careRelationship.endedAt),
    })
    .returning({ id: careRelationship.id });

  if (written !== undefined) return written.id;

  // The update was skipped because the link is active: it is the answer.
  const [active] = await tx
    .select({ id: careRelationship.id })
    .from(careRelationship)
    .where(
      and(
        eq(careRelationship.organizationId, acceptance.organizationId),
        eq(careRelationship.patientProfileId, patientProfileId),
      ),
    )
    .limit(1);

  if (active === undefined) {
    // Unreachable: the insert conflicted, so the row is there.
    throw new Error('the care relationship that refused the insert was not found afterwards');
  }

  return active.id;
}

/**
 * The consents that are not in force yet, written; the ones already in force,
 * left as they are with the version of the terms they were given against.
 *
 * @returns every purpose in force afterwards, which is what the patient is
 *   answered — including consents an earlier acceptance recorded
 */
async function grantConsents(
  tx: Transaction,
  acceptance: InvitationAcceptance,
  profileId: string,
): Promise<readonly ConsentType[]> {
  const inForce = await tx
    .select({ type: consent.type })
    .from(consent)
    .where(and(eq(consent.profileId, profileId), isNull(consent.revokedAt)));

  const already = new Set(inForce.map((row) => row.type));
  const missing = acceptance.consents.filter((toGrant) => !already.has(toGrant.type));

  if (missing.length > 0) {
    await tx
      .insert(consent)
      .values(
        missing.map((toGrant) => ({
          profileId,
          type: toGrant.type,
          termsVersion: toGrant.termsVersion,
          grantedAt: toGrant.grantedAt,
        })),
      )
      // The partial unique index decides a purpose granted twice at once.
      .onConflictDoNothing();
  }

  return [...already, ...missing.map((toGrant) => toGrant.type)];
}
