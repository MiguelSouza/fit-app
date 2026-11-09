import { Inject, Injectable } from '@nestjs/common';

import { consentsInPurposeOrder, type ConsentInForce } from '../domain/consent';
import { LoadPatientCaller } from './load-patient-caller';
import { CONSENT_REPOSITORY, type ConsentRepository } from './ports/consent-repository.port';

/**
 * `GET /v1/me/consents`: what the platform may do with this patient's data
 * right now (card I-05).
 *
 * **Authorization.** The subject is the caller themselves, resolved from the
 * `sub` of the verified token (ADR 0007) and never from a field of the
 * request: there is no patient id to send, so there is nothing to try. A
 * professional calling it gets 403 — what a professional may see about a
 * patient goes through the access rule and the access log, which is the chart
 * and not this route.
 *
 * **What is in force, and only that.** The revoked rows stay in the table
 * forever and are the platform's audit trail, not a screen the patient asked
 * for. Nothing is cached, here or anywhere behind it: the answer is what the
 * rows say at this instant (CLAUDE.md, "Saúde e LGPD").
 *
 * **Nothing is logged.** Which purposes somebody consented to is personal data
 * about their health, so there is no log line in this file at all.
 */
@Injectable()
export class ListMyConsentsUseCase {
  constructor(
    private readonly caller: LoadPatientCaller,
    @Inject(CONSENT_REPOSITORY) private readonly consents: ConsentRepository,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotPatientError when the account is a professional's (403)
   */
  async execute(authUserId: string): Promise<readonly ConsentInForce[]> {
    const profileId = await this.caller.patientProfileId(authUserId);

    return consentsInPurposeOrder(await this.consents.findInForce(profileId));
  }
}
