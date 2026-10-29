import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../../app.module';
import { configureApp } from '../../../bootstrap';
import { DATABASE_STATUS_PORT } from '../../../health-check/application/ports/database-status.port';
import { ENV } from '../../../shared/config/env.module';
import { TEST_JWT_SECRET } from '../../../shared/auth/local-access-token.spec-support';
import { type ApiEnv } from '../../../shared/config/env';
import {
  IDENTITY_REGISTRY,
  type IdentityRegistry,
} from '../application/ports/identity-registry.port';

/**
 * The real `AppModule` over HTTP, with three things overridden so the test
 * needs neither a `.env` nor Postgres: the environment, the database port of
 * the health check and the identity registry.
 *
 * The registry is the seam, and only the registry: the route, the global
 * guard, the validation pipe, the serializer and the error filter are the ones
 * the API runs with. What the fake cannot answer for is the SQL, and that is
 * what the integration profile covers.
 */
export const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: TEST_JWT_SECRET,
  corsAllowedOrigins: [],
  jobsEnabled: false,
  logLevel: 'silent',
};

export async function bootAppWith(registry: IdentityRegistry): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE_STATUS_PORT)
    .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' }) })
    .overrideProvider(IDENTITY_REGISTRY)
    .useValue(registry)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, env);

  return app.init();
}
