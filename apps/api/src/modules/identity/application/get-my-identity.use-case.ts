import { Inject, Injectable } from '@nestjs/common';

import { ProfileNotFoundError } from '../domain/identity-errors';
import { type RegisteredIdentity } from '../domain/registered-identity';
import { IDENTITY_REGISTRY, type IdentityRegistry } from './ports/identity-registry.port';

/**
 * Who the caller is, for `GET /v1/me`.
 *
 * **Authorization.** The subject is the caller themselves: no link, no consent
 * and no access log, because no patient's data is read (CLAUDE.md, "Saúde e
 * LGPD" asks for the log when a professional opens somebody else's chart).
 * The id comes from the verified token, so nobody can ask about another person
 * by changing a parameter.
 *
 * Whoever signed in and never finished the first access has no profile, and
 * that is a 404 with a code the client can act on — it is what sends the panel
 * to the first access screen.
 */
@Injectable()
export class GetMyIdentityUseCase {
  constructor(@Inject(IDENTITY_REGISTRY) private readonly registry: IdentityRegistry) {}

  /** @param authUserId the `sub` of the verified access token */
  async execute(authUserId: string): Promise<RegisteredIdentity> {
    const identity = await this.registry.findByAuthUserId(authUserId);

    if (identity === undefined) throw new ProfileNotFoundError();

    return identity;
  }
}
