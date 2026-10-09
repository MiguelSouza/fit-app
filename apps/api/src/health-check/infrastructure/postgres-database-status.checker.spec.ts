import { Logger } from '@nestjs/common';
import { type Pool } from 'pg';

import { PostgresDatabaseStatusChecker } from './postgres-database-status.checker';

/**
 * Example of an `infrastructure/` test: the adapter against a fake pool. What
 * is being tested is the translation the adapter does — a driver failure
 * becoming `down` instead of an exception — and for that a real Postgres adds
 * nothing.
 */
function poolThat(behaviour: 'answers' | 'fails' | 'hangs'): Pool {
  const query =
    behaviour === 'answers'
      ? () => Promise.resolve({ rows: [{ '?column?': 1 }] })
      : behaviour === 'fails'
        ? () =>
            Promise.reject(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }))
        : // An unreachable host, as opposed to one that refuses: nothing ever
          // comes back.
          () => new Promise(() => {});

  // Only `query` is used, and typing the fake as the whole `Pool` would mean
  // stubbing a few dozen members of the driver for nothing.
  return { query } as unknown as Pool;
}

describe('PostgresDatabaseStatusChecker', () => {
  beforeAll(() => {
    // The adapter logs the failure it swallows; that log is expected here.
    Logger.overrideLogger(false);
  });

  it('reports up, with the latency, when the database answers', async () => {
    const checker = new PostgresDatabaseStatusChecker(poolThat('answers'));

    const health = await checker.check();

    expect(health.name).toBe('database');
    expect(health.status).toBe('up');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports down instead of throwing when the database does not answer', async () => {
    const checker = new PostgresDatabaseStatusChecker(poolThat('fails'));

    await expect(checker.check()).resolves.toEqual({ name: 'database', status: 'down' });
  });

  it('gives up on a silent database instead of waiting forever', async () => {
    // The deadline is the second constructor argument so the test can use a few
    // milliseconds; in the app nothing provides it and it is two seconds.
    const checker = new PostgresDatabaseStatusChecker(poolThat('hangs'), 5);

    await expect(checker.check()).resolves.toEqual({ name: 'database', status: 'down' });
  });
});
