import { z } from 'zod';

import { type AuthenticatedUser } from './authenticated-user';

/**
 * The pure half of authentication: reading the header and reading the claims.
 * No crypto, no NestJS, no I/O — `supabase-token-verifier.ts` is what checks
 * the signature.
 */

/**
 * The `aud` Supabase Auth puts in the access token of a signed-in user. An
 * anonymous token or a service token does not carry it, which is exactly what
 * the audience check is for.
 */
export const AUTHENTICATED_AUDIENCE = 'authenticated';

/** Why a token was refused. A code for the log — never the token itself. */
export type InvalidAccessTokenReason =
  /** No `Authorization: Bearer <token>` header. */
  | 'missing'
  /** Not three base64url parts, or not a JWT at all. */
  | 'malformed'
  /** Signed with something other than HS256, `alg: none` included. */
  | 'algorithm'
  /** The HS256 signature does not match our secret. */
  | 'signature'
  /** Past `exp`. */
  | 'expired'
  /** `aud` is not `authenticated`. */
  | 'audience'
  /** A claim we need is missing or unusable (`sub`, `role`, `exp`). */
  | 'claims';

/**
 * The token is not usable. Not a `DomainError`: authentication happens before
 * any use case, and the domain has no idea that bearer tokens exist. The guard
 * is what turns this into a 401.
 */
export class InvalidAccessTokenError extends Error {
  constructor(readonly reason: InvalidAccessTokenReason) {
    // The reason, and nothing from the token: this message may be logged.
    super(`access token rejected: ${reason}`);
    this.name = 'InvalidAccessTokenError';
  }
}

/** `Bearer <token>`, with the scheme compared case insensitively, as RFC 6750 asks. */
const BEARER = /^Bearer[ ]+(?<token>[^ ]+)$/i;

/**
 * The token out of an `Authorization` header.
 *
 * Only this header. Not a query parameter — a URL ends up in an access log, in
 * a `Referer` and in the browser's history — and not a cookie, which would put
 * the API inside the browser's CSRF story for nothing: the panel and the app
 * both hold the token in memory and send it here.
 *
 * @throws InvalidAccessTokenError when there is no bearer token to read
 */
export function readBearerToken(header: string | string[] | undefined): string {
  // Two `Authorization` headers is not something a legitimate client sends,
  // and picking one of them would be guessing.
  if (typeof header !== 'string') {
    throw new InvalidAccessTokenError('missing');
  }

  const token = BEARER.exec(header.trim())?.groups?.['token'];

  if (token === undefined) {
    throw new InvalidAccessTokenError('missing');
  }

  return token;
}

/**
 * The claims the API insists on, out of everything Supabase puts in the token.
 *
 * `exp` and `aud` are checked by the verifier, which has a clock and the
 * secret. What is left here is who the caller is.
 */
const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.string().min(1),
});

/**
 * The caller, from the claims of an **already verified** token.
 *
 * A missing `role` is a refusal and not a default: Supabase always sends it,
 * and inventing an `authenticated` here would hand a silent fallback to every
 * authorization check downstream. A 401 is visible; a fabricated role is not.
 *
 * @param payload the verified claims set. `unknown` on purpose: this function
 *   must not become the place where a payload is trusted for its type.
 * @throws InvalidAccessTokenError when a claim the API needs is not there
 */
export function readAuthenticatedUser(payload: unknown): AuthenticatedUser {
  const parsed = claimsSchema.safeParse(payload);

  if (!parsed.success) {
    throw new InvalidAccessTokenError('claims');
  }

  return { id: parsed.data.sub, role: parsed.data.role };
}
