import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import { LOGGER, type AppLogger } from '../logging/logger';
import {
  JOB_QUEUE,
  type JobDefinition,
  type JobQueuePort,
  type JobRetryPolicy,
  type JobSchedule,
} from './job-queue.port';

/** Every quarter of an hour, read in UTC. Often enough to notice, cheap enough to ignore. */
export const PING_CRON = '*/15 * * * *';

/** The line the job writes. It is the whole point of the job. */
export const PING = 'ping';

/**
 * The example job of card F-10: it runs on a clock and writes one line.
 *
 * It is here to be copied, and to answer "is the queue alive?" without anybody
 * having to open psql — if this line stops showing up in CloudWatch, the
 * workers of that task are not running.
 *
 * The shape is the one every job follows:
 *
 * 1. a provider that implements `JobDefinition`, so the name, the retry policy
 *    and the schedule sit next to the work they belong to;
 * 2. `onApplicationBootstrap` registering it with `JOB_QUEUE`, which is what
 *    creates the queue, attaches the worker and installs the cron;
 * 3. `handle` doing the work and **throwing** when it fails, which is how the
 *    retry happens.
 *
 * A job that belongs to a domain module lives in that module's
 * `infrastructure/`, not here, and the module registers it the same way.
 */
@Injectable()
export class PingJob implements JobDefinition<'ping'>, OnApplicationBootstrap {
  readonly name = 'ping';

  /**
   * A policy that would survive a blip, on a job that cannot fail: it is the
   * example of what a real job states, not a need of this one.
   */
  readonly retry: JobRetryPolicy = {
    maxAttempts: 3,
    firstRetryDelaySeconds: 10,
    backoff: 'exponential',
    maxRetryDelaySeconds: 300,
  };

  readonly schedule: JobSchedule<'ping'> = { cron: PING_CRON, payload: {} };

  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueuePort,
    @Inject(LOGGER) private readonly logger: AppLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.register(this);
  }

  handle(): Promise<void> {
    // Nothing personal, nothing from a patient: the job exists to prove the
    // queue runs.
    this.logger.info(PING);

    return Promise.resolve();
  }
}
