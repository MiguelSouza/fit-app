import { ForbiddenException, HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';

import { GlobalExceptionFilter, type ErrorResponseBody } from './global-exception.filter';
import { ConflictError, NotFoundError, RuleViolationError } from '../domain/domain-error';

/**
 * The mapping from domain error to status code, which is the one place in the
 * API allowed to know both sides.
 *
 * The express response is faked: what is being tested is the decision, not
 * express.
 */
interface CapturedResponse {
  status: number | undefined;
  body: ErrorResponseBody | undefined;
}

function hostCapturing(captured: CapturedResponse): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: ErrorResponseBody) {
      captured.body = body;
      return this;
    },
  };

  // The filter only ever calls `switchToHttp().getResponse()`.
  return { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
}

function answerFor(exception: unknown): CapturedResponse {
  const captured: CapturedResponse = { status: undefined, body: undefined };
  new GlobalExceptionFilter().catch(exception, hostCapturing(captured));

  return captured;
}

describe('GlobalExceptionFilter', () => {
  beforeAll(() => {
    // The filter logs the unexpected error on purpose, and that log is a pass,
    // not a failure. Turning Nest's logger off keeps the expected stack from
    // being printed in the middle of the test output.
    Logger.overrideLogger(false);
  });

  it('maps a domain error to its status, keeping code and message', () => {
    expect(
      answerFor(new NotFoundError('nutrition.plan.not_found', 'Plano não encontrado.')),
    ).toEqual({
      status: HttpStatus.NOT_FOUND,
      body: { error: { code: 'nutrition.plan.not_found', message: 'Plano não encontrado.' } },
    });
  });

  it('maps each kind of domain error to a different status', () => {
    expect(
      answerFor(new ConflictError('nutrition.plan.already_active', 'Plano já ativo.')).status,
    ).toBe(HttpStatus.CONFLICT);
    expect(
      answerFor(new RuleViolationError('nutrition.plan.macros_exceeded', 'Macros acima do limite.'))
        .status,
    ).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('keeps the status of an http exception raised by the framework', () => {
    const answer = answerFor(new ForbiddenException());

    expect(answer.status).toBe(HttpStatus.FORBIDDEN);
    expect(answer.body?.error.code).toBe('api.http_403');
  });

  it('hides an unexpected error behind a generic 500', () => {
    // A driver message can quote the value of a column, so it must not reach
    // the client (CLAUDE.md, "Saúde e LGPD").
    const answer = answerFor(
      new Error('duplicate key value violates unique constraint (email)=(a@b.c)'),
    );

    expect(answer.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(answer.body).toEqual({
      error: {
        code: 'api.internal_error',
        message: 'Não foi possível concluir a operação. Tente novamente.',
      },
    });
  });
});
