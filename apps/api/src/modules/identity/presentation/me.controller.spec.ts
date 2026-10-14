import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { meResponseSchema } from '@fit-app/contracts';
import request from 'supertest';

import { AppModule } from '../../../app.module';
import { configureApp } from '../../../bootstrap';
import { DATABASE_STATUS_PORT } from '../../../health-check/application/ports/database-status.port';
import { ENV } from '../../../shared/config/env.module';
import {
  signAccessToken,
  TEST_JWT_SECRET,
} from '../../../shared/auth/local-access-token.spec-support';
import { type ApiEnv } from '../../../shared/config/env';

/**
 * The real `AppModule` over HTTP, with the environment and the database port
 * overridden so the test needs neither a `.env` nor Postgres — the same two
 * seams `health.controller.spec.ts` uses.
 *
 * `/v1/me` is not `@Public()`: the global guard of card F-08 answers 401
 * without a token, so the test signs one with the same secret it puts in the
 * environment.
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: TEST_JWT_SECRET,
  corsAllowedOrigins: [],
  logLevel: 'silent',
};

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE_STATUS_PORT)
    .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' }) })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, env);

  return app.init();
}

describe('GET /v1/me', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await bootApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers the provisional identity, in the shape of the contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      personId: '00000000-0000-0000-0000-000000000000',
      role: 'professional',
      timeZone: 'America/Sao_Paulo',
    });

    // What the panel and the app will do with it: read it as the contract.
    expect(meResponseSchema.safeParse(response.body).success).toBe(true);
  });
});
