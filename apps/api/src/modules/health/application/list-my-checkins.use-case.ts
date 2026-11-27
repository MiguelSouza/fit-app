import { Inject, Injectable } from '@nestjs/common';

import { LoadPatientCaller } from '../../identity';
import { checkinPeriod, type CheckinsInPeriod } from '../domain/checkin';
import { CHECKIN_REPOSITORY, type CheckinRepository } from './ports/checkin-repository.port';

/**
 * The patient reads their own check-ins over a period (card P-02).
 *
 * **Authorization.** The caller is the subject, resolved from the verified
 * token through `identity` (ADR 0007): the route is under `me`, there is no id
 * to point at anybody else, and a professional calling it gets 403. A
 * professional reads a patient's check-ins through the other use case, where
 * the access rule and the access log are.
 *
 * **No access record.** "Quem viu os meus dados" is about other people; the
 * patient reading their own history is not an access anybody has to be told
 * about, and `identity`'s log refuses such a row outright (card I-06).
 *
 * **Nothing is logged** (CLAUDE.md, "Saúde e LGPD").
 */
@Injectable()
export class ListMyCheckinsUseCase {
  constructor(
    private readonly callers: LoadPatientCaller,
    @Inject(CHECKIN_REPOSITORY) private readonly checkins: CheckinRepository,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @param from first day of the period, included
   * @param to last day of the period, included
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotPatientError when the account is a professional's (403)
   * @throws InvalidCheckinDateError, InvalidCheckinPeriodError or
   *   CheckinPeriodTooLongError when the period is not one (400)
   */
  async execute(authUserId: string, from: string, to: string): Promise<CheckinsInPeriod> {
    const profileId = await this.callers.patientProfileId(authUserId);
    const period = checkinPeriod(from, to);

    return { period, checkins: await this.checkins.findInPeriod(profileId, period) };
  }
}
