import { randomUUID } from 'node:crypto';

import {
  CallerIsNotProfessionalError,
  InvitationNotFoundError,
  InvitationNotPendingError,
  ProfileNotFoundError,
} from '../domain/identity-errors';
import { INVITATION_LIFETIME_IN_DAYS, type Invitation } from '../domain/invitation';
import { CreateInvitationUseCase } from './create-invitation.use-case';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from './in-memory-identity-registry.spec-support';
import {
  InMemoryInvitationRepository,
  invitationRow,
} from './in-memory-invitation-repository.spec-support';
import { ListInvitationsUseCase } from './list-invitations.use-case';
import { LoadProfessionalCaller } from './load-professional-caller';
import {
  hashOfPredictableToken,
  PredictableInvitationTokenIssuer,
} from './predictable-invitation-token.spec-support';
import { RevokeInvitationUseCase } from './revoke-invitation.use-case';

/**
 * The three use cases of card I-02, driven without a database: create, list
 * and revoke an invitation.
 *
 * What they are tested for, beyond doing the thing, is the acceptance criteria
 * that are decided in code — the invitation belonging to the caller's
 * organization and to no other, the token being answered once and never
 * stored, and a revoked or expired invitation going no further. What the
 * database decides has its own suite against a real Postgres.
 */
const AUTH_USER_ID = randomUUID();
const OTHER_AUTH_USER_ID = randomUUID();

const ORGANIZATION_ID = randomUUID();
const OTHER_ORGANIZATION_ID = randomUUID();

const INPUT = { name: 'Ana', contact: '+55 11 90000-0000' };

/**
 * The three use cases over one pair of fakes, with two professionals of two
 * different practices signed up in it.
 */
function scenario() {
  const registry = new InMemoryIdentityRegistry({
    [AUTH_USER_ID]: professionalIdentity(ORGANIZATION_ID),
    [OTHER_AUTH_USER_ID]: professionalIdentity(OTHER_ORGANIZATION_ID),
  });

  const invitations = new InMemoryInvitationRepository();
  const tokens = new PredictableInvitationTokenIssuer();
  const caller = new LoadProfessionalCaller(registry);

  return {
    invitations,
    tokens,
    create: new CreateInvitationUseCase(caller, invitations, tokens),
    list: new ListInvitationsUseCase(caller, invitations),
    revoke: new RevokeInvitationUseCase(caller, invitations),
  };
}

describe('CreateInvitationUseCase', () => {
  it('creates the invitation in the practice of whoever is calling', async () => {
    const { create } = scenario();

    const { invitation } = await create.execute(AUTH_USER_ID, INPUT);

    expect(invitation.organizationId).toBe(ORGANIZATION_ID);
    expect(invitation).toMatchObject({ name: 'Ana', contact: '+55 11 90000-0000' });
    expect(invitation.acceptedAt).toBeNull();
    expect(invitation.revokedAt).toBeNull();
  });

  it('answers the token once and stores only its hash', async () => {
    const { create, invitations, tokens } = scenario();

    const { token } = await create.execute(AUTH_USER_ID, INPUT);

    expect(token).toBe(tokens.tokens[0]);
    expect(invitations.tokenHashes).toEqual([hashOfPredictableToken(token)]);
    expect(invitations.tokenHashes).not.toContain(token);
  });

  it('issues a different token for every invitation', async () => {
    const { create } = scenario();

    const first = await create.execute(AUTH_USER_ID, INPUT);
    const second = await create.execute(AUTH_USER_ID, INPUT);

    expect(second.token).not.toBe(first.token);
    expect(second.invitation.id).not.toBe(first.invitation.id);
  });

  it('expires the invitation fourteen days out', async () => {
    const { create } = scenario();

    const { invitation } = await create.execute(AUTH_USER_ID, { name: null, contact: null });

    const days =
      (invitation.expiresAt.getTime() - invitation.createdAt.getTime()) / (24 * 60 * 60 * 1000);

    // Rounded to the hour: the two instants are read a few milliseconds apart.
    expect(Math.round(days * 24) / 24).toBe(INVITATION_LIFETIME_IN_DAYS);
  });

  it('creates one with neither name nor contact', async () => {
    const { create } = scenario();

    const { invitation } = await create.execute(AUTH_USER_ID, { name: null, contact: null });

    expect(invitation).toMatchObject({ name: null, contact: null });
  });

  it('refuses a caller whose account is a patient', async () => {
    const patientAuthUserId = randomUUID();

    const create = new CreateInvitationUseCase(
      new LoadProfessionalCaller(
        new InMemoryIdentityRegistry({ [patientAuthUserId]: patientIdentity() }),
      ),
      new InMemoryInvitationRepository(),
      new PredictableInvitationTokenIssuer(),
    );

    await expect(create.execute(patientAuthUserId, INPUT)).rejects.toThrow(
      CallerIsNotProfessionalError,
    );
  });

  it('refuses a caller who never finished the first access', async () => {
    const { create } = scenario();

    await expect(create.execute(randomUUID(), INPUT)).rejects.toThrow(ProfileNotFoundError);
  });
});

