import { BlankCouncilNumberError, BlankProfessionalNameError } from './identity-errors';
import { OWNER, SOLO, type OrganizationKind, type OrganizationRole } from './organization';
import {
  DEFAULT_PROFESSIONAL_TYPE,
  DEFAULT_TIME_ZONE,
  type PersonRole,
  type ProfessionalType,
} from './person';

/**
 * The rule of the first access: what a professional signing up turns into.
 *
 * Pure, and tested as such (CLAUDE.md rule 4): no NestJS, no Drizzle, no I/O.
 * It decides the four things nobody should have to decide twice — the role, the
 * professional type, the time zone and the practice — and the repository only
 * writes what comes out of here.
 */

/** What the caller asked for. `null` means "not said", not "empty". */
export interface ProfessionalRegistrationRequest {
  /** The `sub` of the verified access token, never a field of the body. */
  readonly authUserId: string;
  readonly fullName: string;
  readonly councilNumber: string;
  readonly specialty: string | null;
  readonly professionalType: ProfessionalType | null;
}

/** The practice the registration creates: one professional, who owns it. */
export interface SoloOrganizationToCreate {
  readonly name: string;
  readonly kind: OrganizationKind;
}

/**
 * The four rows of the registration, decided. The repository writes exactly
 * this, in one transaction, and invents nothing of its own.
 */
export interface ProfessionalRegistration {
  readonly authUserId: string;
  readonly role: PersonRole;
  readonly fullName: string;
  readonly timeZone: string;
  readonly professionalType: ProfessionalType;
  readonly councilNumber: string;
  readonly specialty: string | null;
  readonly organization: SoloOrganizationToCreate;
  readonly membershipRole: OrganizationRole;
}

/**
 * Collapses the whitespace of something a person typed: the ends trimmed and
 * every run of spaces inside reduced to one. `"  Ana   Souza "` and
 * `"Ana Souza"` are the same name, and a database that holds both holds two
 * professionals.
 */
function squeeze(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

/**
 * Turns what the caller asked for into what gets written.
 *
 * The defaults are here, in one place, instead of in the controller and in the
 * column and in the panel: `nutritionist`, because the platform is for sports
 * nutritionists; São Paulo, because that is where the practices are; and a
 * `solo` practice with the professional as its `owner`, which is the whole of
 * card I-01's "cada nutricionista ganha a sua".
 *
 * The practice is named after the professional, because for a solo practice
 * that is what it is called. Renaming it later is editing the organization,
 * not re-registering the person.
 *
 * @throws BlankProfessionalNameError when the name is whitespace only
 * @throws BlankCouncilNumberError when the council number is whitespace only
 */
export function professionalRegistrationFor(
  request: ProfessionalRegistrationRequest,
): ProfessionalRegistration {
  const fullName = squeeze(request.fullName);
  const councilNumber = squeeze(request.councilNumber);
  const specialty = request.specialty === null ? null : squeeze(request.specialty);

  if (fullName === '') throw new BlankProfessionalNameError();
  if (councilNumber === '') throw new BlankCouncilNumberError();

  return {
    authUserId: request.authUserId,
    role: 'professional',
    fullName,
    timeZone: DEFAULT_TIME_ZONE,
    professionalType: request.professionalType ?? DEFAULT_PROFESSIONAL_TYPE,
    councilNumber,
    // A specialty nobody typed and one typed as spaces are the same absence.
    specialty: specialty === '' ? null : specialty,
    organization: { name: fullName, kind: SOLO },
    membershipRole: OWNER,
  };
}
