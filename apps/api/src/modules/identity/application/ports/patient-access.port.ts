import { type PatientAccessFacts } from '../../domain/patient-access';

/**
 * Where the facts the access rule is decided on are read from (card I-04).
 *
 * Like the ports next door it is not an abstraction per table (CLAUDE.md rule
 * 5): it is the one question the rule asks — "what is true about this
 * professional and this patient, right now" — and it exists so
 * `application/` holds no Drizzle and so the service can be driven without a
 * database.
 *
 * **One method, and it reads everything at once.** The alternative — a method
 * per condition, the link here and the consent there — is how a caller ends up
 * checking one of the two, which is the failure mode this whole card exists to
 * close. There is nothing to cache either: a consent revoked a second ago has
 * to cut the access off at once (CLAUDE.md, "Saúde e LGPD"), so the facts are
 * read on every request and never kept.
 *
 * What only a real Postgres can prove — that the link of another practice does
 * not come back, that a revoked consent is not read as in force — is
 * `patient-access.service.integration-spec.ts` (CLAUDE.md, "Testes").
 */
export const PATIENT_ACCESS_REPOSITORY = Symbol('fit-app.identity.patientAccessRepository');

export interface PatientAccessRepository {
  /**
   * The facts about a professional and a patient, at this instant.
   *
   * It never throws for an id that is nobody: a professional id with no row
   * comes back as `professionalType: null`, and a patient id with no row as no
   * link and no consent. Whether that is a refusal is the domain's answer, and
   * the caller is told the same thing either way.
   *
   * @param professionalProfileId `identity.profile.id` of the professional —
   *   ours, never the Supabase user id
   * @param patientProfileId `identity.profile.id` of the patient
   */
  findFacts(professionalProfileId: string, patientProfileId: string): Promise<PatientAccessFacts>;
}
