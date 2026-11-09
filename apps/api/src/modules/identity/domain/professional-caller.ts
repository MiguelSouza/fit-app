import { CallerIsNotProfessionalError } from './identity-errors';
import { type RegisteredIdentity } from './registered-identity';

/**
 * Who is calling, when what they are calling only makes sense for a
 * professional of a practice.
 *
 * Pure (CLAUDE.md rule 4). It is the subject every invitation use case of card
 * I-02 is about: the invitation belongs to this organization, the list answers
 * this organization's invitations, and a revocation only reaches one of them.
 * Nothing in a request says which organization — it is read from who the
 * caller is, which is what makes "convite pertence à organização do
 * profissional" true by construction instead of by a check somebody could
 * forget.
 *
 * It is **not** permission to read a patient: that needs an active link and a
 * `share_with_professional` consent in force, which the access service of this
 * module will answer when its card lands (CLAUDE.md, "Saúde e LGPD"). No
 * invitation use case reads a patient's data — an invitation has no patient
 * yet.
 */
export interface ProfessionalCaller {
  /** The caller's own `identity.profile.id`, which is who sent the invitation. */
  readonly profileId: string;
  /** The practice the invitation belongs to. */
  readonly organizationId: string;
}

/**
 * The caller's own profile id, as a professional and without asking which
 * practice they are in.
 *
 * That second half is the whole point of it being its own function. The access
 * rule of this module never picks one practice: the links of **every** practice
 * the professional belongs to are read together, and one active link among them
 * is access (`domain/patient-access.ts`). So a clinic member who belongs to two
 * has a perfectly good answer here, where the same person is an error for
 * `professionalCallerOf` below — an invitation has to go to one practice, and
 * nothing in the request says which.
 *
 * @throws CallerIsNotProfessionalError when the account is a patient's. 403
 *   and not 404: the person exists and is signed in, they just may not read
 *   somebody else's patient.
 */
export function professionalProfileIdOf(identity: RegisteredIdentity): string {
  if (identity.professional === null) throw new CallerIsNotProfessionalError();

  return identity.personId;
}

/**
 * The caller as a professional of a practice.
 *
 * @throws CallerIsNotProfessionalError when the account is a patient's. 403
 *   and not 404: the person exists and is signed in, they just may not invite
 *   anybody.
 */
export function professionalCallerOf(identity: RegisteredIdentity): ProfessionalCaller {
  const profileId = professionalProfileIdOf(identity);

  const [membership, ...rest] = identity.organizations;

  if (membership === undefined || rest.length > 0) {
    // Unreachable while a professional has exactly one practice, which is what
    // the registration creates and what ADR 0014 decided. A plain error, so it
    // comes out as a 500 and somebody looks at it: the day a professional
    // belongs to two practices, which organization an invitation goes to is a
    // choice the request has to make, and this is the line that says so.
    throw new Error('a professional has to belong to exactly one organization to invite');
  }

  return { profileId, organizationId: membership.organizationId };
}
