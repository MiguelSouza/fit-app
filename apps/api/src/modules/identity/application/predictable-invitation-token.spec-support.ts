import {
  type InvitationTokenIssuer,
  type IssuedInvitationToken,
} from './ports/invitation-token.port';

/**
 * An issuer whose tokens a test knows in advance.
 *
 * It is the opposite of what the production adapter must be, which is the
 * point of the port: a test that has to assert "the answer carries the token
 * and the column carries its hash" needs to know both, and the only thing that
 * has to be unpredictable is the real issuer — tested on its own, in
 * `infrastructure/crypto-invitation-token.issuer.spec.ts`.
 *
 * The counter is what makes two invitations of the same test different,
 * without which a fake would hide a use case that issues one token and uses it
 * twice.
 */
export class PredictableInvitationTokenIssuer implements InvitationTokenIssuer {
  private issued = 0;

  /** Every token handed out, in order. */
  readonly tokens: string[] = [];

  issue(): IssuedInvitationToken {
    this.issued += 1;

    const token = `token-${String(this.issued)}`;

    this.tokens.push(token);

    return { token, tokenHash: hashOfPredictableToken(token) };
  }

  hashOf(token: string): string {
    return hashOfPredictableToken(token);
  }
}

/** How this fake "hashes": readable, and clearly not the token itself. */
export function hashOfPredictableToken(token: string): string {
  return `hash-of-${token}`;
}
