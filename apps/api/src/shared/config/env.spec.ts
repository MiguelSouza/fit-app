import { EnvironmentError, loadEnv } from './env';

/**
 * The startup gate: the API either gets an environment it can work with or it
 * does not start. What is tested here is the second half — that refusing to
 * start says which variable is wrong, and that it says it without printing the
 * value, because `DATABASE_URL` carries a password and `SUPABASE_JWT_SECRET` is
 * a signing key (CLAUDE.md, "Saúde e LGPD").
 */
const DATABASE_URL = 'postgresql://postgres:s3cr3t@127.0.0.1:54322/postgres';

/** 40 characters, as long as a hosted project's secret. Not a real secret. */
const SUPABASE_JWT_SECRET = 'local-development-jwt-secret-0123456789a';

/** The smallest environment the API accepts, so a test states only its own subject. */
const REQUIRED = { DATABASE_URL, SUPABASE_JWT_SECRET };

function messageFor(source: NodeJS.ProcessEnv): string {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvironmentError) return error.message;
    throw error;
  }

  throw new Error('expected loadEnv to reject this environment');
}

describe('loadEnv', () => {
  it('reads the variables the API uses', () => {
    expect(
      loadEnv({
        NODE_ENV: 'production',
        PORT: '8080',
        DATABASE_URL,
        SUPABASE_JWT_SECRET,
        CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://painel.example.com,',
        LOG_LEVEL: 'warn',
        JOBS_ENABLED: 'false',
      }),
    ).toEqual({
      nodeEnv: 'production',
      port: 8080,
      databaseUrl: DATABASE_URL,
      supabaseJwtSecret: SUPABASE_JWT_SECRET,
      corsAllowedOrigins: ['https://app.example.com', 'https://painel.example.com'],
      jobsEnabled: false,
      logLevel: 'warn',
    });
  });

  it('falls back to development defaults when only the required ones are set', () => {
    expect(loadEnv(REQUIRED)).toEqual({
      nodeEnv: 'development',
      port: 3333,
      databaseUrl: DATABASE_URL,
      supabaseJwtSecret: SUPABASE_JWT_SECRET,
      corsAllowedOrigins: [],
      jobsEnabled: true,
      logLevel: 'debug',
    });
  });

  it('is silent by default under test and informative in production', () => {
    expect(loadEnv({ ...REQUIRED, NODE_ENV: 'test' }).logLevel).toBe('silent');
    expect(loadEnv({ ...REQUIRED, NODE_ENV: 'production' }).logLevel).toBe('info');
  });

  it('treats a variable set to nothing as a variable that is not set', () => {
    // `PORT=` in a `.env` is not a port, and must not arrive as 0.
    expect(
      loadEnv({ ...REQUIRED, PORT: '', NODE_ENV: '', LOG_LEVEL: '', JOBS_ENABLED: '' }),
    ).toEqual({
      nodeEnv: 'development',
      port: 3333,
      databaseUrl: DATABASE_URL,
      supabaseJwtSecret: SUPABASE_JWT_SECRET,
      corsAllowedOrigins: [],
      jobsEnabled: true,
      logLevel: 'debug',
    });
  });

  it('refuses to start without DATABASE_URL, naming it', () => {
    const message = messageFor({ SUPABASE_JWT_SECRET });

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('is required');
  });

  it('refuses to start without SUPABASE_JWT_SECRET, naming it', () => {
    // An API that cannot verify a token has no business answering a request,
    // so this is a startup failure and not a 500 on the first call.
    const message = messageFor({ DATABASE_URL });

    expect(message).toContain('SUPABASE_JWT_SECRET');
    expect(message).toContain('is required');
  });

  it('rejects a jwt secret too short to be the one Supabase generated', () => {
    expect(messageFor({ DATABASE_URL, SUPABASE_JWT_SECRET: 'changeme' })).toContain(
      'at least 32 characters',
    );
  });

  it('names every bad variable in one message', () => {
    const message = messageFor({ PORT: 'abc', NODE_ENV: 'prod' });

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('SUPABASE_JWT_SECRET');
    expect(message).toContain('PORT');
    expect(message).toContain('NODE_ENV');
  });

  it('rejects a database url that is not a postgres connection string', () => {
    expect(messageFor({ ...REQUIRED, DATABASE_URL: 'mysql://root@127.0.0.1/fit' })).toContain(
      'Postgres connection string',
    );
  });

  it('rejects a port outside the valid range', () => {
    expect(messageFor({ ...REQUIRED, PORT: '70000' })).toContain(
      'must be an integer between 1 and 65535',
    );
  });

  it('never puts the value of a variable in the message', () => {
    // The message goes to a terminal and to CloudWatch; the connection string
    // has a password in it.
    const message = messageFor({
      DATABASE_URL: 'postgres-but-wrong://user:s3cr3t@host/db',
      SUPABASE_JWT_SECRET: 'short-and-wrong',
    });

    expect(message).not.toContain('s3cr3t');
    expect(message).not.toContain('postgres-but-wrong');
    expect(message).not.toContain('short-and-wrong');
  });

  it('runs the jobs everywhere but under jest, unless told otherwise', () => {
    // A worker in a test suite would mean a Postgres and a clock behind every
    // one of them (ADR 0009).
    expect(loadEnv({ ...REQUIRED, NODE_ENV: 'test' }).jobsEnabled).toBe(false);
    expect(loadEnv({ ...REQUIRED, NODE_ENV: 'production' }).jobsEnabled).toBe(true);
    expect(loadEnv({ ...REQUIRED, NODE_ENV: 'test', JOBS_ENABLED: 'true' }).jobsEnabled).toBe(true);
  });

  it('rejects a JOBS_ENABLED that is not true or false', () => {
    // `JOBS_ENABLED=no` must not read as "on", which is what a coerced
    // boolean would have made of it.
    expect(messageFor({ ...REQUIRED, JOBS_ENABLED: 'no' })).toContain('JOBS_ENABLED');
  });

  it('rejects a log level pino does not know', () => {
    expect(messageFor({ ...REQUIRED, LOG_LEVEL: 'loud' })).toContain('LOG_LEVEL');
  });
});
