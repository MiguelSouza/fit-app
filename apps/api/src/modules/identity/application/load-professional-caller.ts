import { Inject, Injectable } from '@nestjs/common';

import { ProfileNotFoundError } from '../domain/identity-errors';
import {
  professionalCallerOf,
  professionalProfileIdOf,
  type ProfessionalCaller,
} from '../domain/professional-caller';
import { IDENTITY_REGISTRY, type IdentityRegistry } from './ports/identity-registry.port';

/**
 * The caller, as the professional of a practice — the first line of every
 * invitation use case.
 *
 * It is one object, injected into the three of them, instead of four lines
 * repeated: the authorization of a use case is the part that must not be
 * written twice, because the second copy is the one that forgets something
 * (CLAUDE.md, "Saúde e LGPD": use the module's access service, never
 * reimplement it). When the access service of `identity` lands with its own
 * card — the active link, the consent in force, the access log — it is this
 * object that grows into it.
 *
 * What it does **not** do is read a patient. An invitation has no patient yet,
 * so there is no link and no consent to check here, and nothing to log.
 */
@Injectable()
export class LoadProfessionalCaller {
  constructor(@Inject(IDENTITY_REGISTRY) private readonly registry: IdentityRegistry) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @throws ProfileNotFoundError when the caller never finished the first
   *   access. 404 with the code the panel keys off, as `GET /v1/me` answers.
   * @throws CallerIsNotProfessionalError when the account is a patient's
   */
  async execute(authUserId: string): Promise<ProfessionalCaller> {
    const identity = await this.registry.findByAuthUserId(authUserId);

    if (identity === undefined) throw new ProfileNotFoundError();

    return professionalCallerOf(identity);
  }

  /**
   * The caller's professional profile id, for what is about the person and not
   * about their practice — which is what the access rule asks
   * (`PatientAccessService`).
   *
   * `execute` above cannot answer it: it also resolves the one practice an
   * invitation belongs to, and a professional of two is a loud error there on
   * purpose. The access rule has no such question, since the links of every
   * practice they belong to are read together, so asking through `execute`
   * would turn a clinic member into a 500 on a route the rule itself lets
   * through.
   *
   * @param authUserId the `sub` of the verified access token
   * @throws ProfileNotFoundError when the caller never finished the first
   *   access (404), CallerIsNotProfessionalError when the account is a
   *   patient's (403)
   */
  async professionalProfileId(authUserId: string): Promise<string> {
    const identity = await this.registry.findByAuthUserId(authUserId);

    if (identity === undefined) throw new ProfileNotFoundError();

    return professionalProfileIdOf(identity);
  }
}
