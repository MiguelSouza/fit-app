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

/**
 * The patient who is calling: the id of their profile and the zone their days
 * are counted in.
 *
 * Two fields, and the second one is why this exists next to the function
 * above. Every module that records something the patient **lived** has to know
 * which day it was for them — the night a sleep began, the Tuesday a check-in
 * is about (CLAUDE.md, "Dados de saúde": UTC in the database, the zone on the
 * profile) — and the zone is a column of `identity.profile`, which only this
 * module reads (rule 2). So it travels out of here with the id, instead of
 * every other module learning to ask for it separately or, worse, defaulting
 * to the server's.
 *
 * It is the caller's own and nobody else's. A professional reading a patient
 * goes through the access rule (ADR 0017), which answers a different question.
 */
export interface PatientCaller {
  /** `identity.profile.id` — ours, never the Supabase user id. */
  readonly profileId: string;

  /** The IANA name on the profile. Never empty: the column is `not null`. */
  readonly timeZone: string;
}

/**
 * The caller as a patient, with their zone.
 *
 * @throws CallerIsNotPatientError when the account is a professional's (403),
 *   for the same reason as above
 */
export function patientCallerOf(identity: RegisteredIdentity): PatientCaller {
  if (identity.role !== 'patient') throw new CallerIsNotPatientError();

  return { profileId: identity.personId, timeZone: identity.timeZone };
}
