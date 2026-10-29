import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { integrationDatabaseUrl } from '../../../shared/testing/integration-postgres.spec-support';
import { ProfileIsNotProfessionalError } from '../domain/identity-errors';
import { type OrganizationRole } from '../domain/organization';
import { professionalRegistrationFor } from '../domain/professional-registration';
import { DrizzleIdentityRegistry } from '../infrastructure/drizzle-identity-registry.repository';
import { GetMyIdentityUseCase } from './get-my-identity.use-case';
import { RegisterProfessionalUseCase } from './register-professional.use-case';

/**
 * The first access of a professional against a **real Postgres**, which is the
 * fourth acceptance criterion of card I-01 and what CLAUDE.md ("Testes") asks
 * of a critical use case.
 *
 * It is here and not in the unit profile because half of what the criteria say
 * is written in SQL and not in TypeScript: the four rows in one transaction,
 * the unique index that makes a second registration write nothing, the
 * `default 'nutritionist'` on the column. A fake repository would answer for
 * the code and leave the database's half untested.
 *
 * Every test registers its own Supabase user id, so the suites share one
 * throwaway database without sharing rows, and the assertions below count rows
 * **of that person** rather than rows of the table.
 */
const INPUT = {
  fullName: 'Ana Souza',
  councilNumber: 'CRN-3 12345',
  specialty: 'Nutrição esportiva',
  professionalType: null,
};

