import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { integrationDatabaseUrl } from '../../../shared/testing/integration-postgres.spec-support';
import { MealPlanRequiresNutritionistError, PatientNotFoundError } from '../domain/identity-errors';
import { type ProfessionalType } from '../domain/person';
import { CryptoInvitationTokenIssuer } from '../infrastructure/crypto-invitation-token.issuer';
import { DrizzleIdentityRegistry } from '../infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationAcceptanceRepository } from '../infrastructure/drizzle-invitation-acceptance.repository';
import { DrizzleInvitationRepository } from '../infrastructure/drizzle-invitation.repository';
import { DrizzlePatientAccessRepository } from '../infrastructure/drizzle-patient-access.repository';
import { AcceptInvitationUseCase } from './accept-invitation.use-case';
import { CreateInvitationUseCase } from './create-invitation.use-case';
import { LoadProfessionalCaller } from './load-professional-caller';
import { PatientAccessService } from './patient-access.service';
import {
  RegisterProfessionalUseCase,
  type RegisterProfessionalInput,
} from './register-professional.use-case';

/**
 * The access rule against a **real Postgres**, which is what CLAUDE.md
 * ("Testes") asks of a critical use case — and no use case of this platform is
 * more critical: everything a professional ever reads about a patient passes
 * through this check.
 *
 * What a fake cannot answer for is exactly what the rule rests on. The link
 * belongs to the practice and not to the professional, so what proves "o
 * profissional de outra clínica não vê" is the join to
 * `organization_member`; "consentimento revogado" is a `revoked_at` that is no
 * longer null, which only the real partial index and the real `is null`
 * decide; and the whole picture — professional, practice, invitation, patient,
 * link, consents — is five tables that only the real schema can put together.
 *
 * Every test builds its own professional and its own patient through the use
 * cases of cards I-01 to I-03, so the suites share one throwaway database
 * without sharing rows, and the rows are the ones the API really writes. No
 * data of a real person goes in: the names are labels and the ids are random
 * (CLAUDE.md, "Testes").
 */
const NUTRITIONIST = {
  fullName: 'Ana Souza',
  councilNumber: 'CRN-3 12345',
  specialty: 'Nutrição esportiva',
  professionalType: null,
};

const TRAINER = {
  fullName: 'Bruno Lima',
  councilNumber: 'CREF 98765',
  specialty: null,
  professionalType: 'trainer' as ProfessionalType,
};

const PATIENT = {
  fullName: 'Paciente de teste',
  timeZone: null,
  consents: ['health_data', 'share_with_professional'] as const,
};

