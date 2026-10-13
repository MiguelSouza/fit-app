import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { JOSEError, JWTClaimValidationFailed } from 'jose/errors';

import { type ApiEnv } from '../config/env';
import { ENV } from '../config/env.module';
import {
  AUTHENTICATED_AUDIENCE,
  InvalidAccessTokenError,
  readAuthenticatedUser,
  type InvalidAccessTokenReason,
} from './access-token';
import { type AuthenticatedUser } from './authenticated-user';

/**
 * The only algorithm the API accepts.
 *
 * Pinning it is the whole point: without this, a token's own header would get
 * to say how it is verified, which is the algorithm confusion attack. jose
 * refuses `alg: none` on its own, and this list refuses everything else
 * Supabase does not use.
 *
 * Supabase signs the access token with HS256 and the project's JWT secret.
 * Asymmetric signing keys with a JWKS endpoint are the other way of doing
 * this, and they are deliberately out: they mean a network call in the request
 * path and a cache to keep, and the secret is what `.env.example` and the
 * local stack already hand out. Switching later means this file and one
 * variable (see ADR 0007).
 */
const ALGORITHMS = ['HS256'];

/**
 * Claims that have to be present for the token to mean anything, beyond the
 * `aud` the `audience` option already requires. `exp` is listed because a
 * token without it never expires, and jose only enforces `exp` when it is
 * there.
 */
const REQUIRED_CLAIMS = ['sub', 'exp', 'role'];

/** jose's stable error codes, as the reason the API logs. */
const REASON_BY_CODE: Readonly<Record<string, InvalidAccessTokenReason>> = {
  ERR_JWS_SIGNATURE_VERIFICATION_FAILED: 'signature',
  ERR_JWT_EXPIRED: 'expired',
  ERR_JOSE_ALG_NOT_ALLOWED: 'algorithm',
  ERR_JOSE_NOT_SUPPORTED: 'algorithm',
  ERR_JWS_INVALID: 'malformed',
  ERR_JWT_INVALID: 'malformed',
  ERR_JWT_CLAIM_VALIDATION_FAILED: 'claims',
};

/**
 * Checks that an access token really came from our Supabase project and says
 * who it belongs to. Signature, expiration and audience, which is what the
 * card asks for, in that order — jose does all three before returning.
 *
 * The issuer is not checked and that is on purpose: with a shared secret, only
 * the project that holds it can produce a signature that passes, so `iss`
 * would add a variable to configure and nothing to the guarantee. A move to
 * asymmetric keys changes that, and the `issuer` option is where it goes.
 */
@Injectable()
export class SupabaseTokenVerifier {
  private readonly secret: Uint8Array;

  constructor(@Inject(ENV) env: ApiEnv) {
    // Encoded once, at startup. The secret stays in this field and is never
    // logged, returned or put in an error message.
    this.secret = new TextEncoder().encode(env.supabaseJwtSecret);
  }

  /**
   * @param token the compact JWS from the `Authorization` header
   * @throws InvalidAccessTokenError when the token is not one we issued, is
   *   past its expiration, or does not carry the claims the API needs
   */
  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ALGORITHMS,
        audience: AUTHENTICATED_AUDIENCE,
        requiredClaims: REQUIRED_CLAIMS,
      });

      return readAuthenticatedUser(payload);
    } catch (error) {
      throw asInvalidAccessToken(error);
    }
  }
}

/**
 * A jose failure as one of our reasons. Anything that is not jose's — and not
 * already ours — comes back untouched, so a bug in here surfaces as a 500 and
 * not as a 401 blaming the caller for it.
 */
function asInvalidAccessToken(error: unknown): unknown {
  if (error instanceof InvalidAccessTokenError) return error;

  // Checked before the code table: this is the error that knows *which* claim
  // failed, and `aud` is the one the card names.
  if (error instanceof JWTClaimValidationFailed) {
    return new InvalidAccessTokenError(error.claim === 'aud' ? 'audience' : 'claims');
  }

  if (error instanceof JOSEError) {
    const reason = REASON_BY_CODE[error.code];

    if (reason !== undefined) return new InvalidAccessTokenError(reason);
  }

  return error;
}
