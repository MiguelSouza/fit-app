import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { type Response } from 'express';

import { DomainError, type DomainErrorKind } from '../domain/domain-error';

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

/** Error body every endpoint of the API answers with. */
export interface ErrorResponseBody {
  readonly error: {
    /** Stable identifier, `<module>.<entity>.<problem>`; the client's i18n key. */
    readonly code: string;
    /** pt-BR text, safe to show. Never carries patient data. */
    readonly message: string;
  };
}

const INTERNAL_ERROR: ErrorResponseBody = {
  error: {
    code: 'api.internal_error',
    message: 'Não foi possível concluir a operação. Tente novamente.',
  },
};

/**
 * Everything the stack trace says minus its first line, which repeats the
 * message.
 *
 * An unexpected error is often the database driver's, and a Postgres message
 * quotes the value that broke the query ("Key (email)=(...) already exists").
 * That is personal data, and CLAUDE.md forbids logging it. The stack says
 * where it broke, which is what debugging needs.
 */
function stackWithoutMessage(error: Error): string {
  return (error.stack ?? '').split('\n').slice(1).join('\n');
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.describe(exception);

    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: HttpStatus; body: ErrorResponseBody } {
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

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: INTERNAL_ERROR };
  }
}
