import { type OnApplicationShutdown } from '@nestjs/common';
import { PgBoss } from 'pg-boss';

import { type ApiEnv } from '../config/env';
import { type AppLogger } from '../logging/logger';
import { type JobName, type JobPayload } from './job-catalog';
import { type JobDefinition, type JobQueuePort, type JobRetryPolicy } from './job-queue.port';

/**
 * The schema pg-boss keeps its own tables in.
 *
 * Not a module's schema and not `public`: CLAUDE.md rule 4 gives one schema to
 * each domain module, and the queue is not a domain module — it is plumbing
 * that happens to live in the same database (ADR 0009). Nothing in `nutrition`
 * or `health` ever reads from here.
 */
export const JOBS_SCHEMA = 'pgboss';

/** The zone a cron expression is read in when the job does not say. */
export const DEFAULT_TIME_ZONE = 'UTC';

/** What the worker writes when it picks a job up, and when an attempt fails. */
export const JOB_STARTED = 'job started';
export const JOB_FAILED = 'job failed';
export const QUEUE_STARTED = 'job queue started';
export const QUEUE_FAILED = 'job queue failed';

/** How pg-boss spells a retry policy on a queue. */
export interface QueueSettings {
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  readonly retryDelayMax?: number;
}

/** One job as the queue hands it to a worker. */
export interface BossJob<Payload> {
  readonly id: string;
  readonly data: Payload;
  /** Attempts already made before this one. `0` on the first run. */
  readonly retryCount: number;
}

/**
 * The slice of pg-boss this adapter uses, and nothing more.
 *
 * It is here for two reasons. It is the exhaustive list of what a replacement
 * queue would have to offer, so the size of that swap is visible at a glance.
 * And it is the seam the adapter's test uses: the test drives the adapter
 * against a client it wrote itself, and proves what is asked of pg-boss
 * without a Postgres anywhere near it.
 */
export interface BossClient {
  start(): Promise<unknown>;
  stop(): Promise<void>;
  /** The queue as it is stored, or `null` when it was never created. */
  getQueue(name: string): Promise<unknown>;
  createQueue(name: string, settings: QueueSettings): Promise<void>;
  updateQueue(name: string, settings: QueueSettings): Promise<void>;
  work<Payload>(
    name: string,
    handler: (jobs: BossJob<Payload>[]) => Promise<void>,
  ): Promise<unknown>;
  send(name: string, payload: object): Promise<string | null>;
  schedule(name: string, cron: string, payload: object, timeZone: string): Promise<void>;
  onError(listener: (error: Error) => void): void;
}

/**
 * The only place in the repository that builds a pg-boss.
 *
 * Every call is delegated one by one instead of the instance being handed over
 * as it is: that is what keeps the library's own options — the batch size, the
 * shape of the schedule call — on this side of the seam.
 *
 * @param env the parsed environment; the connection string is read from it
 */
export function createBossClient(env: ApiEnv): BossClient {
  const boss = new PgBoss({
    connectionString: env.databaseUrl,
    schema: JOBS_SCHEMA,
    // Shows up in `pg_stat_activity`, next to the API's own pool: it is what
    // tells a worker's connection from a request's.
    application_name: 'fit-app-jobs',
  });

  return {
    start: () => boss.start(),
    stop: () => boss.stop(),
    getQueue: (name) => boss.getQueue(name),
    createQueue: (name, settings) => boss.createQueue(name, settings),
    updateQueue: (name, settings) => boss.updateQueue(name, settings),
    // `batchSize: 1` so a job that fails fails alone. With a batch, pg-boss
    // settles the whole array on the handler's single result, and one bad
    // payload would drag its neighbours into the retry with it.
    work: (name, handler) => boss.work(name, { batchSize: 1 }, handler),
    send: (name, payload) => boss.send(name, payload),
    schedule: (name, cron, payload, timeZone) =>
      boss.schedule(name, cron, payload, { tz: timeZone }),
    onError: (listener) => {
      // pg-boss is an EventEmitter, and an `error` with nobody listening takes
      // the process down. The error goes through the logger's serializer,
      // which strips the message it carries.
      boss.on('error', listener);
    },
  };
}

/**
 * Turns the policy a job states into the columns pg-boss keeps on a queue.
 *
 * The translation worth naming: a job counts **attempts**, pg-boss counts
 * **retries**, so three attempts is `retryLimit: 2`. Getting that backwards is
 * a job that runs one more time than its author meant it to.
 */
