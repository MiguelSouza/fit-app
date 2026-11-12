import { randomUUID } from 'node:crypto';

import { RecordingEventBus } from '../../../shared/events/recording-event-bus.spec-support';
import {
  CallerIsNotPatientError,
  CallerIsNotProfessionalError,
  CareRelationshipAlreadyEndedError,
  CareRelationshipNotFoundError,
  PatientNotFoundError,
  ProfileNotFoundError,
} from '../domain/identity-errors';
import { type RegisteredIdentity } from '../domain/registered-identity';
import { EndCareRelationshipUseCase } from './end-care-relationship.use-case';
import { InMemoryCareRelationshipRepository } from './in-memory-care-relationship.spec-support';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from './in-memory-identity-registry.spec-support';
import { LoadPatientCaller } from './load-patient-caller';
import { LoadProfessionalCaller } from './load-professional-caller';

/**
 * Ending the follow-up from both sides, driven without a database (card I-07).
 *
 * The card's third acceptance criterion — "testes para os dois lados" — is this
 * file and the integration suite next door: here it is the authorization of
 * each side, the refusals each one words differently, and the event going out
 * once; there it is what only a real Postgres can say — the professional's 404
 * on the next request, and that none of the patient's rows went anywhere.
 *
 * No data of a real person: the ids are random and nothing has a name.
 */
const PROFESSIONAL_AUTH_USER_ID = 'auth-user-of-the-professional';
const OTHER_PROFESSIONAL_AUTH_USER_ID = 'auth-user-of-another-professional';
const PATIENT_AUTH_USER_ID = 'auth-user-of-the-patient';

interface Fixture {
  readonly patientProfileId: string;
  readonly organizationId: string;
  readonly careRelationshipId: string;
  readonly relationships: InMemoryCareRelationshipRepository;
  readonly events: RecordingEventBus;
  readonly endCareRelationship: EndCareRelationshipUseCase;
}

/** The one practice a professional belongs to (ADR 0014). */
function practiceOf(identity: RegisteredIdentity): string {
  const [membership] = identity.organizations;

  if (membership === undefined) throw new Error('the double built a professional with no practice');

  return membership.organizationId;
}

/**
 * A practice following a patient, as the acceptance of an invitation leaves
 * things — plus a second practice, whose professional has nothing to do with
 * this patient.
 */
function aFollowedPatient(endedAt: Date | null = null): Fixture {
  const professional = professionalIdentity();
  const otherProfessional = professionalIdentity();
  const patient = patientIdentity();

  const registry = new InMemoryIdentityRegistry({
    [PROFESSIONAL_AUTH_USER_ID]: professional,
    [OTHER_PROFESSIONAL_AUTH_USER_ID]: otherProfessional,
    [PATIENT_AUTH_USER_ID]: patient,
  });

  const relationships = new InMemoryCareRelationshipRepository();

  const organizationId = practiceOf(professional);

  relationships.addProfessional({ profileId: professional.personId, organizationId });
  relationships.addProfessional({
    profileId: otherProfessional.personId,
    organizationId: practiceOf(otherProfessional),
  });

  const link = relationships.addCareRelationship(organizationId, patient.personId, endedAt);

  const events = new RecordingEventBus();

  return {
    patientProfileId: patient.personId,
    organizationId: link.organizationId,
    careRelationshipId: link.id,
    relationships,
    events,
    endCareRelationship: new EndCareRelationshipUseCase(
      new LoadProfessionalCaller(registry),
      new LoadPatientCaller(registry),
      relationships,
      events,
    ),
  };
}

