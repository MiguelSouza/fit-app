import { Inject, Injectable, Logger } from '@nestjs/common';

import { MealPlanRequiresNutritionistError, PatientNotFoundError } from '../domain/identity-errors';
import {
  decideMealPlanEdit,
  decidePatientAccess,
  type MealPlanEditRefusal,
} from '../domain/patient-access';
import {
  PATIENT_ACCESS_REPOSITORY,
  type PatientAccessRepository,
} from './ports/patient-access.port';

/**
 * The access service of `identity`: the one answer in the platform to "pode
 * este profissional ver este paciente?" (card I-04).
 *
 * Every module calls this and **nobody reimplements it**, which is what
 * CLAUDE.md requires under "Saúde e LGPD". It leaves the module through
 * `index.ts`, so a use case in `nutrition`, `health` or `insights` injects this
 * class and gets the whole rule — the active link, the consent in force, and a
 * refusal that does not leak whether the patient exists.
 *
 * Two shapes of the same question, on purpose:
 *
 * - `canAccessPatient` / `canEditMealPlan` answer a boolean, for code that has
 *   to decide something rather than refuse — hiding a button, filtering a list.
 * - `assertCanAccessPatient` / `assertCanEditMealPlan` throw the domain error,
 *   which is what a use case wants on its first line: one call, and the HTTP
 *   status is already decided in the one place that maps it
 *   (`global-exception.filter.ts`).
 *
 * **It reads, it does not record.** Logging the opening of a chart
 * (`identity.logAccess`, CLAUDE.md) is the access log, which is another table
 * and another card; an authorization check also runs on requests that are not
 * the opening of a chart, so the two are not the same event and this is not
 * the place to conflate them.
 */
@Injectable()
export class PatientAccessService {
  /**
   * What a refusal is allowed to say: the two ids and the reason code
   * (CLAUDE.md, "Saúde e LGPD" — ids e códigos, nunca dado pessoal). No name,
   * no practice, nothing about the patient.
   *
   * `warn` and not `debug`: a professional asking for a patient they may not
   * see is either a bug in a client or somebody trying, and both are worth
   * finding in CloudWatch. It stays rare, because the panel does not ask for
   * charts the professional has no link to.
   */
  private readonly logger = new Logger('PatientAccess');

  constructor(
    @Inject(PATIENT_ACCESS_REPOSITORY) private readonly repository: PatientAccessRepository,
  ) {}

  /**
   * Whether the professional may read this patient: active link **and**
   * `share_with_professional` in force, both read at this instant.
   *
   * @param professionalId `identity.profile.id` of the professional
   * @param patientId `identity.profile.id` of the patient
   */
  async canAccessPatient(professionalId: string, patientId: string): Promise<boolean> {
    const decision = decidePatientAccess(
      await this.repository.findFacts(professionalId, patientId),
    );

    if (!decision.granted) this.refused(professionalId, patientId, decision.refusal);

    return decision.granted;
  }

  /**
   * The same check, as the first line of a use case.
   *
   * @throws PatientNotFoundError on any refusal — 404 and never 403, so that a
   *   caller cannot tell a patient they may not see from a patient that is not
   *   there (the acceptance criterion of the card)
   */
  async assertCanAccessPatient(professionalId: string, patientId: string): Promise<void> {
    if (!(await this.canAccessPatient(professionalId, patientId))) throw new PatientNotFoundError();
  }

  /**
   * Whether the professional may write this patient's meal plan: the access
   * above **and** `professional_type = nutritionist` (CLAUDE.md, "Saúde e
   * LGPD" — the type, not the generic role).
   */
  async canEditMealPlan(professionalId: string, patientId: string): Promise<boolean> {
    const decision = decideMealPlanEdit(await this.repository.findFacts(professionalId, patientId));

    if (!decision.granted) this.refused(professionalId, patientId, decision.refusal);

    return decision.granted;
  }

  /**
   * The meal plan check, as the first line of a use case that prescribes.
   *
   * The two refusals are not the same answer, and the difference is the whole
   * reason this method exists instead of a boolean every caller translates on
   * its own:
   *
   * @throws PatientNotFoundError when the caller has no access at all — 404,
   *   as above
   * @throws MealPlanRequiresNutritionistError when they do have access and are
   *   not a nutritionist — 403, because somebody who already sees the patient
   *   is only being told what their licence does not cover
   */
  async assertCanEditMealPlan(professionalId: string, patientId: string): Promise<void> {
    const decision = decideMealPlanEdit(await this.repository.findFacts(professionalId, patientId));

    if (decision.granted) return;

    this.refused(professionalId, patientId, decision.refusal);

    if (decision.refusal === 'not_a_nutritionist') throw new MealPlanRequiresNutritionistError();

    throw new PatientNotFoundError();
  }

  private refused(professionalId: string, patientId: string, refusal: MealPlanEditRefusal): void {
    this.logger.warn(
      `patient access refused (reason=${refusal} professional=${professionalId} patient=${patientId})`,
    );
  }
}
