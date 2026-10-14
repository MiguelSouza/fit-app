import { type DestinationStream } from 'pino';

import { createLogger } from '../logging/logger';
import { type ApiEnv } from '../config/env';
import { type JobDefinition, type JobRetryPolicy } from './job-queue.port';
import {
  JOB_FAILED,
  PgBossJobQueue,
  toQueueSettings,
  type BossClient,
  type BossJob,
  type QueueSettings,
} from './pg-boss-job-queue';

/**
 * The adapter against a client the test wrote, which is what lets it assert
 * what is asked of pg-boss — the retry columns, the worker, the cron — with no
 * Postgres in sight. The real client is one file away and delegates call for
 * call.
 *
 * The second acceptance criterion of card F-10 is here: a job that fails is
 * tried again, with a growing wait between the tries.
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: 'unused-in-this-test-but-long-enough-0001',
  corsAllowedOrigins: [],
  jobsEnabled: false,
  logLevel: 'debug',
};

interface ScheduleCall {
  readonly name: string;
  readonly cron: string;
  readonly payload: object;
  readonly timeZone: string;
}

/** The handler the adapter gave to `work`, as the test holds it. */
type Worker = (jobs: BossJob<unknown>[]) => Promise<void>;

class FakeBoss implements BossClient {
  starts = 0;
  stops = 0;
  created: { name: string; settings: QueueSettings }[] = [];
  updated: { name: string; settings: QueueSettings }[] = [];
  scheduled: ScheduleCall[] = [];
  sent: { name: string; payload: object }[] = [];
  workers = new Map<string, Worker>();

  /** The queues `getQueue` answers for. Empty means every queue is new. */
  existing = new Set<string>();

  start(): Promise<unknown> {
    this.starts += 1;

    return Promise.resolve('started');
  }

  stop(): Promise<void> {
    this.stops += 1;

    return Promise.resolve();
  }

  getQueue(name: string): Promise<unknown> {
    return Promise.resolve(this.existing.has(name) ? { name } : null);
  }

  createQueue(name: string, settings: QueueSettings): Promise<void> {
    this.created.push({ name, settings });

    return Promise.resolve();
  }

  updateQueue(name: string, settings: QueueSettings): Promise<void> {
    this.updated.push({ name, settings });

    return Promise.resolve();
  }

  work<Payload>(
    name: string,
    handler: (jobs: BossJob<Payload>[]) => Promise<void>,
  ): Promise<unknown> {
    // The only cast in here: the map holds the workers of every payload type
    // at once, which no single type parameter can say.
    this.workers.set(name, handler as Worker);

    return Promise.resolve('worker-1');
  }

  send(name: string, payload: object): Promise<string | null> {
    this.sent.push({ name, payload });

    return Promise.resolve('job-1');
  }

  schedule(name: string, cron: string, payload: object, timeZone: string): Promise<void> {
    this.scheduled.push({ name, cron, payload, timeZone });

    return Promise.resolve();
  }

  onError(): void {
    // Nothing to do: no test makes the real emitter fail.
  }
}

interface Harness {
  readonly queue: PgBossJobQueue;
  readonly boss: FakeBoss;
  readonly lines: () => Record<string, unknown>[];
}

