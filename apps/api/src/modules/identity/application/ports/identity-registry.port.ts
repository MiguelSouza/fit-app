import { type ProfessionalRegistration } from '../../domain/professional-registration';
import { type RegisteredIdentity } from '../../domain/registered-identity';

/**
 * Where the people of `identity` are kept.
 *
 * This is not an abstraction per table — CLAUDE.md rule 5 says the database
 * does not need one — but the two operations the use cases of card I-01 make,
 * named after what they mean: read the caller's identity, and register a
 * professional. It exists so `application/` holds no Drizzle and so the use
 * case can be driven without a database; what the database itself enforces is
 * covered by the integration test against a real Postgres (CLAUDE.md,
 * "Testes").
 */
export const IDENTITY_REGISTRY = Symbol('fit-app.identity.registry');

export interface IdentityRegistry {
  /**
   * The identity behind a Supabase user id, or `undefined` when that person
   * has no profile yet — signed in, first access not finished.
   */
  findByAuthUserId(authUserId: string): Promise<RegisteredIdentity | undefined>;

  /**
   * Creates the profile, the professional, the solo organization and the owner
   * membership **in one transaction**: either the four rows exist or none
   * does.
   *
   * Answers `undefined` when the person is already registered, having written
   * nothing. The unique index on the Supabase user id is what decides it, so
   * two requests arriving at the same moment cannot produce two professionals
   * — which is the acceptance criterion "chamar duas vezes não duplica nada",
   * enforced by the database and not by a check the caller could race past.
   */
  createProfessional(
    registration: ProfessionalRegistration,
  ): Promise<RegisteredIdentity | undefined>;
}
