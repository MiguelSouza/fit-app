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

  /**
   * The hash of a token somebody handed in, so the acceptance can look the row
   * up by the unique index on `token_hash`.
   *
   * It is here and not a second port: hashing is the other half of issuing,
   * and the two have to agree on the algorithm — a test that swaps the issuer
   * swaps both at once and cannot end up hashing with one and comparing
   * against the other.
   */
  hashOf(token: string): string;
}
