import { Inject, Injectable } from '@nestjs/common';

import { consentToGrant, type ConsentInForce, type ConsentType } from '../domain/consent';
import { LoadPatientCaller } from './load-patient-caller';
import { CONSENT_REPOSITORY, type ConsentRepository } from './ports/consent-repository.port';

/**
 * The patient gives one purpose (card I-05).
 *
 * **Authorization.** Only the patient themselves, resolved from the `sub` of
 * the verified token (ADR 0007). Consent under LGPD is personal: there is no
 * "on behalf of" here, and no professional can tick a box for a patient — a
 * platform where they could would have no consent at all, only a record of
 * somebody else's click.
 *
 * **Idempotent.** A purpose already in force writes nothing and answers the
 * consent that is really there, with the date and the version of the terms it
 * was given against. That is what makes a double tap and a retry harmless, and
 * it is also what keeps the record honest: giving a consent again does not
 * reset the day the patient agreed, nor move it onto today's terms.
 *
 * **It does not undo a revocation.** The revoked row stays where it is, dated,
 * and this writes a **new** row — which is what makes the history of "deu,
 * tirou e deu de novo" readable a year later, and what the acceptance
 * criterion "revogação nunca apaga o registro original" rests on from the
 * other side.
 *
 * **No event.** Granting a consent widens what the platform may do, and
 * nothing has to be stopped in a hurry: whoever cares reads the consent at the
 * instant they need it, as the access rule does (ADR 0017). The revocation is
 * the one that is announced, because that one is permission being withdrawn.
 *
 * **Nothing is logged.** Which purposes somebody consented to is personal data
 * (CLAUDE.md, "Saúde e LGPD").
 */
@Injectable()
export class GrantConsentUseCase {
  constructor(
    private readonly caller: LoadPatientCaller,
    @Inject(CONSENT_REPOSITORY) private readonly consents: ConsentRepository,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @param type the purpose the patient is consenting to
   * @returns the consent in force for that purpose afterwards
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotPatientError when the account is a professional's (403)
   * @throws HealthDataConsentRequiredError when the purpose rests on
   *   `health_data` and that one is not in force (422)
   */
  async execute(authUserId: string, type: ConsentType): Promise<ConsentInForce> {
    const profileId = await this.caller.patientProfileId(authUserId);

    const inForce = await this.consents.findInForce(profileId);
    const toGrant = consentToGrant(
      type,
      inForce.map((consent) => consent.type),
      new Date(),
    );

    // Already in force: nothing to write, and the answer is the row that is
    // there — not the one this request would have written.
    if (toGrant === undefined) {
      const existing = inForce.find((consent) => consent.type === type);

      if (existing === undefined) {
        // Unreachable: the domain answered `undefined` because the purpose is
        // in the list this very line searches.
        throw new Error('the consent read as in force was not in the list it came from');
      }

      return existing;
    }

    // The database decides a race, through the partial unique index on the
    // consents in force: two requests of the same purpose produce one row, and
    // both callers are answered the one that holds.
    return this.consents.grant(profileId, toGrant);
  }
}