describe('EndCareRelationshipUseCase, from the professional side', () => {
  it('dates the link and answers it, with the date it started untouched', async () => {
    const { endCareRelationship, patientProfileId, careRelationshipId, relationships } =
      aFollowedPatient();
    const [before] = relationships.rows;

    const ended = await endCareRelationship.byProfessional(
      PROFESSIONAL_AUTH_USER_ID,
      patientProfileId,
    );

    expect(ended.id).toBe(careRelationshipId);
    expect(ended.startedAt).toEqual(before?.startedAt);
    expect(ended.endedAt).toBeInstanceOf(Date);
  });

  it('removes nothing: the row stays, dated', async () => {
    // The card's second acceptance criterion, as far as a double can show it.
    const { endCareRelationship, patientProfileId, relationships } = aFollowedPatient();

    await endCareRelationship.byProfessional(PROFESSIONAL_AUTH_USER_ID, patientProfileId);

    expect(relationships.rows).toHaveLength(1);
    expect(relationships.rows[0]?.endedAt).toBeInstanceOf(Date);
  });

  it('publishes identity.relationship.ended with the ids, the side and the instant', async () => {
    const { endCareRelationship, patientProfileId, organizationId, careRelationshipId, events } =
      aFollowedPatient();

    const ended = await endCareRelationship.byProfessional(
      PROFESSIONAL_AUTH_USER_ID,
      patientProfileId,
    );

    expect(events.payloadsOf('identity.relationship.ended')).toEqual([
      {
        careRelationshipId,
        organizationId,
        patientId: patientProfileId,
        endedBy: 'professional',
        endedAt: ended.endedAt.toISOString(),
      },
    ]);
  });

  it('carries no personal data in the payload: ids, a code and an instant', async () => {
    // CLAUDE.md, "Saúde e LGPD": a payload is read by a handler that may log
    // it, enqueue it or send it to a provider.
    const { endCareRelationship, patientProfileId, events } = aFollowedPatient();

    await endCareRelationship.byProfessional(PROFESSIONAL_AUTH_USER_ID, patientProfileId);

    for (const payload of events.payloadsOf('identity.relationship.ended')) {
      expect(Object.keys(payload).sort()).toEqual([
        'careRelationshipId',
        'endedAt',
        'endedBy',
        'organizationId',
        'patientId',
      ]);
    }
  });

  it('answers a patient of another practice as a patient that is not there', async () => {
    // 404 and never 403: a professional must not learn that an id is somebody
    // else's patient (ADR 0017).
    const { endCareRelationship, patientProfileId, events, relationships } = aFollowedPatient();

    await expect(
      endCareRelationship.byProfessional(OTHER_PROFESSIONAL_AUTH_USER_ID, patientProfileId),
    ).rejects.toThrow(PatientNotFoundError);

    expect(relationships.rows[0]?.endedAt).toBeNull();
    expect(events.published).toEqual([]);
  });

  it('answers an id that is nobody as a patient that is not there', async () => {
    const { endCareRelationship } = aFollowedPatient();

    await expect(
      endCareRelationship.byProfessional(PROFESSIONAL_AUTH_USER_ID, randomUUID()),
    ).rejects.toThrow(PatientNotFoundError);
  });

  it('refuses a follow-up that was already ended, and announces nothing', async () => {
    const { endCareRelationship, patientProfileId, events } = aFollowedPatient(
      new Date('2026-11-01T12:00:00.000Z'),
    );

    await expect(
      endCareRelationship.byProfessional(PROFESSIONAL_AUTH_USER_ID, patientProfileId),
    ).rejects.toThrow(CareRelationshipAlreadyEndedError);
    expect(events.published).toEqual([]);
  });

  it('refuses the second ending and keeps the first instant', async () => {
    const { endCareRelationship, patientProfileId, relationships } = aFollowedPatient();

    const first = await endCareRelationship.byProfessional(
      PROFESSIONAL_AUTH_USER_ID,
      patientProfileId,
    );

    await expect(
      endCareRelationship.byProfessional(PROFESSIONAL_AUTH_USER_ID, patientProfileId),
    ).rejects.toThrow(CareRelationshipAlreadyEndedError);
    expect(relationships.rows[0]?.endedAt).toEqual(first.endedAt);
  });

  it('refuses a patient calling the professional side', async () => {
    const { endCareRelationship, patientProfileId } = aFollowedPatient();

    await expect(
      endCareRelationship.byProfessional(PATIENT_AUTH_USER_ID, patientProfileId),
    ).rejects.toThrow(CallerIsNotProfessionalError);
  });

  it('refuses whoever signed in and never finished the first access', async () => {
    const { endCareRelationship, patientProfileId } = aFollowedPatient();

    await expect(
      endCareRelationship.byProfessional('auth-user-with-no-profile', patientProfileId),
    ).rejects.toThrow(ProfileNotFoundError);
  });
});

