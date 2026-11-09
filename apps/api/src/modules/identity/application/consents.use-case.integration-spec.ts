import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { RecordingEventBus } from '../../../shared/events/recording-event-bus.spec-support';
import { integrationDatabaseUrl } from '../../../shared/testing/integration-postgres.spec-support';
import { type ConsentType } from '../domain/consent';
import { ConsentNotInForceError } from '../domain/identity-errors';
import { CryptoInvitationTokenIssuer } from '../infrastructure/crypto-invitation-token.issuer';
import { DrizzleConsentRepository } from '../infrastructure/drizzle-consent.repository';
import { DrizzleIdentityRegistry } from '../infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationAcceptanceRepository } from '../infrastructure/drizzle-invitation-acceptance.repository';
import { DrizzleInvitationRepository } from '../infrastructure/drizzle-invitation.repository';
import { DrizzlePatientAccessRepository } from '../infrastructure/drizzle-patient-access.repository';
import { AcceptInvitationUseCase } from './accept-invitation.use-case';
import { CreateInvitationUseCase } from './create-invitation.use-case';
import { GrantConsentUseCase } from './grant-consent.use-case';
import { ListMyConsentsUseCase } from './list-my-consents.use-case';
import { LoadPatientCaller } from './load-patient-caller';
import { LoadProfessionalCaller } from './load-professional-caller';
import { PatientAccessService } from './patient-access.service';
import { RegisterProfessionalUseCase } from './register-professional.use-case';
import { RevokeConsentUseCase } from './revoke-consent.use-case';

