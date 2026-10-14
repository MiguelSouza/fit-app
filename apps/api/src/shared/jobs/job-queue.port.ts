import { type JobName, type JobPayload } from './job-catalog';

/**
 * How many times a job is tried and how long the queue waits between the
 * tries. Stated in the job, not in the adapter: it is a decision about the
 * work ("a webhook from the aggregator is worth five tries"), not about the
 * queue product.
 */
export interface JobRetryPolicy {
  /** Tries in total, the first one included. `1` means no retry. */
  readonly maxAttempts: number;
  /** How long after a failure the first retry runs. */
  readonly firstRetryDelaySeconds: number;
  /**
   * `exponential` doubles the wait at every attempt, which is what keeps a
   * failing dependency from being hammered; `fixed` keeps
   * `firstRetryDelaySeconds` throughout.
   */
  readonly backoff: 'exponential' | 'fixed';
  /** A ceiling for the exponential growth. No ceiling when left out. */
  readonly maxRetryDelaySeconds?: number;
}

/** Makes a job run on a clock instead of (or as well as) on demand. */
export interface JobSchedule<Name extends JobName> {
  /** A five field cron expression. */
  readonly cron: string;
  /** What every tick carries. A scheduled job gets no arguments from a caller. */
  readonly payload: JobPayload<Name>;
  /**
   * The zone the expression is read in. UTC by default: everything in this
   * codebase stores time in UTC, and a schedule that follows São Paulo's
   * daylight saving is a decision each job states for itself.
   */
  readonly timeZone?: string;
}

/**
 * One job: its name, how it is retried, whether it runs on a clock, and the
 * work itself.
 *
 * A job is a Nest provider that implements this interface and registers itself
 * with the queue while the app starts — `ping.job.ts` is the one to copy.
 */
export interface JobDefinition<Name extends JobName = JobName> {
  readonly name: Name;
  readonly retry: JobRetryPolicy;
  readonly schedule?: JobSchedule<Name>;

  /**
   * The work. It is run again after a failure, so it has to be safe to run
   * twice: the same payload delivered twice must not charge twice, send two
   * e-mails or write two rows.
   *
   * **Throwing is how a job reports failure** — that is what the queue reads
   * to count the attempt and schedule the retry. A job that swallows its own
   * error is a job that silently never happened.
   */
  handle(payload: JobPayload<Name>): Promise<void>;
}

/**
 * Port (CLAUDE.md rule 5): a module hands work over to be done later, without
 * knowing what stores it in the meantime.
 *
 * pg-boss is the implementation today (ADR 0009) and lives in
 * `pg-boss-job-queue.ts`. Everything that is pg-boss — the queue names, the
 * retry columns, the cron table — stops at that file; nothing in this
 * interface mentions it, which is what makes the queue replaceable.
 */
export interface JobQueuePort {
  /**
   * Makes a job known to the queue: creates it if it is new, brings its retry
   * policy up to date if it is not, attaches the worker and installs the
   * schedule when the job has one. Called once, while the app starts.
   */
  register<Name extends JobName>(job: JobDefinition<Name>): Promise<void>;

  /** Hands one unit of work over, to be run as soon as a worker is free. */
  enqueue<Name extends JobName>(name: Name, payload: JobPayload<Name>): Promise<void>;
}

/** Injection token for the queue. */
export const JOB_QUEUE = Symbol('fit-app.api.job-queue');
