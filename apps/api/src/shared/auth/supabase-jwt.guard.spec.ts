import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type DestinationStream } from 'pino';
import request from 'supertest';

import { CurrentUser } from './current-user.decorator';
import { type AuthenticatedUser } from './authenticated-user';
import {
  OTHER_JWT_SECRET,
  TEST_JWT_SECRET,
  TEST_USER_ID,
  signAccessToken,
} from './local-access-token.spec-support';
import { Public } from './public.decorator';
import { AppModule } from '../../app.module';
import { configureApp } from '../../bootstrap';
import { DATABASE_STATUS_PORT } from '../../health-check/application/ports/database-status.port';
import { type ApiEnv } from '../config/env';
import { ENV } from '../config/env.module';
import { createLogger, LOGGER } from '../logging/logger';
import { PinoLoggerService } from '../logging/pino-logger.service';

/**
 * The guard as the API actually runs it: the real `AppModule`, booted the way
 * `main.ts` boots it, with the global guard in front of every route.
 *
 * Two controllers are added to the testing module because there is no
 * authenticated route in the API yet — F-08 is what makes the next card's
 * routes protected by default. Everything else is production wiring: the
 * guard, the verifier, the versioning and the error filter.
 *
 * Only the environment and the database port are overridden, as in
 * `health.controller.spec.ts`: no `.env` and no Postgres needed.
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: TEST_JWT_SECRET,
  corsAllowedOrigins: [],
  jobsEnabled: false,
  logLevel: 'silent',
};

/** Stands in for the routes the domain cards will add: nothing special on it. */
@Controller({ path: 'protected-example' })
class ProtectedExampleController {
  @Get()
  get(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

@Controller({ path: 'public-example' })
class PublicExampleController {
  @Public()
  @Get()
  get(): { reached: boolean } {
    return { reached: true };
  }
}

/**
 * `@Public()` on one handler and not on the one next to it: the metadata is
 * read per route, so the neighbour is still protected.
 */
@Controller({ path: 'mixed-example' })
class MixedExampleController {
  @Public()
  @Get('open')
  open(): { reached: boolean } {
    return { reached: true };
  }

  @Get('closed')
  closed(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

/**
 * A whole controller marked `@Public()`, as `HealthController` is, with a
 * second route next to the first: it is open too, and nothing written on the
 * handler could have closed it.
 */
@Public()
@Controller({ path: 'public-controller-example' })
class PublicControllerExampleController {
  @Get('first')
  first(): { reached: boolean } {
    return { reached: true };
  }

  @Get('second')
  second(): { reached: boolean } {
    return { reached: true };
  }
}

/** The mistake `@CurrentUser()` on an open route is: a 500, not a 401. */
@Controller({ path: 'public-asking-for-the-user' })
class PublicAskingForTheUserController {
  @Public()
  @Get()
  get(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [
      ProtectedExampleController,
      PublicExampleController,
      MixedExampleController,
      PublicControllerExampleController,
      PublicAskingForTheUserController,
    ],
  })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE_STATUS_PORT)
    .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' }) })
    .compile();

  // `logger: false` only because one test below provokes a 500 on purpose:
  // the error filter would print its stack in the middle of a green run.
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, env);

  return app.init();
}

describe('the global authentication guard', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function get(path: string): request.Test {
    return request(app.getHttpServer()).get(path);
  }

  describe('without a usable token', () => {
    it('answers 401 when no token is sent', async () => {
      const response = await get('/v1/protected-example').expect(401);

      expect(response.body).toEqual({
        error: { code: 'api.http_401', message: 'Sessão inválida ou expirada. Entre novamente.' },
      });
    });

    it('answers 401 for an expired token', async () => {
      await get('/v1/protected-example')
        .set('authorization', `Bearer ${await signAccessToken({ expiresInSeconds: -1 })}`)
        .expect(401);
    });

    it('answers 401 for a token signed with another secret', async () => {
      await get('/v1/protected-example')
        .set('authorization', `Bearer ${await signAccessToken({ secret: OTHER_JWT_SECRET })}`)
        .expect(401);
    });

    it('answers 401 for a token of another audience', async () => {
      await get('/v1/protected-example')
        .set('authorization', `Bearer ${await signAccessToken({ audience: 'admin' })}`)
        .expect(401);
    });

    it('answers 401 for something that is not a token', async () => {
      await get('/v1/protected-example').set('authorization', 'Bearer nope').expect(401);
      await get('/v1/protected-example').set('authorization', 'Basic dXNlcjpwYXNz').expect(401);
    });

    it('says the same thing whatever the reason was', async () => {
      // The caller's move is the same in every case, and a message that tells
      // the cases apart is a probe for whoever is trying tokens.
      const [missing, expired] = await Promise.all([
        get('/v1/protected-example'),
        get('/v1/protected-example').set(
          'authorization',
          `Bearer ${await signAccessToken({ expiresInSeconds: -1 })}`,
        ),
      ]);

      expect(missing.body).toEqual(expired.body);
    });
  });

  describe('with a valid token', () => {
    it('lets the request through and hands @CurrentUser() the right id', async () => {
      const response = await get('/v1/protected-example')
        .set('authorization', `Bearer ${await signAccessToken()}`)
        .expect(200);

      expect(response.body).toEqual({ id: TEST_USER_ID, role: 'authenticated' });
    });

    it('reads the id of whoever the token is for, not a fixed one', async () => {
      const subject = '9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d';

      const response = await get('/v1/protected-example')
        .set('authorization', `Bearer ${await signAccessToken({ subject })}`)
        .expect(200);

      expect(response.body).toMatchObject({ id: subject });
    });

    it('accepts the scheme written in any case', async () => {
      await get('/v1/protected-example')
        .set('authorization', `bearer ${await signAccessToken()}`)
        .expect(200);
    });
  });

  describe('public routes', () => {
    it('lets a @Public() route answer with no token', async () => {
      await get('/v1/public-example').expect(200, { reached: true });
    });

    it('reads @Public() per route, so the handler next to an open one is closed', async () => {
      await get('/v1/mixed-example/open').expect(200, { reached: true });
      await get('/v1/mixed-example/closed').expect(401);
      await get('/v1/mixed-example/closed')
        .set('authorization', `Bearer ${await signAccessToken()}`)
        .expect(200);
    });

    it('opens every route of a controller marked @Public(), with no way back', async () => {
      // The edge of a decorator that only says "open": marking a controller
      // marks the routes somebody adds to it later too, and no handler can
      // close one again. Hence the rule in `public.decorator.ts` — a
      // controller is only marked when the whole of it is public.
      await get('/v1/public-controller-example/first').expect(200);
      await get('/v1/public-controller-example/second').expect(200);
    });

    it('keeps GET /v1/health open, for a probe that has no session', async () => {
      await get('/v1/health').expect(200);
    });

    it('still answers 404 for an unknown route instead of 401', async () => {
      // A 401 here would tell an anonymous caller which routes exist.
      await get('/v1/not-a-route').expect(404);
    });

    it('treats asking for the caller on an open route as a bug, not a refusal', async () => {
      const response = await get('/v1/public-asking-for-the-user').expect(500);

      expect(response.body).toEqual({
        error: {
          code: 'api.internal_error',
          message: 'Não foi possível concluir a operação. Tente novamente.',
        },
      });
    });
  });
});

