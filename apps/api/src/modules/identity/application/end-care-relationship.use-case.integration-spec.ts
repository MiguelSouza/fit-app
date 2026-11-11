import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { RecordingEventBus } from '../../../shared/events/recording-event-bus.spec-support';
import { integrationDatabaseUrl } from '../../../shared/testing/integration-postgres.spec-support';
import { type ConsentType } from '../domain/consent';
import {
  CareRelationshipAlreadyEndedError,
  CareRelationshipNotFoundError,
  PatientNotFoundError,
} from '../domain/identity-errors';
import { CryptoInvitationTokenIssuer } from '../infrastructure/crypto-invitation-token.issuer';
import { DrizzleCareRelationshipRepository } from '../infrastructure/drizzle-care-relationship.repository';
import { DrizzleConsentRepository } from '../infrastructure/drizzle-consent.repository';
import { DrizzleIdentityRegistry } from '../infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationAcceptanceRepository } from '../infrastructure/drizzle-invitation-acceptance.repository';
import { DrizzleInvitationRepository } from '../infrastructure/drizzle-invitation.repository';
import { DrizzlePatientAccessRepository } from '../infrastructure/drizzle-patient-access.repository';
import { AcceptInvitationUseCase } from './accept-invitation.use-case';
import { CreateInvitationUseCase } from './create-invitation.use-case';
import { EndCareRelationshipUseCase } from './end-care-relationship.use-case';
import { LoadPatientCaller } from './load-patient-caller';
import { LoadProfessionalCaller } from './load-professional-caller';
import { PatientAccessService } from './patient-access.service';
import { RegisterProfessionalUseCase } from './register-professional.use-case';
import { RevokeConsentUseCase } from './revoke-consent.use-case';

/**
 * Ending the follow-up against a **real Postgres**, which is what CLAUDE.md
 * ("Testes") asks of a critical use case — and this one takes a professional's
 * access away, which is the kind of thing that has to be true in the database
 * and not merely in a double.
 *
 * All three acceptance criteria of card I-07 only mean something here:
 *
 * - **"Após encerrar, o profissional recebe 404 nos dados do paciente."** The
 *   access rule is five tables, a join to `organization_member` and a partial
 *   index (ADR 0017), and "a requisição seguinte" is the next call to
 *   `PatientAccessService` — exactly what a `nutrition` use case will do.
 * - **"Nenhum dado do paciente é apagado."** A fake can be written to keep the
 *   rows; only the real tables prove that the profile, the patient, the
 *   consents, the invitation and the link itself are all still there, and that
 *   the one column that changed is `ended_at`.
 * - **"Testes para os dois lados."** Both sides are driven here against the
 *   same schema, including the one race that matters: the two of them ending
 *   the same follow-up at the same instant.
 *
 * Every test builds its own professional and its own patient through the use
 * cases of cards I-01 to I-03, so the suites share one throwaway database
 * without sharing rows. No data of a real person goes in: the names are labels
 * and the ids are random.
 */
const NUTRITIONIST = {
  fullName: 'Ana Souza',
  councilNumber: 'CRN-3 12345',
  specialty: 'Nutrição esportiva',
  professionalType: null,
};

const PATIENT = {
  fullName: 'Paciente de teste',
  timeZone: null,
  consents: ['health_data', 'share_with_professional'] as readonly ConsentType[],
};

interface FollowedPatient {
  readonly professionalAuthUserId: string;
  readonly professionalProfileId: string;
  readonly patientAuthUserId: string;
  readonly patientProfileId: string;
  readonly organizationId: string;
  readonly careRelationshipId: string;
}

interface CareRelationshipRow {
  readonly id: string;
  readonly organization_id: string;
  readonly invitation_id: string;
  readonly started_at: Date;
  readonly ended_at: Date | null;
}

