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

/**
 * Where an unexpected error goes besides the log, when it goes anywhere
 * (ADR 0013).
 *
 * The three fields travel together on purpose. A DSN alone would give Sentry
 * events nobody can act on: without the environment you cannot tell a crash in
 * staging from one a patient just had, and without the release you cannot tell
 * whether the bug is still deployed. So the environment has a default and the
 * release does not — turning Sentry on means saying which version is sending.
 */
export interface SentryConfig {
  readonly dsn: string;
  /** `development`, `test`, `production`, `staging`: free text, as Sentry treats it. */
  readonly environment: string;
  /** The image tag or the commit sha of this deploy. */
  readonly release: string;
}

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
  /**
   * Whether this process runs the job queue: connects pg-boss, installs the
   * schedules and works the queues (ADR 0009).
   *
   * On by default, because the API and its workers are the same ECS task. Off
   * under jest and wherever the process only needs the modules wired without
   * a database behind them — generating the OpenAPI document, for one.
   */
  readonly jobsEnabled: boolean;
  readonly logLevel: LogLevel;
  /**
   * Absent means the API reports to nobody: errors stay in the log, which is
   * what a laptop and a test run want. Present means `SENTRY_DSN` was set, and
   * then `SENTRY_RELEASE` had to be set too.
   */
  readonly sentry?: SentryConfig;
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
 * Whether the queue runs when `JOBS_ENABLED` says nothing: yes while
 * developing and in production, no under jest, where a worker would mean every
 * suite needing a Postgres and a clock.
 */
const DEFAULT_JOBS_ENABLED: Readonly<Record<NodeEnv, boolean>> = {
  development: true,
  test: false,
  production: true,
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
 * A floor, not the length of any secret Supabase hands out: the local stack's
 * has 55 characters and a hosted project's has 40. Refusing anything shorter is
 * what keeps a placeholder like `changeme` from becoming the key that guards
 * every patient's data: HS256 is only as strong as the secret behind it.
 */
const MIN_JWT_SECRET_LENGTH = 32;

const JWT_SECRET_MISSING =
  'is required: read it from `pnpm exec supabase status -o env` and put it in .env';

const JWT_SECRET_TOO_SHORT =
  `must be at least ${MIN_JWT_SECRET_LENGTH} characters: every secret Supabase hands out is ` +
  'longer than that, and a short one is a guessable signing key';

/**
 * The shape Sentry hands out, checked so a truncated copy and paste fails at
 * startup instead of making every event disappear quietly. The message never
 * quotes what came in: the DSN is not a secret, but nothing in this file
 * prints a value and this is no place to start.
 */
const SENTRY_DSN_SHAPE =
  'must be the DSN of the project, as Sentry shows it: https://<key>@<host>/<project id>';

const SENTRY_ENVIRONMENT_SHAPE =
  'must be a single word of at most 64 characters, without spaces or slashes, as Sentry requires';

const SENTRY_RELEASE_MISSING =
  'is required when SENTRY_DSN is set: an event that does not say which version sent it cannot ' +
  'tell you whether the bug is still deployed. Use the image tag or the commit sha';

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

  // Optional, and empty is the same as absent: a laptop and the CI have no
  // DSN, and the API must start all the same (ADR 0013).
  SENTRY_DSN: blankToUndefined(
    z
      .string()
      .regex(/^https:\/\/[^@\s]+@[^/\s]+\/\d+$/, { error: SENTRY_DSN_SHAPE })
      .optional(),
  ),

  // Defaults to `NODE_ENV` below. It exists because the two are not the same
  // question: a staging task runs with `NODE_ENV=production` and has to show
  // up in Sentry as `staging`.
  SENTRY_ENVIRONMENT: blankToUndefined(
    z
      .string()
      .regex(/^[^\s/]{1,64}$/, { error: SENTRY_ENVIRONMENT_SHAPE })
      .optional(),
  ),

  SENTRY_RELEASE: blankToUndefined(z.string().optional()),

  // A string, not `z.coerce.boolean()`: coercion reads every non-empty string
  // as `true`, so `JOBS_ENABLED=no` would turn the workers on.
  JOBS_ENABLED: blankToUndefined(
    z
      .enum(['true', 'false'], { error: "must be 'true' or 'false'" })
      .transform((value) => value === 'true')
      .optional(),
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
function invalidEnvironment(problems: readonly string[]): EnvironmentError {
  return new EnvironmentError(
    [
      'Invalid environment. The API did not start because of these variables:',
      ...problems.map((problem) => `  - ${problem}`),
      'See .env.example at the root of the repository. No value is printed here on purpose.',
    ].join('\n'),
  );
}

function describe(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

/**
 * The error reporting, which the schema cannot decide on its own: whether
 * `SENTRY_RELEASE` is required depends on another variable.
 *
 * @throws EnvironmentError when the DSN is set and the release is not
 */
function readSentry(
  dsn: string | undefined,
  environment: string | undefined,
  release: string | undefined,
  nodeEnv: NodeEnv,
): SentryConfig | undefined {
  if (dsn === undefined) return undefined;

  if (release === undefined) {
    throw invalidEnvironment([`SENTRY_RELEASE: ${SENTRY_RELEASE_MISSING}`]);
  }

  return { dsn, environment: environment ?? nodeEnv, release };
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
    throw invalidEnvironment(describe(parsed.error));
  }

  const {
    NODE_ENV,
    PORT,
    DATABASE_URL,
    SUPABASE_JWT_SECRET,
    CORS_ALLOWED_ORIGINS,
    LOG_LEVEL,
    JOBS_ENABLED,
    SENTRY_DSN,
    SENTRY_ENVIRONMENT,
    SENTRY_RELEASE,
  } = parsed.data;

  const sentry = readSentry(SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE, NODE_ENV);

  return {
    nodeEnv: NODE_ENV,
    port: PORT,
    databaseUrl: DATABASE_URL,
    supabaseJwtSecret: SUPABASE_JWT_SECRET,
    corsAllowedOrigins: readOrigins(CORS_ALLOWED_ORIGINS),
    jobsEnabled: JOBS_ENABLED ?? DEFAULT_JOBS_ENABLED[NODE_ENV],
    logLevel: LOG_LEVEL ?? DEFAULT_LOG_LEVEL[NODE_ENV],

    // Spread and not `sentry: sentry`: with `exactOptionalPropertyTypes` an
    // optional field is either there or absent, never present and undefined.
    ...(sentry === undefined ? {} : { sentry }),
  };
}
