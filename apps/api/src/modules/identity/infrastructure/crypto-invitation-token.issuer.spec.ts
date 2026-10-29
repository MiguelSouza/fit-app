import { createHash } from 'node:crypto';

import { CryptoInvitationTokenIssuer, hashInvitationToken } from './crypto-invitation-token.issuer';

/**
 * The acceptance criterion "token não é previsível", as far as a test can go.
 *
 * Unpredictability is not something a unit test proves — it comes from
 * `randomBytes`, the operating system's CSPRNG, and from the 256 bits of it
 * this issuer asks for. What a test can pin down is everything that would
 * quietly take those bits away: a shorter token, a token that is not url safe,
 * two draws that come back the same, and a column that ends up holding the
 * token instead of its digest.
 */
const DRAWS = 500;

describe('CryptoInvitationTokenIssuer', () => {
  const issuer = new CryptoInvitationTokenIssuer();

  it('issues 256 bits, url safe, with nothing to escape in a link', () => {
    const { token } = issuer.issue();

    // 32 bytes in base64url, unpadded.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('never issues the same token twice', () => {
    const tokens = new Set(Array.from({ length: DRAWS }, () => issuer.issue().token));

    expect(tokens.size).toBe(DRAWS);
  });

  it('hands over a hash that is not the token, and cannot be read back as one', () => {
    const { token, tokenHash } = issuer.issue();

    expect(tokenHash).not.toBe(token);
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('hashes the same token to the same value, which is how it is looked up', () => {
    const { token, tokenHash } = issuer.issue();

    expect(hashInvitationToken(token)).toBe(tokenHash);
  });

  it('hashes two tokens to two different values', () => {
    const first = issuer.issue();
    const second = issuer.issue();

    expect(second.tokenHash).not.toBe(first.tokenHash);
  });
});
