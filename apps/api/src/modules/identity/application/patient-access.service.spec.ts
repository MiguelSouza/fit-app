import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { MealPlanRequiresNutritionistError, PatientNotFoundError } from '../domain/identity-errors';
import { InMemoryPatientAccessRepository } from './in-memory-patient-access.spec-support';
import { PatientAccessService } from './patient-access.service';

/**
 * The access service, over the fake facts: the five cases of the card and the
 * personal trainer who may see a patient and may not feed them.
 *
 * What this suite is about is the **answer** — a boolean, or which error —
 * since the decision itself is already pinned in `domain/patient-access.spec.
 * ts`. That the same five hold against real SQL is
 * `patient-access.service.integration-spec.ts`, and that the refusal reaches
 * the client as a 404 is `presentation/patient-access.guard.spec.ts`.
 *
 * No data of a real person: every id is random and nothing here has a name
 * (CLAUDE.md, "Testes").
 */
describe('the patient access service', () => {
  let facts: InMemoryPatientAccessRepository;
  let access: PatientAccessService;
  const warnings: string[] = [];

  /**
   * A refused access is a warning on purpose, and most of this suite is
   * refusals: collected here instead of printed, so the output stays readable
   * and so one of the tests can say what the line is allowed to carry.
   *
   * `Logger.overrideLogger` and not a mock: the tests of this repository run as
   * ES modules, where the `jest` object is not a global, and Nest's own seam
   * does the job without one. It is set once for this file, which jest loads in
   * a registry of its own.
   */
  beforeAll(() => {
    Logger.overrideLogger({
      log: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      verbose: () => undefined,
      warn: (message: unknown) => {
        warnings.push(String(message));
      },
    });
  });

  beforeEach(() => {
    facts = new InMemoryPatientAccessRepository();
    access = new PatientAccessService(facts);
    warnings.length = 0;
  });

  /** A patient of a practice, with the sharing consent in force. */
  function aFollowedPatient(organizationId: string): string {
    const patientId = randomUUID();

    facts.addCareRelationship(organizationId, patientId);
    facts.grant(patientId);

    return patientId;
  }

  it('lets a professional with an active link and the consent in force through', async () => {
    const professional = facts.addProfessional();
    const patientId = aFollowedPatient(professional.organizationId);

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(true);
    await expect(
      access.assertCanAccessPatient(professional.profileId, patientId),
    ).resolves.toBeUndefined();
  });

  it('refuses a patient the professional has no link to, with a 404', async () => {
    const professional = facts.addProfessional();
    const patientId = randomUUID();

    facts.grant(patientId);

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(false);
    await expect(access.assertCanAccessPatient(professional.profileId, patientId)).rejects.toThrow(
      PatientNotFoundError,
    );
  });

  it('refuses a link that was ended', async () => {
    const professional = facts.addProfessional();
    const patientId = randomUUID();

    facts.addCareRelationship(
      professional.organizationId,
      patientId,
      new Date('2026-11-01T12:00:00Z'),
    );
    facts.grant(patientId);

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(false);
  });

  it('refuses an active link once the patient revokes the consent', async () => {
    const professional = facts.addProfessional();
    const patientId = aFollowedPatient(professional.organizationId);

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(true);

    // "Revogar consentimento corta o acesso na hora" (CLAUDE.md): no cache to
    // invalidate, the next question reads the facts again.
    facts.revoke(patientId);

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(false);
    expect(facts.reads).toBe(2);
  });

  it('refuses the professional of another practice, consent in force and all', async () => {
    // The card's "consentimento de outro profissional": the patient consented
    // and is followed by somebody else. The consent is the patient's, the link
    // is what says whose patient they are, and this professional has none.
    const theirs = facts.addProfessional();
    const stranger = facts.addProfessional();
    const patientId = aFollowedPatient(theirs.organizationId);

    await expect(access.canAccessPatient(theirs.profileId, patientId)).resolves.toBe(true);
    await expect(access.canAccessPatient(stranger.profileId, patientId)).resolves.toBe(false);
    await expect(access.assertCanAccessPatient(stranger.profileId, patientId)).rejects.toThrow(
      PatientNotFoundError,
    );
  });

  it('refuses an id that is not a professional', async () => {
    await expect(access.canAccessPatient(randomUUID(), randomUUID())).resolves.toBe(false);
  });

  it('logs a refusal as the two ids and a reason code, and nothing else', async () => {
    // CLAUDE.md, "Saúde e LGPD": ids e códigos. A log line about a refused
    // access must not carry a name, a practice or anything the patient wrote.
    const professional = facts.addProfessional();
    const patientId = randomUUID();

    await access.canAccessPatient(professional.profileId, patientId);

    expect(warnings).toEqual([
      `patient access refused (reason=no_care_relationship ` +
        `professional=${professional.profileId} patient=${patientId})`,
    ]);
  });

  describe('editing a meal plan', () => {
    it('lets a nutritionist with access through', async () => {
      const nutritionist = facts.addProfessional({ type: 'nutritionist' });
      const patientId = aFollowedPatient(nutritionist.organizationId);

      await expect(access.canEditMealPlan(nutritionist.profileId, patientId)).resolves.toBe(true);
      await expect(
        access.assertCanEditMealPlan(nutritionist.profileId, patientId),
      ).resolves.toBeUndefined();
    });

    it('refuses a personal trainer who does have access to the patient', async () => {
      // The acceptance criterion of the card. The trainer is of the same
      // practice, with the same active link and the same consent: what stops
      // them is `professional_type`.
      const trainer = facts.addProfessional({ type: 'trainer' });
      const patientId = aFollowedPatient(trainer.organizationId);

      await expect(access.canAccessPatient(trainer.profileId, patientId)).resolves.toBe(true);
      await expect(access.canEditMealPlan(trainer.profileId, patientId)).resolves.toBe(false);

      // 403 and not 404: they already see the patient, so there is nothing
      // left to hide — they are told what their licence does not cover.
      await expect(access.assertCanEditMealPlan(trainer.profileId, patientId)).rejects.toThrow(
        MealPlanRequiresNutritionistError,
      );
    });

    it('answers 404 to a nutritionist with no access, never the licence error', async () => {
      const nutritionist = facts.addProfessional({ type: 'nutritionist' });
      const patientId = randomUUID();

      facts.grant(patientId);

      await expect(access.canEditMealPlan(nutritionist.profileId, patientId)).resolves.toBe(false);
      await expect(access.assertCanEditMealPlan(nutritionist.profileId, patientId)).rejects.toThrow(
        PatientNotFoundError,
      );
    });
  });
});
