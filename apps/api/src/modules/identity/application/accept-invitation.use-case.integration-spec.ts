import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { integrationDatabaseUrl } from '../../../shared/testing/integration-postgres.spec-support';
import { careRelationshipStatusOf } from '../domain/care-relationship';
import { CURRENT_TERMS_VERSION, type ConsentType } from '../domain/consent';
import {
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
  MissingRequiredConsentError,
  ProfileIsNotPatientError,
} from '../domain/identity-errors';
import { invitationAcceptanceOf } from '../domain/invitation-acceptance';
import { CryptoInvitationTokenIssuer } from '../infrastructure/crypto-invitation-token.issuer';
import { DrizzleIdentityRegistry } from '../infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationAcceptanceRepository } from '../infrastructure/drizzle-invitation-acceptance.repository';
import { DrizzleInvitationRepository } from '../infrastructure/drizzle-invitation.repository';
import { AcceptInvitationUseCase } from './accept-invitation.use-case';
import { CreateInvitationUseCase } from './create-invitation.use-case';
import { LoadProfessionalCaller } from './load-professional-caller';
import { RegisterProfessionalUseCase } from './register-professional.use-case';
import { RevokeInvitationUseCase } from './revoke-invitation.use-case';

/**
 * The acceptance of an invitation against a **real Postgres**, which is what
 * CLAUDE.md ("Testes") asks of a critical use case — and this one is the most
 * critical write in the module: five tables, one transaction, and a patient
 * who must never end up half joined.
 *
 * What a fake cannot answer for is exactly what the card's criteria rest on:
 * the transaction rolling back as a whole, the unique index on the Supabase
 * user id that makes "paciente que já existe só ganha o novo vínculo" true
 * however many requests arrive, the conditional update that makes a used link
 * unusable, and the partial unique index that keeps one consent in force per
 * purpose.
 *
 * Every test registers its own professional and its own patient, so the suites
 * share one throwaway database without sharing rows. No data of a real person
 * goes in: the names are labels and the ids are random.
 */
const PROFESSIONAL = {
  fullName: 'Ana Souza',
  councilNumber: 'CRN-3 12345',
  specialty: 'Nutrição esportiva',
  professionalType: null,
};

const REQUIRED: readonly ConsentType[] = ['health_data', 'share_with_professional'];

const PATIENT = { fullName: 'Paciente de teste', timeZone: null, consents: REQUIRED };

