/**
 * Who mints the secret half of an invitation link.
 *
 * It is a port, and not three lines inside the use case, for two reasons.
 * Generating a cryptographically random value and hashing it is platform work,
 * so it does not belong in `domain/` (CLAUDE.md rule 4) and the use case stays
 * free of `node:crypto`. And a test that has to know the token cannot guess a
 * good one — with the port, the test hands over an issuer it chose and the
 * production adapter stays the only thing that has to be unpredictable
 * (`infrastructure/crypto-invitation-token.issuer.ts`).
 */
export const INVITATION_TOKEN_ISSUER = Symbol('fit-app.identity.invitationTokenIssuer');

/**
 * A token and the hash of it, the only two forms it exists in.
 *
 * The token is answered to the professional once, in the creation, and is
 * never stored; the hash is what goes in the column, and it is what a future
 * acceptance looks the invitation up by. Losing the token is losing the link,
 * which is the point: a leaked database, a backup or a log line cannot rebuild
 * it.
 */
export interface IssuedInvitationToken {
  /** What goes in the link the professional sends on WhatsApp. */
  readonly token: string;
  /** What the database keeps in its place. */
  readonly tokenHash: string;
}

export interface InvitationTokenIssuer {
  issue(): IssuedInvitationToken;
}
