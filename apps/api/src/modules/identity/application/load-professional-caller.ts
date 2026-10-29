import { Inject, Injectable } from '@nestjs/common';

import { ProfileNotFoundError } from '../domain/identity-errors';
import { professionalCallerOf, type ProfessionalCaller } from '../domain/professional-caller';
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
}
