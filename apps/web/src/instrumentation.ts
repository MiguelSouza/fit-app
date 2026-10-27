import * as Sentry from '@sentry/nextjs';

/**
 * What Next.js runs once, on the server, before it serves anything — the
 * `instrumentation` hook of the framework (ADR 0013).
 *
 * The configuration of each runtime is imported here, and dynamically: the
 * Node build and the edge build are different bundles, and a static import
 * would drag one into the other.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Reports what breaks while the server renders — a server component, a route
 * handler, a server action. Next.js calls it with the error and with which
 * request it happened on; what of that request may be sent is decided by the
 * same filter as everything else (`lib/sentry.ts`).
 */
export const onRequestError = Sentry.captureRequestError;