/**
 * The same guard, in front of an app that has the logger the API runs with, so
 * what a refusal writes can be read back.
 *
 * The level is the whole point. The default level in production is `info`
 * (`shared/config/env.ts`), so a refusal written at `debug` is not written at
 * all: a token this project did not issue has to come out at `warn` or the
 * reason code the README sends an investigator to read is not there. And it is
 * the reason code alone — the token itself never reaches a line (CLAUDE.md,
 * "Saúde e LGPD").
 */
describe('what a refused request writes to the log', () => {
  const productionLevel: ApiEnv = { ...env, logLevel: 'info' };
  const written: Record<string, unknown>[] = [];

  const destination: DestinationStream = {
    write(line: string): void {
      written.push(JSON.parse(line) as Record<string, unknown>);
    },
  };

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProtectedExampleController],
    })
      .overrideProvider(ENV)
      .useValue(productionLevel)
      .overrideProvider(LOGGER)
      .useValue(createLogger(productionLevel, destination))
      .overrideProvider(DATABASE_STATUS_PORT)
      .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' }) })
      .compile();

    app = moduleRef.createNestApplication();

    // As `main.ts` does it: without this bridge a `Logger` call inside the
    // guard goes to the console and no line exists to assert on.
    app.useLogger(app.get(PinoLoggerService));
    configureApp(app, productionLevel);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    written.length = 0;
  });

  function refusals(): Record<string, unknown>[] {
    return written.filter((line) => String(line.msg).startsWith('access token refused'));
  }

  it('writes a token this project did not issue at warn, by reason alone', async () => {
    const token = await signAccessToken({ secret: OTHER_JWT_SECRET });

    await request(app.getHttpServer())
      .get('/v1/protected-example')
      .set('authorization', `Bearer ${token}`)
      .expect(401);

    expect(refusals()).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: 'AuthGuard',
        msg: 'access token refused (signature)',
      }),
    ]);

    // Not the token, not a piece of it, and no id of anybody.
    const everything = JSON.stringify(written);
    for (const part of token.split('.')) expect(everything).not.toContain(part);
  });

  it('keeps a request with no token out of the production log', async () => {
    await request(app.getHttpServer()).get('/v1/protected-example').expect(401);

    // Nobody signed in yet is traffic, not an event: `debug`, which the
    // production level does not write.
    expect(refusals()).toEqual([]);
  });
});
