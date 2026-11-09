import { randomUUID } from 'node:crypto';

import { CURRENT_TERMS_VERSION, type ConsentType } from '../domain/consent';
import {
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
  MissingRequiredConsentError,
  ProfileIsNotPatientError,
} from '../domain/identity-errors';
import { type Invitation } from '../domain/invitation';
import { DEFAULT_TIME_ZONE } from '../domain/person';
import { AcceptInvitationUseCase } from './accept-invitation.use-case';
import {
  InMemoryIdentityRegistry,
  professionalIdentity,
} from './in-memory-identity-registry.spec-support';
import { InMemoryInvitationAcceptanceRepository } from './in-memory-invitation-acceptance.spec-support';
import { invitationRow } from './in-memory-invitation-repository.spec-support';
import {
  hashOfPredictableToken,
  PredictableInvitationTokenIssuer,
} from './predictable-invitation-token.spec-support';

/**
 * The acceptance of an invitation, driven without a database (card I-03).
 *
 * The three acceptance criteria of the card are here: an acceptance without
 * the required consents fails, a patient who already exists only gains the new
 * link, and a used link cannot be used again. What the database decides — the
 * transaction, the unique indexes, two acceptances in the same instant — has
 * its own suite against a real Postgres.
 */
const AUTH_USER_ID = randomUUID();
const ORGANIZATION_ID = randomUUID();
const OTHER_ORGANIZATION_ID = randomUUID();

const REQUIRED: readonly ConsentType[] = ['health_data', 'share_with_professional'];

const INPUT = { fullName: 'Ana Souza', timeZone: null, consents: REQUIRED };

/**
 * The use case over the fakes, with one pending invitation of
 * `ORGANIZATION_ID` seeded behind a token the test knows.
 */
function scenario(invitation: Invitation = invitationRow(ORGANIZATION_ID)) {
  const registry = new InMemoryIdentityRegistry();
  const acceptances = new InMemoryInvitationAcceptanceRepository();
  const tokens = new PredictableInvitationTokenIssuer();

  const token = 'token-of-the-link';

  acceptances.seed(invitation, hashOfPredictableToken(token));

  return {
    registry,
    acceptances,
    invitation,
    token,
    accept: new AcceptInvitationUseCase(registry, acceptances, tokens),
  };
}

