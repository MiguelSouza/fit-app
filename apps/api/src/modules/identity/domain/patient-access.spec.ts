import { randomUUID } from 'node:crypto';

import { type CareRelationship } from './care-relationship';
import { decideMealPlanEdit, decidePatientAccess, type PatientAccessFacts } from './patient-access';
import { type ProfessionalType } from './person';

/**
 * The rule the whole platform leans on, tested where it is decided: an active
 * link **and** the `share_with_professional` consent in force (CLAUDE.md,
 * "Saúde e LGPD").
 *
 * These are the five cases of the card, one per test, on the pure function —
 * so they run in milliseconds and say which condition refused. That the same
 * five hold over real SQL is
 * `application/patient-access.service.integration-spec.ts`, and that a refusal
 * comes out as a 404 is `presentation/patient-access.guard.spec.ts`.
 *
 * No data of a real person: ids are random and nothing here has a name.
 */
const PATIENT_ID = randomUUID();

function link(endedAt: Date | null): CareRelationship {
  return {
    id: randomUUID(),
    organizationId: randomUUID(),
    patientProfileId: PATIENT_ID,
    invitationId: randomUUID(),
    startedAt: new Date('2026-10-01T12:00:00Z'),
    endedAt,
  };
}

function facts(overrides: Partial<PatientAccessFacts> = {}): PatientAccessFacts {
  return {
    professionalType: 'nutritionist',
    careRelationships: [link(null)],
    shareWithProfessionalInForce: true,
    ...overrides,
  };
}

describe('decidePatientAccess', () => {
  it('grants it when the link is active and the consent is in force', () => {
    expect(decidePatientAccess(facts())).toEqual({
      granted: true,
      professionalType: 'nutritionist',
    });
  });

  it('refuses a professional with no link to the patient', () => {
    // The patient belongs to another practice, or to nobody at all, and both
    // get the same answer. It is also the card's "consentimento de outro
    // profissional": the consent is in force here and the link is what is
    // missing, because the consent belongs to the patient and the link is what
    // says whose patient they are. Two professionals and one patient, over
    // real SQL, is the integration spec.
    expect(decidePatientAccess(facts({ careRelationships: [] }))).toEqual({
      granted: false,
      refusal: 'no_care_relationship',
    });
  });

  it('refuses a link that ended, consent or no consent', () => {
    const ended = facts({ careRelationships: [link(new Date('2026-11-01T12:00:00Z'))] });

    expect(decidePatientAccess(ended)).toEqual({
      granted: false,
      refusal: 'care_relationship_ended',
    });
  });

  it('refuses an active link once the consent is revoked', () => {
    // The follow-up is on and the patient took the sharing back: access stops
    // at that instant, with nothing to invalidate, because the consent is read
    // on every request.
    expect(decidePatientAccess(facts({ shareWithProfessionalInForce: false }))).toEqual({
      granted: false,
      refusal: 'consent_not_in_force',
    });
  });

  it('refuses an id that is not a professional profile', () => {
    expect(decidePatientAccess(facts({ professionalType: null }))).toEqual({
      granted: false,
      refusal: 'not_a_professional',
    });
  });

  it('grants it when any of the practices still follows the patient', () => {
    // A professional belongs to one practice today (ADR 0014). The day they
    // belong to two, one active link is enough, and the ended one does not
    // take the access away.
    const both = facts({
      careRelationships: [link(new Date('2026-11-01T12:00:00Z')), link(null)],
    });

    expect(decidePatientAccess(both).granted).toBe(true);
  });
});

describe('decideMealPlanEdit', () => {
  it('lets a nutritionist with access edit the plan', () => {
    expect(decideMealPlanEdit(facts())).toEqual({ granted: true });
  });

  it('refuses a personal trainer who does have access to the patient', () => {
    // The acceptance criterion of the card: the trainer sees the patient and
    // does not prescribe their food. The refusal is its own reason, because
    // this one is a 403 and not a 404.
    const trainer: ProfessionalType = 'trainer';

    expect(decideMealPlanEdit(facts({ professionalType: trainer }))).toEqual({
      granted: false,
      refusal: 'not_a_nutritionist',
    });
  });

  it('refuses a nutritionist without access with the access reason', () => {
    // Not `not_a_nutritionist`: whoever may not see the patient must not be
    // told anything about them, so the access refusal is what comes out.
    expect(decideMealPlanEdit(facts({ careRelationships: [] }))).toEqual({
      granted: false,
      refusal: 'no_care_relationship',
    });
  });
});
