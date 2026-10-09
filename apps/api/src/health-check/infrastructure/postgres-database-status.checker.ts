import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Pool } from 'pg';

import { type DatabaseStatusPort } from '../application/ports/database-status.port';
import { type ComponentHealth } from '../domain/system-health';
import { DATABASE_POOL } from '../../shared/database/database.module';

/** Cheapest query there is: it proves the pool hands out a live connection. */
const PROBE = 'select 1';

/**
 * The Postgres side of `DatabaseStatusPort`. Drizzle will sit on top of this
 * same pool for the queries that have a schema behind them; a health check
 * does not need a mapper.
 */
@Injectable()
export class PostgresDatabaseStatusChecker implements DatabaseStatusPort {
  private readonly logger = new Logger('DatabaseStatusChecker');

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async check(): Promise<ComponentHealth> {
    const startedAt = performance.now();

    try {
      await this.pool.query(PROBE);

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
