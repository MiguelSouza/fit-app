import { EnvironmentError, loadEnv } from './env';

/**
 * The startup gate: the API either gets an environment it can work with or it
 * does not start. What is tested here is the second half — that refusing to
 * start says which variable is wrong, and that it says it without printing the
 * value, because `DATABASE_URL` carries a password (CLAUDE.md, "Saúde e LGPD").
 */
const DATABASE_URL = 'postgresql://postgres:s3cr3t@127.0.0.1:54322/postgres';

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
        CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://painel.example.com,',
        LOG_LEVEL: 'warn',
      }),
    ).toEqual({
      nodeEnv: 'production',
      port: 8080,
      databaseUrl: DATABASE_URL,
      corsAllowedOrigins: ['https://app.example.com', 'https://painel.example.com'],
      logLevel: 'warn',
    });
  });

  it('falls back to development defaults when only the database is set', () => {
    expect(loadEnv({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      port: 3333,
      databaseUrl: DATABASE_URL,
      corsAllowedOrigins: [],
      logLevel: 'debug',
    });
  });

  it('is silent by default under test and informative in production', () => {
    expect(loadEnv({ NODE_ENV: 'test', DATABASE_URL }).logLevel).toBe('silent');
    expect(loadEnv({ NODE_ENV: 'production', DATABASE_URL }).logLevel).toBe('info');
  });

  it('treats a variable set to nothing as a variable that is not set', () => {
    // `PORT=` in a `.env` is not a port, and must not arrive as 0.
    expect(loadEnv({ DATABASE_URL, PORT: '', NODE_ENV: '', LOG_LEVEL: '' })).toEqual({
      nodeEnv: 'development',
      port: 3333,
      databaseUrl: DATABASE_URL,
      corsAllowedOrigins: [],
      logLevel: 'debug',
    });
  });

  it('refuses to start without DATABASE_URL, naming it', () => {
    const message = messageFor({});

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('is required');
  });

  it('names every bad variable in one message', () => {
    const message = messageFor({ PORT: 'abc', NODE_ENV: 'prod' });

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message).toContain('NODE_ENV');
  });

  it('rejects a database url that is not a postgres connection string', () => {
    expect(messageFor({ DATABASE_URL: 'mysql://root@127.0.0.1/fit' })).toContain(
      'Postgres connection string',
    );
  });

  it('rejects a port outside the valid range', () => {
    expect(messageFor({ DATABASE_URL, PORT: '70000' })).toContain(
      'must be an integer between 1 and 65535',
    );
  });

  it('never puts the value of a variable in the message', () => {
    // The message goes to a terminal and to CloudWatch; the connection string
    // has a password in it.
    const message = messageFor({ DATABASE_URL: 'postgres-but-wrong://user:s3cr3t@host/db' });

    expect(message).not.toContain('s3cr3t');
    expect(message).not.toContain('postgres-but-wrong');
  });

  it('rejects a log level pino does not know', () => {
    expect(messageFor({ DATABASE_URL, LOG_LEVEL: 'loud' })).toContain('LOG_LEVEL');
  });
});