describe('EndCareRelationshipUseCase, from the patient side', () => {
  it('dates the link the patient names and answers it', async () => {
    const { endCareRelationship, careRelationshipId, relationships } = aFollowedPatient();

    const ended = await endCareRelationship.byPatient(PATIENT_AUTH_USER_ID, careRelationshipId);

    expect(ended.id).toBe(careRelationshipId);
    expect(relationships.rows).toHaveLength(1);
    expect(relationships.rows[0]?.endedAt).toEqual(ended.endedAt);
  });

  it('publishes the same event, with the patient as the side that ended it', async () => {
    const { endCareRelationship, careRelationshipId, organizationId, patientProfileId, events } =
      aFollowedPatient();

    const ended = await endCareRelationship.byPatient(PATIENT_AUTH_USER_ID, careRelationshipId);

    expect(events.payloadsOf('identity.relationship.ended')).toEqual([
      {
        careRelationshipId,
        organizationId,
        patientId: patientProfileId,
        endedBy: 'patient',
        endedAt: ended.endedAt.toISOString(),
      },
    ]);
  });

  it('needs no consent and nothing the professional holds', async () => {
    // The patient who has revoked everything is precisely the one who comes to
    // end the follow-up: there is no consent in this repository at all, and the
    // request goes through.
    const { endCareRelationship, careRelationshipId } = aFollowedPatient();

    await expect(
      endCareRelationship.byPatient(PATIENT_AUTH_USER_ID, careRelationshipId),
    ).resolves.toMatchObject({ id: careRelationshipId });
  });

  it('answers a link of another patient as not found', async () => {
    const { endCareRelationship, relationships } = aFollowedPatient();
    const somebodyElse = relationships.addCareRelationship(randomUUID(), randomUUID());

    await expect(
      endCareRelationship.byPatient(PATIENT_AUTH_USER_ID, somebodyElse.id),
    ).rejects.toThrow(CareRelationshipNotFoundError);
    expect(relationships.rows[1]?.endedAt).toBeNull();
  });

  it('answers an id that is nobody as not found', async () => {
    const { endCareRelationship } = aFollowedPatient();

    await expect(endCareRelationship.byPatient(PATIENT_AUTH_USER_ID, randomUUID())).rejects.toThrow(
      CareRelationshipNotFoundError,
    );
  });

  it('refuses a follow-up that was already ended', async () => {
    const { endCareRelationship, careRelationshipId, events } = aFollowedPatient(
      new Date('2026-11-01T12:00:00.000Z'),
    );

    await expect(
      endCareRelationship.byPatient(PATIENT_AUTH_USER_ID, careRelationshipId),
    ).rejects.toThrow(CareRelationshipAlreadyEndedError);
    expect(events.published).toEqual([]);
  });

  it('refuses a professional calling the patient side', async () => {
    const { endCareRelationship, careRelationshipId } = aFollowedPatient();

    await expect(
      endCareRelationship.byPatient(PROFESSIONAL_AUTH_USER_ID, careRelationshipId),
    ).rejects.toThrow(CallerIsNotPatientError);
  });
});

describe('EndCareRelationshipUseCase, with both sides ending at once', () => {
  it('dates the row once and announces it once', async () => {
    // The `where` of the update is what decides it, here and in Postgres: the
    // one that loses is told the follow-up is already over, and the instant
    // that stands is the winner's.
    const { endCareRelationship, patientProfileId, careRelationshipId, relationships, events } =
      aFollowedPatient();

    const outcomes = await Promise.allSettled([
      endCareRelationship.byProfessional(PROFESSIONAL_AUTH_USER_ID, patientProfileId),
      endCareRelationship.byPatient(PATIENT_AUTH_USER_ID, careRelationshipId),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(relationships.rows).toHaveLength(1);
    expect(events.payloadsOf('identity.relationship.ended')).toHaveLength(1);
  });
});
