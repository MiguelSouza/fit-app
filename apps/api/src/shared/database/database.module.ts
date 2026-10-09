import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

import { ENV, EnvModule } from '../config/env.module';
import { type ApiEnv } from '../config/env';

/**
 * Injection token for the Postgres connection pool.
 *
 * One pool for the whole API. Each module still only reads and writes its own
 * schema (CLAUDE.md rule 2) — that is a rule about the queries, not about the
 * socket, and a pool per module would just multiply connections against the
 * same database.
 */
export const DATABASE_POOL = Symbol('fit-app.api.database-pool');

@Module({
  imports: [EnvModule],
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ENV],
      useFactory: (env: ApiEnv): Pool => {
        const pool = new Pool({
          connectionString: env.databaseUrl,
          // Shows up in `pg_stat_activity`: it is what tells an API connection
          // apart from a migration or from Studio.
          application_name: 'fit-app-api',
        });

        // An idle client that dies takes the process down with it if nobody is
        // listening. Only the driver's error code is logged: a Postgres message
        // can quote the value of a column, and health data never goes to a log
        // (CLAUDE.md, "Saúde e LGPD").
        pool.on('error', (error: Error & { code?: string }) => {
          new Logger('DatabasePool').error(`idle client failed (code=${error.code ?? 'unknown'})`);
        });

        return pool;
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Closes the pool on shutdown so a redeploy does not leave connections behind. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
