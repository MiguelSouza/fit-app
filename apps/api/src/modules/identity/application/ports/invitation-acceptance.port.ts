import { type Invitation } from '../../domain/invitation';
import {
  type AcceptedInvitation,
  type InvitationAcceptance,
} from '../../domain/invitation-acceptance';

/**
 * Where the patient's side of an invitation is written (card I-03).
 *
 * It is a port of its own, next to `InvitationRepository`, and not two more
 * methods on it, because what it writes is not an invitation: accepting one
 * creates a profile, a patient, a care link and the consents, and marks the
 * invitation as used — **all of it in one transaction**, which is what the
 * card asks for and what makes a half joined patient impossible. The
 * professional's side of the invitation has no business growing that reach.
 *
 * Like the ports next door it is not an abstraction per table (CLAUDE.md rule
 * 5): it exists so `application/` holds no Drizzle, and so the use case can be
 * driven without a database. What only a real Postgres can prove — the
 * transaction rolling back as a whole, the unique indexes that decide a double
 * acceptance, the profile keyed by the Supabase user id — is
 * `accept-invitation.use-case.integration-spec.ts` (CLAUDE.md, "Testes").
 */
export const INVITATION_ACCEPTANCE_REPOSITORY = Symbol(
  'fit-app.identity.invitationAcceptanceRepository',
);

export interface InvitationAcceptanceRepository {
  /**
   * The invitation a token opens, whatever state it is in, or `undefined` when
   * no row has that hash.
   *
   * It takes the **hash** and never the token: the column holds a digest (ADR
   * 0015), so the lookup is one index probe and the token itself does not
   * travel past the use case. Nothing is filtered out here — an expired, a
   * revoked and an accepted invitation all come back — because what to say
   * about each is the domain's answer, and "não encontrado" for all three
   * would tell the patient to ask for a new link when the truth is that they
   * already used this one.
   */
  findByTokenHash(tokenHash: string): Promise<Invitation | undefined>;

  /**
   * Writes the acceptance: the profile and the patient if they are not there
   * yet, the active care link in the invitation's practice, the consents that
   * are not already in force, and the invitation marked as accepted. One
   * transaction, so either the patient is in or nothing happened.
   *
   * Answers `undefined` when the invitation was no longer acceptable by the
   * time the write ran — used, revoked or expired. The condition lives in the
   * write itself, which is what makes the criterion "convite usado não pode
   * ser reutilizado" hold for two acceptances of the same link at the same
   * instant: the database decides, not a value this process read a moment ago.
   */
  accept(acceptance: InvitationAcceptance): Promise<AcceptedInvitation | undefined>;
}
