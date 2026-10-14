import { Module } from '@nestjs/common';

import { ENV, EnvModule } from '../config/env.module';
import { type ApiEnv } from '../config/env';
import { LOGGER, type AppLogger } from '../logging/logger';
import { LoggingModule } from '../logging/logging.module';
import { DisabledJobQueue } from './disabled-job-queue';
import { JOB_QUEUE, type JobQueuePort } from './job-queue.port';
import { PgBossJobQueue, createBossClient } from './pg-boss-job-queue';
import { PingJob } from './ping.job';

/**
 * Where the queue is chosen. A module that enqueues work imports this one and
 * asks for `JOB_QUEUE`; it never names pg-boss.
 *
 * These are the two lines a different queue would touch: the factory below
 * builds `PgBossJobQueue` today, and `pg-boss-job-queue.ts` is the only file
 * that knows what that is (ADR 0009).
 *
 * `JOBS_ENABLED=false` swaps in the queue that does nothing, so a process that
 * only needs the modules wired — jest, `pnpm api:generate` — boots without a
 * Postgres behind it.
 */
@Module({
  imports: [EnvModule, LoggingModule],
  providers: [
    {
      provide: JOB_QUEUE,
      inject: [ENV, LOGGER],
      useFactory: (env: ApiEnv, logger: AppLogger): JobQueuePort =>
        env.jobsEnabled
          ? new PgBossJobQueue(createBossClient(env), logger)
          : new DisabledJobQueue(logger),
    },
    PingJob,
  ],
  exports: [JOB_QUEUE],
})
export class JobsModule {}
