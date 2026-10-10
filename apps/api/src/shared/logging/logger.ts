import pino from 'pino';

import { type ApiEnv } from '../config/env';
import { currentCorrelationId } from './correlation-id';
import { redactSensitiveObject } from './sensitive-data';
import { toSafeError } from './safe-error';

/**
 * The message a line gets when an error was logged without one of its own.
 *
 * Pino, left alone, takes the message from the error in that case:
 * `logger.error(err)` and `logger.error({ err })` both come out with
 * `msg: err.message`, which puts straight back the text `serializers.err`
 * exists to drop — a Postgres message quotes the value that broke the query
 * ("Key (email)=(...) already exists"). So the sentence is ours and not the
 * error's, and it is short enough to grep for: a call that lands here is a call
 * missing its sentence.
 */
export const ERROR_WITHOUT_MESSAGE = 'error logged without a message';

/**
 * The arguments of a log call, with the error's message never standing in for
 * the one the call did not give. The object the caller passed is kept as it is,
 * and the redaction of `formatters.log` still runs over it afterwards.
 */
function withFixedErrorMessage(args: unknown[]): unknown[] {
  const [first, second] = args;

  // A message was given, so pino has no reason to go looking for one.
  if (second !== undefined) return args;

  if (first instanceof Error) {
    return [{ err: first }, ERROR_WITHOUT_MESSAGE];
  }

  if (first === null || typeof first !== 'object') return args;

  // Pino copies `obj.err.message` whenever the object carries an error and no
  // message of its own.
  const { err, msg } = first as { err?: unknown; msg?: unknown };

  return err != null && msg === undefined ? [first, ERROR_WITHOUT_MESSAGE] : args;
}

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
 * - `serializers.err` drops the error message, which can quote a column value,
 *   and `hooks.logMethod` keeps pino from putting that same message back as the
 *   line's `msg` when the call did not give one.
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
    hooks: {
      logMethod(args, method) {
        // `Parameters<pino.LogFn>` spells out only the `(msg, ...args)`
        // overload, so the first argument is typed as a string even though pino
        // accepts an object there too; it is read back as `unknown`.
        method.apply(this, withFixedErrorMessage([...args]) as Parameters<pino.LogFn>);
      },
    },
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
