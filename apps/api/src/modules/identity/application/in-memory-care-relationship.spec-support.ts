import { randomUUID } from 'node:crypto';

import { type CareRelationship, type EndedCareRelationship } from '../domain/care-relationship';
import { type CareRelationshipRepository } from './ports/care-relationship.port';

/** A row of `identity.care_relationship`, as this double keeps it: never deleted. */
interface CareRelationshipRow {
  readonly id: string;
  readonly organizationId: string;
  readonly patientProfileId: string;
  readonly invitationId: string;
  readonly startedAt: Date;
  endedAt: Date | null;
}

/**
 * The care links without a database, for the tests that are about the use case
 * and not about the SQL (card I-07).
 *
 * What it reproduces faithfully is the two things the use case leans on:
 * **ending dates the row and never removes it** — `rows` keeps every link ever
 * written, so a unit test can assert the card's "nenhum dado do paciente é
 * apagado" without Postgres — and **a link is only visible to a professional
 * of its own practice**, which is what the join to `organization_member` makes
 * true in the real query.
 *
 * What only the real one can prove is that the professional's access is gone on
 * the next request, that the two sides ending at the same instant date the row
 * once, and that nothing was deleted from the five tables of a patient; that is
 * `end-care-relationship.use-case.integration-spec.ts` (CLAUDE.md, "Testes").
 * No data of a real person goes in here: every id is random and nothing has a
 * name.
 */
export class InMemoryCareRelationshipRepository implements CareRelationshipRepository {
  /** Every row ever written. Nothing in here removes one, ever. */
  readonly rows: CareRelationshipRow[] = [];

  /** `profileId` of each professional, against the practices they belong to. */
  private readonly memberships = new Map<string, Set<string>>();

  /** A professional of a practice, as the registration of card I-01 creates one. */
  addProfessional(
    options: { readonly profileId?: string; readonly organizationId?: string } = {},
  ): { profileId: string; organizationId: string } {
    const profileId = options.profileId ?? randomUUID();
    const organizationId = options.organizationId ?? randomUUID();

    const practices = this.memberships.get(profileId) ?? new Set<string>();
    practices.add(organizationId);
    this.memberships.set(profileId, practices);

    return { profileId, organizationId };
  }

  /** A care link, as accepting an invitation creates one (card I-03). */
  addCareRelationship(
    organizationId: string,
    patientProfileId: string,
    endedAt: Date | null = null,
  ): CareRelationship {
    const row: CareRelationshipRow = {
      id: randomUUID(),
      organizationId,
      patientProfileId,
      invitationId: randomUUID(),
      startedAt: new Date('2026-10-01T12:00:00.000Z'),
      endedAt,
    };

    this.rows.push(row);

    return { ...row };
  }

  findOfProfessional(
    professionalProfileId: string,
    patientProfileId: string,
  ): Promise<readonly CareRelationship[]> {
    const practices = this.memberships.get(professionalProfileId) ?? new Set<string>();

    return Promise.resolve(
      this.rows
        .filter(
          (row) => row.patientProfileId === patientProfileId && practices.has(row.organizationId),
        )
        .map((row) => ({ ...row })),
    );
  }

  findOfPatient(
    patientProfileId: string,
    careRelationshipId: string,
  ): Promise<CareRelationship | undefined> {
    const found = this.rows.find(
      (row) => row.id === careRelationshipId && row.patientProfileId === patientProfileId,
    );

    return Promise.resolve(found === undefined ? undefined : { ...found });
  }

  end(careRelationshipId: string, endedAt: Date): Promise<EndedCareRelationship | undefined> {
    // What `is null` in the real `where` does: only an active link is dated,
    // so the second ending of the same follow-up writes nothing.
    const active = this.rows.find((row) => row.id === careRelationshipId && row.endedAt === null);

    if (active === undefined) return Promise.resolve(undefined);

    active.endedAt = endedAt;

    return Promise.resolve({ ...active, endedAt });
  }
}