/**
 * Giving and taking back a consent against a **real Postgres**, which is what
 * CLAUDE.md ("Testes") asks of a critical use case — and consent is the thing
 * that makes every other use case of this platform lawful.
 *
 * Three of the card's acceptance criteria only mean something here:
 *
 * - **"Revogação nunca apaga o registro original."** A fake can be written to
 *   keep the row; only the real table proves that the `update` left
 *   `granted_at` and `terms_version` alone and that the row is still there to
 *   be read with raw SQL afterwards.
 * - **"Depois de revogar `share_with_professional`, o profissional perde
 *   acesso na requisição seguinte."** The access rule is five tables, a join
 *   to `organization_member` and a partial index (ADR 0017), and the next
 *   request is the next call to `PatientAccessService` — which is exactly what
 *   a `nutrition` use case will do.
 * - **The cascade of `health_data` is one transaction**, and what the rows say
 *   afterwards is the only honest witness of that.
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

interface ConsentRow {
  readonly type: ConsentType;
  readonly terms_version: string;
  readonly granted_at: Date;
  readonly revoked_at: Date | null;
}

describe('the consents of a patient, against a real Postgres', () => {
  const pool = new Pool({
    connectionString: integrationDatabaseUrl(),
    application_name: 'fit-app-test',
  });

  const registry = new DrizzleIdentityRegistry(pool);
  const consents = new DrizzleConsentRepository(pool);
  const tokens = new CryptoInvitationTokenIssuer();

  const register = new RegisterProfessionalUseCase(registry);
  const createInvitation = new CreateInvitationUseCase(
    new LoadProfessionalCaller(registry),
    new DrizzleInvitationRepository(pool),
    tokens,
  );
  const accept = new AcceptInvitationUseCase(
    registry,
    new DrizzleInvitationAcceptanceRepository(pool),
    tokens,
  );

  const caller = new LoadPatientCaller(registry);
  const list = new ListMyConsentsUseCase(caller, consents);
  const grant = new GrantConsentUseCase(caller, consents);
  const access = new PatientAccessService(new DrizzlePatientAccessRepository(pool));

  let events: RecordingEventBus;
  let revoke: RevokeConsentUseCase;

  beforeEach(() => {
    // One bus per test, so `published` is this test's events and nobody else's.
    events = new RecordingEventBus();
    revoke = new RevokeConsentUseCase(caller, consents, events);
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
  async function aFollowedPatient(): Promise<{
    patientAuthUserId: string;
    patientProfileId: string;
    professionalProfileId: string;
  }> {
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
      patientAuthUserId,
      patientProfileId: accepted.profileId,
      professionalProfileId: professional.personId,
    };
  }

  /** Every row of the patient's consents, revoked ones and all, as SQL sees them. */
  async function rowsOf(patientProfileId: string): Promise<readonly ConsentRow[]> {
    const { rows } = await pool.query<ConsentRow>(
      'select type, terms_version, granted_at, revoked_at from identity.consent where profile_id = $1 order by granted_at, type',
      [patientProfileId],
    );

    return rows;
  }

  it('answers what the acceptance recorded, with the version of the terms', async () => {
    const { patientAuthUserId } = await aFollowedPatient();

    const inForce = await list.execute(patientAuthUserId);

    expect(inForce.map((consent) => consent.type)).toEqual([
      'health_data',
      'share_with_professional',
    ]);
    expect(inForce.every((consent) => consent.termsVersion.length > 0)).toBe(true);
  });

  it('dates the row instead of deleting it, and leaves the original facts alone', async () => {
    // The card's first acceptance criterion, asked of the table.
    const { patientAuthUserId, patientProfileId } = await aFollowedPatient();
    const before = await rowsOf(patientProfileId);

    await revoke.execute(patientAuthUserId, 'share_with_professional');

    const after = await rowsOf(patientProfileId);
    const original = before.find((row) => row.type === 'share_with_professional');
    const revoked = after.find((row) => row.type === 'share_with_professional');

    expect(after).toHaveLength(before.length);
    expect(revoked?.granted_at).toEqual(original?.granted_at);
    expect(revoked?.terms_version).toBe(original?.terms_version);
    expect(revoked?.revoked_at).toBeInstanceOf(Date);
  });

  it('cuts the professional access off on the next request', async () => {
    // The card's second acceptance criterion. Nothing is invalidated and
    // nothing is cached: the access rule reads the row at the instant it is
    // asked (ADR 0017), so the request right after the revocation already
    // answers no.
    const { patientAuthUserId, patientProfileId, professionalProfileId } = await aFollowedPatient();

    await expect(access.canAccessPatient(professionalProfileId, patientProfileId)).resolves.toBe(
      true,
    );

    await revoke.execute(patientAuthUserId, 'share_with_professional');

    await expect(access.canAccessPatient(professionalProfileId, patientProfileId)).resolves.toBe(
      false,
    );

    // And the link was not touched: it is the consent that was taken back. The
    // care relationship is the audit trail of why that practice ever saw this
    // patient, and ending the follow-up is the practice's own act.
    const { rows } = await pool.query<{ ended_at: Date | null }>(
      'select ended_at from identity.care_relationship where patient_profile_id = $1',
      [patientProfileId],
    );

    expect(rows[0]?.ended_at).toBeNull();
  });

  it('gives the professional access back when the patient consents again', async () => {
    const { patientAuthUserId, patientProfileId, professionalProfileId } = await aFollowedPatient();

    await revoke.execute(patientAuthUserId, 'share_with_professional');
    await grant.execute(patientAuthUserId, 'share_with_professional');

    await expect(access.canAccessPatient(professionalProfileId, patientProfileId)).resolves.toBe(
      true,
    );

    // A new row beside the revoked one: the history of "deu, tirou e deu de
    // novo" survives, and the partial unique index allows it because only one
    // of the two is in force.
    const rows = await rowsOf(patientProfileId);

    expect(rows.filter((row) => row.type === 'share_with_professional')).toHaveLength(2);
    expect(
      rows.filter((row) => row.type === 'share_with_professional' && row.revoked_at === null),
    ).toHaveLength(1);
  });

  it('publishes identity.consent.revoked with the profile id and the purpose', async () => {
    // The card's third acceptance criterion.
    const { patientAuthUserId, patientProfileId } = await aFollowedPatient();

    await revoke.execute(patientAuthUserId, 'share_with_professional');

    expect(events.payloadsOf('identity.consent.revoked')).toEqual([
      {
        profileId: patientProfileId,
        consentType: 'share_with_professional',
        revokedAt: expect.any(String),
      },
    ]);
  });

  it('ends every purpose in force when health_data goes, and announces each one', async () => {
    // "Revogar `health_data` encerra o uso do app" (card I-05): the cascade is
    // one transaction, so what the table says afterwards is all or nothing.
    const { patientAuthUserId, patientProfileId } = await aFollowedPatient();

    await grant.execute(patientAuthUserId, 'wearable_data');
    await grant.execute(patientAuthUserId, 'ai_processing');

    const revoked = await revoke.execute(patientAuthUserId, 'health_data');

    expect(revoked.map((consent) => consent.type)).toEqual([
      'health_data',
      'share_with_professional',
      'wearable_data',
      'ai_processing',
    ]);
    expect(
      events.payloadsOf('identity.consent.revoked').map((payload) => payload.consentType),
    ).toEqual(['health_data', 'share_with_professional', 'wearable_data', 'ai_processing']);

    // Nothing left in force, and every row still there.
    const rows = await rowsOf(patientProfileId);

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
    expect(await list.execute(patientAuthUserId)).toEqual([]);
  });

  it('refuses the second revocation of the same purpose, keeping the first instant', async () => {
    const { patientAuthUserId, patientProfileId } = await aFollowedPatient();

    const [first] = await revoke.execute(patientAuthUserId, 'share_with_professional');

    await expect(revoke.execute(patientAuthUserId, 'share_with_professional')).rejects.toThrow(
      ConsentNotInForceError,
    );

    const rows = await rowsOf(patientProfileId);

    expect(rows.find((row) => row.type === 'share_with_professional')?.revoked_at).toEqual(
      first?.revokedAt,
    );
  });

  it('writes one row for a purpose given twice at the same instant', async () => {
    // The partial unique index decides the race, not this process: two
    // requests of the same purpose produce one consent in force, and both
    // callers are answered the one that holds.
    const { patientAuthUserId, patientProfileId } = await aFollowedPatient();

    const [one, other] = await Promise.all([
      grant.execute(patientAuthUserId, 'wearable_data'),
      grant.execute(patientAuthUserId, 'wearable_data'),
    ]);

    expect(one?.grantedAt).toEqual(other?.grantedAt);
    expect(
      (await rowsOf(patientProfileId)).filter((row) => row.type === 'wearable_data'),
    ).toHaveLength(1);
  });
});