describe('accepting an invitation, against a real Postgres', () => {
  const pool = new Pool({
    connectionString: integrationDatabaseUrl(),
    application_name: 'fit-app-test',
  });

  const registry = new DrizzleIdentityRegistry(pool);
  const invitations = new DrizzleInvitationRepository(pool);
  const acceptances = new DrizzleInvitationAcceptanceRepository(pool);
  const tokens = new CryptoInvitationTokenIssuer();

  const register = new RegisterProfessionalUseCase(registry);
  const create = new CreateInvitationUseCase(
    new LoadProfessionalCaller(registry),
    invitations,
    tokens,
  );
  const revoke = new RevokeInvitationUseCase(new LoadProfessionalCaller(registry), invitations);
  const accept = new AcceptInvitationUseCase(registry, acceptances, tokens);

  afterAll(async () => {
    // A pool left open is a jest run that does not exit.
    await pool.end();
  });

  /** A professional with their own solo practice, and a link they can send. */
  async function aLink(): Promise<{
    authUserId: string;
    organizationId: string;
    invitationId: string;
    token: string;
  }> {
    const authUserId = randomUUID();
    const identity = await register.execute(authUserId, PROFESSIONAL);
    const [membership] = identity.organizations;

    if (membership === undefined) throw new Error('the registration created no practice');

    const { invitation, token } = await create.execute(authUserId, {
      name: 'Paciente de teste',
      contact: null,
    });

    return {
      authUserId,
      organizationId: membership.organizationId,
      invitationId: invitation.id,
      token,
    };
  }

  /** What is really in the rows, read without Drizzle. */
  async function profileRow(authUserId: string) {
    const { rows } = await pool.query<{
      id: string;
      role: string;
      full_name: string;
      time_zone: string;
    }>('select id, role, full_name, time_zone from identity.profile where auth_user_id = $1', [
      authUserId,
    ]);

    return rows[0];
  }

  async function careRelationshipRows(patientProfileId: string) {
    const { rows } = await pool.query<{
      id: string;
      organization_id: string;
      invitation_id: string;
      started_at: Date;
      ended_at: Date | null;
    }>(
      `select id, organization_id, invitation_id, started_at, ended_at
         from identity.care_relationship
        where patient_profile_id = $1
        order by started_at`,
      [patientProfileId],
    );

    return rows;
  }

  async function consentRows(profileId: string) {
    const { rows } = await pool.query<{
      type: ConsentType;
      terms_version: string;
      granted_at: Date;
      revoked_at: Date | null;
    }>(
      `select type, terms_version, granted_at, revoked_at
         from identity.consent where profile_id = $1 order by granted_at, type`,
      [profileId],
    );

    return rows;
  }

  async function acceptedAtOf(invitationId: string): Promise<Date | null> {
    const { rows } = await pool.query<{ accepted_at: Date | null }>(
      'select accepted_at from identity.invitation where id = $1',
      [invitationId],
    );

    return rows[0]?.accepted_at ?? null;
  }

  it('writes the patient, the active link and the consents, and spends the invitation', async () => {
    const link = await aLink();
    const authUserId = randomUUID();

    const accepted = await accept.execute(authUserId, { ...PATIENT, token: link.token });

    expect(accepted).toMatchObject({
      organizationId: link.organizationId,
      consents: REQUIRED,
    });

    // The profile, as a patient, with the platform's default zone.
    expect(await profileRow(authUserId)).toMatchObject({
      id: accepted.profileId,
      role: 'patient',
      full_name: 'Paciente de teste',
      time_zone: 'America/Sao_Paulo',
    });

    // The patient half of it.
    const { rows: patientRows } = await pool.query(
      'select profile_id from identity.patient where profile_id = $1',
      [accepted.profileId],
    );

    expect(patientRows).toHaveLength(1);

    // The link, active, pointing at the invitation it came from.
    const relationships = await careRelationshipRows(accepted.profileId);

    expect(relationships).toHaveLength(1);
    expect(relationships[0]).toMatchObject({
      id: accepted.careRelationshipId,
      organization_id: link.organizationId,
      invitation_id: link.invitationId,
      ended_at: null,
    });

    const [relationship] = relationships;

    if (relationship === undefined) throw new Error('the acceptance wrote no care relationship');

    expect(
      careRelationshipStatusOf({
        id: relationship.id,
        organizationId: relationship.organization_id,
        patientProfileId: accepted.profileId,
        invitationId: relationship.invitation_id,
        startedAt: relationship.started_at,
        endedAt: relationship.ended_at,
      }),
    ).toBe('active');

    // The two consents, with the version of the terms, none revoked.
    expect(await consentRows(accepted.profileId)).toEqual([
      {
        type: 'health_data',
        terms_version: CURRENT_TERMS_VERSION,
        granted_at: expect.any(Date),
        revoked_at: null,
      },
      {
        type: 'share_with_professional',
        terms_version: CURRENT_TERMS_VERSION,
        granted_at: expect.any(Date),
        revoked_at: null,
      },
    ]);

    // And the link is spent.
    expect(await acceptedAtOf(link.invitationId)).toBeInstanceOf(Date);
  });

  it('records the optional consents when the patient ticked them', async () => {
    const link = await aLink();
    const authUserId = randomUUID();

    const accepted = await accept.execute(authUserId, {
      ...PATIENT,
      token: link.token,
      consents: [...REQUIRED, 'wearable_data', 'ai_processing'],
    });

    expect((await consentRows(accepted.profileId)).map((row) => row.type).sort()).toEqual(
      ['ai_processing', 'health_data', 'share_with_professional', 'wearable_data'].sort(),
    );
  });

  it('gives a patient who already exists the new link and nothing else', async () => {
    const first = await aLink();
    const second = await aLink();
    const authUserId = randomUUID();

    const one = await accept.execute(authUserId, { ...PATIENT, token: first.token });

    // The same person, invited by a second practice, filling in another name.
    const other = await accept.execute(authUserId, {
      ...PATIENT,
      token: second.token,
      fullName: 'Outro Nome',
      consents: [...REQUIRED, 'wearable_data'],
    });

    expect(other.profileId).toBe(one.profileId);

    // One profile, one patient row, and the name they registered with.
    const { rows: profiles } = await pool.query(
      'select id from identity.profile where auth_user_id = $1',
      [authUserId],
    );

    expect(profiles).toHaveLength(1);
    expect((await profileRow(authUserId))?.full_name).toBe('Paciente de teste');

    // Two links, one per practice, both active.
    const relationships = await careRelationshipRows(one.profileId);

    expect(relationships.map((row) => row.organization_id)).toEqual([
      first.organizationId,
      second.organizationId,
    ]);
    expect(relationships.every((row) => row.ended_at === null)).toBe(true);

    // The consents already in force were not written again; the new one was.
    expect((await consentRows(one.profileId)).map((row) => row.type)).toEqual([
      'health_data',
      'share_with_professional',
      'wearable_data',
    ]);
    expect(other.consents).toEqual(
      expect.arrayContaining(['health_data', 'share_with_professional', 'wearable_data']),
    );
  });

  it('refuses to use a link twice, and writes nothing the second time', async () => {
    const link = await aLink();
    const first = randomUUID();
    const second = randomUUID();

    await accept.execute(first, { ...PATIENT, token: link.token });

    await expect(accept.execute(second, { ...PATIENT, token: link.token })).rejects.toThrow(
      InvitationAlreadyAcceptedError,
    );

    // The second person got no profile at all: the whole transaction is one.
    expect(await profileRow(second)).toBeUndefined();

    const { rows } = await pool.query<{ count: string }>(
      'select count(*) from identity.care_relationship where organization_id = $1',
      [link.organizationId],
    );

    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it('refuses, and writes nothing, without the required consents', async () => {
    const link = await aLink();
    const authUserId = randomUUID();

    await expect(
      accept.execute(authUserId, { ...PATIENT, token: link.token, consents: ['wearable_data'] }),
    ).rejects.toThrow(MissingRequiredConsentError);

    expect(await profileRow(authUserId)).toBeUndefined();

    // And the link still works, so the patient ticks the box and tries again.
    expect(await acceptedAtOf(link.invitationId)).toBeNull();

    await expect(
      accept.execute(authUserId, { ...PATIENT, token: link.token }),
    ).resolves.toMatchObject({ organizationId: link.organizationId });
  });

  it('rolls the whole transaction back when the account is a professional', async () => {
    const link = await aLink();

    // Straight at the repository: the use case refuses this before writing
    // anything, and what is being proved here is the other guard — the one
    // inside the transaction, which is what a race would reach. The invitation
    // has already been marked as accepted by the time it fires.
    const acceptance = invitationAcceptanceOf({
      invitation: {
        id: link.invitationId,
        organizationId: link.organizationId,
        name: null,
        contact: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        acceptedAt: null,
        revokedAt: null,
      },
      authUserId: link.authUserId,
      fullName: 'Ana Souza',
      timeZone: null,
      consents: REQUIRED,
      now: new Date(),
    });

    await expect(acceptances.accept(acceptance)).rejects.toThrow(ProfileIsNotPatientError);

    // Nothing of it survived: the link is still usable and the professional
    // did not become a patient.
    expect(await acceptedAtOf(link.invitationId)).toBeNull();

    const { rows } = await pool.query<{ count: string }>(
      'select count(*) from identity.patient where profile_id = (select id from identity.profile where auth_user_id = $1)',
      [link.authUserId],
    );

    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });

  it('refuses a link the professional revoked, and leaves it revoked', async () => {
    const link = await aLink();

    await revoke.execute(link.authUserId, link.invitationId);

    await expect(accept.execute(randomUUID(), { ...PATIENT, token: link.token })).rejects.toThrow(
      InvitationRevokedError,
    );

    expect(await acceptedAtOf(link.invitationId)).toBeNull();
  });

  it('refuses a link whose fourteen days are gone', async () => {
    const link = await aLink();

    await pool.query(
      `update identity.invitation set expires_at = now() - interval '1 day' where id = $1`,
      [link.invitationId],
    );

    await expect(accept.execute(randomUUID(), { ...PATIENT, token: link.token })).rejects.toThrow(
      InvitationExpiredError,
    );
  });

  it('writes nothing when the link expired between the read and the write', async () => {
    const link = await aLink();

    const acceptance = invitationAcceptanceOf({
      invitation: {
        id: link.invitationId,
        organizationId: link.organizationId,
        name: null,
        contact: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        acceptedAt: null,
        revokedAt: null,
      },
      authUserId: randomUUID(),
      fullName: 'Paciente de teste',
      timeZone: null,
      consents: REQUIRED,
      now: new Date(),
    });

    await pool.query(
      `update identity.invitation set expires_at = now() - interval '1 day' where id = $1`,
      [link.invitationId],
    );

    // The condition is in the `where` of the update, so the database decides.
    await expect(acceptances.accept(acceptance)).resolves.toBeUndefined();
  });

  it('refuses a token that opens no invitation', async () => {
    await expect(
      accept.execute(randomUUID(), { ...PATIENT, token: 'a-token-nobody-issued' }),
    ).rejects.toThrow(InvitationNotFoundError);
  });

  it('finds an invitation by the hash of the token and never by the token', async () => {
    const link = await aLink();

    await expect(acceptances.findByTokenHash(tokens.hashOf(link.token))).resolves.toMatchObject({
      id: link.invitationId,
      organizationId: link.organizationId,
    });

    await expect(acceptances.findByTokenHash(link.token)).resolves.toBeUndefined();
  });

  it('keeps one consent in force per purpose, by the partial unique index', async () => {
    const link = await aLink();
    const accepted = await accept.execute(randomUUID(), { ...PATIENT, token: link.token });

    await expect(
      pool.query(
        `insert into identity.consent (profile_id, type, terms_version, granted_at)
         values ($1, 'health_data', $2, now())`,
        [accepted.profileId, CURRENT_TERMS_VERSION],
      ),
    ).rejects.toThrow();

    // A revoked one does not stand in the way: granting again is a new row.
    await pool.query(
      `update identity.consent set revoked_at = now()
        where profile_id = $1 and type = 'health_data'`,
      [accepted.profileId],
    );

    await expect(
      pool.query(
        `insert into identity.consent (profile_id, type, terms_version, granted_at)
         values ($1, 'health_data', $2, now())`,
        [accepted.profileId, CURRENT_TERMS_VERSION],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('refuses a second link between the same practice and patient, by the unique index', async () => {
    const link = await aLink();
    const accepted = await accept.execute(randomUUID(), { ...PATIENT, token: link.token });

    await expect(
      pool.query(
        `insert into identity.care_relationship
           (organization_id, patient_profile_id, invitation_id, started_at)
         values ($1, $2, $3, now())`,
        [link.organizationId, accepted.profileId, link.invitationId],
      ),
    ).rejects.toThrow();
  });

  it('starts a follow-up again when the practice had ended it', async () => {
    const first = await aLink();
    const authUserId = randomUUID();

    const accepted = await accept.execute(authUserId, { ...PATIENT, token: first.token });

    await pool.query('update identity.care_relationship set ended_at = now() where id = $1', [
      accepted.careRelationshipId,
    ]);

    // The same practice invites them again — a new invitation, as a used one
    // is never reused.
    const { token } = await create.execute(first.authUserId, { name: null, contact: null });

    const again = await accept.execute(authUserId, { ...PATIENT, token });

    expect(again.careRelationshipId).toBe(accepted.careRelationshipId);

    const relationships = await careRelationshipRows(accepted.profileId);

    expect(relationships).toHaveLength(1);
    expect(relationships[0]?.ended_at).toBeNull();
  });
});
