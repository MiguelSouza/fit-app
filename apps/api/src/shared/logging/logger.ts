import pino from 'pino';

import { type ApiEnv } from '../config/env';
import { currentCorrelationId } from './correlation-id';
import { redactSensitiveObject } from './sensitive-data';
import { toSafeError } from './safe-error';

/** The logger the whole API writes through. Structured JSON, one object per line. */
export type AppLogger = pino.Logger;

/**
 * Builds the logger.
 *
 * JSON on standard output and nothing else: in staging and production the ECS
 * task's stdout is the CloudWatch log stream (ADR 0005), and locally the lines
 * stay readable enough that a pretty printer is not worth a dependency — and
 * `pino-pretty` would be one more package reading data we must not leak.
 *
 * Three things are set on purpose:
 *
 * - `formatters.log` masks the sensitive fields of every log object before pino
 *   serializes it. Pino's own `redact` option takes a fixed list of paths
 *   (`a.b.email`), and we need the field masked wherever it shows up, at any
 *   depth, so the shape of an object nobody foresaw cannot leak a name.
 * - `serializers.err` drops the error message, which can quote a column value.
 * - `mixin` stamps the request's correlation id on every line written while it
 *   is in flight, without anyone having to pass it around.
 *
 * The message itself is not inspected: a log call writes a fixed sentence and
 * puts the data in the object, where redaction applies.
 *
 * @param env the parsed environment; only `logLevel` is read
 * @param destination where the lines go. Defaults to standard output; a test
 *   passes a stream and reads back what was written.
 */
export function createLogger(env: ApiEnv, destination?: pino.DestinationStream): AppLogger {
  const options: pino.LoggerOptions = {
    level: env.logLevel,
    // ISO 8601 in UTC, as everything else in this codebase stores time.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // `{"level":"info"}` instead of `{"level":30}`: CloudWatch Logs Insights
      // filters on the label, and a human reads it without a table.
      level: (label) => ({ level: label }),
      log: redactSensitiveObject,
    },
    serializers: { err: toSafeError },
    mixin: () => {
      const correlationId = currentCorrelationId();

      return correlationId === undefined ? {} : { correlationId };
    },
  };

  return pino(options, destination);
}

/**
 * Injection token for the logger built above.
 *
 * It lives here, and not in `logging.module.ts` as `ENV` and `DATABASE_POOL`
 * do, because `PinoLoggerService` injects it and the module declares that
 * service: having the token in the module file would make the two files import
 * each other.
 */
export const LOGGER = Symbol('fit-app.api.logger');
