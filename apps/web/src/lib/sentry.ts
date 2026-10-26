import { scrubSentryEvent } from '@fit-app/observability';
import { type init } from '@sentry/nextjs';

/**
 * The options every runtime of the panel starts Sentry with: the browser, the
 * Node server that renders it and the edge (ADR 0013).
 *
 * One file for the three because the rule is the same everywhere — what may
 * not leave this platform does not depend on where the error happened — and
 * because three copies of a filter is three chances of one of them drifting.
 *
 * The variables are `NEXT_PUBLIC_*` and go into the bundle at build time, so
 * what counts is the environment of the build and not the one of the server
 * that runs afterwards (same as `lib/env.ts`). The DSN is public by design: it
 * allows sending an event to the project and nothing else.
 */
type SentryOptions = NonNullable<Parameters<typeof init>[0]>;

/**
 * The options, or `undefined` when this build has no DSN — which is what a
 * laptop and the CI want: the error stays in the console and goes nowhere.
 *
 * Each variable is spelled out because that is how Next.js recognises and
 * replaces it; `process.env[name]` would reach the browser as nothing.
 */
export function sentryOptions(): SentryOptions | undefined {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (dsn === undefined || dsn === '') return undefined;

  // Which version is sending. On Vercel the commit of the deploy is there
  // without anybody setting it, which is the honest default; locally there is
  // usually none, and an event without a release is still better than a panel
  // that refuses to open — unlike the API, this one cannot stop at startup.
  const release =
    process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

  return {
    dsn,

    // The deployment, not the build mode: a preview on Vercel is built with
    // `NODE_ENV=production` and has no business being read as production.
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

    ...(release === undefined || release === '' ? {} : { release }),

    // Errors only, like the API: tracing samples navigations and requests,
    // and that is a different decision with a different cost.
    tracesSampleRate: 0,

    // The session replay of Sentry records the screen. On a panel that shows
    // patients that is a video of health data leaving the browser, and it
    // stays off (CLAUDE.md, "Saúde e LGPD").
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    dataCollection: {
      // The user is set by hand, by id, in the layout of the panel.
      userInfo: false,

      // What the professional typed and what the API answered about a patient.
      httpBodies: [],
      cookies: false,
      httpHeaders: false,

      // The search box of the patient list puts a name in there.
      urlQueryParams: false,

      stackFrameVariables: false,
    },

    // The last word, on the event as it goes out: the same filter and the same
    // field name list the API uses (`@fit-app/observability`).
    beforeSend: scrubSentryEvent,
  };
}

/**
 * The message of the error the check page provokes (`/debug/sentry`), in both
 * halves of it: the one thrown while the server renders and the one thrown in
 * the browser.
 *
 * It carries a synthetic name, e-mail and weight on purpose — in the Sentry
 * issue all three have to show up as `[redacted]`. Seeing that an event
 * arrived is half the check; the other half is what it did **not** carry.
 */
export const SENTRY_CHECK_MESSAGE =
  'erro proposital do painel: paciente Ana Souza <ana.souza@example.com>, peso 61,4 kg';
