import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { integrationDatabaseUrl } from '../../../shared/testing/integration-postgres.spec-support';
import { type ConsentType } from '../domain/consent';
import { CryptoInvitationTokenIssuer } from '../infrastructure/crypto-invitation-token.issuer';
import { DrizzleAccessLogRepository } from '../infrastructure/drizzle-access-log.repository';
import { DrizzleIdentityRegistry } from '../infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationAcceptanceRepository } from '../infrastructure/drizzle-invitation-acceptance.repository';
import { DrizzleInvitationRepository } from '../infrastructure/drizzle-invitation.repository';
import { AcceptInvitationUseCase } from './accept-invitation.use-case';
import { AccessLogService } from './access-log.service';
import { CreateInvitationUseCase } from './create-invitation.use-case';
import { ListMyAccessLogUseCase } from './list-my-access-log.use-case';
import { LoadPatientCaller } from './load-patient-caller';
import { LoadProfessionalCaller } from './load-professional-caller';
import { RegisterProfessionalUseCase } from './register-professional.use-case';

/**
 * The access log against a **real Postgres**, which is what CLAUDE.md
 * ("Testes") asks of a critical use case — and a trail nobody can trust is
 * worse than no trail at all.
 *
 * Two of the card's acceptance criteria only mean something here:
 *
 * - **"Registros não podem ser editados nem apagados pela API."** A fake can
 *   be written to keep every row; only the real table proves that an `update`
 *   and a `delete` are **refused**, whoever sends them and whatever the
 *   `where` says. That is the trigger of
 *   `0004_identity_access_log_append_only.sql`, and it is the half of the
 *   criterion no code review can enforce.
 * - **"Paciente vê só os próprios registros."** Two patients and one
 *   professional in the same table, and the query that answers one of them.
 *
 * The paging is here too, because what it leans on is SQL: the row
 * comparison against `(occurred_at, id)` and the index behind it, with two
 * accesses written in the same instant — the case an `order by occurred_at`
 * alone cannot get right.
 *
 * Every test builds its own professional and its own patient through the use
 * cases of cards I-01 to I-03, so the suites share one throwaway database
 * without sharing rows. No data of a real person goes in: the names are
 * labels and the ids are random.
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

interface AccessLogRow {
  readonly id: string;
  readonly resource: string;
  readonly action: string;
  readonly occurred_at: Date;
}

describe('the access log, against a real Postgres', () => {
  const pool = new Pool({
    connectionString: integrationDatabaseUrl(),
    application_name: 'fit-app-test',
  });

  const registry = new DrizzleIdentityRegistry(pool);
  const records = new DrizzleAccessLogRepository(pool);
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

  const log = new AccessLogService(records);
  const list = new ListMyAccessLogUseCase(new LoadPatientCaller(registry), records);

  afterAll(async () => {
    // A pool left open is a jest run that does not exit.
    await pool.end();
  });

  /** A patient a nutritionist follows (cards I-01 to I-03). */
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

  /** The rows of one patient, as SQL sees them. */
  async function rowsOf(patientProfileId: string): Promise<readonly AccessLogRow[]> {
    const { rows } = await pool.query<AccessLogRow>(
      'select id, resource, action, occurred_at from identity.access_log where patient_profile_id = $1 order by occurred_at',
      [patientProfileId],
    );

    return rows;
  }

  it('writes one row per visit and answers it with who accessed', async () => {
    const { patientAuthUserId, patientProfileId, professionalProfileId } = await aFollowedPatient();

    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'view');

    const page = await list.execute(patientAuthUserId);

    expect(await rowsOf(patientProfileId)).toHaveLength(1);
    expect(page.entries).toEqual([
      {
        id: expect.any(String),
        actor: { name: NUTRITIONIST.fullName, professionalType: 'nutritionist' },
        resource: 'patient_chart',
        action: 'view',
        occurredAt: expect.any(Date),
      },
    ]);
  });

  it('answers only the records of the patient who asked', async () => {
    // The acceptance criterion, with both patients in the same table and the
    // same professional on both rows.
    const mine = await aFollowedPatient();
    const theirs = await aFollowedPatient();

    await log.logAccess(mine.professionalProfileId, mine.patientProfileId, 'patient_chart', 'view');
    await log.logAccess(
      theirs.professionalProfileId,
      theirs.patientProfileId,
      'patient_chart',
      'export',
    );

    const page = await list.execute(mine.patientAuthUserId);

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.action).toBe('view');
  });

  it('refuses an update of a record, whatever the where says', async () => {
    const { patientProfileId, professionalProfileId } = await aFollowedPatient();
    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'view');

    const [row] = await rowsOf(patientProfileId);

    await expect(
      pool.query("update identity.access_log set action = 'view' where id = $1", [row?.id]),
    ).rejects.toThrow(/append-only/);

    await expect(
      pool.query('update identity.access_log set occurred_at = now() where false'),
    ).rejects.toThrow(/append-only/);

    expect(await rowsOf(patientProfileId)).toHaveLength(1);
  });

  it('refuses a delete of a record, and a truncate of the table', async () => {
    const { patientProfileId, professionalProfileId } = await aFollowedPatient();
    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'export');

    await expect(
      pool.query('delete from identity.access_log where patient_profile_id = $1', [
        patientProfileId,
      ]),
    ).rejects.toThrow(/append-only/);

    await expect(pool.query('truncate identity.access_log')).rejects.toThrow(/append-only/);

    expect(await rowsOf(patientProfileId)).toHaveLength(1);
  });

  it('keeps the trail in the way of deleting the people it names', async () => {
    // The consequence of the two foreign keys not being `cascade`: removing a
    // profile would cascade into a delete this table refuses, so what it does
    // instead is fail and say the trail is there. Erasing a person is a
    // different right, with a card of its own, and it is that card that
    // decides what happens to these rows.
    const { patientProfileId, professionalProfileId } = await aFollowedPatient();
    await log.logAccess(professionalProfileId, patientProfileId, 'patient_chart', 'view');

    await expect(
      pool.query('delete from identity.profile where id = $1', [professionalProfileId]),
    ).rejects.toThrow();
  });

  it('pages strictly, even when two accesses share an instant', async () => {
    const { patientAuthUserId, patientProfileId, professionalProfileId } = await aFollowedPatient();

    // Written straight to the table, with one instant for all three: the case
    // the pair `(occurred_at, id)` exists for.
    for (let visit = 0; visit < 3; visit += 1) {
      await pool.query(
        `insert into identity.access_log
           (actor_profile_id, patient_profile_id, resource, action, occurred_at)
         values ($1, $2, 'patient_chart', 'view', '2026-11-09T12:00:00.000Z')`,
        [professionalProfileId, patientProfileId],
      );
    }

    const first = await list.execute(patientAuthUserId, { limit: 2 });
    const second = await list.execute(patientAuthUserId, {
      limit: 2,
      cursor: first.nextCursor,
    });

    expect(first.entries).toHaveLength(2);
    expect(second.entries).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();

    const ids = [...first.entries, ...second.entries].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(3);
    expect(await rowsOf(patientProfileId)).toHaveLength(3);
  });

  it('answers an empty page for a patient nobody has opened', async () => {
    const { patientAuthUserId } = await aFollowedPatient();

    await expect(list.execute(patientAuthUserId)).resolves.toEqual({
      entries: [],
      nextCursor: undefined,
    });
  });
});