describe('the patient access rule, against a real Postgres', () => {
  const pool = new Pool({
    connectionString: integrationDatabaseUrl(),
    application_name: 'fit-app-test',
  });

  const registry = new DrizzleIdentityRegistry(pool);
  const invitations = new DrizzleInvitationRepository(pool);
  const acceptances = new DrizzleInvitationAcceptanceRepository(pool);
  const tokens = new CryptoInvitationTokenIssuer();

  const register = new RegisterProfessionalUseCase(registry);
  const create = new CreateInvitationUseCase(
    new LoadProfessionalCaller(registry),
    invitations,
    tokens,
  );
  const accept = new AcceptInvitationUseCase(registry, acceptances, tokens);
  const access = new PatientAccessService(new DrizzlePatientAccessRepository(pool));

  beforeAll(() => {
    // The refusals are warnings on purpose, and most of this suite is
    // refusals. Nothing of what they carry is personal data; they are silenced
    // so the output of the run stays readable. `Logger.overrideLogger` and not
    // a mock — these tests run as ES modules, where the `jest` object is not a
    // global, and Nest's own seam does the job without one.
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

  /** A professional with their own solo practice, as card I-01 creates one. */
  async function aProfessional(
    registration: RegisterProfessionalInput,
  ): Promise<{ authUserId: string; profileId: string; organizationId: string }> {
    const authUserId = randomUUID();
    const identity = await register.execute(authUserId, registration);
    const [membership] = identity.organizations;

    if (membership === undefined) throw new Error('the registration created no practice');

    return {
      authUserId,
      profileId: identity.personId,
      organizationId: membership.organizationId,
    };
  }

  /** A patient who accepted that professional's invitation (cards I-02, I-03). */
  async function aPatientOf(professionalAuthUserId: string): Promise<string> {
    const { token } = await create.execute(professionalAuthUserId, {
      name: 'Paciente de teste',
      contact: null,
    });

    const accepted = await accept.execute(randomUUID(), {
      token,
      fullName: PATIENT.fullName,
      timeZone: PATIENT.timeZone,
      consents: [...PATIENT.consents],
    });

    return accepted.profileId;
  }

  it('lets the nutritionist who follows the patient read them and edit the plan', async () => {
    const professional = await aProfessional(NUTRITIONIST);
    const patientId = await aPatientOf(professional.authUserId);

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(true);
    await expect(access.canEditMealPlan(professional.profileId, patientId)).resolves.toBe(true);
  });

  it('refuses the professional of another practice, consent in force and all', async () => {
    // The card's "consentimento de outro profissional". The consent is a row
    // of the patient's profile and it is in force; what this professional is
    // missing is the link, and the join to `organization_member` is what says
    // so.
    const theirs = await aProfessional(NUTRITIONIST);
    const stranger = await aProfessional(NUTRITIONIST);
    const patientId = await aPatientOf(theirs.authUserId);

    await expect(access.canAccessPatient(stranger.profileId, patientId)).resolves.toBe(false);
    await expect(access.assertCanAccessPatient(stranger.profileId, patientId)).rejects.toThrow(
      PatientNotFoundError,
    );
  });

  it('refuses a professional once the follow-up ends', async () => {
    const professional = await aProfessional(NUTRITIONIST);
    const patientId = await aPatientOf(professional.authUserId);

    // What ending a follow-up writes: `ended_at`, and the row stays. The use
    // case that does it has its own card; the column is what the rule reads.
    await pool.query(
      'update identity.care_relationship set ended_at = now() where patient_profile_id = $1',
      [patientId],
    );

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(false);
  });

  it('refuses a professional the instant the consent is revoked', async () => {
    const professional = await aProfessional(NUTRITIONIST);
    const patientId = await aPatientOf(professional.authUserId);

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(true);

    // A revocation is a new state of the row and never a delete (card I-03),
    // so what the rule reads is `revoked_at is null` and not the existence of
    // the row. Nothing is cached, so the next question already answers no
    // (CLAUDE.md: "revogar consentimento corta o acesso na hora").
    await pool.query(
      "update identity.consent set revoked_at = now() where profile_id = $1 and type = 'share_with_professional'",
      [patientId],
    );

    await expect(access.canAccessPatient(professional.profileId, patientId)).resolves.toBe(false);

    // And the link is untouched: it is the consent that was taken back.
    const { rows } = await pool.query<{ ended_at: Date | null }>(
      'select ended_at from identity.care_relationship where patient_profile_id = $1',
      [patientId],
    );

    expect(rows[0]?.ended_at).toBeNull();
  });

  it('lets a personal trainer of the same practice read the patient and refuses the plan', async () => {
    // The acceptance criterion of the card. A clinic with two professionals is
    // what the membership table is for, even though the MVP only creates solo
    // practices (ADR 0014): the trainer joins the nutritionist's practice and
    // the link, which belongs to the practice, is theirs to read too.
    const nutritionist = await aProfessional(NUTRITIONIST);
    const trainer = await aProfessional(TRAINER);
    const patientId = await aPatientOf(nutritionist.authUserId);

    await pool.query(
      "insert into identity.organization_member (organization_id, profile_id, role) values ($1, $2, 'member')",
      [nutritionist.organizationId, trainer.profileId],
    );

    await expect(access.canAccessPatient(trainer.profileId, patientId)).resolves.toBe(true);
    await expect(access.canEditMealPlan(trainer.profileId, patientId)).resolves.toBe(false);

    // 403 and not 404: the trainer already sees the patient, so there is
    // nothing left to hide — what they are told is what their licence does not
    // cover.
    await expect(access.assertCanEditMealPlan(trainer.profileId, patientId)).rejects.toThrow(
      MealPlanRequiresNutritionistError,
    );

    // And the nutritionist of the same practice still prescribes.
    await expect(access.canEditMealPlan(nutritionist.profileId, patientId)).resolves.toBe(true);
  });

  it('refuses a patient id that is nobody', async () => {
    const professional = await aProfessional(NUTRITIONIST);

    await expect(access.canAccessPatient(professional.profileId, randomUUID())).resolves.toBe(
      false,
    );
  });

  it('refuses a professional id that is nobody', async () => {
    const professional = await aProfessional(NUTRITIONIST);
    const patientId = await aPatientOf(professional.authUserId);

    await expect(access.canAccessPatient(randomUUID(), patientId)).resolves.toBe(false);
  });
});
