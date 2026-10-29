import { type Invitation, type InvitationToCreate } from '../../domain/invitation';

/**
 * Where the invitations of `identity` are kept.
 *
 * Like `IdentityRegistry` next door, it is not an abstraction per table
 * (CLAUDE.md rule 5) but the four operations the use cases of card I-02 make,
 * named after what they mean. It exists so `application/` holds no Drizzle and
 * so the use cases can be driven without a database; what only the database
 * can enforce — the unique token hash, the organization's rows and nobody
 * else's — is covered by the integration test against a real Postgres
 * (CLAUDE.md, "Testes").
 *
 * **The organization is a parameter of every operation that touches a row the
 * caller did not just create.** Not a convenience: it is how "o convite
 * pertence à organização do profissional" survives a use case that forgets to
 * check, because a query scoped to another practice finds nothing.
 */
export const INVITATION_REPOSITORY = Symbol('fit-app.identity.invitationRepository');

export interface InvitationRepository {
  /** Writes the invitation and answers it as it was stored, id and all. */
  create(invitation: InvitationToCreate): Promise<Invitation>;

  /** The organization's invitations, the most recent first. */
  listByOrganization(organizationId: string): Promise<readonly Invitation[]>;

  /**
   * One invitation of that organization, or `undefined` when there is none —
   * which is also the answer when the id belongs to another practice.
   */
  findById(invitationId: string, organizationId: string): Promise<Invitation | undefined>;

  /**
   * Marks a **pending** invitation as revoked, and answers it.
   *
   * `undefined` means nothing was written: the id is not this organization's,
   * or the invitation was no longer pending by the time the write ran —
   * accepted, revoked or expired. The whole condition lives in the write
   * itself, so two revocations, or a revocation racing an acceptance, cannot
   * both win.
   *
   * @param revokedAt when the professional asked, which is also the instant
   *   the expiry is measured against
   */
  revoke(
    invitationId: string,
    organizationId: string,
    revokedAt: Date,
  ): Promise<Invitation | undefined>;
}
