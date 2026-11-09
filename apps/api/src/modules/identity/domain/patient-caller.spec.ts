import { CallerIsNotPatientError } from './identity-errors';
import { patientProfileIdOf } from './patient-caller';
import { type RegisteredIdentity } from './registered-identity';

/**
 * Who may manage a consent: the patient themselves, and nobody else (card
 * I-05).
 *
 * No data of a real person: the names are labels and the ids are fixed strings
 * (CLAUDE.md, "Testes").
 */
const PATIENT: RegisteredIdentity = {
  personId: 'patient-profile-id',
  role: 'patient',
  fullName: 'Paciente de teste',
  timeZone: 'America/Sao_Paulo',
  professional: null,
  organizations: [],
};

const PROFESSIONAL: RegisteredIdentity = {
  personId: 'professional-profile-id',
  role: 'professional',
  fullName: 'Profissional de teste',
  timeZone: 'America/Sao_Paulo',
  professional: { type: 'nutritionist', councilNumber: 'CRN-3 12345', specialty: null },
  organizations: [
    {
      organizationId: 'organization-id',
      name: 'Consultório de teste',
      kind: 'solo',
      role: 'owner',
    },
  ],
};

describe('patientProfileIdOf', () => {
  it('answers the caller own profile id', () => {
    expect(patientProfileIdOf(PATIENT)).toBe('patient-profile-id');
  });

  it('refuses a professional: nobody consents on somebody else behalf', () => {
    expect(() => patientProfileIdOf(PROFESSIONAL)).toThrow(CallerIsNotPatientError);
  });

  it('answers the same id however many practices follow the patient', () => {
    // The consents belong to the profile and not to the care relationship (ADR
    // 0016), so the practices change nothing here.
    expect(
      patientProfileIdOf({
        ...PATIENT,
        organizations: [
          { organizationId: 'one', name: 'Clínica A', kind: 'clinic', role: 'member' },
          { organizationId: 'other', name: 'Clínica B', kind: 'clinic', role: 'member' },
        ],
      }),
    ).toBe('patient-profile-id');
  });
});
