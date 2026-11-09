import {
  type ConsentInForce,
  type ConsentToGrant,
  type ConsentType,
  type RevokedConsent,
} from '../../domain/consent';

/**
 * Where the patient's consents are read and written (card I-05).
 *
 * Like the ports next door it is not an abstraction per table (CLAUDE.md rule
 * 5): it is the three things the use cases do — read what is in force, give one
 * purpose, take a set of purposes back — and it exists so `application/` holds
 * no Drizzle and so the use cases can be driven without a database.
 *
 * The acceptance of an invitation writes consents too, and it does **not** go
 * through here: it writes them inside the transaction that creates the profile,
 * the patient and the care link (`InvitationAcceptanceRepository`), because a
 * patient with a link and no consent is a state nobody should have to clean up.
 * Two ports write the same table on purpose; what they share is the table's
 * one invariant, and that invariant lives in the database — the partial unique
 * index on the consents in force.
 *
 * What only a real Postgres can prove — that a revocation dates the row
 * instead of deleting it, that the professional's access is gone on the next
 * request, that two revocations of the same purpose cannot both write — is
 * `consents.use-case.integration-spec.ts` (CLAUDE.md, "Testes").
 */
export const CONSENT_REPOSITORY = Symbol('fit-app.identity.consentRepository');

export interface ConsentRepository {
  /**
   * The purposes this profile holds right now: the rows with no `revoked_at`.
   *
   * It is read on every one of the three requests and never cached, for the
   * same reason `PatientAccessRepository` caches nothing (ADR 0017): a consent
   * revoked a second ago has to be gone at once, and a copy with a time to
   * live is exactly the thing that ignores it.
   *
   * The order is not specified here — the domain sorts it
   * (`consentsInForceOrder`), because the order is the product's and not an
   * index's.
   *
   * @param profileId `identity.profile.id` of the patient — ours, never the
   *   Supabase user id
   */
  findInForce(profileId: string): Promise<readonly ConsentInForce[]>;

  /**
   * Writes one consent and answers what is in force for that purpose
   * afterwards.
   *
   * **Idempotent, and decided by the database.** The partial unique index on
   * the consents in force is what refuses a second row, so two requests
   * arriving at the same instant produce one consent and both get the same
   * answer — which is why this answers the row rather than nothing: the one
   * that lost the race must still be told the date and the version that
   * actually hold, and they are the winner's.
   */
  grant(profileId: string, toGrant: ConsentToGrant): Promise<ConsentInForce>;

  /**
   * Dates the rows of these purposes, **in one transaction**, and answers the
   * ones it really wrote.
   *
   * A set and not one purpose, because of the cascade of `health_data`
   * (`consentsToRevoke`): either every purpose it takes down is revoked or
   * none is, so a patient cannot end up having revoked the foundation and kept
   * the AI processing on.
   *
   * **It never deletes and never rewrites.** The update sets `revoked_at` on
   * the rows that still have none, which is the acceptance criterion
   * "revogação nunca apaga o registro original" asked of the database and not
   * of a convention: a purpose somebody else revoked a moment ago keeps the
   * instant it was really revoked at, and simply does not come back in the
   * answer. An empty answer means the whole set was already gone.
   */
  revoke(
    profileId: string,
    types: readonly ConsentType[],
    revokedAt: Date,
  ): Promise<readonly RevokedConsent[]>;
}
