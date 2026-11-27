import { Inject, Injectable } from '@nestjs/common';

import { ProfileNotFoundError } from '../domain/identity-errors';
import { patientCallerOf, patientProfileIdOf, type PatientCaller } from '../domain/patient-caller';
import { IDENTITY_REGISTRY, type IdentityRegistry } from './ports/identity-registry.port';

/**
 * The caller, as the patient themselves — the first line of the three consent
 * use cases (card I-05).
 *
 * The mirror of `LoadProfessionalCaller`, and it exists for the same reason:
 * the authorization of a use case is the part that must not be written twice,
 * because the second copy is the one that forgets something (CLAUDE.md, "Saúde
 * e LGPD"). Here what it must not forget is small and absolute — the subject
 * of a consent is the person who sent the request, and nobody else.
 *
 * It does **not** ask the access service of this module anything. That service
 * answers "pode este profissional ver este paciente?" (ADR 0017), which is a
 * different question with a different subject: a patient reading their own
 * consents needs no care link and no `share_with_professional` — revoking that
 * very consent is one of these requests.
 *
 * It leaves the module through `index.ts`, next to the access rule and the
 * access log, because it is the other half of the same obligation: every route
 * of `nutrition`, `health` and `insights` that a patient points at themselves
 * — their check-ins, their diary, their plan — starts by resolving who is
 * calling, and nobody writes that line twice (card P-02).
 */
@Injectable()
export class LoadPatientCaller {
  constructor(@Inject(IDENTITY_REGISTRY) private readonly registry: IdentityRegistry) {}

  /**
   * The caller's own `identity.profile.id`, as a patient.
   *
   * @param authUserId the `sub` of the verified access token
   * @throws ProfileNotFoundError when the caller never finished the first
   *   access. 404 with the code the app keys off, as `GET /v1/me` answers.
   * @throws CallerIsNotPatientError when the account is a professional's (403)
   */
  async patientProfileId(authUserId: string): Promise<string> {
    const identity = await this.registry.findByAuthUserId(authUserId);

    if (identity === undefined) throw new ProfileNotFoundError();

    return patientProfileIdOf(identity);
  }

  /**
   * The caller as a patient, with the time zone their days are counted in.
   *
   * It is what a module that records something the patient **lived** needs:
   * which Tuesday a check-in is about is read in their zone and in nobody
   * else's (CLAUDE.md, "Dados de saúde"), and the zone is a column of this
   * module's `profile` table (rule 2). Whoever only needs the id keeps using
   * `patientProfileId` above — one query either way.
   *
   * @param authUserId the `sub` of the verified access token
   * @throws ProfileNotFoundError when the caller never finished the first
   *   access (404), CallerIsNotPatientError when the account is a
   *   professional's (403)
   */
  async execute(authUserId: string): Promise<PatientCaller> {
    const identity = await this.registry.findByAuthUserId(authUserId);

    if (identity === undefined) throw new ProfileNotFoundError();

    return patientCallerOf(identity);
  }
}
