import { Inject, Injectable } from '@nestjs/common';

import { ProfileIsNotProfessionalError } from '../domain/identity-errors';
import {
  professionalRegistrationFor,
  type ProfessionalRegistrationRequest,
} from '../domain/professional-registration';
import { type RegisteredIdentity } from '../domain/registered-identity';
import { IDENTITY_REGISTRY, type IdentityRegistry } from './ports/identity-registry.port';

/** What the caller fills in. Who they are is not in here: see `execute`. */
export type RegisterProfessionalInput = Omit<ProfessionalRegistrationRequest, 'authUserId'>;

/**
 * The first access of a professional: the profile, the professional, the solo
 * practice and the ownership of it, created together (card I-01).
 *
 * **Idempotent.** Calling it again answers the registration that already
 * exists and writes nothing — the panel can retry a request that timed out,
 * and a double click cannot produce two practices. Two things make it so, and
 * both are needed: the read below, which is the normal path, and the unique
 * index on the Supabase user id, which decides the race the read cannot see.
 *
 * **Authorization.** The subject of this use case is the caller themselves, so
 * there is no link and no consent to check: no patient's data is read or
 * written here (CLAUDE.md, "Saúde e LGPD"). What does matter is that the
 * person being registered is the person who sent the request, and that is why
 * the id comes from the verified token and never from the body (ADR 0007).
 */
@Injectable()
export class RegisterProfessionalUseCase {
  constructor(@Inject(IDENTITY_REGISTRY) private readonly registry: IdentityRegistry) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @param input what the first access screen asked for
   */
  async execute(authUserId: string, input: RegisterProfessionalInput): Promise<RegisteredIdentity> {
    const existing = await this.registry.findByAuthUserId(authUserId);

    if (existing !== undefined) return professionalOf(existing);

    const created = await this.registry.createProfessional(
      professionalRegistrationFor({ authUserId, ...input }),
    );

    if (created !== undefined) return created;

    // Nothing was written because the row was already there: another request
    // of the same person got in between the read and the insert. Whatever that
    // one created is the answer to this one too.
    const raced = await this.registry.findByAuthUserId(authUserId);

    if (raced === undefined) {
      // Unreachable: the insert was refused because the profile exists. A
      // plain error, so it comes out as a 500 and somebody looks at it,
      // instead of a 404 that would send the panel back to a first access it
      // has just finished.
      throw new Error('the profile that refused the insert was not found afterwards');
    }

    return professionalOf(raced);
  }
}

/**
 * The identity, provided it is a professional's.
 *
 * Reached by whoever signed up as a patient and then posted to the
 * professional endpoint: the account exists, and this product does not give
 * one person two roles.
 */
function professionalOf(identity: RegisteredIdentity): RegisteredIdentity {
  if (identity.professional === null) throw new ProfileIsNotProfessionalError();

  return identity;
}
