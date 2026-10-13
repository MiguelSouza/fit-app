import {
  InvalidAccessTokenError,
  isRoutineRefusal,
  readAuthenticatedUser,
  readBearerToken,
  type InvalidAccessTokenReason,
} from './access-token';

/**
 * The pure half of authentication: what counts as a bearer token in a header,
 * and which claims the API insists on. No crypto here — the signature is
 * `supabase-token-verifier.spec.ts`.
 */
function reasonOf(read: () => unknown): InvalidAccessTokenReason {
  try {
    read();
  } catch (error) {
    if (error instanceof InvalidAccessTokenError) return error.reason;
    throw error;
  }

  throw new Error('expected the token to be refused');
}

describe('readBearerToken', () => {
  it('reads the token out of an Authorization header', () => {
    expect(readBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts the scheme in any case, as RFC 6750 asks', () => {
    expect(readBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(readBearerToken('BEARER abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(readBearerToken('  Bearer   abc.def.ghi  ')).toBe('abc.def.ghi');
  });

  it('refuses a request with no Authorization header', () => {
    expect(reasonOf(() => readBearerToken(undefined))).toBe('missing');
  });

  it('refuses another authentication scheme', () => {
    expect(reasonOf(() => readBearerToken('Basic dXNlcjpwYXNz'))).toBe('missing');
    expect(reasonOf(() => readBearerToken('abc.def.ghi'))).toBe('missing');
  });

  it('refuses a Bearer with nothing after it', () => {
    expect(reasonOf(() => readBearerToken('Bearer'))).toBe('missing');
    expect(reasonOf(() => readBearerToken('Bearer   '))).toBe('missing');
  });

  it('refuses two Authorization headers instead of picking one', () => {
    // Express hands over an array for a repeated header; choosing would be
    // guessing which one the client meant.
    expect(reasonOf(() => readBearerToken(['Bearer one', 'Bearer two']))).toBe('missing');
  });

  it('never puts the token in the error it throws', () => {
    const error = new InvalidAccessTokenError('signature');

    expect(error.message).toBe('access token rejected: signature');
  });
});

describe('readAuthenticatedUser', () => {
  it('takes the id from sub and the role from role', () => {
    expect(readAuthenticatedUser({ sub: 'pat_1', role: 'authenticated', aud: 'authenticated' })) //
      .toEqual({ id: 'pat_1', role: 'authenticated' });
  });

  it('ignores every other claim, including the personal ones', () => {
    // A token carries the e-mail and the phone. Neither belongs in the object
    // the API passes around and logs (CLAUDE.md, "Saúde e LGPD").
    expect(
      readAuthenticatedUser({
        sub: 'pat_1',
        role: 'authenticated',
        email: 'ana@example.com',
        phone: '+5511999999999',
        user_metadata: { name: 'Ana' },
      }),
    ).toEqual({ id: 'pat_1', role: 'authenticated' });
  });

  it('refuses a token without sub', () => {
    expect(reasonOf(() => readAuthenticatedUser({ role: 'authenticated' }))).toBe('claims');
  });

  it('refuses an empty sub instead of reading it as a user', () => {
    expect(reasonOf(() => readAuthenticatedUser({ sub: '', role: 'authenticated' }))).toBe(
      'claims',
    );
  });

  it('refuses a token without a role instead of assuming one', () => {
    // A fabricated default would be invisible to every authorization check
    // downstream; a 401 is not.
    expect(reasonOf(() => readAuthenticatedUser({ sub: 'pat_1' }))).toBe('claims');
  });

  it('refuses claims that are not even an object', () => {
    expect(reasonOf(() => readAuthenticatedUser(null))).toBe('claims');
    expect(reasonOf(() => readAuthenticatedUser('pat_1'))).toBe('claims');
  });
});

describe('isRoutineRefusal', () => {
  it('counts a missing and an expired token as traffic', () => {
    // Nobody signed in yet, and a session that ran out mid-use. Both happen
    // all day and stay at `debug`.
    expect(isRoutineRefusal('missing')).toBe(true);
    expect(isRoutineRefusal('expired')).toBe(true);
  });

  it('counts anything this project did not issue as worth a log line', () => {
    // These reach the production log, where the level is `info`: each one is a
    // token that was made somewhere else.
    for (const reason of ['signature', 'algorithm', 'audience', 'claims', 'malformed'] as const) {
      expect(isRoutineRefusal(reason)).toBe(false);
    }
  });
});
