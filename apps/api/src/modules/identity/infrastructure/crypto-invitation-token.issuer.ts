import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  type InvitationTokenIssuer,
  type IssuedInvitationToken,
} from '../application/ports/invitation-token.port';

/**
 * The `InvitationTokenIssuer` over `node:crypto`.
 *
 * **Why 32 bytes.** The token is a bearer credential: whoever holds it joins a
 * practice as a patient. 256 bits from the operating system's CSPRNG
 * (`randomBytes`, which is `getrandom`/`BCryptGenRandom` underneath, not
 * `Math.random`) is not guessable and not enumerable — an attacker with the
 * whole fourteen day window and every request they can send gets nowhere near
 * it. `base64url` so the value goes in a URL with no escaping: 43 characters,
 * `A–Z a–z 0–9 - _`.
 *
 * **Why a plain SHA-256 for the hash, with no salt and no work factor.** This
 * is not a password. A password is short, human chosen and guessable, which is
 * what bcrypt and argon2 exist to slow down; a 256 bit random token has no
 * guessable neighbourhood, so there is nothing for an attacker to iterate
 * over and a salt protects against nothing. What the hash buys is the thing
 * that matters: the database never holds a usable link, so a dump, a backup or
 * a replica cannot be turned into access. And a plain digest is deterministic,
 * which is what lets the acceptance find the row by a unique index instead of
 * scanning and comparing.
 */
@Injectable()
export class CryptoInvitationTokenIssuer implements InvitationTokenIssuer {
  issue(): IssuedInvitationToken {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    return { token, tokenHash: hashInvitationToken(token) };
  }

  hashOf(token: string): string {
    return hashInvitationToken(token);
  }
}

/** 256 bits. See the note on the class. */
const TOKEN_BYTES = 32;

/**
 * What the database keeps in place of a token: its SHA-256, in hex.
 *
 * A function and not a method, so the acceptance use case of the next card and
 * the integration test can hash a token they already have without reaching for
 * the issuer.
 */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
