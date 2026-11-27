import { Inject, Injectable } from '@nestjs/common';

import { LoadProfessionalCaller, PatientAccessService } from '../../identity';
import { checkinPeriod, type CheckinsInPeriod } from '../domain/checkin';
import { CHECKIN_REPOSITORY, type CheckinRepository } from './ports/checkin-repository.port';

/**
 * A professional reads a patient's check-ins over a period (card P-02).
 *
 * **Authorization is `identity`'s rule and nothing else**: an active care link
 * **and** the `share_with_professional` consent in force, read at this instant
 * (ADR 0017). It is asked here, inside the use case, even though the route is
 * also behind `@RequiresPatientAccess()` — a guard answers for an HTTP request,
 * and a job or another use case calling this one has no guard (CLAUDE.md,
 * "Saúde e LGPD": use the module's access service, never reimplement it).
 *
 * **Every refusal is a 404**, because the service decided so: a patient this
 * professional may not see answers exactly like a patient who does not exist,
 * so trying ids cannot be used to list the platform's patients. That is the
 * card's third acceptance criterion, and no code in this module repeats it.
 *
 * **The reading is recorded.** It is a professional opening somebody's health
 * data, which CLAUDE.md requires a row for, and the route carries
 * `@RecordsPatientAccess('patient_checkins', 'view')` for it — its own resource
 * and not the ficha's, so the patient's list says what really happened.
 *
 * **Nothing is logged** — not the patient, not the period, not a value
 * (CLAUDE.md, "Saúde e LGPD"). The refusal itself is logged by the access
 * service, as ids and a reason code.
 */
@Injectable()
export class ListPatientCheckinsUseCase {
  constructor(
    private readonly callers: LoadProfessionalCaller,
    private readonly access: PatientAccessService,
    @Inject(CHECKIN_REPOSITORY) private readonly checkins: CheckinRepository,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token, of the
   *   professional asking
   * @param patientId `identity.profile.id` of the patient
   * @param from first day of the period, included
   * @param to last day of the period, included
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotProfessionalError when the account is a patient's (403)
   * @throws PatientNotFoundError on any refusal of the access rule (404)
   * @throws InvalidCheckinDateError, InvalidCheckinPeriodError or
   *   CheckinPeriodTooLongError when the period is not one (400)
   */
  async execute(
    authUserId: string,
    patientId: string,
    from: string,
    to: string,
  ): Promise<CheckinsInPeriod> {
    // The profile id and not the practice: the rule reads the links of every
    // practice the professional belongs to, so a clinic member in two of them
    // is a fine caller here.
    const professionalId = await this.callers.professionalProfileId(authUserId);

    await this.access.assertCanAccessPatient(professionalId, patientId);

    const period = checkinPeriod(from, to);

    return { period, checkins: await this.checkins.findInPeriod(patientId, period) };
  }
}
