import { SignJWT } from 'jose';

/**
 * Supabase access tokens minted here, in the test process.
 *
 * Nothing in the test suite talks to Supabase: the project's JWT secret is a
 * symmetric key, so a token signed with the same test secret the verifier was
 * given is byte for byte the kind of token the real one produces. That is what
 * lets a test cover an expired token, a forged signature and a wrong audience,
 * none of which Supabase would hand out on request.
 *
 * Not a `.spec.ts` file, so jest does not read it as a test suite, and excluded
 * from `tsconfig.build.json`, so a token signer never reaches `dist/`.
 */

/** 40 characters, as long as a hosted project's secret. Not a secret of anything. */
export const TEST_JWT_SECRET = 'test-only-jwt-secret-0123456789abcdefghi';

export const OTHER_JWT_SECRET = 'another-project-secret-0123456789abcdefg';

export function secretKey(secret: string = TEST_JWT_SECRET): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface TokenOptions {
  /** The `sub` claim: the Supabase user id. */
  readonly subject?: string | undefined;
  readonly role?: string | undefined;
  readonly audience?: string | undefined;
  /** Seconds from now until `exp`. Negative mints an already expired token. */
  readonly expiresInSeconds?: number | undefined;
  readonly algorithm?: string | undefined;
  readonly secret?: string | undefined;
  /** Dropped from the claims set before signing, to test a missing claim. */
  readonly without?: readonly string[] | undefined;
}

const DEFAULTS = {
  subject: '3f1c0a7e-0c2f-4f1a-9b8e-2d6c5a4b1e90',
  role: 'authenticated',
  audience: 'authenticated',
  expiresInSeconds: 3600,
  algorithm: 'HS256',
} as const;

/**
 * A token shaped like the one Supabase Auth issues, with whatever the test
 * needs changed. The defaults are a valid token for the default secret.
 */
export async function signAccessToken(options: TokenOptions = {}): Promise<string> {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const expiresInSeconds = options.expiresInSeconds ?? DEFAULTS.expiresInSeconds;

  const claims: Record<string, unknown> = {
    sub: options.subject ?? DEFAULTS.subject,
    role: options.role ?? DEFAULTS.role,
    aud: options.audience ?? DEFAULTS.audience,
    iss: 'http://127.0.0.1:54321/auth/v1',
    iat: nowInSeconds,
    exp: nowInSeconds + expiresInSeconds,
    session_id: 'f0f0f0f0-0000-4000-8000-000000000000',
  };

  for (const claim of options.without ?? []) delete claims[claim];

  return new SignJWT(claims)
    .setProtectedHeader({ alg: options.algorithm ?? DEFAULTS.algorithm, typ: 'JWT' })
    .sign(secretKey(options.secret));
}

/** The default subject, for a test that asserts `@CurrentUser()` got the right id. */
export const TEST_USER_ID = DEFAULTS.subject;
