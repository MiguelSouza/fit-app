import { CallerIsNotPatientError } from './identity-errors';
import { type RegisteredIdentity } from './registered-identity';

/**
 * Who is calling, when what they are calling is about **themselves as a
 * patient** — the consents of card I-05.
 *
 * Pure (CLAUDE.md rule 4), and the mirror of `professional-caller.ts` next
 * door. It is one line of code and it exists for the same reason that one
 * does: the subject of a consent request is never in the body, it is the
 * verified token (ADR 0007), and the one check that makes it so should be
 * written once.
 *
 * Consent under LGPD is personal: nobody gives it or takes it back on somebody
 * else's behalf, not the professional who follows them and not the practice
 * they joined. So there is no "on behalf of" variant of this function, and
 * there is no patient id anywhere in the three requests it guards.
 */

/**
 * The caller's own `identity.profile.id`, as a patient.
 *
 * It asks nothing about practices, unlike `professionalCallerOf`: the consents
 * belong to the profile and not to the care relationship (ADR 0016), so which
 * practice follows this patient — one, two or none — changes nothing here.
 *
 * @throws CallerIsNotPatientError when the account is a professional's. 403
 *   and not 404: the person exists and is signed in, they simply have no
 *   consents of their own to manage.
 */
export function patientProfileIdOf(identity: RegisteredIdentity): string {
  if (identity.role !== 'patient') throw new CallerIsNotPatientError();

  return identity.personId;
}
