import { randomUUID } from 'node:crypto';

import { ProfileIsNotProfessionalError, ProfileNotFoundError } from '../domain/identity-errors';
import { type ProfessionalRegistration } from '../domain/professional-registration';
import { type RegisteredIdentity } from '../domain/registered-identity';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
} from './in-memory-identity-registry.spec-support';
import { type IdentityRegistry } from './ports/identity-registry.port';
import { GetMyIdentityUseCase } from './get-my-identity.use-case';
import { RegisterProfessionalUseCase } from './register-professional.use-case';

/** The Supabase user of whoever is calling. An id, never a person. */
const AUTH_USER_ID = randomUUID();

const INPUT = {
  fullName: 'Ana Souza',
  councilNumber: 'CRN-3 12345',
  specialty: 'Nutrição esportiva',
  professionalType: null,
};

describe('RegisterProfessionalUseCase', () => {
  it('registers the professional once and answers what was written', async () => {
    const registry = new InMemoryIdentityRegistry();

    const identity = await new RegisterProfessionalUseCase(registry).execute(AUTH_USER_ID, INPUT);

    expect(registry.registrations).toBe(1);
    expect(identity.role).toBe('professional');
    expect(identity.professional).toEqual({
      type: 'nutritionist',
      councilNumber: 'CRN-3 12345',
      specialty: 'Nutrição esportiva',
    });
    expect(identity.organizations).toEqual([
      {
        organizationId: expect.any(String),
        name: 'Ana Souza',
        kind: 'solo',
        role: 'owner',
      },
    ]);
  });

  it('called twice, writes once and answers the same registration', async () => {
    const registry = new InMemoryIdentityRegistry();
    const useCase = new RegisterProfessionalUseCase(registry);

    const first = await useCase.execute(AUTH_USER_ID, INPUT);
    const second = await useCase.execute(AUTH_USER_ID, INPUT);

    expect(registry.registrations).toBe(1);
    expect(second).toEqual(first);
  });

  it('ignores a second call that asks for something else: the first access happened once', async () => {
    const registry = new InMemoryIdentityRegistry();
    const useCase = new RegisterProfessionalUseCase(registry);

    const first = await useCase.execute(AUTH_USER_ID, INPUT);
    const second = await useCase.execute(AUTH_USER_ID, {
      ...INPUT,
      fullName: 'Outro Nome',
      professionalType: 'trainer',
    });

    // Changing the registration is editing the profile, which is another use
    // case with its own card. What this one guarantees is that nothing was
    // duplicated and nothing was silently overwritten.
    expect(registry.registrations).toBe(1);
    expect(second).toEqual(first);
  });

  it('refuses an account that is already a patient', async () => {
    const registry = new InMemoryIdentityRegistry({ [AUTH_USER_ID]: patientIdentity() });

    await expect(
      new RegisterProfessionalUseCase(registry).execute(AUTH_USER_ID, INPUT),
    ).rejects.toThrow(ProfileIsNotProfessionalError);
  });

  it('answers the registration of whoever won a race it lost', async () => {
    // What two requests of the same person arriving at the same instant look
    // like from inside: the read found nothing, and by the time the insert ran
    // the other one had already written the row.
    const winner = await alreadyRegistered();

    const identity = await new RegisterProfessionalUseCase(raceLostTo(winner)).execute(
      AUTH_USER_ID,
      INPUT,
    );

    expect(identity).toEqual(winner);
  });

  it('fails loudly when the row that refused the insert is not there afterwards', async () => {
    // Cannot happen, and it must not come out as a 404: that would send the
    // panel back to a first access it has just finished.
    const error = await new RegisterProfessionalUseCase(raceLostTo(undefined))
      .execute(AUTH_USER_ID, INPUT)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ProfileNotFoundError);
    expect((error as Error).message).toContain('was not found afterwards');
  });
});

describe('GetMyIdentityUseCase', () => {
  it('answers the identity of whoever is calling', async () => {
    const registry = new InMemoryIdentityRegistry();
    const registered = await new RegisterProfessionalUseCase(registry).execute(AUTH_USER_ID, INPUT);

    await expect(new GetMyIdentityUseCase(registry).execute(AUTH_USER_ID)).resolves.toEqual(
      registered,
    );
  });

  it('says there is no profile for whoever signed in and never registered', async () => {
    const registry = new InMemoryIdentityRegistry();

    await expect(new GetMyIdentityUseCase(registry).execute(AUTH_USER_ID)).rejects.toThrow(
      ProfileNotFoundError,
    );
  });
});

/** An identity that is already in the registry, as the race's winner left it. */
async function alreadyRegistered(): Promise<RegisteredIdentity> {
  const registry = new InMemoryIdentityRegistry();

  return new RegisterProfessionalUseCase(registry).execute(AUTH_USER_ID, INPUT);
}

/**
 * A registry that answers like one in the middle of a race: nothing on the
 * first read, nothing written by the insert, and `winner` on the read after it.
 *
 * `undefined` as the winner is the state that cannot happen — the insert was
 * refused by a row that then is not there — and the use case has to make noise
 * about it instead of answering a 404.
 */
function raceLostTo(winner: RegisteredIdentity | undefined): IdentityRegistry {
  let reads = 0;

  return {
    findByAuthUserId: (): Promise<RegisteredIdentity | undefined> => {
      reads += 1;

      return Promise.resolve(reads === 1 ? undefined : winner);
    },

    createProfessional: (
      _registration: ProfessionalRegistration,
    ): Promise<RegisteredIdentity | undefined> => Promise.resolve(undefined),
  };
}
