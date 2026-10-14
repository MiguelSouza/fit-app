import { type AppLogger } from '../logging/logger';
import { type JobName, type JobPayload } from './job-catalog';
import { type JobDefinition, type JobQueuePort } from './job-queue.port';

/** The line this queue leaves. Grep for it when a job "did not run". */
export const JOBS_DISABLED = 'job queue disabled';

/**
 * The queue of a process that was told not to run jobs (`JOBS_ENABLED=false`):
 * jest, and the step of `pnpm api:generate` that creates the app only to read
 * its routes.
 *
 * It accepts everything and does nothing, so the modules wire up exactly as
 * they do in production and nothing reaches for Postgres. Registering is
 * expected here and logged at `debug`; enqueuing is not, and is logged at
 * `warn` — somebody asked for work that will never be done, and the silence
 * would be the bug.
 */
export class DisabledJobQueue implements JobQueuePort {
  constructor(private readonly logger: AppLogger) {}

  register<Name extends JobName>(job: JobDefinition<Name>): Promise<void> {
    this.logger.debug({ job: job.name }, JOBS_DISABLED);

    return Promise.resolve();
  }

  enqueue<Name extends JobName>(name: Name, _payload: JobPayload<Name>): Promise<void> {
    this.logger.warn({ job: name }, JOBS_DISABLED);

    return Promise.resolve();
  }
}
