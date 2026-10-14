import { Test } from '@nestjs/testing';
import { type DestinationStream } from 'pino';

import { ENV } from '../config/env.module';
import { type ApiEnv } from '../config/env';
import { LOGGER, createLogger } from '../logging/logger';
import { DisabledJobQueue, JOBS_DISABLED } from './disabled-job-queue';
import { JOB_QUEUE } from './job-queue.port';
import { JobsModule } from './jobs.module';

/**
 * What `JOBS_ENABLED=false` has to buy: the modules wire up, the jobs register
 * themselves, and nothing opens a connection. It is what lets every suite that
 * boots `AppModule` — and the step of `pnpm api:generate` that reads its
 * routes — run without a Postgres.
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  // Nothing answers here. A queue that connected would make this test hang
  // or fail, which is exactly the regression it is watching for.
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: 'unused-in-this-test-but-long-enough-0001',
  corsAllowedOrigins: [],
  jobsEnabled: false,
  logLevel: 'debug',
};

describe('JobsModule with the jobs turned off', () => {
  it('boots, registers the ping job and touches no database', async () => {
    const written: string[] = [];
    const destination: DestinationStream = {
      write(line: string): void {
        written.push(line);
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [JobsModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(LOGGER)
      .useValue(createLogger(env, destination))
      .compile();

    const app = await moduleRef.createNestApplication().init();

    try {
      expect(app.get(JOB_QUEUE)).toBeInstanceOf(DisabledJobQueue);

      const lines = written.map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(lines.find((line) => line['msg'] === JOBS_DISABLED)).toMatchObject({ job: 'ping' });
    } finally {
      await app.close();
    }
  });
});
