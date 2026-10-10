import { z } from 'zod';

/**
 * The environment the API reads, parsed and validated once at startup.
 *
 * `.env.example` at the repository root is the catalogue of every variable and
 * says which card each block belongs to; only the ones the API already uses
 * show up here.
 *
 * Nothing in this file ever logs a value: `DATABASE_URL` carries a password and
 * `SUPABASE_JWT_SECRET` is a signing key, and CLAUDE.md ("Saúde e LGPD")
 * forbids putting that kind of thing in a log. An error names the variable and
 * stops there.
 */
export type NodeEnv = 'development' | 'test' | 'production';

/** The levels pino understands, plus `silent`, which turns logging off. */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface ApiEnv {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly databaseUrl: string;
  /**
   * The secret Supabase Auth signs the access token with, and the one the API
   * verifies it with (ADR 0002: the login is theirs, the authorization is
   * ours). Required: an API that cannot check a token has no business
   * answering a request about a patient.
   */
  readonly supabaseJwtSecret: string;
  /** Origins allowed to call the API from a browser. Empty means "no browser". */
  readonly corsAllowedOrigins: readonly string[];
  readonly logLevel: LogLevel;
}

/** Startup failure: a variable is missing or unusable. Not a domain error. */
export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

const NODE_ENVS = ['development', 'test', 'production'] as const;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const DEFAULT_PORT = 3333;

/**
 * How noisy the API is when `LOG_LEVEL` says nothing: everything in
 * development, the usual `info` in production, and silence under jest, so a
 * test run does not print a log line per request.
 */
const DEFAULT_LOG_LEVEL: Readonly<Record<NodeEnv, LogLevel>> = {
  development: 'debug',
  test: 'silent',
  production: 'info',
};

/**
 * An absent variable and one set to the empty string mean the same thing: a
 * `.env` with `PORT=` has no port. Without this, `PORT=` would reach the
 * coercion and arrive as `0`.
 */
function blankToUndefined<Schema extends z.ZodType>(schema: Schema): z.ZodPreprocess<Schema> {
  return z.preprocess((raw) => (raw === '' ? undefined : raw), schema);
}

const PORT_MESSAGE = 'must be an integer between 1 and 65535';

const DATABASE_URL_MISSING =
  'is required: copy .env.example to .env and start the local stack with `pnpm db:start`';

/**
 * Supabase generates a 40 character secret. Refusing anything shorter is what
 * keeps a placeholder like `changeme` from becoming the key that guards every
 * patient's data: HS256 is only as strong as the secret behind it.
 */
const MIN_JWT_SECRET_LENGTH = 32;

const JWT_SECRET_MISSING =
  'is required: read it from `pnpm exec supabase status -o env` and put it in .env';

const JWT_SECRET_TOO_SHORT =
  `must be at least ${MIN_JWT_SECRET_LENGTH} characters: the one Supabase generates has 40, ` +
  'and a short secret is a guessable signing key';

const envSchema = z.object({
  NODE_ENV: blankToUndefined(
    z.enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(', ')}` }).default('development'),
  ),

  PORT: blankToUndefined(
    z.coerce
      .number({ error: PORT_MESSAGE })
      .int({ error: PORT_MESSAGE })
      .min(1, { error: PORT_MESSAGE })
      .max(65535, { error: PORT_MESSAGE })
      .default(DEFAULT_PORT),
  ),

  DATABASE_URL: blankToUndefined(
    z
      .string({
        error: (issue) => (issue.input === undefined ? DATABASE_URL_MISSING : 'must be text'),
      })
      // Checked by shape, not by connecting: the point is to catch a typo at
      // startup instead of on the first query. The message never quotes the
      // value, which is a connection string with a password in it.
      .regex(/^postgres(ql)?:\/\//, {
        error: 'must be a Postgres connection string, starting with postgresql://',
      }),
  ),

  // Like `DATABASE_URL`, this one is a credential: the error says how long it
  // has to be and never shows what came in.
  SUPABASE_JWT_SECRET: blankToUndefined(
    z
      .string({
        error: (issue) => (issue.input === undefined ? JWT_SECRET_MISSING : 'must be text'),
      })
      .min(MIN_JWT_SECRET_LENGTH, { error: JWT_SECRET_TOO_SHORT }),
  ),

  /** A comma separated list, as `.env.example` writes it. */
  CORS_ALLOWED_ORIGINS: blankToUndefined(z.string().default('')),

  LOG_LEVEL: blankToUndefined(
    z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` }).optional(),
  ),
});

/** Blank entries are dropped so a trailing comma is not read as an origin. */
function readOrigins(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/**
 * Every problem in one message, one line per variable, so a deploy with three
 * variables missing takes one round instead of three.
 *
 * Only the name of the variable and what is wrong with it: a value never goes
 * into the message, because this text ends up in a terminal and in CloudWatch.
 */
function describe(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);

  return [
    'Invalid environment. The API did not start because of these variables:',
    ...lines,
    'See .env.example at the root of the repository. No value is printed here on purpose.',
  ].join('\n');
}

/**
 * Pure: it reads the object it is given, never `process.env` by itself, which
 * is what makes it testable and keeps the parsing out of the modules.
 *
 * @throws EnvironmentError naming every variable that is missing or unusable
 */
export function loadEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new EnvironmentError(describe(parsed.error));
  }

  const { NODE_ENV, PORT, DATABASE_URL, SUPABASE_JWT_SECRET, CORS_ALLOWED_ORIGINS, LOG_LEVEL } =
    parsed.data;

  return {
    nodeEnv: NODE_ENV,
    port: PORT,
    databaseUrl: DATABASE_URL,
    supabaseJwtSecret: SUPABASE_JWT_SECRET,
    corsAllowedOrigins: readOrigins(CORS_ALLOWED_ORIGINS),
    logLevel: LOG_LEVEL ?? DEFAULT_LOG_LEVEL[NODE_ENV],
  };
}