describe('ListInvitationsUseCase', () => {
  it('answers every invitation the practice created', async () => {
    const { create, list } = scenario();

    const first = await create.execute(AUTH_USER_ID, { name: 'Primeira', contact: null });
    const second = await create.execute(AUTH_USER_ID, { name: 'Segunda', contact: null });

    const listed = await list.execute(AUTH_USER_ID);

    expect(listed.map((invitation) => invitation.id)).toEqual(
      expect.arrayContaining([first.invitation.id, second.invitation.id]),
    );
    expect(listed).toHaveLength(2);
  });

  it('answers the most recent first, which is the order the screen reads', async () => {
    const older = invitationRow(ORGANIZATION_ID, { createdAt: new Date('2026-03-01T10:00:00Z') });
    const newer = invitationRow(ORGANIZATION_ID, { createdAt: new Date('2026-03-08T10:00:00Z') });

    const list = new ListInvitationsUseCase(
      new LoadProfessionalCaller(
        new InMemoryIdentityRegistry({ [AUTH_USER_ID]: professionalIdentity(ORGANIZATION_ID) }),
      ),
      // Seeded in the wrong order on purpose: what orders the list is the
      // date, not the order the rows happened to come back in.
      new InMemoryInvitationRepository([older, newer]),
    );

    await expect(list.execute(AUTH_USER_ID)).resolves.toEqual([newer, older]);
  });

  it('does not show another practice invitations', async () => {
    const { create, list } = scenario();

    const mine = await create.execute(AUTH_USER_ID, INPUT);
    await create.execute(OTHER_AUTH_USER_ID, INPUT);

    const listed = await list.execute(AUTH_USER_ID);

    expect(listed.map((invitation) => invitation.id)).toEqual([mine.invitation.id]);
  });

  it('answers nothing for a practice that never invited anybody', async () => {
    const { list } = scenario();

    await expect(list.execute(AUTH_USER_ID)).resolves.toEqual([]);
  });

  it('refuses a caller whose account is a patient', async () => {
    const patientAuthUserId = randomUUID();

    const list = new ListInvitationsUseCase(
      new LoadProfessionalCaller(
        new InMemoryIdentityRegistry({ [patientAuthUserId]: patientIdentity() }),
      ),
      new InMemoryInvitationRepository(),
    );

    await expect(list.execute(patientAuthUserId)).rejects.toThrow(CallerIsNotProfessionalError);
  });
});

describe('RevokeInvitationUseCase', () => {
  it('revokes a pending invitation of the practice', async () => {
    const { create, revoke } = scenario();

    const { invitation } = await create.execute(AUTH_USER_ID, INPUT);
    const revoked = await revoke.execute(AUTH_USER_ID, invitation.id);

    expect(revoked.id).toBe(invitation.id);
    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });

  it('refuses to revoke an invitation of another practice, as not found', async () => {
    const { create, revoke } = scenario();

    const { invitation } = await create.execute(OTHER_AUTH_USER_ID, INPUT);

    // Not a 403: a professional has no business learning that an id is
    // somebody else's invitation.
    await expect(revoke.execute(AUTH_USER_ID, invitation.id)).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  it('refuses an id that is nobody invitation', async () => {
    const { revoke } = scenario();

    await expect(revoke.execute(AUTH_USER_ID, randomUUID())).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  it('refuses to revoke twice', async () => {
    const { create, revoke } = scenario();

    const { invitation } = await create.execute(AUTH_USER_ID, INPUT);

    await revoke.execute(AUTH_USER_ID, invitation.id);

    await expect(revoke.execute(AUTH_USER_ID, invitation.id)).rejects.toThrow(
      InvitationNotPendingError,
    );
  });

  it('refuses to revoke one that was already accepted', async () => {
    const { create, revoke, invitations } = scenario();

    const { invitation } = await create.execute(AUTH_USER_ID, INPUT);

    invitations.markAccepted(invitation.id, new Date());

    await expect(revoke.execute(AUTH_USER_ID, invitation.id)).rejects.toThrow(
      InvitationNotPendingError,
    );
  });

  it('refuses to revoke an expired one: there is nothing left to take back', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expired = invitationRow(ORGANIZATION_ID, { expiresAt: yesterday });

    const revoke = new RevokeInvitationUseCase(
      new LoadProfessionalCaller(
        new InMemoryIdentityRegistry({ [AUTH_USER_ID]: professionalIdentity(ORGANIZATION_ID) }),
      ),
      new InMemoryInvitationRepository([expired]),
    );

    await expect(revoke.execute(AUTH_USER_ID, expired.id)).rejects.toThrow(
      InvitationNotPendingError,
    );
  });

  it('says not pending, not a 500, when an acceptance wins the race', async () => {
    // Read as pending, accepted by somebody else before the write ran: the
    // conditional update writes nothing, and the professional is told there is
    // nothing left to revoke.
    const pending = invitationRow(ORGANIZATION_ID);

    const invitations = new AcceptedWhileBeingRead([pending]);
    const revoke = new RevokeInvitationUseCase(
      new LoadProfessionalCaller(
        new InMemoryIdentityRegistry({ [AUTH_USER_ID]: professionalIdentity(ORGANIZATION_ID) }),
      ),
      invitations,
    );

    await expect(revoke.execute(AUTH_USER_ID, pending.id)).rejects.toThrow(
      InvitationNotPendingError,
    );
  });
});

/**
 * A repository in which the invitation is accepted in the instant between the
 * use case reading it and writing to it — the race the conditional write
 * exists for, made deterministic.
 */
class AcceptedWhileBeingRead extends InMemoryInvitationRepository {
  override async findById(
    invitationId: string,
    organizationId: string,
  ): Promise<Invitation | undefined> {
    const found = await super.findById(invitationId, organizationId);

    if (found !== undefined) this.markAccepted(found.id, new Date());

    return found;
  }
}
