import { Inject, Injectable, type LoggerService } from '@nestjs/common';

import { LOGGER, type AppLogger } from './logger';

/** The pino levels NestJS log methods map onto. */
type PinoLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Makes NestJS log through pino.
 *
 * `main.ts` hands this to `app.useLogger`, so everything already written with
 * `new Logger('Something')` — the exception filter, the connection pool, the
 * framework's own boot messages — comes out as structured JSON, with the
 * request's correlation id and with the sensitive fields masked. Nothing in the
 * codebase has to change to get that.
 *
 * NestJS passes the context as the last argument of the call
 * (`logger.log('message', 'ContextName')`), and `Logger.error` passes the
 * stack before it. Both are turned into their own fields instead of being
 * glued to the message, which is what makes a line queryable.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  constructor(@Inject(LOGGER) private readonly logger: AppLogger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private write(level: PinoLevel, message: unknown, params: readonly unknown[]): void {
    const last = params.at(-1);
    const context = typeof last === 'string' ? last : undefined;
    const extra = context === undefined ? params : params.slice(0, -1);

    const bindings: Record<string, unknown> = {};
    if (context !== undefined) bindings.context = context;

    const [first] = extra;
    if (
      (level === 'error' || level === 'fatal') &&
      extra.length === 1 &&
      typeof first === 'string'
    ) {
      // `Logger.error(message, stack, context)`: the one argument left is the stack.
      bindings.stack = first;
    } else if (extra.length > 0) {
      bindings.detail = extra;
    }

    if (typeof message === 'string') {
      this.logger[level](bindings, message);
      return;
    }

    // NestJS allows logging an object. It goes under a field of its own, where
    // the redaction of `formatters.log` reaches it.
    this.logger[level]({ ...bindings, message });
  }
}
