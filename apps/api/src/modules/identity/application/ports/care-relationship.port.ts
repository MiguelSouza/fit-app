import { type CareRelationship, type EndedCareRelationship } from '../../domain/care-relationship';

/**
 * Where the care link is read and where it is ended (card I-07).
 *
 * Like the ports next door it is not an abstraction per table (CLAUDE.md rule
 * 5): it is the three things ending a follow-up does — find the link from the
 * professional's side, find it from the patient's, and date it — and it exists
 * so `application/` holds no Drizzle and so both sides can be driven without a
 * database.
 *
 * **There is no `delete` and there is no "unend".** Ending the follow-up dates
 * the row and nothing else: the link is the audit trail of why a practice ever
 * saw this patient (ADR 0016), the patient's own history stays with the
 * patient, and this port offers no way to remove either — which is the card's
 * acceptance criterion "nenhum dado do paciente é apagado" written as a type.
 * A practice and a patient who start again accept a new invitation, which is a
 * new link with its own `started_at`.
 *
 * The two `find` methods are **not** one method with a flag. They answer two
 * different questions with two different keys — "the links of my practices with
 * this patient" and "this link of mine" — and the authorization of each side
 * is the key itself: a professional cannot name a link of a practice they do
 * not belong to, and a patient cannot name one that is not theirs. That is what
 * makes the refusals structural instead of a check somebody has to remember
 * (CLAUDE.md, "Saúde e LGPD").
 *
 * What only a real Postgres can prove — that the access rule answers 404 on the
 * next request, that nothing was deleted, and that two endings at the same
 * instant date the row once — is
 * `end-care-relationship.use-case.integration-spec.ts` (CLAUDE.md, "Testes").
 */
export const CARE_RELATIONSHIP_REPOSITORY = Symbol('fit-app.identity.careRelationshipRepository');

export interface CareRelationshipRepository {
  /**
   * Every link between a practice this professional belongs to and this
   * patient, **ended ones included**.
   *
   * The ended ones come too on purpose: without them the second request would
   * look like a patient that was never theirs, and the two deserve different
   * answers — "não existe" and "já foi encerrado" (`decideCareRelationshipToEnd`).
   *
   * It never throws for an id that is nobody: a professional id with no row,
   * and a patient id with no link, both come back empty, and whether that is a
   * refusal is the domain's answer.
   *
   * @param professionalProfileId `identity.profile.id` of the professional —
   *   ours, never the Supabase user id
   * @param patientProfileId `identity.profile.id` of the patient
   */
  findOfProfessional(
    professionalProfileId: string,
    patientProfileId: string,
  ): Promise<readonly CareRelationship[]>;

  /**
   * The link with that id, when it is this patient's own — `undefined`
   * otherwise, which covers an id that is nobody's and an id that is another
   * patient's with the same answer.
   *
   * @param patientProfileId `identity.profile.id` of the caller
   * @param careRelationshipId the link the patient is ending
   */
  findOfPatient(
    patientProfileId: string,
    careRelationshipId: string,
  ): Promise<CareRelationship | undefined>;

  /**
   * Dates the link, and answers it as it ended.
   *
   * **Idempotent by the `where`, and that is what decides a race.** The update
   * only touches a row that still has no `ended_at`, so two endings arriving
   * together — the patient's and the professional's — date it once and the
   * second one is answered `undefined`. The use case turns that into the same
   * 409 it would have given had it read the row first, because by then that is
   * what it is.
   *
   * It writes one column. `started_at`, `invitation_id` and the patient's data
   * are left exactly as they were.
   */
  end(careRelationshipId: string, endedAt: Date): Promise<EndedCareRelationship | undefined>;
}
