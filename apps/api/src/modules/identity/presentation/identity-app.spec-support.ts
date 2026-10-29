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
import {
  INVITATION_REPOSITORY,
  type InvitationRepository,
} from '../application/ports/invitation-repository.port';
import {
  INVITATION_TOKEN_ISSUER,
  type InvitationTokenIssuer,
} from '../application/ports/invitation-token.port';

/**
 * The real `AppModule` over HTTP, with the few things overridden that a test
 * would otherwise need a `.env` and a Postgres for: the environment, the
 * database port of the health check, the identity registry and — for the
 * routes that have them — the invitation repository and the token issuer.
 *
 * Those are the seams, and only those: the route, the global
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

/**
 * The other seams of `identity`, for the routes that have them: the
 * invitations of card I-02 are kept by a repository and their tokens are
 * minted by an issuer, and a test that does not want Postgres hands over both.
 *
 * Optional, so the suites of card I-01 — which touch neither — stay as they
 * were.
 */
export interface IdentityDoubles {
  readonly invitations?: InvitationRepository;
  readonly tokens?: InvitationTokenIssuer;
}

export async function bootAppWith(
  registry: IdentityRegistry,
  doubles: IdentityDoubles = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE_STATUS_PORT)
    .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' }) })
    .overrideProvider(IDENTITY_REGISTRY)
    .useValue(registry);

  if (doubles.invitations !== undefined) {
    builder = builder.overrideProvider(INVITATION_REPOSITORY).useValue(doubles.invitations);
  }

  if (doubles.tokens !== undefined) {
    builder = builder.overrideProvider(INVITATION_TOKEN_ISSUER).useValue(doubles.tokens);
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, env);

  return app.init();
}
