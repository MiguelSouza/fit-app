import { randomUUID } from 'node:crypto';

import { CallerIsNotProfessionalError } from './identity-errors';
import { professionalCallerOf } from './professional-caller';
import { type RegisteredIdentity } from './registered-identity';

/**
 * Who may invite, and on behalf of which practice. It is the first line of
 * every invitation use case, so it is tested on its own: the organization is
 * read from the caller and never from the request.
 */
const PERSON_ID = randomUUID();
const ORGANIZATION_ID = randomUUID();

function professional(overrides: Partial<RegisteredIdentity> = {}): RegisteredIdentity {
  return {
    personId: PERSON_ID,
    role: 'professional',
    fullName: 'Profissional de teste',
    timeZone: 'America/Sao_Paulo',
    professional: { type: 'nutritionist', councilNumber: 'CRN-3 12345', specialty: null },
    organizations: [
      {
        organizationId: ORGANIZATION_ID,
        name: 'Consultório de teste',
        kind: 'solo',
        role: 'owner',
      },
    ],
    ...overrides,
  };
}

describe('professionalCallerOf', () => {
  it('answers the caller and the practice the invitation will belong to', () => {
    expect(professionalCallerOf(professional())).toEqual({
      profileId: PERSON_ID,
      organizationId: ORGANIZATION_ID,
    });
  });

  it('refuses a patient: inviting is a professional doing', () => {
    expect(() =>
      professionalCallerOf(
        professional({ role: 'patient', professional: null, organizations: [] }),
      ),
    ).toThrow(CallerIsNotProfessionalError);
  });

  it('fails loudly when a professional has no practice', () => {
    // Cannot happen: the registration creates the practice in the same
    // transaction as the profile (ADR 0014). It must not come out as "you may
    // not", which would send a professional to a screen that cannot help them.
    const error = thrownBy(() => professionalCallerOf(professional({ organizations: [] })));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CallerIsNotProfessionalError);
  });

  it('fails loudly when a professional has two, instead of picking one', () => {
    // The day a clinic has members in two practices, which one an invitation
    // goes to is a choice the request has to make. Guessing it here would
    // quietly send patients to the wrong practice.
    const error = thrownBy(() =>
      professionalCallerOf(
        professional({
          organizations: [
            ...professional().organizations,
            {
              organizationId: randomUUID(),
              name: 'Outra clínica',
              kind: 'clinic',
              role: 'member',
            },
          ],
        }),
      ),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CallerIsNotProfessionalError);
  });
});

/** What a call threw, so a test can assert on the kind and not only on the throw. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error: unknown) {
    return error;
  }

  throw new Error('the call was expected to throw and did not');
}
