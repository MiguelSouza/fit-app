import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Pool } from 'pg';

import { type DatabaseStatusPort } from '../application/ports/database-status.port';
import { type ComponentHealth } from '../domain/system-health';
import { DATABASE_POOL } from '../../shared/database/database.module';

/** Cheapest query there is: it proves the pool hands out a live connection. */
const PROBE = 'select 1';

/**
 * How long the probe waits before calling the database down.
 *
 * A database that refuses the connection fails right away, but one that is
 * unreachable instead of closed — a paused project, a security group dropping
 * the packets, a partition — answers nothing at all, and neither the pool
 * (`connectionTimeoutMillis` defaults to no timeout) nor the driver gives up
 * before the operating system's TCP timeout, tens of seconds later. Without a
 * bound here the endpoint would hang instead of reporting `degraded`, which is
 * the one thing it exists to do.
 */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Optional override of the deadline, in milliseconds. Nothing provides it: it
 * is here so a test can wait a few milliseconds instead of two seconds, and so
 * a deployment that needs another number has somewhere to say it.
 */
export const DATABASE_PROBE_TIMEOUT_MS = Symbol('fit-app.api.database-probe-timeout-ms');

/** What the timeout throws, shaped like a driver error so the log stays the same. */
function timedOut(): Error & { code: string } {
  return Object.assign(new Error('database probe timed out'), { code: 'probe_timeout' });
}

/**
 * The Postgres side of `DatabaseStatusPort`. Drizzle will sit on top of this
 * same pool for the queries that have a schema behind them; a health check
 * does not need a mapper.
 */
@Injectable()
export class PostgresDatabaseStatusChecker implements DatabaseStatusPort {
  private readonly logger = new Logger('DatabaseStatusChecker');

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional()
    @Inject(DATABASE_PROBE_TIMEOUT_MS)
    private readonly timeoutMs: number = PROBE_TIMEOUT_MS,
  ) {}

  /**
   * The probe, with a deadline. The query is left to finish on its own if the
   * deadline comes first: `Promise.race` already handles its result, so a late
   * failure is not an unhandled rejection, and the pool takes its connection
   * back either way.
   */
  private async probe(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.pool.query(PROBE),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(timedOut()), this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async check(): Promise<ComponentHealth> {
    const startedAt = performance.now();

    try {
      await this.probe();

      return {
        name: 'database',
        status: 'up',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error: unknown) {
      // Code only, never the driver's message: see the comment on the pool's
      // error listener.
      const code =
        error instanceof Error ? ((error as { code?: string }).code ?? 'unknown') : 'unknown';
      this.logger.warn(`database health check failed (code=${code})`);

      return { name: 'database', status: 'down' };
    }
  }
}
