import { scrubSentryEvent } from '@fit-app/observability';
import * as Sentry from '@sentry/node';

import { type ApiEnv, type SentryConfig } from '../config/env';

/**
 * Where an unexpected error of the API goes besides the log (ADR 0013).
 *
 * Two layers keep patient data out of what leaves this process, and they are
 * not redundant:
 *
 * - `dataCollection` tells the SDK what never to pick up in the first place —
 *   a request body, a cookie, a header, a query string, the arguments of a
 *   query, the local variables of a stack frame. Data that was never collected
 *   cannot leak through a code path nobody reviewed.
 * - `beforeSend` runs last, on the event as it is about to go out, and masks
 *   what is left by field name (`@fit-app/observability`, the same list the
 *   log lines go through). It is what catches a field an integration added
 *   that this file does not know about.
 *
 * Nothing here decides *whether* to report: that is the environment. No
 * `SENTRY_DSN`, no client, and every call below becomes a no-op — which is
 * what a laptop and a test run want.
 */

/**
 * The options the API starts Sentry with.
 *
 * Exported because the test uses exactly these, with a transport of its own,
 * to look at the envelope that would have gone out: a test that built its own
 * options would be testing something the API does not run.
 */
export function sentryOptions(config: SentryConfig): Sentry.NodeOptions {
  return {
    dsn: config.dsn,

    // The two fields that make an event actionable: which deployment it came
    // from, and which version was running.
    environment: config.environment,
    release: config.release,

    // Errors only. Tracing samples requests, and a span carries the route and
    // the query of everything the API does, which is a different decision with
    // a different cost — it is not what this card asks for, and turning it on
    // is its own change.
    tracesSampleRate: 0,

    dataCollection: {
      // The user is set by hand, by id, where the error is reported. Left on,
      // the SDK fills `user` from whatever an integration found — an
      // `Authorization` header, a cookie, a body.
      userInfo: false,

      // The body of a request to this API is a check-in, a note, a meal or a
      // measurement. There is no version of it that may leave.
      httpBodies: [],

      // The session token lives in both.
      cookies: false,
      httpHeaders: false,

      // A search box puts whatever was typed in the query string, and here
      // that is usually somebody's name.
      urlQueryParams: false,

      // Bound parameters and written rows: the value that broke the query is
      // the patient's. The sanitized statement still comes through, which is
      // what says where it broke.
      databaseQueryData: false,

      // The payload of a job (pg-boss, ADR 0009) carries ids, and one day will
      // carry more than ids.
      queues: false,

      // The locals at the point of the failure are the patient's; the source
      // lines around it are ours and stay (`frameContextLines`).
      stackFrameVariables: false,
    },

    beforeSend: (event) => scrubSentryEvent(event),
  };
}

/**
 * Starts the Sentry client, if this deployment has one.
 *
 * Called from `instrument.ts`, which `main.ts` imports before anything else:
 * the SDK instruments `http` and `express` while it starts, and a module
 * loaded before it is a module it cannot see.
 *
 * @returns whether a client was started, which is what the boot log says
 */
export function initSentry(env: ApiEnv): boolean {
  if (env.sentry === undefined) return false;

  Sentry.init(sentryOptions(env.sentry));

  return true;
}

/** What the API knows about a failed request that is safe to send. */
export interface ErrorReportContext {
  /** The Supabase user id of the caller, when the route had one. Never a name. */
  readonly userId?: string | undefined;
  readonly method?: string | undefined;
  /** The path, without the query string. Ids in it are what makes an issue readable. */
  readonly path?: string | undefined;
  /** Ties the event to the line the logger wrote for the same request. */
  readonly correlationId?: string | undefined;
}

/**
 * Reports an unexpected error, with the caller identified by id and nothing
 * else.
 *
 * A no-op when no client was started, because `captureException` is one — so
 * the caller has no flag to check and no branch to forget.
 *
 * Only the unexpected ones get here. A domain error and an `HttpException` are
 * answers this API gives on purpose (a 404, a 403, a 422); sending them would
 * drown the real failures and put a bug tracker between a nutritionist and a
 * validation message.
 */
export function reportUnexpectedError(exception: unknown, context: ErrorReportContext): void {
  Sentry.captureException(exception, {
    // `user` with only an id: the SDK would otherwise show an e-mail and a
    // username next to the issue, and this platform has no reason to put a
    // patient in a bug tracker (CLAUDE.md, "Saúde e LGPD").
    ...(context.userId === undefined ? {} : { user: { id: context.userId } }),

    // Tags are indexed and searchable in Sentry, which is what the
    // correlation id is for: it is the one string that joins this event to the
    // request line in CloudWatch.
    tags: {
      ...(context.method === undefined ? {} : { method: context.method }),
      ...(context.path === undefined ? {} : { path: context.path }),
      ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }),
    },
  });
}

/**
 * Hands whatever is buffered to Sentry, with a deadline.
 *
 * ECS gives a task 30 seconds between the SIGTERM and the kill (ADR 0005), and
 * an event still in the queue when the process goes is an event nobody ever
 * sees — which is exactly the deploy where the bug is most likely.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  await Sentry.flush(timeoutMs);
}
