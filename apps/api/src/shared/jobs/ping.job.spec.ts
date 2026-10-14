import { type DestinationStream } from 'pino';

import { createLogger } from '../logging/logger';
import { type ApiEnv } from '../config/env';
import { type JobName } from './job-catalog';
import { type JobDefinition, type JobQueuePort } from './job-queue.port';
import { PING, PING_CRON, PingJob } from './ping.job';

const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: 'unused-in-this-test-but-long-enough-0001',
  corsAllowedOrigins: [],
  jobsEnabled: false,
  logLevel: 'debug',
};

class RecordingQueue implements JobQueuePort {
  readonly registered: JobDefinition<JobName>[] = [];

  register<Name extends JobName>(job: JobDefinition<Name>): Promise<void> {
    this.registered.push(job);

    return Promise.resolve();
  }

  enqueue(): Promise<void> {
    return Promise.resolve();
  }
}

interface Harness {
  readonly job: PingJob;
  readonly queue: RecordingQueue;
  readonly lines: () => Record<string, unknown>[];
}

function harness(): Harness {
  const written: string[] = [];
  const destination: DestinationStream = {
    write(line: string): void {
      written.push(line);
    },
  };
  const queue = new RecordingQueue();

  return {
    queue,
    job: new PingJob(queue, createLogger(env, destination)),
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('the ping job', () => {
  it('registers itself with the queue while the app starts', async () => {
    const { job, queue } = harness();

    await job.onApplicationBootstrap();

    expect(queue.registered).toEqual([job]);
  });

  it('runs on a clock, and backs off when it fails', () => {
    const { job } = harness();

    expect(job.schedule).toEqual({ cron: PING_CRON, payload: {} });
    expect(job.retry).toMatchObject({ maxAttempts: 3, backoff: 'exponential' });
  });

  it('writes its line and nothing else', async () => {
    const { job, lines } = harness();

    await job.handle();

    expect(lines()).toMatchObject([{ msg: PING, level: 'info' }]);
  });
});
