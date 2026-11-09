import { Inject, Injectable } from '@nestjs/common';

import { EVENT_BUS, type EventBusPort } from '../../../shared/events/event-bus.port';
import { consentsToRevoke, type ConsentType, type RevokedConsent } from '../domain/consent';
import { ConsentNotInForceError } from '../domain/identity-errors';
import { LoadPatientCaller } from './load-patient-caller';
import { CONSENT_REPOSITORY, type ConsentRepository } from './ports/consent-repository.port';

/**
 * The patient takes one purpose back (card I-05).
 *
 * **Authorization.** Only the patient themselves, as in `GrantConsentUseCase`.
 * A professional cannot revoke on somebody's behalf, and — just as important —
 * nothing a professional holds can stop a revocation: the request needs no
 * link, no practice and no `share_with_professional`, which is the consent it
 * may well be taking away.
 *
 * **The original record is never touched.** Revoking sets `revoked_at` on the
 * row that is there and keeps `granted_at` and `terms_version` as they were
 * (ADR 0016), which is the card's first acceptance criterion. Nothing in this
 * module deletes a consent, ever.
 *
 * **Revoking `health_data` ends the use of the app**, and that is one
 * transaction: every purpose in force goes with it, because each of the others
 * is something done *to* data the platform may no longer keep
 * (`consentsToRevoke`). What it does **not** do is end the care relationship
 * or erase anything — the link is the audit trail of why a practice ever saw
 * this patient, and the access rule already answers no the instant
 * `share_with_professional` stops being in force (ADR 0017).
 *
 * **The access of the professional is cut off without this use case being
 * trusted.** It publishes `identity.consent.revoked` so the other modules can
 * stop what they were doing — the wearable sync, the AI summaries — but no
 * subscriber stands between a revocation and the refusal: the access rule
 * reads the row at the instant of the request and caches nothing (CLAUDE.md,
 * "Saúde e LGPD": "revogar consentimento corta o acesso na hora"). A handler
 * that fails is a log line and not a patient left exposed.
 *
 * **Nothing is logged here.** Which purposes somebody revoked is personal data
 * about their health; the event carries the profile id and the purpose code,
 * which is what a payload is allowed to carry.
 */
@Injectable()
export class RevokeConsentUseCase {
  constructor(
    private readonly caller: LoadPatientCaller,
    @Inject(CONSENT_REPOSITORY) private readonly consents: ConsentRepository,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @param type the purpose the patient is revoking
   * @returns every consent this revocation ended, with both instants on it —
   *   one purpose, or all of them when `health_data` goes
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotPatientError when the account is a professional's (403)
   * @throws ConsentNotInForceError when that purpose is not in force (409),
   *   including the race where another request revoked it in between
   */
  async execute(authUserId: string, type: ConsentType): Promise<readonly RevokedConsent[]> {
    const profileId = await this.caller.patientProfileId(authUserId);

    const inForce = await this.consents.findInForce(profileId);

    // The cascade of `health_data` is decided here, in the domain, and written
    // as one transaction below: revoking the foundation and keeping a purpose
    // built on it is a state nobody should be able to reach.
    const types = consentsToRevoke(
      type,
      inForce.map((consent) => consent.type),
    );

    const revoked = await this.consents.revoke(profileId, types, new Date());

    // The write found nothing left to date: between the read above and the
    // update, another request of the same patient revoked it. The answer is
    // the same as asking for a purpose that was never in force, because by now
    // that is what it is.
    if (revoked.length === 0) throw new ConsentNotInForceError();

    await this.announce(profileId, revoked);

    return revoked;
  }

  /**
   * One event per purpose, so a handler reads the purpose it cares about and
   * never has to know about the cascade.
   *
   * Published **after** the transaction and in the order the purposes were
   * revoked in: an event is a fact that already happened (CLAUDE.md rule 3),
   * and announcing one before the row is committed would have a handler react
   * to a revocation a rollback could still undo. `publish` waits for the
   * handlers and swallows their failures (`InMemoryEventBus`), so a module
   * that breaks does not break the revocation.
   */
  private async announce(profileId: string, revoked: readonly RevokedConsent[]): Promise<void> {
    for (const consent of revoked) {
      await this.events.publish('identity.consent.revoked', {
        profileId,
        consentType: consent.type,
        revokedAt: consent.revokedAt.toISOString(),
      });
    }
  }
}