describe('AcceptInvitationUseCase', () => {
  it('makes the account a patient and starts the follow-up in the invitation practice', async () => {
    const { accept, token, acceptances } = scenario();

    const accepted = await accept.execute(AUTH_USER_ID, { ...INPUT, token });

    expect(accepted.organizationId).toBe(ORGANIZATION_ID);
    expect(accepted.consents).toEqual(REQUIRED);

    expect(acceptances.profiles.get(AUTH_USER_ID)).toMatchObject({
      role: 'patient',
      fullName: 'Ana Souza',
      timeZone: DEFAULT_TIME_ZONE,
    });
    expect(acceptances.patients.has(accepted.profileId)).toBe(true);
    expect(acceptances.careRelationships).toHaveLength(1);
    expect(acceptances.careRelationships[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      patientProfileId: accepted.profileId,
      endedAt: null,
    });
  });

  it('records the consents with the version of the terms the API served', async () => {
    const { accept, token, acceptances } = scenario();

    const accepted = await accept.execute(AUTH_USER_ID, {
      ...INPUT,
      token,
      consents: [...REQUIRED, 'ai_processing'],
    });

    expect(acceptances.consents).toEqual([
      {
        profileId: accepted.profileId,
        type: 'health_data',
        termsVersion: CURRENT_TERMS_VERSION,
        grantedAt: expect.any(Date),
      },
      {
        profileId: accepted.profileId,
        type: 'share_with_professional',
        termsVersion: CURRENT_TERMS_VERSION,
        grantedAt: expect.any(Date),
      },
      {
        profileId: accepted.profileId,
        type: 'ai_processing',
        termsVersion: CURRENT_TERMS_VERSION,
        grantedAt: expect.any(Date),
      },
    ]);
  });

  it('accepts without the two optional consents: they can come later', async () => {
    const { accept, token, acceptances } = scenario();

    await accept.execute(AUTH_USER_ID, { ...INPUT, token });

    expect(acceptances.consents.map((consent) => consent.type)).toEqual(REQUIRED);
  });

  it('fails, writing nothing, without health_data and share_with_professional', async () => {
    const { accept, token, acceptances } = scenario();

    await expect(
      accept.execute(AUTH_USER_ID, { ...INPUT, token, consents: ['wearable_data'] }),
    ).rejects.toThrow(MissingRequiredConsentError);

    expect(acceptances.profiles.size).toBe(0);
    expect(acceptances.careRelationships).toEqual([]);
    expect(acceptances.consents).toEqual([]);
  });

  it('leaves the invitation pending when the acceptance was refused', async () => {
    const { accept, token, acceptances, invitation } = scenario();

    await expect(
      accept.execute(AUTH_USER_ID, { ...INPUT, token, consents: ['health_data'] }),
    ).rejects.toThrow(MissingRequiredConsentError);

    // The link still works: the patient ticks the box and tries again.
    expect(acceptances.invitationById(invitation.id)?.acceptedAt).toBeNull();

    await expect(accept.execute(AUTH_USER_ID, { ...INPUT, token })).resolves.toMatchObject({
      organizationId: ORGANIZATION_ID,
    });
  });

  it('gives a patient who already exists the new link and nothing else', async () => {
    const { accept, token, acceptances } = scenario();

    const first = await accept.execute(AUTH_USER_ID, { ...INPUT, token });

    // The same person, invited by a second practice, accepting with another
    // name: the profile they registered with stays as it is.
    const second = acceptances.seed(
      invitationRow(OTHER_ORGANIZATION_ID),
      hashOfPredictableToken('token-of-the-other-link'),
    );

    const accepted = await accept.execute(AUTH_USER_ID, {
      ...INPUT,
      token: 'token-of-the-other-link',
      fullName: 'Outro Nome',
    });

    expect(accepted.profileId).toBe(first.profileId);
    expect(acceptances.profiles.size).toBe(1);
    expect(acceptances.profiles.get(AUTH_USER_ID)?.fullName).toBe('Ana Souza');
    expect(acceptances.patients.size).toBe(1);

    // One link per practice, and the consents are not recorded twice.
    expect(
      acceptances.careRelationships.map((relationship) => relationship.organizationId),
    ).toEqual([ORGANIZATION_ID, OTHER_ORGANIZATION_ID]);
    expect(acceptances.careRelationships[1]?.invitationId).toBe(second.id);
    expect(acceptances.consents).toHaveLength(2);
    expect(accepted.consents).toEqual(REQUIRED);
  });

  it('refuses to use the same link twice', async () => {
    const { accept, token } = scenario();

    await accept.execute(AUTH_USER_ID, { ...INPUT, token });

    await expect(accept.execute(randomUUID(), { ...INPUT, token })).rejects.toThrow(
      InvitationAlreadyAcceptedError,
    );
  });

  it('writes no second link when the same person opens the same link twice', async () => {
    const { accept, token, acceptances } = scenario();

    await accept.execute(AUTH_USER_ID, { ...INPUT, token });

    await expect(accept.execute(AUTH_USER_ID, { ...INPUT, token })).rejects.toThrow(
      InvitationAlreadyAcceptedError,
    );

    expect(acceptances.careRelationships).toHaveLength(1);
  });

  it('refuses a link the professional took back', async () => {
    const { accept, token } = scenario(
      invitationRow(ORGANIZATION_ID, { revokedAt: new Date(Date.now() - 1000) }),
    );

    await expect(accept.execute(AUTH_USER_ID, { ...INPUT, token })).rejects.toThrow(
      InvitationRevokedError,
    );
  });

  it('refuses a link whose fourteen days are gone', async () => {
    const { accept, token } = scenario(
      invitationRow(ORGANIZATION_ID, { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
    );

    await expect(accept.execute(AUTH_USER_ID, { ...INPUT, token })).rejects.toThrow(
      InvitationExpiredError,
    );
  });

  it('refuses a token that opens no invitation', async () => {
    const { accept } = scenario();

    await expect(
      accept.execute(AUTH_USER_ID, { ...INPUT, token: 'a-token-nobody-issued' }),
    ).rejects.toThrow(InvitationNotFoundError);
  });

  it('refuses an account that is already a professional', async () => {
    const { accept, token, registry, acceptances, invitation } = scenario();

    await registry.createProfessional({
      authUserId: AUTH_USER_ID,
      role: 'professional',
      fullName: 'Profissional de teste',
      timeZone: DEFAULT_TIME_ZONE,
      professionalType: 'nutritionist',
      councilNumber: 'CRN-3 12345',
      specialty: null,
      organization: { name: 'Consultório de teste', kind: 'solo' },
      membershipRole: 'owner',
    });

    await expect(accept.execute(AUTH_USER_ID, { ...INPUT, token })).rejects.toThrow(
      ProfileIsNotPatientError,
    );

    // And the link was not spent on the refusal: it is still there for the
    // patient it was meant for.
    expect(acceptances.careRelationships).toEqual([]);
    expect(acceptances.invitationById(invitation.id)?.acceptedAt).toBeNull();
  });

  it('refuses a professional of another practice holding a patient link', async () => {
    const otherAuthUserId = randomUUID();
    const registry = new InMemoryIdentityRegistry({
      [otherAuthUserId]: professionalIdentity(OTHER_ORGANIZATION_ID),
    });
    const acceptances = new InMemoryInvitationAcceptanceRepository();

    acceptances.seed(invitationRow(ORGANIZATION_ID), hashOfPredictableToken('a-link'));

    const accept = new AcceptInvitationUseCase(
      registry,
      acceptances,
      new PredictableInvitationTokenIssuer(),
    );

    await expect(accept.execute(otherAuthUserId, { ...INPUT, token: 'a-link' })).rejects.toThrow(
      ProfileIsNotPatientError,
    );
  });

  it('keeps the zone the patient said, which is what dates a night of sleep', async () => {
    const { accept, token, acceptances } = scenario();

    await accept.execute(AUTH_USER_ID, { ...INPUT, token, timeZone: 'America/Bahia' });

    expect(acceptances.profiles.get(AUTH_USER_ID)?.timeZone).toBe('America/Bahia');
  });
});
