import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { integrationDatabaseUrl } from '../../../shared/testing/integration-postgres.spec-support';
import { InvitationNotFoundError, InvitationNotPendingError } from '../domain/identity-errors';
import { invitationStatusOf } from '../domain/invitation';
import {
  CryptoInvitationTokenIssuer,
  hashInvitationToken,
} from '../infrastructure/crypto-invitation-token.issuer';
import { DrizzleIdentityRegistry } from '../infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationRepository } from '../infrastructure/drizzle-invitation.repository';
import { CreateInvitationUseCase } from './create-invitation.use-case';
import { ListInvitationsUseCase } from './list-invitations.use-case';
import { LoadProfessionalCaller } from './load-professional-caller';
import { RegisterProfessionalUseCase } from './register-professional.use-case';
import { RevokeInvitationUseCase } from './revoke-invitation.use-case';

/**
 * The invitations of card I-02 against a **real Postgres**, which is what
 * CLAUDE.md ("Testes") asks of a critical use case.
 *
 * Half of what the acceptance criteria say is written in SQL and not in
 * TypeScript: the column that holds a hash and never a token, the unique index
 * on it, the queries scoped to one organization so a professional cannot reach
 * another practice's invitation, and the conditional update that decides a
 * revocation racing an acceptance. A fake repository answers for the code and
 * leaves all of that untested.
 *
 * Every test registers its own professional, so the suites share one throwaway
 * database without sharing rows.
 */
const PROFESSIONAL = {
  fullName: 'Ana Souza',
  councilNumber: 'CRN-3 12345',
  specialty: 'Nutrição esportiva',
  professionalType: null,
};

const INPUT = { name: 'Paciente de teste', contact: '+55 11 90000-0000' };

