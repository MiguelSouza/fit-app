import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
import { ENV } from '../config/env.module';
import { type ApiEnv } from '../config/env';

/** Path of the route, so the README and the test name the same thing once. */
export const SENTRY_CHECK_PATH = 'debug/sentry';

/**
 * The error the route raises. It carries a name, an e-mail and a weight on
 * purpose: whoever is checking the pipeline needs to see, in the Sentry issue,
 * that the message came out as `[redacted]` — the half of the check that
 * matters is not that an event arrived, it is what it did **not** carry.
 *
 * Synthetic data, as every value in this repository outside production is
 * (CLAUDE.md, "Testes": never real patient data, not even here).
 */
export class SentryCheckError extends Error {
  constructor() {
    super('erro proposital do fit-app: paciente Ana Souza <ana.souza@example.com>, peso 61,4 kg');
    this.name = 'SentryCheckError';
  }
}

/**
 * `GET /v1/debug/sentry`: provokes an error, which is the acceptance criterion
 * of card F-16 ("um erro provocado em cada app aparece no Sentry") made
 * reproducible instead of being a `throw` somebody adds by hand and forgets to
 * take back out.
 *
 * **In production it answers 404**, like a route that is not there: there is
 * no crash button in front of real patients, and a 404 is also what an
 * unauthenticated scan deserves to learn about it. Everywhere else it throws,
 * and the error takes the same path any bug of this API takes — the global
 * filter answers 500 and reports it.
 *
 * It stays out of the OpenAPI document in every environment: it is not part of
 * the contract, and a generated client method for it would be absurd.
 *
 * `@Public()` for the same reason the health check is: locally there is no
 * token this API accepts (ADR 0012), and the route says nothing about anybody.
 */
@Public()
@ApiExcludeController()
@Controller({ path: SENTRY_CHECK_PATH })
export class SentryCheckController {
  constructor(@Inject(ENV) private readonly env: ApiEnv) {}

  /**
   * @throws NotFoundException in production
   * @throws SentryCheckError everywhere else
   */
  @Get()
  get(): never {
    if (this.env.nodeEnv === 'production') throw new NotFoundException();

    throw new SentryCheckError();
  }
}