describe('RegisterProfessionalUseCase against a real Postgres', () => {
  const pool = new Pool({
    connectionString: integrationDatabaseUrl(),
    application_name: 'fit-app-test',
  });

  const registry = new DrizzleIdentityRegistry(pool);
  const register = new RegisterProfessionalUseCase(registry);
  const getMyIdentity = new GetMyIdentityUseCase(registry);

  afterAll(async () => {
    // A pool left open is a jest run that does not exit.
    await pool.end();
  });

  /** What is really in the tables for one person, read without Drizzle. */
  async function rowsOf(personId: string) {
    const [profiles, professionals, memberships, organizations] = await Promise.all([
      count('select count(*) from identity.profile where id = $1', personId),
      count('select count(*) from identity.professional where profile_id = $1', personId),
      count('select count(*) from identity.organization_member where profile_id = $1', personId),
      count(
        `select count(*) from identity.organization o
           join identity.organization_member m on m.organization_id = o.id
          where m.profile_id = $1`,
        personId,
      ),
    ]);

    return { profiles, professionals, memberships, organizations };
  }

  async function count(sql: string, personId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(sql, [personId]);

    return Number(rows[0]?.count ?? 0);
  }

  it('creates the four rows, and creates them together', async () => {
    const authUserId = randomUUID();

    const identity = await register.execute(authUserId, INPUT);

    expect(await rowsOf(identity.personId)).toEqual({
      profiles: 1,
      professionals: 1,
      memberships: 1,
      organizations: 1,
    });

    // And they are joined to each other, which is what "together" means: the
    // membership points at the practice that was created and at the profile
    // that was created, as its owner.
    const { rows } = await pool.query<{
      role: string;
      kind: string;
      name: string;
      professional_type: string;
    }>(
      `select m.role, o.kind, o.name, p.professional_type
         from identity.organization_member m
         join identity.organization o on o.id = m.organization_id
         join identity.professional p on p.profile_id = m.profile_id
        where m.profile_id = $1`,
      [identity.personId],
    );

    expect(rows).toEqual([
      { role: 'owner', kind: 'solo', name: 'Ana Souza', professional_type: 'nutritionist' },
    ]);
  });

  it('writes professional_type nutritionist when the request does not say', async () => {
    const authUserId = randomUUID();

    const identity = await register.execute(authUserId, INPUT);

    // Read off the column, not off the answer: the criterion is about what is
    // stored, and the column has the same default as the domain.
    const { rows } = await pool.query<{ professional_type: string }>(
      'select professional_type from identity.professional where profile_id = $1',
      [identity.personId],
    );

    expect(rows).toEqual([{ professional_type: 'nutritionist' }]);
  });

  it('called twice, duplicates nothing', async () => {
    const authUserId = randomUUID();

    const first = await register.execute(authUserId, INPUT);
    const second = await register.execute(authUserId, INPUT);

    expect(second.personId).toBe(first.personId);
    expect(await rowsOf(first.personId)).toEqual({
      profiles: 1,
      professionals: 1,
      memberships: 1,
      organizations: 1,
    });
  });

  it('writes nothing at all on the second call, not even a loose organization', async () => {
    const authUserId = randomUUID();

    const first = await register.execute(authUserId, INPUT);
    const organizationsBefore = await totalOrganizations(pool);

    await register.execute(authUserId, { ...INPUT, fullName: 'Outro Nome' });

    // A practice with nobody in it would still be a row in the table, so the
    // count of the whole schema is what notices one. What this covers is the
    // second call writing nothing — it does not even reach the transaction,
    // since the read answers first; the rollback is the test below. And the
    // name of the first registration is untouched: a second call does not
    // overwrite.
    expect(await totalOrganizations(pool)).toBe(organizationsBefore);

    const { rows } = await pool.query<{ full_name: string }>(
      'select full_name from identity.profile where id = $1',
      [first.personId],
    );

    expect(rows).toEqual([{ full_name: 'Ana Souza' }]);
  });

  it('rolls the rows already inserted back when the last one fails', async () => {
    const authUserId = randomUUID();
    const organizationsBefore = await totalOrganizations(pool);

    // A membership role the column does not have. It breaks the **last** of
    // the four inserts, with the profile, the professional and the practice
    // already written inside the transaction — which is the only angle from
    // which "de forma atômica" can be seen from outside.
    //
    // The registry is driven directly, and the value goes in through a cast:
    // neither the domain nor the use case can produce this, and that is the
    // point. What is under test is the transaction of the repository, not a
    // rule above it.
    const invalidRole: string = 'treasurer';

    const registration = {
      ...professionalRegistrationFor({ authUserId, ...INPUT }),
      membershipRole: invalidRole as OrganizationRole,
    };

    await expect(registry.createProfessional(registration)).rejects.toThrow();

    // None of the three survived: no profile of that person, and no practice
    // left loose in the schema.
    const { rows } = await pool.query<{ count: string }>(
      'select count(*) from identity.profile where auth_user_id = $1',
      [authUserId],
    );

    expect(Number(rows[0]?.count ?? 0)).toBe(0);
    expect(await totalOrganizations(pool)).toBe(organizationsBefore);
  });

  it('reads the registration back, through the joins GET /v1/me uses', async () => {
    const authUserId = randomUUID();

    const registered = await register.execute(authUserId, INPUT);
    const read = await getMyIdentity.execute(authUserId);

    expect(read).toEqual(registered);
    expect(read.professional).toEqual({
      type: 'nutritionist',
      councilNumber: 'CRN-3 12345',
      specialty: 'Nutrição esportiva',
    });
  });

  it('refuses to turn a patient into a professional', async () => {
    // A profile that is not a professional's, written straight into the table:
    // the patient's own registration is another card, and what this test needs
    // is the row, not the flow that creates it. No data of a real person —
    // random id, and a name that is a label.
    const authUserId = randomUUID();

    await pool.query(
      `insert into identity.profile (auth_user_id, role, full_name, time_zone)
       values ($1, 'patient', 'Paciente de teste', 'America/Sao_Paulo')`,
      [authUserId],
    );

    await expect(register.execute(authUserId, INPUT)).rejects.toThrow(
      ProfileIsNotProfessionalError,
    );

    // And the read of that person says so too: no professional half, and no
    // practice.
    const identity = await getMyIdentity.execute(authUserId);

    expect(identity.professional).toBeNull();
    expect(identity.organizations).toEqual([]);
  });
});

/** Every organization in the schema, whoever it belongs to. */
async function totalOrganizations(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'select count(*) from identity.organization',
  );

  return Number(rows[0]?.count ?? 0);
}
