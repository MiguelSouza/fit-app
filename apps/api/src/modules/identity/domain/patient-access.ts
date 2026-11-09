import { isActiveCareRelationship, type CareRelationship } from './care-relationship';
import { type ConsentType } from './consent';
import { type ProfessionalType } from './person';

/**
 * The most important rule of the platform, as a pure function: a professional
 * reaches a patient only with an **active care link** and the
 * `share_with_professional` consent **in force** (CLAUDE.md, "Saúde e LGPD").
 *
 * Pure: no NestJS, no Drizzle, no I/O (CLAUDE.md rule 4). The facts come from
 * the repository behind `PatientAccessRepository`; the decision is here, in one
 * place, with unit tests on it — which is the other half of "ninguém
 * reimplementa": a rule nobody can reimplement is a rule that is a function,
 * not four lines copied into every use case.
 *
 * What is **not** here is the answer to "what does a refusal look like over
 * HTTP". A refusal is a 404 and never a 403, so that a professional cannot
 * learn that a patient id exists by being told they may not see it, and that
 * translation lives in `PatientAccessService` and in the error it throws.
 */

/** The purpose a professional has to hold to read a patient at all. */
export const SHARE_WITH_PROFESSIONAL: ConsentType = 'share_with_professional';

/**
 * Why access was refused. Codes, never messages: they go to a log line beside
 * the two ids, which is all a refusal is allowed to say (CLAUDE.md, "Saúde e
 * LGPD" — ids e códigos).
 *
 * Every one of them answers the same thing to the caller. They exist so that
 * whoever reads the log can tell "este paciente não é desta clínica" from "o
 * paciente revogou o consentimento", which are the same 404 and very different
 * conversations.
 */
export type PatientAccessRefusal =
  | 'not_a_professional'
  | 'no_care_relationship'
  | 'care_relationship_ended'
  | 'consent_not_in_force';

/** Refusing a meal plan edit adds one reason to the four above. */
export type MealPlanEditRefusal = PatientAccessRefusal | 'not_a_nutritionist';

/**
 * What the database answers about one professional and one patient.
 *
 * `careRelationships` is a list and not a single link because the question is
 * asked of the **professional**, and the link belongs to the practice (ADR
 * 0015): what comes back is every link between a practice this professional
 * belongs to and this patient. Today that is one row at most, since a
 * professional belongs to exactly one practice (ADR 0014); when a clinic has
 * members in two, deciding which of the links counts is this file's job and not
 * a repository's `order by`.
 */
export interface PatientAccessFacts {
  /** `null` when that id is nobody's professional profile. */
  readonly professionalType: ProfessionalType | null;
  /** The links between this professional's practices and this patient. */
  readonly careRelationships: readonly CareRelationship[];
  /**
   * Whether the patient's `share_with_professional` consent is in force — one
   * row, not revoked (`identity.consent`).
   *
   * It belongs to the patient and not to the pair, deliberately: the consent is
   * given to the platform sharing their data with their professional, and which
   * practice that is, is what the link says. So a consent in force plus a link
   * of **another** practice is a refusal, and it is the two conditions together
   * that make it one.
   */
  readonly shareWithProfessionalInForce: boolean;
}

/** Granted, with what the professional is licensed as; or refused, with why. */
export type PatientAccessDecision =
  | { readonly granted: true; readonly professionalType: ProfessionalType }
  | { readonly granted: false; readonly refusal: PatientAccessRefusal };

/** The same shape for the meal plan, which has one more way of being refused. */
export type MealPlanEditDecision =
  { readonly granted: true } | { readonly granted: false; readonly refusal: MealPlanEditRefusal };

/**
 * Whether this professional may read this patient.
 *
 * The three conditions are checked in the order that makes the log line most
 * useful — no link at all, a link that ended, a consent that is not in force —
 * and the first failure is the answer. Nothing is cached anywhere: the facts
 * are read at the instant of the request, which is what makes "revogar
 * consentimento corta o acesso na hora" true without any invalidation
 * (CLAUDE.md, "Saúde e LGPD").
 */
export function decidePatientAccess(facts: PatientAccessFacts): PatientAccessDecision {
  if (facts.professionalType === null) return { granted: false, refusal: 'not_a_professional' };

  if (facts.careRelationships.length === 0) {
    return { granted: false, refusal: 'no_care_relationship' };
  }

  if (!facts.careRelationships.some(isActiveCareRelationship)) {
    return { granted: false, refusal: 'care_relationship_ended' };
  }

  if (!facts.shareWithProfessionalInForce) {
    return { granted: false, refusal: 'consent_not_in_force' };
  }

  return { granted: true, professionalType: facts.professionalType };
}

/**
 * Whether this professional may write this patient's meal plan: the access
 * above **and** being a nutritionist.
 *
 * `professional_type` and not the generic role, as CLAUDE.md requires under
 * "Saúde e LGPD": a personal trainer of the same practice has every right to
 * see the patient and none to prescribe their food. The two refusals are kept
 * apart because they are not the same answer — somebody who may not see the
 * patient must not learn that they exist, and somebody who already sees them
 * is simply being told what their licence does not cover.
 */
export function decideMealPlanEdit(facts: PatientAccessFacts): MealPlanEditDecision {
  const access = decidePatientAccess(facts);

  if (!access.granted) return access;

  if (access.professionalType !== 'nutritionist') {
    return { granted: false, refusal: 'not_a_nutritionist' };
  }

  return { granted: true };
}
