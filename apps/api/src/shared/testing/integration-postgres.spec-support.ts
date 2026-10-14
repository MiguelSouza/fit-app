import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { MIGRATIONS_FOLDER, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from '../database/migrations';

/**
 * The throwaway Postgres the integration profile runs against
 * (`pnpm test:integration`).
 *
 * CLAUDE.md ("Testes") asks for a real Postgres, with Testcontainers, for the
 * critical use cases: half of what those use cases enforce is written in SQL —
 * a unique index, a check, a cascade, "one active plan per patient" — and a
 * fake repository answers for the code while leaving the database's half of
 * the rule untested.
 *
 * One container for the whole run, started in `globalSetup` and dropped in
 * `globalTeardown`. Disposable on purpose: the database is created, migrated,
 * used and destroyed, so a run never inherits a row from the run before it and
 * never has to clean up after itself. It also means nothing survives the run —
 * and what went in was synthetic data to begin with, because real patient data
 * never enters development or test (CLAUDE.md, "Testes").
 */

/**
 * The image. Pinned, and pinned to the major version of the database the API
 * actually talks to: Postgres 17, the same as the local Supabase stack
 * (`supabase/config.toml`) and as the hosted projects (ADR 0002). A test that
 * passes on another major proves less than it looks like it does.
 */
export const POSTGRES_IMAGE = 'postgres:17-alpine';

/**
 * The credentials of the container. Not a secret, and not a password anybody
 * has to keep: the database lives for one test run, inside Docker, reachable
 * only from this machine and on a port Docker picks.
 */
const DATABASE = 'fit_app_test';
const USERNAME = 'fit_app_test';
const PASSWORD = 'fit_app_test';

/**
 * The variable the connection string is published in.
 *
 * Not `DATABASE_URL`: that one is the API's, read by `loadEnv` and by Drizzle
 * Kit, and a harness that overwrote it could point a migration at a database
 * somebody cares about. A test asks for this one, through
 * `integrationDatabaseUrl()`.
 */
export const INTEGRATION_DATABASE_URL = 'FIT_APP_INTEGRATION_DATABASE_URL';

/** What a suite is told when it reads the URL outside the integration run. */
export const NO_DATABASE_RUNNING =
  'No integration database. A test that needs Postgres runs under `pnpm test:integration` ' +
  '(jest.integration.config.mjs), which starts the container in globalSetup.';

/** What the setup prints when there is no migration to apply yet. */
export const NO_MIGRATIONS_YET =
  `[integration] no migrations in ${MIGRATIONS_FOLDER}/: the database comes up empty. ` +
  'The tables arrive with card F-07, and this harness applies them the day they do.';

/**
 * The running container, kept so the teardown can stop the one the setup
 * started. The two run in the same process, so a module level value is enough;
 * and a run that is killed before the teardown leaves the container to the
 * Testcontainers reaper, which removes it on its own.
 */
let container: StartedPostgreSqlContainer | undefined;

/**
 * Applies the migrations of `drizzle/` to the fresh database, exactly as
 * `pnpm db:migrate` applies them to the local one: same folder, same
 * bookkeeping table, same schema (`shared/database/migrations.ts`).
 *
 * While `drizzle/` holds no migration the folder does not exist, and this says
 * so instead of failing: the harness is finished and the tables are not (card
 * F-07, blocked on its reference SQL). The day the first migration lands it
 * starts being applied, with no change here.
 *
 * @returns whether anything was applied
 */
async function applyMigrations(connectionUri: string, apiRoot: string): Promise<boolean> {
  const folder = join(apiRoot, MIGRATIONS_FOLDER);

  // The journal is what Drizzle reads first, and the one file it cannot work
  // without.
  if (!existsSync(join(folder, 'meta', '_journal.json'))) {
    console.warn(NO_MIGRATIONS_YET);

    return false;
  }

  const pool = new Pool({
    connectionString: connectionUri,
    // Shows up in `pg_stat_activity`, as the API pool and the queue do.
    application_name: 'fit-app-test-migrations',
  });

  try {
    await migrate(drizzle(pool), {
      migrationsFolder: folder,
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
  } finally {
    // The migration connection goes away with the migration: the tests open
    // their own, and a pool left open is a jest run that does not exit.
    await pool.end();
  }

  return true;
}

/**
 * Starts the container, migrates it and publishes its connection string. This
 * is the whole of what `globalSetup` does.
 *
 * @param apiRoot the `apps/api` directory, the one `drizzle/` is in. The jest
 *   `projectConfig.rootDir` is what answers for it, so the path does not
 *   depend on the directory the command was run from.
 */
export async function startIntegrationPostgres(apiRoot: string): Promise<void> {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE)
    .withUsername(USERNAME)
    .withPassword(PASSWORD)
    .start();

  await applyMigrations(container.getConnectionUri(), apiRoot);

  process.env[INTEGRATION_DATABASE_URL] = container.getConnectionUri();
}

/** Drops the container. The data goes with it, which is the point of it. */
export async function stopIntegrationPostgres(): Promise<void> {
  delete process.env[INTEGRATION_DATABASE_URL];

  await container?.stop();
  container = undefined;
}

/**
 * The connection string of the test database, for a suite that needs one.
 *
 * It throws instead of answering undefined: a test that quietly fell back to
 * another database would be a test writing rows where nobody is looking.
 */
export function integrationDatabaseUrl(): string {
  const url = process.env[INTEGRATION_DATABASE_URL];

  if (url === undefined || url === '') throw new Error(NO_DATABASE_RUNNING);

  return url;
}
