import { BlankCouncilNumberError, BlankProfessionalNameError } from './identity-errors';
import { DEFAULT_TIME_ZONE } from './person';
import {
  professionalRegistrationFor,
  type ProfessionalRegistrationRequest,
} from './professional-registration';

/**
 * The rule of card I-01, tested without a database: what a professional
 * signing up turns into. The acceptance criterion "`professional_type` padrão
 * `nutritionist`" is decided here, and the integration test checks that the
 * row really lands with it.
 *
 * The auth id is the nil UUID, which is not and will never be a person — no
 * patient, synthetic or otherwise, is invented in a test (CLAUDE.md,
 * "Testes").
 */
const AUTH_USER_ID = '00000000-0000-0000-0000-000000000000';

function request(
  overrides: Partial<ProfessionalRegistrationRequest> = {},
): ProfessionalRegistrationRequest {
  return {
    authUserId: AUTH_USER_ID,
    fullName: 'Ana Souza',
    councilNumber: 'CRN-3 12345',
    specialty: 'Nutrição esportiva',
    professionalType: null,
    ...overrides,
  };
}

describe('professionalRegistrationFor', () => {
  it('registers a nutritionist when nobody says which type it is', () => {
    expect(professionalRegistrationFor(request()).professionalType).toBe('nutritionist');
  });

  it('keeps the type the caller did ask for', () => {
    const registration = professionalRegistrationFor(request({ professionalType: 'trainer' }));

    expect(registration.professionalType).toBe('trainer');
  });

  it('makes the person a professional, in the default time zone', () => {
    const registration = professionalRegistrationFor(request());

    expect(registration.role).toBe('professional');
    expect(registration.timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  it('gives them a solo practice, named after them, which they own', () => {
    const registration = professionalRegistrationFor(request({ fullName: 'Ana Souza' }));

    expect(registration.organization).toEqual({ name: 'Ana Souza', kind: 'solo' });
    expect(registration.membershipRole).toBe('owner');
  });

  it('collapses the whitespace of what was typed, in the name and in the practice', () => {
    const registration = professionalRegistrationFor(
      request({ fullName: '  Ana   Souza ', councilNumber: ' CRN-3  12345 ' }),
    );

    expect(registration.fullName).toBe('Ana Souza');
    expect(registration.organization.name).toBe('Ana Souza');
    expect(registration.councilNumber).toBe('CRN-3 12345');
  });

  it('reads a specialty of spaces as no specialty at all', () => {
    expect(professionalRegistrationFor(request({ specialty: '   ' })).specialty).toBeNull();
    expect(professionalRegistrationFor(request({ specialty: null })).specialty).toBeNull();
  });

  it('refuses a name that is only whitespace', () => {
    expect(() => professionalRegistrationFor(request({ fullName: '   ' }))).toThrow(
      BlankProfessionalNameError,
    );
  });

  it('refuses a council number that is only whitespace', () => {
    expect(() => professionalRegistrationFor(request({ councilNumber: ' ' }))).toThrow(
      BlankCouncilNumberError,
    );
  });

  it('never takes the person from the body: the id comes from the token', () => {
    // The shape is the guard here — there is no field in the request that
    // could name somebody else — and this pins it: what the registration
    // writes is the `sub` it was given.
    expect(professionalRegistrationFor(request()).authUserId).toBe(AUTH_USER_ID);
  });
});
