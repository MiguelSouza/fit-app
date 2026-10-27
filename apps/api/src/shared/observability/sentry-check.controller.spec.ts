import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { API_VERSION, configureApp } from '../../bootstrap';
import { buildOpenApiDocument } from '../../openapi';
import { DATABASE_STATUS_PORT } from '../../health-check/application/ports/database-status.port';
import { ENV } from '../config/env.module';
import { type ApiEnv, type NodeEnv } from '../config/env';
import { SENTRY_CHECK_PATH } from './sentry-check.controller';

/**
 * The first acceptance criterion of card F-16 — *um erro provocado em cada app
 * aparece no Sentry* — as far as a test can take it: the route is there, it
 * fails the way an unexpected error fails, and the client learns nothing from
 * it. Whether the event reaches the project is a look at the Sentry dashboard
 * with a DSN set, and the README says how.
 */
function envFor(nodeEnv: NodeEnv): ApiEnv {
  return {
    nodeEnv,
    port: 0,
    databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
    supabaseJwtSecret: 'unused-in-this-test-but-long-enough-0001',
    corsAllowedOrigins: [],
    jobsEnabled: false,
    logLevel: 'silent',
  };
}

async function bootApp(nodeEnv: NodeEnv): Promise<INestApplication> {
  const env = envFor(nodeEnv);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE_STATUS_PORT)
    .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' }) })
    .compile();

  // `logger: false`: the 500 below is the point of the route, and the filter
  // logs its stack on the way out. Muted, the expected one does not look like
  // a failure in the test output.
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, env);

  return app.init();
}

describe(`GET /v${API_VERSION}/${SENTRY_CHECK_PATH}`, () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('fails with the generic 500, telling the caller nothing', async () => {
    app = await bootApp('development');

    const response = await request(app.getHttpServer())
      .get(`/v${API_VERSION}/${SENTRY_CHECK_PATH}`)
      .expect(500);

    expect(response.body).toEqual({
      error: {
        code: 'api.internal_error',
        message: 'Não foi possível concluir a operação. Tente novamente.',
      },
    });

    // The error carries synthetic personal data so the issue in Sentry shows
    // it masked; none of it may come back in the answer either.
    expect(JSON.stringify(response.body)).not.toContain('Ana Souza');
  });

  it('answers 404 in production, like a route that is not there', async () => {
    app = await bootApp('production');

    await request(app.getHttpServer()).get(`/v${API_VERSION}/${SENTRY_CHECK_PATH}`).expect(404);
  });

  it('stays out of the OpenAPI document, because it is not part of the contract', async () => {
    app = await bootApp('development');

    const paths = Object.keys(buildOpenApiDocument(app, API_VERSION).paths);

    expect(paths).not.toContain(`/v${API_VERSION}/${SENTRY_CHECK_PATH}`);
    expect(paths.some((path) => path.includes('debug'))).toBe(false);
  });
});