function harness(): Harness {
  const written: string[] = [];
  const destination: DestinationStream = {
    write(line: string): void {
      written.push(line);
    },
  };
  const boss = new FakeBoss();

  return {
    boss,
    queue: new PgBossJobQueue(boss, createLogger(env, destination)),
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const RETRY: JobRetryPolicy = {
  maxAttempts: 3,
  firstRetryDelaySeconds: 10,
  backoff: 'exponential',
  maxRetryDelaySeconds: 300,
};

/** A job built for the test: it records its runs and fails when asked to. */
function jobThat(behaviour: { fails?: boolean } = {}): JobDefinition<'ping'> & {
  runs: object[];
} {
  const runs: object[] = [];

  return {
    name: 'ping',
    retry: RETRY,
    schedule: { cron: '*/15 * * * *', payload: {} },
    runs,
    handle(payload): Promise<void> {
      runs.push(payload);

      return behaviour.fails === true
        ? Promise.reject(new Error('the ping could not reach anything'))
        : Promise.resolve();
    },
  };
}

function batch(retryCount = 0): BossJob<unknown>[] {
  return [{ id: 'job-1', data: {}, retryCount }];
}

describe('toQueueSettings', () => {
  it('turns attempts into the retries pg-boss counts, with backoff', () => {
    expect(toQueueSettings(RETRY)).toEqual({
      // Three attempts is the first one plus two retries.
      retryLimit: 2,
      retryDelay: 10,
      retryBackoff: true,
      retryDelayMax: 300,
    });
  });

  it('keeps the wait flat for a fixed policy', () => {
    expect(
      toQueueSettings({ maxAttempts: 2, firstRetryDelaySeconds: 30, backoff: 'fixed' }),
    ).toEqual({ retryLimit: 1, retryDelay: 30, retryBackoff: false });
  });

  it('asks for no retry at all when the job allows a single attempt', () => {
    expect(
      toQueueSettings({ maxAttempts: 1, firstRetryDelaySeconds: 5, backoff: 'exponential' }),
    ).toMatchObject({ retryLimit: 0 });
  });
});

describe('PgBossJobQueue', () => {
  it('creates the queue of a new job with its retry policy', async () => {
    const { queue, boss } = harness();

    await queue.register(jobThat());

    expect(boss.created).toEqual([
      {
        name: 'ping',
        settings: { retryLimit: 2, retryDelay: 10, retryBackoff: true, retryDelayMax: 300 },
      },
    ]);
    expect(boss.updated).toEqual([]);
  });

  it('writes the policy onto a queue a previous deploy had created', async () => {
    const { queue, boss } = harness();
    boss.existing.add('ping');

    await queue.register(jobThat());

    expect(boss.created).toEqual([]);
    expect(boss.updated).toMatchObject([{ name: 'ping', settings: { retryLimit: 2 } }]);
  });

  it('lets the failure out, which is what makes the queue retry the job', async () => {
    const { queue, boss, lines } = harness();
    const job = jobThat({ fails: true });

    await queue.register(job);

    const worker = boss.workers.get('ping');

    // A worker that resolved here would be a job marked done: pg-boss reads
    // the rejection, counts the attempt and schedules the next one.
    await expect(worker?.(batch(1))).rejects.toThrow('the ping could not reach anything');

    expect(job.runs).toHaveLength(1);
    expect(lines().find((line) => line['msg'] === JOB_FAILED)).toMatchObject({
      job: 'ping',
      jobId: 'job-1',
      // `retryCount: 1` is the second attempt, and the log says so.
      attempt: 2,
      level: 'error',
    });
  });

  it('hands the payload to the job and finishes quietly when it works', async () => {
    const { queue, boss } = harness();
    const job = jobThat();

    await queue.register(job);

    await expect(boss.workers.get('ping')?.(batch())).resolves.toBeUndefined();

    expect(job.runs).toEqual([{}]);
  });

  it('installs the cron of a scheduled job, read in UTC by default', async () => {
    const { queue, boss } = harness();

    await queue.register(jobThat());

    expect(boss.scheduled).toEqual([
      { name: 'ping', cron: '*/15 * * * *', payload: {}, timeZone: 'UTC' },
    ]);
  });

  it('reads the cron in the zone the job asks for', async () => {
    const { queue, boss } = harness();

    await queue.register({
      ...jobThat(),
      schedule: { cron: '0 6 * * *', payload: {}, timeZone: 'America/Sao_Paulo' },
    });

    expect(boss.scheduled).toMatchObject([{ timeZone: 'America/Sao_Paulo' }]);
  });

  it('schedules nothing for a job that only runs on demand', async () => {
    const { queue, boss } = harness();
    const { schedule: _schedule, ...onDemand } = jobThat();

    await queue.register(onDemand);

    expect(boss.scheduled).toEqual([]);
    expect(boss.workers.has('ping')).toBe(true);
  });

  it('enqueues the payload on the named queue', async () => {
    const { queue, boss } = harness();

    await queue.enqueue('ping', {});

    expect(boss.sent).toEqual([{ name: 'ping', payload: {} }]);
  });

  it('connects once, however many jobs register', async () => {
    const { queue, boss } = harness();

    await queue.register(jobThat());
    await queue.register(jobThat());
    await queue.enqueue('ping', {});

    expect(boss.starts).toBe(1);
  });

  it('stops the queue on shutdown, and only if it was ever started', async () => {
    const untouched = harness();

    await untouched.queue.onApplicationShutdown();

    expect(untouched.boss.stops).toBe(0);

    const used = harness();

    await used.queue.register(jobThat());
    await used.queue.onApplicationShutdown();

    expect(used.boss.stops).toBe(1);
  });
});
