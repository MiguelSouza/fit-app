import { randomUUID } from 'node:crypto';

import { type Invitation, type InvitationToCreate } from '../domain/invitation';
import { type InvitationRepository } from './ports/invitation-repository.port';

/**
 * The invitation repository without a database, for the tests that are about
 * the use cases and not about the SQL.
 *
 * What it reproduces faithfully is what the use cases lean on: a row is only
 * ever found inside its own organization, the list comes back the most recent
 * first, and a revocation writes nothing unless the invitation is still
 * pending. What only the real one can prove — the unique index on the token
 * hash, the column that holds a hash and not a token, the conditional update
 * deciding a race — is `invitations.use-case.integration-spec.ts`, against a
 * real Postgres (CLAUDE.md, "Testes").
 */
export class InMemoryInvitationRepository implements InvitationRepository {
  private readonly rows = new Map<string, Invitation>();

  /** Every hash written, in order, so a test can assert the token was not stored. */
  readonly tokenHashes: string[] = [];

  constructor(initial: readonly Invitation[] = []) {
    for (const invitation of initial) this.rows.set(invitation.id, invitation);
  }

  create(invitation: InvitationToCreate): Promise<Invitation> {
    const created: Invitation = {
      id: randomUUID(),
      organizationId: invitation.organizationId,
      name: invitation.name,
      contact: invitation.contact,
      createdAt: new Date(),
      expiresAt: invitation.expiresAt,
      acceptedAt: null,
      revokedAt: null,
    };

    this.rows.set(created.id, created);
    this.tokenHashes.push(invitation.tokenHash);

    return Promise.resolve(created);
  }

  listByOrganization(organizationId: string): Promise<readonly Invitation[]> {
    const invitations = [...this.rows.values()]
      .filter((invitation) => invitation.organizationId === organizationId)
      .sort((one, other) => other.createdAt.getTime() - one.createdAt.getTime());

    return Promise.resolve(invitations);
  }

  findById(invitationId: string, organizationId: string): Promise<Invitation | undefined> {
    const found = this.rows.get(invitationId);

    return Promise.resolve(found?.organizationId === organizationId ? found : undefined);
  }

  revoke(
    invitationId: string,
    organizationId: string,
    revokedAt: Date,
  ): Promise<Invitation | undefined> {
    const found = this.rows.get(invitationId);

    // The same condition the `update ... where` of the real one carries: the
    // organization's row, still pending at this instant.
    if (
      found === undefined ||
      found.organizationId !== organizationId ||
      found.acceptedAt !== null ||
      found.revokedAt !== null ||
      found.expiresAt.getTime() < revokedAt.getTime()
    ) {
      return Promise.resolve(undefined);
    }

    const revoked: Invitation = { ...found, revokedAt };

    this.rows.set(invitationId, revoked);

    return Promise.resolve(revoked);
  }

  /** Lets a test make an invitation accepted, which no use case does yet. */
  markAccepted(invitationId: string, acceptedAt: Date): void {
    const found = this.rows.get(invitationId);

    if (found === undefined) throw new Error('no invitation with that id in the fake repository');

    this.rows.set(invitationId, { ...found, acceptedAt });
  }
}

/**
 * An invitation of a given practice, for a test that needs a row it did not
 * create through the use case. Pending by default, two weeks out.
 *
 * No data of a real person: the id is random and the name is a label
 * (CLAUDE.md, "Testes" — never real patient data, not even in a fixture).
 */
export function invitationRow(
  organizationId: string,
  overrides: Partial<Invitation> = {},
): Invitation {
  const createdAt = new Date();

  return {
    id: randomUUID(),
    organizationId,
    name: null,
    contact: null,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}
