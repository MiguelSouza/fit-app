import { InvalidAccessTokenError, type InvalidAccessTokenReason } from './access-token';
import {
  OTHER_JWT_SECRET,
  TEST_JWT_SECRET,
  TEST_USER_ID,
  signAccessToken,
} from './local-access-token.spec-support';
import { SupabaseTokenVerifier } from './supabase-token-verifier';
import { type ApiEnv } from '../config/env';

/**
 * The three checks the card asks for — signature, expiration, audience — on
 * tokens minted here, with the same symmetric secret Supabase would use. The
 * tokens a real project hands out are the happy case; the interesting ones
 * (expired, forged, wrong audience, `alg: none`) only exist locally.
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: TEST_JWT_SECRET,
  corsAllowedOrigins: [],
  jobsEnabled: false,
  logLevel: 'silent',
};

const verifier = new SupabaseTokenVerifier(env);

async function reasonOf(token: string): Promise<InvalidAccessTokenReason> {
  try {
    await verifier.verify(token);
  } catch (error) {
    if (error instanceof InvalidAccessTokenError) return error.reason;
    throw error;
  }

  throw new Error('expected the token to be refused');
}

describe('SupabaseTokenVerifier', () => {
  it('accepts a token the project signed, and says who it belongs to', async () => {
    await expect(verifier.verify(await signAccessToken())).resolves.toEqual({
      id: TEST_USER_ID,
      role: 'authenticated',
    });
  });

  it('accepts a token that expires in a second', async () => {
    const token = await signAccessToken({ expiresInSeconds: 1 });

    await expect(verifier.verify(token)).resolves.toMatchObject({ id: TEST_USER_ID });
  });

  it('refuses a token that has expired', async () => {
    await expect(reasonOf(await signAccessToken({ expiresInSeconds: -1 }))).resolves.toBe(
      'expired',
    );
  });

  it('refuses a token signed with another secret', async () => {
    // What a token from another Supabase project, or a forged one, looks like.
    await expect(reasonOf(await signAccessToken({ secret: OTHER_JWT_SECRET }))).resolves.toBe(
      'signature',
    );
  });

  it('refuses a token whose payload was edited after signing', async () => {
    const [header, payload, signature] = (await signAccessToken()).split('.');
    const edited = Buffer.from(JSON.stringify({ sub: 'someone-else', role: 'authenticated' }))
      .toString('base64url')
      .replace(/=+$/, '');

    expect(payload).not.toBe(edited);

    await expect(reasonOf(`${header}.${edited}.${signature}`)).resolves.toBe('signature');
  });

  it('refuses a token for another audience', async () => {
    await expect(reasonOf(await signAccessToken({ audience: 'admin' }))).resolves.toBe('audience');
  });

  it('refuses a token with no audience at all', async () => {
    await expect(reasonOf(await signAccessToken({ without: ['aud'] }))).resolves.toBe('audience');
  });

  it("refuses the project's own api keys, signed as they are with this secret", async () => {
    // `anon` and `service_role` are JWTs the project signs with the very
    // secret this verifier holds, and the `anon` one ships inside the panel and
    // the app for anyone to read. What keeps one of them from passing as a
    // person is that they carry no `aud: authenticated` and no `sub`.
    const apiKey = await signAccessToken({ role: 'anon', without: ['aud', 'sub'] });

    await expect(verifier.verify(apiKey)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('refuses an unsigned token, however well formed', async () => {
    // `alg: none` is the oldest trick there is, and the one a pinned algorithm
    // list exists to stop.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: TEST_USER_ID,
        role: 'authenticated',
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    await expect(reasonOf(`${header}.${payload}.`)).resolves.toBe('algorithm');
  });

  it('refuses a token signed with an algorithm the API does not accept', async () => {
    await expect(reasonOf(await signAccessToken({ algorithm: 'HS512' }))).resolves.toBe(
      'algorithm',
    );
  });

  it('refuses a token that never expires', async () => {
    await expect(reasonOf(await signAccessToken({ without: ['exp'] }))).resolves.toBe('claims');
  });

  it('refuses a token without the claims the API needs', async () => {
    await expect(reasonOf(await signAccessToken({ without: ['sub'] }))).resolves.toBe('claims');
    await expect(reasonOf(await signAccessToken({ without: ['role'] }))).resolves.toBe('claims');
  });

  it('refuses something that is not a token', async () => {
    await expect(reasonOf('')).resolves.toBe('malformed');
    await expect(reasonOf('not-a-jwt')).resolves.toBe('malformed');
    await expect(reasonOf('a.b.c')).resolves.toBe('malformed');
  });

  it('never quotes the token or the secret in the error', async () => {
    const token = await signAccessToken({ secret: OTHER_JWT_SECRET });

    await expect(verifier.verify(token)).rejects.toThrow(/^access token rejected: [a-z]+$/);
  });
});