describe('the end of a care relationship, against a real Postgres', () => {
  const pool = new Pool({
    connectionString: integrationDatabaseUrl(),
    application_name: 'fit-app-test',
  });

  const registry = new DrizzleIdentityRegistry(pool);
  const relationships = new DrizzleCareRelationshipRepository(pool);
  const consents = new DrizzleConsentRepository(pool);
  const tokens = new CryptoInvitationTokenIssuer();

  const professionals = new LoadProfessionalCaller(registry);
  const patients = new LoadPatientCaller(registry);

  const register = new RegisterProfessionalUseCase(registry);
  const createInvitation = new CreateInvitationUseCase(
    professionals,
    new DrizzleInvitationRepository(pool),
    tokens,
  );
  const accept = new AcceptInvitationUseCase(
    registry,
    new DrizzleInvitationAcceptanceRepository(pool),
    tokens,
  );
  const access = new PatientAccessService(new DrizzlePatientAccessRepository(pool));

  let events: RecordingEventBus;
  let end: EndCareRelationshipUseCase;
  let revokeConsent: RevokeConsentUseCase;

  beforeEach(() => {
    // One bus per test, so `published` is this test's events and nobody else's.
    events = new RecordingEventBus();
    end = new EndCareRelationshipUseCase(professionals, patients, relationships, events);
    revokeConsent = new RevokeConsentUseCase(patients, consents, events);
  });

  beforeAll(() => {
    // The access service logs a warning on every refusal, and half of this
    // suite is refusals. Nothing it carries is personal data; they are
    // silenced so the output of the run stays readable, through Nest's own
    // seam (these tests run as ES modules, where `jest` is not a global).
    Logger.overrideLogger({
      log: () => undefined,
      error: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      verbose: () => undefined,
    });
  });

  afterAll(async () => {
    // A pool left open is a jest run that does not exit.
    await pool.end();
  });

  /** A patient who accepted a nutritionist's invitation (cards I-01 to I-03). */
  async function aFollowedPatient(): Promise<FollowedPatient> {
    const professionalAuthUserId = randomUUID();
    const professional = await register.execute(professionalAuthUserId, NUTRITIONIST);

    const { token } = await createInvitation.execute(professionalAuthUserId, {
      name: 'Paciente de teste',
      contact: null,
    });

    const patientAuthUserId = randomUUID();
    const accepted = await accept.execute(patientAuthUserId, {
      token,
      fullName: PATIENT.fullName,
      timeZone: PATIENT.timeZone,
      consents: [...PATIENT.consents],
    });

    return {
      professionalAuthUserId,
      professionalProfileId: professional.personId,
      patientAuthUserId,
      patientProfileId: accepted.profileId,
      organizationId: accepted.organizationId,
      careRelationshipId: accepted.careRelationshipId,
    };
  }

  /** Every link of a patient, as SQL sees them. */
  async function linksOf(patientProfileId: string): Promise<readonly CareRelationshipRow[]> {
    const { rows } = await pool.query<CareRelationshipRow>(
      'select id, organization_id, invitation_id, started_at, ended_at from identity.care_relationship where patient_profile_id = $1 order by started_at',
      [patientProfileId],
    );

    return rows;
  }

  /** How many rows each table of the patient still has. */
  async function rowCountsOf(patientProfileId: string): Promise<Record<string, number>> {
    const { rows } = await pool.query<{
      profiles: string;
      patients: string;
      consents: string;
      links: string;
      invitations: string;
    }>(
      `select
         (select count(*) from identity.profile where id = $1) as profiles,
         (select count(*) from identity.patient where profile_id = $1) as patients,
         (select count(*) from identity.consent where profile_id = $1) as consents,
         (select count(*) from identity.care_relationship where patient_profile_id = $1) as links,
         (select count(*) from identity.invitation i
            join identity.care_relationship c on c.invitation_id = i.id
            where c.patient_profile_id = $1) as invitations`,
      [patientProfileId],
    );

    const [counts] = rows;

    if (counts === undefined) throw new Error('the counting query answered no row');

    return {
      profiles: Number(counts.profiles),
      patients: Number(counts.patients),
      consents: Number(counts.consents),
      links: Number(counts.links),
      invitations: Number(counts.invitations),
    };
  }

  it('cuts the professional access off on the next request, when the practice ends it', async () => {
    // The card's first acceptance criterion. Nothing is invalidated and nothing
    // is cached: the access rule reads the row at the instant it is asked (ADR
    // 0017), so the request right after the ending already answers no.
    const { professionalAuthUserId, professionalProfileId, patientProfileId } =
      await aFollowedPatient();

    await expect(access.canAccessPatient(professionalProfileId, patientProfileId)).resolves.toBe(
      true,
    );

    await end.byProfessional(professionalAuthUserId, patientProfileId);

    await expect(access.canAccessPatient(professionalProfileId, patientProfileId)).resolves.toBe(
      false,
    );
  });

  it('cuts it off just the same when the patient is the one who leaves', async () => {
    const { professionalProfileId, patientAuthUserId, patientProfileId, careRelationshipId } =
      await aFollowedPatient();

    await end.byPatient(patientAuthUserId, careRelationshipId);

    await expect(access.canAccessPatient(professionalProfileId, patientProfileId)).resolves.toBe(
      false,
    );
  });

  it('refuses the meal plan too, and with the same 404', async () => {
    // The nutritionist keeps their licence and loses the patient: what the
    // refusal has to be is `PatientNotFoundError`, not "não é nutricionista".
    const { professionalAuthUserId, professionalProfileId, patientProfileId } =
      await aFollowedPatient();

    await end.byProfessional(professionalAuthUserId, patientProfileId);

    await expect(
      access.assertCanEditMealPlan(professionalProfileId, patientProfileId),
    ).rejects.toThrow(PatientNotFoundError);
  });

  it('deletes nothing: every row of the patient is still there, and only ended_at changed', async () => {
    // The card's second acceptance criterion, asked of the tables.
    const { professionalAuthUserId, patientProfileId } = await aFollowedPatient();

    const before = await rowCountsOf(patientProfileId);
    const [original] = await linksOf(patientProfileId);

    const ended = await end.byProfessional(professionalAuthUserId, patientProfileId);

    expect(await rowCountsOf(patientProfileId)).toEqual(before);

    const [dated] = await linksOf(patientProfileId);

    expect(dated?.id).toBe(original?.id);
    expect(dated?.started_at).toEqual(original?.started_at);
    expect(dated?.invitation_id).toBe(original?.invitation_id);
    expect(dated?.ended_at).toEqual(ended.endedAt);
  });

  it('ends the follow-up of a patient who had already revoked the sharing consent', async () => {
    // The one difference from every other professional route: ending the link
    // does not ask for `share_with_professional`, because the consent and the
    // link are different records (ADR 0018) and the practice has to be able to
    // close its own side of a follow-up the patient walked away from.
    const { professionalAuthUserId, patientAuthUserId, patientProfileId } =
      await aFollowedPatient();

    await revokeConsent.execute(patientAuthUserId, 'share_with_professional');

    const ended = await end.byProfessional(professionalAuthUserId, patientProfileId);

    expect(ended.endedAt).toBeInstanceOf(Date);
  });

  it('publishes identity.relationship.ended with the ids and the side that ended it', async () => {
    const { professionalAuthUserId, patientProfileId, organizationId, careRelationshipId } =
      await aFollowedPatient();

    const ended = await end.byProfessional(professionalAuthUserId, patientProfileId);

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

  it('refuses the second ending, keeping the first instant', async () => {
    const { professionalAuthUserId, patientAuthUserId, patientProfileId, careRelationshipId } =
      await aFollowedPatient();

    const first = await end.byProfessional(professionalAuthUserId, patientProfileId);

    // And the other side cannot end it again either: there is one follow-up,
    // and it is over.
    await expect(end.byPatient(patientAuthUserId, careRelationshipId)).rejects.toThrow(
      CareRelationshipAlreadyEndedError,
    );

    const [link] = await linksOf(patientProfileId);

    expect(link?.ended_at).toEqual(first.endedAt);
  });

  it('dates the row once when both sides end it at the same instant', async () => {
    // The `where ended_at is null` of the update is what decides it, in
    // Postgres and not in this process: one of the two wins, the other is told
    // the follow-up is already over, and there is one instant on the row.
    const { professionalAuthUserId, patientAuthUserId, patientProfileId, careRelationshipId } =
      await aFollowedPatient();

    const outcomes = await Promise.allSettled([
      end.byProfessional(professionalAuthUserId, patientProfileId),
      end.byPatient(patientAuthUserId, careRelationshipId),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(events.payloadsOf('identity.relationship.ended')).toHaveLength(1);

    const links = await linksOf(patientProfileId);

    expect(links).toHaveLength(1);
    expect(links[0]?.ended_at).toBeInstanceOf(Date);
  });

  it('answers a patient of another practice as a patient that is not there', async () => {
    // Two whole practices, each with its own patient: what keeps one from
    // ending the other's follow-up is the join to `organization_member`.
    const mine = await aFollowedPatient();
    const theirs = await aFollowedPatient();

    await expect(
      end.byProfessional(mine.professionalAuthUserId, theirs.patientProfileId),
    ).rejects.toThrow(PatientNotFoundError);

    expect((await linksOf(theirs.patientProfileId))[0]?.ended_at).toBeNull();
  });

  it('answers a link of another patient as not found', async () => {
    const mine = await aFollowedPatient();
    const theirs = await aFollowedPatient();

    await expect(end.byPatient(mine.patientAuthUserId, theirs.careRelationshipId)).rejects.toThrow(
      CareRelationshipNotFoundError,
    );

    expect((await linksOf(theirs.patientProfileId))[0]?.ended_at).toBeNull();
  });

  it('lets the patient come back to the same practice with a new invitation', async () => {
    // The other half of "nada é apagado": the link is dated and reused, so a
    // patient who comes back gets the same row with a new `started_at` and a
    // new invitation on it (card I-03), and the access is back.
    const { professionalAuthUserId, professionalProfileId, patientAuthUserId, patientProfileId } =
      await aFollowedPatient();

    const ended = await end.byProfessional(professionalAuthUserId, patientProfileId);

    const { token } = await createInvitation.execute(professionalAuthUserId, {
      name: 'Paciente de teste',
      contact: null,
    });

    await accept.execute(patientAuthUserId, {
      token,
      fullName: PATIENT.fullName,
      timeZone: PATIENT.timeZone,
      consents: [...PATIENT.consents],
    });

    await expect(access.canAccessPatient(professionalProfileId, patientProfileId)).resolves.toBe(
      true,
    );

    const links = await linksOf(patientProfileId);

    expect(links).toHaveLength(1);
    expect(links[0]?.ended_at).toBeNull();
    expect(links[0]?.started_at.getTime()).toBeGreaterThanOrEqual(ended.endedAt.getTime());
  });
});
