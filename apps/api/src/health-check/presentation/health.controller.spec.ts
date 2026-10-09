import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { configureApp } from '../../bootstrap';
import { DATABASE_STATUS_PORT } from '../application/ports/database-status.port';
import { type ComponentHealth } from '../domain/system-health';
import { ENV } from '../../shared/config/env.module';
import { type ApiEnv } from '../../shared/config/env';

/**
 * Example of a `presentation/` test: the real `AppModule`, booted the same way
 * `main.ts` boots it, answering over HTTP.
 *
 * Two providers are overridden and nothing else: the environment, so the test
 * needs no `.env`, and the database port, so it needs no Postgres. The
 * versioning, the controller and the wiring under test are the production
 * ones — which is what makes this the test that backs "`GET /v1/health`
 * answers 200".
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  corsAllowedOrigins: [],
};

async function bootApp(database: ComponentHealth): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE_STATUS_PORT)
    .useValue({ check: () => Promise.resolve(database) })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, env);

  return app.init();
}

describe('GET /v1/health', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('answers 200 with the api and the database up', async () => {
    app = await bootApp({ name: 'database', status: 'up', latencyMs: 4 });

    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      checks: [
        { name: 'api', status: 'up' },
        { name: 'database', status: 'up', latencyMs: 4 },
      ],
    });
  });

  it('still answers 200 with the database down, saying which piece failed', async () => {
    app = await bootApp({ name: 'database', status: 'down' });

    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);

    expect(response.body).toEqual({
      status: 'degraded',
      checks: [
        { name: 'api', status: 'up' },
        { name: 'database', status: 'down' },
      ],
    });
  });

  it('serves the route only under the version prefix', async () => {
    app = await bootApp({ name: 'database', status: 'up' });

    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
