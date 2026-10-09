/**
 * The environment the API reads, parsed once at startup.
 *
 * `.env.example` at the repository root is the catalogue of every variable and
 * says which card each block belongs to; only the ones the API already uses
 * show up here.
 *
 * Nothing in this file ever logs a value: `DATABASE_URL` carries a password,
 * and CLAUDE.md ("Saúde e LGPD") forbids putting that kind of thing in a log.
 * An error names the variable and stops there.
 */
export type NodeEnv = 'development' | 'test' | 'production';

export interface ApiEnv {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly databaseUrl: string;
  /** Origins allowed to call the API from a browser. Empty means "no browser". */
  readonly corsAllowedOrigins: readonly string[];
}

/** Startup failure: a variable is missing or unusable. Not a domain error. */
export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];

const DEFAULT_PORT = 3333;

function readNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === undefined || raw === '') return 'development';

  const found = NODE_ENVS.find((candidate) => candidate === raw);
  if (!found) {
    throw new EnvironmentError(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}`);
  }

  return found;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvironmentError('PORT must be an integer between 1 and 65535');
  }

  return port;
}

function readDatabaseUrl(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    throw new EnvironmentError(
      'DATABASE_URL is required: copy .env.example to .env and start the local stack with `pnpm db:start`',
    );
  }

  return raw;
}

/**
 * A comma separated list, as `.env.example` writes it. Blank entries are
 * dropped so a trailing comma is not read as an origin.
 */
function readOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/**
 * Pure: it reads the object it is given, never `process.env` by itself, which
 * is what makes it testable and keeps the parsing out of the modules.
 */
export function loadEnv(source: NodeJS.ProcessEnv): ApiEnv {
  return {
    nodeEnv: readNodeEnv(source.NODE_ENV),
    port: readPort(source.PORT),
    databaseUrl: readDatabaseUrl(source.DATABASE_URL),
    corsAllowedOrigins: readOrigins(source.CORS_ALLOWED_ORIGINS),
  };
}