export function toQueueSettings(retry: JobRetryPolicy): QueueSettings {
  const settings = {
    retryLimit: Math.max(retry.maxAttempts - 1, 0),
    retryDelay: retry.firstRetryDelaySeconds,
    // What pg-boss calls `retryBackoff`: the wait doubles at every attempt
    // instead of staying at `retryDelay`.
    retryBackoff: retry.backoff === 'exponential',
  };

  // `exactOptionalPropertyTypes` is on, so the key is left out rather than set
  // to undefined.
  return retry.maxRetryDelaySeconds === undefined
    ? settings
    : { ...settings, retryDelayMax: retry.maxRetryDelaySeconds };
}

/**
 * The queue of CLAUDE.md's stack, running on the Postgres the API already has
 * (ADR 0009).
 *
 * It connects on the first call and not in the constructor, so the order the
 * providers happen to be created in does not decide whether a job manages to
 * register before the queue is up.
 *
 * Nothing it logs carries a payload: a job's payload is stored data, and a
 * line about it is that same data in a second place (CLAUDE.md, "Saúde e
 * LGPD"). The name of the job, its id and the attempt are enough to follow one
 * through CloudWatch.
 */
export class PgBossJobQueue implements JobQueuePort, OnApplicationShutdown {
  /** The `start()` in flight, or the one already done. Kept so it happens once. */
  private starting: Promise<void> | undefined;

  constructor(
    private readonly client: BossClient,
    private readonly logger: AppLogger,
  ) {
    this.client.onError((error) => {
      this.logger.error({ err: error }, QUEUE_FAILED);
    });
  }

  async register<Name extends JobName>(job: JobDefinition<Name>): Promise<void> {
    await this.started();

    const settings = toQueueSettings(job.retry);

    // A queue outlives the deploy that created it, so a policy that changed in
    // the code has to be written onto the queue that is already there.
    const existing = await this.client.getQueue(job.name);

    if (existing === null) {
      await this.client.createQueue(job.name, settings);
    } else {
      await this.client.updateQueue(job.name, settings);
    }

    await this.client.work<JobPayload<Name>>(job.name, (jobs) => this.runBatch(job, jobs));

    if (job.schedule !== undefined) {
      // Idempotent: pg-boss keys a schedule by the name of the queue, so a
      // second deploy moves the cron instead of adding a second one.
      await this.client.schedule(
        job.name,
        job.schedule.cron,
        job.schedule.payload,
        job.schedule.timeZone ?? DEFAULT_TIME_ZONE,
      );
    }
  }

  async enqueue<Name extends JobName>(name: Name, payload: JobPayload<Name>): Promise<void> {
    await this.started();

    const id = await this.client.send(name, payload);

    this.logger.debug({ job: name, jobId: id }, 'job enqueued');
  }

  /** Lets the workers finish what they hold before the task goes away. */
  async onApplicationShutdown(): Promise<void> {
    if (this.starting === undefined) return;

    try {
      await this.client.stop();
    } catch (error) {
      // A shutdown that throws is a task that does not exit, and the queue is
      // about to lose its connections either way.
      this.logger.error({ err: error }, QUEUE_FAILED);
    }
  }

  /** Connects once, and hands the same promise to everyone who asks after. */
  private started(): Promise<void> {
    this.starting ??= this.client.start().then(() => {
      this.logger.info(QUEUE_STARTED);
    });

    return this.starting;
  }

  private async runBatch<Name extends JobName>(
    job: JobDefinition<Name>,
    batch: BossJob<JobPayload<Name>>[],
  ): Promise<void> {
    for (const entry of batch) {
      const attempt = entry.retryCount + 1;

      this.logger.info({ job: job.name, jobId: entry.id, attempt }, JOB_STARTED);

      try {
        await job.handle(entry.data);
      } catch (error) {
        this.logger.error({ err: error, job: job.name, jobId: entry.id, attempt }, JOB_FAILED);

        // Rethrown on purpose. The rejection is the only thing that tells the
        // queue the attempt failed: it is what makes it count the attempt and
        // schedule the next one with the backoff of the policy. Swallowing it
        // here would mark the job done and lose the work.
        throw error;
      }
    }
  }
}
