import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { type ErrorResponse } from '@fit-app/contracts';
import { type Request, type Response } from 'express';

import { authenticatedUserOf } from '../auth/authenticated-user';
import { DomainError, type DomainErrorKind } from '../domain/domain-error';
import { currentCorrelationId } from '../logging/correlation-id';
import { stackWithoutMessage } from '../logging/safe-error';
import { reportUnexpectedError, type ErrorReportContext } from '../observability/sentry';

/**
 * The only place in the API where a domain error becomes a status code
 * (CLAUDE.md, "Convenções"). `domain/` and `application/` throw `DomainError`
 * and know nothing about HTTP.
 */
const STATUS_BY_KIND: Readonly<Record<DomainErrorKind, HttpStatus>> = {
  invalid_input: HttpStatus.BAD_REQUEST,
  not_found: HttpStatus.NOT_FOUND,
  permission_denied: HttpStatus.FORBIDDEN,
  conflict: HttpStatus.CONFLICT,
  rule_violation: HttpStatus.UNPROCESSABLE_ENTITY,
};

/**
 * Error body every endpoint of the API answers with. The shape is
 * `errorResponseSchema` in `@fit-app/contracts` (CLAUDE.md rule 7), which is
 * also what the clients read it as.
 */
export type ErrorResponseBody = ErrorResponse;

const INTERNAL_ERROR: ErrorResponseBody = {
  error: {
    code: 'api.internal_error',
    message: 'Não foi possível concluir a operação. Tente novamente.',
  },
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const { status, body, unexpected } = this.describe(exception);

    // Only the unexpected ones, and only after the decision above: a 404, a
    // 403 and a 422 are answers this API gives on purpose, and sending them
    // would drown the real failures (ADR 0013).
    if (unexpected) reportUnexpectedError(exception, reportContext(http.getRequest<Request>()));

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: HttpStatus;
    body: ErrorResponseBody;
    unexpected?: true;
  } {
    if (exception instanceof DomainError) {
      return {
        status: STATUS_BY_KIND[exception.kind],
        body: { error: { code: exception.code, message: exception.message } },
      };
    }

    // Raised by Nest itself (an unknown route, a guard, a pipe) or thrown on
    // purpose by a controller. The status it carries is already the answer.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      return {
        status,
        body: { error: { code: `api.http_${status}`, message: exception.message } },
      };
    }

    // A bug or an outage: the client gets a generic message, never the
    // internal one, which could leak a query or a value.
    this.logger.error(
      exception instanceof Error
        ? `unhandled ${exception.name}`
        : `unhandled non-error exception (${typeof exception})`,
      exception instanceof Error ? stackWithoutMessage(exception) : undefined,
    );

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: INTERNAL_ERROR, unexpected: true };
  }
}

/**
 * What goes to Sentry about the request that failed: an id for the caller, the
 * route, and the correlation id that joins the event to the line the logger
 * wrote for the same request.
 *
 * Not the body, not the headers, not the query string — the SDK is told not to
 * collect any of them (`sentry.ts`) and the filter has no reason to put them
 * back. The request may be missing entirely: a filter also catches what breaks
 * outside an HTTP context.
 */
function reportContext(request: Request | undefined): ErrorReportContext {
  return {
    userId: request === undefined ? undefined : authenticatedUserOf(request)?.id,
    method: request?.method,
    path: request?.originalUrl?.split('?')[0],
    correlationId: currentCorrelationId(),
  };
}