describe('the invitations of a practice, against a real Postgres', () => {
  const pool = new Pool({
    connectionString: integrationDatabaseUrl(),
    application_name: 'fit-app-test',
  });

  const registry = new DrizzleIdentityRegistry(pool);
  const invitations = new DrizzleInvitationRepository(pool);
  const caller = new LoadProfessionalCaller(registry);

  const register = new RegisterProfessionalUseCase(registry);
  const create = new CreateInvitationUseCase(
    caller,
    invitations,
    new CryptoInvitationTokenIssuer(),
  );
  const list = new ListInvitationsUseCase(caller, invitations);
  const revoke = new RevokeInvitationUseCase(caller, invitations);

  afterAll(async () => {
    // A pool left open is a jest run that does not exit.
    await pool.end();
  });

  /** A professional with their own solo practice, as the first access creates one. */
  async function aProfessional(): Promise<{ authUserId: string; organizationId: string }> {
    const authUserId = randomUUID();
    const identity = await register.execute(authUserId, PROFESSIONAL);
    const [membership] = identity.organizations;

    if (membership === undefined) throw new Error('the registration created no practice');

    return { authUserId, organizationId: membership.organizationId };
  }

  /** What is really in the row, read without Drizzle. */
  async function rowOf(invitationId: string) {
    const { rows } = await pool.query<{
      organization_id: string;
      invited_by_profile_id: string;
      token_hash: string;
      name: string | null;
      contact: string | null;
      accepted_at: Date | null;
      revoked_at: Date | null;
    }>('select * from identity.invitation where id = $1', [invitationId]);

    return rows[0];
  }

  it('writes the invitation in the practice of whoever asked', async () => {
    const { authUserId, organizationId } = await aProfessional();

    const { invitation } = await create.execute(authUserId, INPUT);

    expect(await rowOf(invitation.id)).toMatchObject({
      organization_id: organizationId,
      name: 'Paciente de teste',
      contact: '+55 11 90000-0000',
      accepted_at: null,
      revoked_at: null,
    });

    // Fourteen days out, in UTC, as the column stores it.
    expect(invitation.expiresAt.getTime() - invitation.createdAt.getTime()).toBeGreaterThan(
      13.9 * 24 * 60 * 60 * 1000,
    );
    expect(invitationStatusOf(invitation, new Date())).toBe('pending');
  });

  it('stores the hash of the token and never the token', async () => {
    const { authUserId } = await aProfessional();

    const { invitation, token } = await create.execute(authUserId, INPUT);
    const row = await rowOf(invitation.id);

    expect(row?.token_hash).toBe(hashInvitationToken(token));
    expect(row?.token_hash).not.toBe(token);

    // And the token is nowhere else in the table either: no second column
    // keeping a copy for convenience.
    const { rows } = await pool.query<{ count: string }>(
      `select count(*) from identity.invitation
        where id = $1 and (token_hash = $2 or name = $2 or contact = $2)`,
      [invitation.id, token],
    );

    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });

  it('refuses two invitations with the same token, by the unique index', async () => {
    const { authUserId, organizationId } = await aProfessional();

    const { invitation, token } = await create.execute(authUserId, INPUT);
    const row = await rowOf(invitation.id);

    await expect(
      pool.query(
        `insert into identity.invitation
           (organization_id, invited_by_profile_id, token_hash, expires_at)
         values ($1, $2, $3, now() + interval '14 days')`,
        [organizationId, row?.invited_by_profile_id, hashInvitationToken(token)],
      ),
    ).rejects.toThrow();
  });

  it('records which professional sent it', async () => {
    const { authUserId } = await aProfessional();

    const identity = await registry.findByAuthUserId(authUserId);
    const { invitation } = await create.execute(authUserId, INPUT);

    expect((await rowOf(invitation.id))?.invited_by_profile_id).toBe(identity?.personId);
  });

  it('lists the practice invitations, the most recent first', async () => {
    const { authUserId } = await aProfessional();

    const older = await create.execute(authUserId, { name: 'Primeiro', contact: null });
    const newer = await create.execute(authUserId, { name: 'Segundo', contact: null });

    const listed = await list.execute(authUserId);

    expect(listed.map((invitation) => invitation.id)).toEqual([
      newer.invitation.id,
      older.invitation.id,
    ]);
  });

  it('does not list, find or revoke an invitation of another practice', async () => {
    const mine = await aProfessional();
    const theirs = await aProfessional();

    const { invitation } = await create.execute(theirs.authUserId, INPUT);

    await expect(list.execute(mine.authUserId)).resolves.toEqual([]);
    await expect(invitations.findById(invitation.id, mine.organizationId)).resolves.toBeUndefined();

    // Not a 403: the id is simply not there, as far as this caller goes.
    await expect(revoke.execute(mine.authUserId, invitation.id)).rejects.toThrow(
      InvitationNotFoundError,
    );

    // And nothing was written to it.
    expect((await rowOf(invitation.id))?.revoked_at).toBeNull();
  });

  it('revokes a pending invitation, once', async () => {
    const { authUserId } = await aProfessional();

    const { invitation } = await create.execute(authUserId, INPUT);
    const revoked = await revoke.execute(authUserId, invitation.id);

    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect((await rowOf(invitation.id))?.revoked_at).toBeInstanceOf(Date);

    await expect(revoke.execute(authUserId, invitation.id)).rejects.toThrow(
      InvitationNotPendingError,
    );
  });

  it('writes nothing when an acceptance got there first', async () => {
    const { authUserId, organizationId } = await aProfessional();

    const { invitation } = await create.execute(authUserId, INPUT);

    // The acceptance is another card; what it will write is this column, and
    // what matters here is that the revocation's `where` sees it.
    await pool.query('update identity.invitation set accepted_at = now() where id = $1', [
      invitation.id,
    ]);

    await expect(
      invitations.revoke(invitation.id, organizationId, new Date()),
    ).resolves.toBeUndefined();

    expect((await rowOf(invitation.id))?.revoked_at).toBeNull();
  });

  it('writes nothing when the invitation has expired', async () => {
    const { authUserId, organizationId } = await aProfessional();

    const { invitation } = await create.execute(authUserId, INPUT);

    await pool.query(
      `update identity.invitation set expires_at = now() - interval '1 day' where id = $1`,
      [invitation.id],
    );

    await expect(
      invitations.revoke(invitation.id, organizationId, new Date()),
    ).resolves.toBeUndefined();

    // And the use case says why, instead of answering a revocation that did
    // not happen.
    await expect(revoke.execute(authUserId, invitation.id)).rejects.toThrow(
      InvitationNotPendingError,
    );
  });

  it('reads an expired row back as expired, without a job having to say so', async () => {
    const { authUserId } = await aProfessional();

    const { invitation } = await create.execute(authUserId, INPUT);

    await pool.query(
      `update identity.invitation set expires_at = now() - interval '1 day' where id = $1`,
      [invitation.id],
    );

    const [read] = await list.execute(authUserId);

    if (read === undefined) throw new Error('the invitation that was just created was not listed');

    expect(invitationStatusOf(read, new Date())).toBe('expired');
  });

  it('creates one with neither name nor contact', async () => {
    const { authUserId } = await aProfessional();

    const { invitation } = await create.execute(authUserId, { name: null, contact: null });

    expect(await rowOf(invitation.id)).toMatchObject({ name: null, contact: null });
  });
});
