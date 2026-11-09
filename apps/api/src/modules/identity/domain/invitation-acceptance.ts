import { type ConsentToGrant, type ConsentType, consentsToGrant } from './consent';
import { BlankPatientNameError, UnknownTimeZoneError } from './identity-errors';
import { type Invitation, invitationReadyToAccept } from './invitation';
import { DEFAULT_TIME_ZONE, isKnownTimeZone, type PersonRole } from './person';

/**
 * The rule of the patient's side of an invitation: what accepting a link turns
 * into (card I-03).
 *
 * Pure, and tested as such (CLAUDE.md rule 4): no NestJS, no Drizzle, no I/O.
 * It decides everything that is not storage — whether the link may still be
 * used, what the patient's profile starts as, and which consents get recorded
 * with which version of the terms — and the repository writes exactly what
 * comes out, in one transaction.
 */

/** What the caller asked for. `null` means "not said", not "empty". */
export interface InvitationAcceptanceRequest {
  /** The invitation the token was found by, as it stands in the database. */
  readonly invitation: Invitation;
  /** The `sub` of the verified access token: the account that just signed up. */
  readonly authUserId: string;
  readonly fullName: string;
  readonly timeZone: string | null;
  /** The purposes the patient ticked. The required ones are checked here. */
  readonly consents: readonly ConsentType[];
  /** The instant of the acceptance: the link, the consents and the follow-up all start here. */
  readonly now: Date;
}

/**
 * The patient's profile as the acceptance wants it.
 *
 * "Ensure" and not "create": the person may already be on the platform, having
 * been invited by another practice, and then this is what their row already
 * says and nothing is written. The acceptance criterion "paciente que já
 * existe só ganha o novo vínculo" is that, and it is the repository — keyed by
 * the Supabase user id — that decides it, not a check this process could race
 * past.
 */
export interface PatientToEnsure {
  readonly authUserId: string;
  readonly role: PersonRole;
  readonly fullName: string;
  readonly timeZone: string;
}

/**
 * Everything the acceptance writes, decided. The repository invents nothing of
 * its own and writes all of it in one transaction.
 */
export interface InvitationAcceptance {
  readonly invitationId: string;
  /** The practice the link belongs to: the invitation's, never the caller's wish. */
  readonly organizationId: string;
  readonly patient: PatientToEnsure;
  readonly consents: readonly ConsentToGrant[];
  readonly acceptedAt: Date;
}

/** What came of it: the patient is in, and this is where. */
export interface AcceptedInvitation {
  readonly profileId: string;
  readonly organizationId: string;
  readonly careRelationshipId: string;
  readonly acceptedAt: Date;
  /** The purposes in force afterwards, which may include older consents. */
  readonly consents: readonly ConsentType[];
}

/**
 * Collapses the whitespace of something a person typed, as
 * `professional-registration.ts` does for the name of a professional.
 */
function squeeze(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

/**
 * Turns an accepted link into the rows that get written.
 *
 * The order of the refusals is the order that helps whoever is holding the
 * link: whether the invitation is still good comes first, because a patient
 * whose link expired is not helped by being told about a field, and then the
 * form — the name, and the consents without which there is no follow-up.
 *
 * @throws InvitationAlreadyAcceptedError when the link was already used
 * @throws InvitationRevokedError when the professional took it back
 * @throws InvitationExpiredError when the fourteen days are gone
 * @throws BlankPatientNameError when the name is whitespace only
 * @throws UnknownTimeZoneError when the zone is not an IANA name
 * @throws MissingRequiredConsentError when a required consent is missing
 */
export function invitationAcceptanceOf(request: InvitationAcceptanceRequest): InvitationAcceptance {
  const invitation = invitationReadyToAccept(request.invitation, request.now);

  const fullName = squeeze(request.fullName);

  if (fullName === '') throw new BlankPatientNameError();

  // A zone nobody said and one typed as spaces are the same absence, and the
  // default is the platform's, in one place (`domain/person.ts`). One that was
  // said has to be a name the IANA database has: it is the column that dates a
  // night of sleep, and it is refused here and not stored to be discovered
  // broken later.
  const said = request.timeZone === null ? '' : squeeze(request.timeZone);

  if (said !== '' && !isKnownTimeZone(said)) throw new UnknownTimeZoneError();

  return {
    invitationId: invitation.id,
    organizationId: invitation.organizationId,
    patient: {
      authUserId: request.authUserId,
      role: 'patient',
      fullName,
      timeZone: said === '' ? DEFAULT_TIME_ZONE : said,
    },
    consents: consentsToGrant(request.consents, request.now),
    acceptedAt: request.now,
  };
}
