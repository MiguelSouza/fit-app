import { Inject, Injectable } from '@nestjs/common';

import { EVENT_BUS, type EventBusPort } from '../../../shared/events/event-bus.port';
import {
  decideCareRelationshipToEnd,
  type CareRelationship,
  type EndCareRelationshipRefusal,
  type EndedCareRelationship,
} from '../domain/care-relationship';
import {
  CareRelationshipAlreadyEndedError,
  CareRelationshipNotFoundError,
  PatientNotFoundError,
} from '../domain/identity-errors';
import { type PersonRole } from '../domain/person';
import { LoadPatientCaller } from './load-patient-caller';
import { LoadProfessionalCaller } from './load-professional-caller';
import {
  CARE_RELATIONSHIP_REPOSITORY,
  type CareRelationshipRepository,
} from './ports/care-relationship.port';

/**
 * Ending the follow-up, from either side (card I-07).
 *
 * **One use case with two entry points, and not two use cases.** What differs
 * between the patient leaving and the practice letting a patient go is who may
 * ask and how a refusal is worded; what happens afterwards — the row dated, the
 * access gone, the event announced — is one thing, and it must stay one thing.
 * Two classes would be two places for it, and the second would be the one that
 * forgets the event.
 *
 * **Nothing is deleted. Ever.** The card's second acceptance criterion is a
 * property of this whole path: the only write is `ended_at` on one row
 * (`CareRelationshipRepository` offers no delete), and the patient's profile,
 * their consents, their check-ins and their measurements are not touched. The
 * patient keeps their history because it was always theirs — the link is the
 * record of who was allowed to look at it, not the owner of it.
 *
 * **The access is cut off by the row and not by this use case.** The access rule
 * reads the link at the instant of the request and caches nothing (ADR 0017),
 * so the request right after this one already answers 404 — which is the card's
 * first acceptance criterion, and it holds without any subscriber being trusted
 * and without anything being invalidated.
 *
 * **What the other modules do about it is theirs**, and they hear it as
 * `identity.relationship.ended`: `nutrition` archives the plans that practice
 * had in force for this patient, `insights` stops producing alerts for it. They
 * are not called from here — this module knows nothing about a plan — and a
 * handler that fails is a log line and not a follow-up left half ended
 * (`InMemoryEventBus`, ADR 0009).
 *
 * **Nothing is logged here.** Who stopped following whom is personal data about
 * somebody's health care on both sides (CLAUDE.md, "Saúde e LGPD"); the event
 * carries ids, a role and an instant, which is what a payload may carry.
 *
 * **And nothing is written to the access log.** `identity.logAccess` records
 * opening a chart or exporting data (card I-06); ending a link is neither —
 * nothing of the patient's was read — and a row there would say the
 * professional saw something they did not.
 */
@Injectable()
export class EndCareRelationshipUseCase {
  constructor(
    private readonly professionals: LoadProfessionalCaller,
    private readonly patients: LoadPatientCaller,
    @Inject(CARE_RELATIONSHIP_REPOSITORY)
    private readonly relationships: CareRelationshipRepository,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
  ) {}

  /**
   * The practice lets a patient go.
   *
   * **Authorization.** The caller is a professional, and the link is looked up
   * among the practices they belong to: a patient of somebody else's practice
   * is answered as a patient that is not there, exactly as the access rule
   * answers (ADR 0017), so this route is no oracle for patient ids either.
   *
   * It deliberately does **not** require the `share_with_professional` consent,
   * which is the one difference from every other professional route of this
   * platform and the reason this use case does not sit behind
   * `@RequiresPatientAccess()`. A patient who revoked that consent leaves an
   * active link behind — the consent and the link are different records (ADR
   * 0018) — and the practice has to be able to close its own side of it.
   * Nothing of the patient's is read here, so there is nothing for the consent
   * to protect.
   *
   * `professionalProfileId` and not `execute`: the link belongs to the practice
   * (ADR 0015) and the repository joins through every membership the
   * professional has, so a clinic member who belongs to two is a perfectly good
   * caller here — resolving the one practice an invitation needs would make
   * them a 500 instead.
   *
   * @param authUserId the `sub` of the verified access token
   * @param patientProfileId `identity.profile.id` of the patient
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotProfessionalError when the account is a patient's (403)
   * @throws PatientNotFoundError when no practice of theirs ever followed this
   *   patient (404 — and never 403, which would confirm the id)
   * @throws CareRelationshipAlreadyEndedError when the follow-up is over (409)
   */
  async byProfessional(
    authUserId: string,
    patientProfileId: string,
  ): Promise<EndedCareRelationship> {
    const professionalProfileId = await this.professionals.professionalProfileId(authUserId);

    const found = await this.relationships.findOfProfessional(
      professionalProfileId,
      patientProfileId,
    );

    return this.end(found, 'professional', () => new PatientNotFoundError());
  }

  /**
   * The patient leaves the practice.
   *
   * **Authorization.** Only the patient themselves, as with their consents
   * (card I-05): the link is looked up by id **and** by the caller's profile,
   * so another patient's id is not found rather than refused. Nothing a
   * professional holds can stop it, and no consent is needed — a patient who
   * has revoked everything is precisely the one who comes to end the
   * follow-up.
   *
   * @param authUserId the `sub` of the verified access token
   * @param careRelationshipId the link the patient is ending, as the acceptance
   *   of the invitation answered it
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotPatientError when the account is a professional's (403)
   * @throws CareRelationshipNotFoundError when that link is not theirs (404)
   * @throws CareRelationshipAlreadyEndedError when the follow-up is over (409)
   */
  async byPatient(authUserId: string, careRelationshipId: string): Promise<EndedCareRelationship> {
    const patientProfileId = await this.patients.patientProfileId(authUserId);

    const found = await this.relationships.findOfPatient(patientProfileId, careRelationshipId);

    // A list of one, or none: the domain decides both sides with the same
    // function, and an id that is nobody's is the same answer as an id that is
    // somebody else's.
    return this.end(
      found === undefined ? [] : [found],
      'patient',
      () => new CareRelationshipNotFoundError(),
    );
  }

  /**
   * The half both sides share: decide, date the row, announce the fact.
   *
   * @param notFound how this side words "there is no such link", which is the
   *   one thing the two do not answer alike
   */
  private async end(
    found: readonly CareRelationship[],
    endedBy: PersonRole,
    notFound: () => Error,
  ): Promise<EndedCareRelationship> {
    const decision = decideCareRelationshipToEnd(found);

    if (!decision.canEnd) throw this.refusal(decision.refusal, notFound);

    const ended = await this.relationships.end(decision.relationship.id, new Date());

    // Nothing was written, having just been read as active: the other side —
    // or another request of this one — ended it in between. The answer is the
    // same as above, because by now that is what it is.
    if (ended === undefined) throw new CareRelationshipAlreadyEndedError();

    // After the write and not before: an event is a fact that already happened
    // (CLAUDE.md rule 3), and a plan archived over a link that failed to be
    // dated would be a plan nobody asked to archive.
    await this.events.publish('identity.relationship.ended', {
      careRelationshipId: ended.id,
      organizationId: ended.organizationId,
      patientId: ended.patientProfileId,
      endedBy,
      endedAt: ended.endedAt.toISOString(),
    });

    return ended;
  }

  private refusal(refusal: EndCareRelationshipRefusal, notFound: () => Error): Error {
    return refusal === 'already_ended' ? new CareRelationshipAlreadyEndedError() : notFound();
  }
}
