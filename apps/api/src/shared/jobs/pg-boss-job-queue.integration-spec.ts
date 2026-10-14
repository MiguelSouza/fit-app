import { Pool } from 'pg';

import { type ApiEnv } from '../config/env';
import { createLogger } from '../logging/logger';
import { integrationDatabaseUrl } from '../testing/integration-postgres.spec-support';
import { type JobDefinition } from './job-queue.port';
import { createBossClient, JOBS_SCHEMA, PgBossJobQueue } from './pg-boss-job-queue';

/**
 * The example integration test of card F-11, and the one test in the API that
 * runs against a real Postgres today.
 *
 * What it adds to `pg-boss-job-queue.spec.ts`, which drives the adapter
 * against a client the test wrote: that fake proves what the adapter *asks*
 * of pg-boss, and this proves pg-boss *answers* it — the queue really is
 * created, the worker really is called, and the tables really land in the
 * `pgboss` schema and nowhere else. A fake cannot be wrong about the library
 * in the same way the library can.
 *
 * It is also what exercises the harness end to end: container up, migrations
 * applied, test, container gone (`shared/testing`).
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  // The throwaway container of this run. Reading it through the helper is what
  // makes a run under the unit profile fail with a sentence instead of trying
  // to reach a database that is not there.
  databaseUrl: integrationDatabaseUrl(),
  supabaseJwtSecret: 'unused-in-this-test-but-long-enough-0001',
  corsAllowedOrigins: [],
  jobsEnabled: true,
  // The adapter logs a line per job; this is a test, not a log stream.
  logLevel: 'silent',
};

/** How long the test waits for the worker to pick the job up. */
const HANDLED_TIMEOUT_MS = 30_000;

/**
 * pg-boss polls for work on a timer, so the handler runs some time after the
 * `enqueue` resolves — "some time" being the thing a fake cannot reproduce.
 */
async function eventually(done: () => boolean): Promise<void> {
  const deadline = Date.now() + HANDLED_TIMEOUT_MS;

  while (!done()) {
    if (Date.now() > deadline) {
      throw new Error(`the queue did not run the job within ${HANDLED_TIMEOUT_MS} ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('PgBossJobQueue against a real Postgres', () => {
  const queue = new PgBossJobQueue(createBossClient(env), createLogger(env));
  const pool = new Pool({ connectionString: env.databaseUrl, application_name: 'fit-app-test' });

  /** Payloads the handler was given, one per run. */
  const handled: Record<string, never>[] = [];

  const job: JobDefinition<'ping'> = {
    name: 'ping',
    retry: { maxAttempts: 1, firstRetryDelaySeconds: 1, backoff: 'fixed' },
    handle: (payload) => {
      handled.push(payload);

      return Promise.resolve();
    },
  };

  afterAll(async () => {
    // The queue holds the connections of a worker, and the test its own pool:
    // both have to go, or jest has nothing to exit from.
    await queue.onApplicationShutdown();
    await pool.end();
  });

  it('runs an enqueued job in the worker it registered', async () => {
    await queue.register(job);
    await queue.enqueue('ping', {});

    await eventually(() => handled.length > 0);

    expect(handled).toEqual([{}]);
  });

  it('keeps its tables in the pgboss schema, and out of the domain schemas', async () => {
    // `job` is the table the queue stores work in. Where it ended up is the
    // assertion: CLAUDE.md rule 4 gives one schema to each domain module, and
    // the queue is plumbing that happens to share the database (ADR 0009).
    const { rows } = await pool.query<{ table_schema: string }>(
      `select table_schema from information_schema.tables where table_name = 'job'`,
    );

    expect(rows.map((row) => row.table_schema)).toEqual([JOBS_SCHEMA]);
  });
});
