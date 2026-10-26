import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/sentry';

/**
 * Sentry in the browser, started before the panel renders: Next.js loads this
 * file first in the client bundle (ADR 0013).
 *
 * With no DSN in the build, `sentryOptions()` returns nothing and the SDK is
 * never started — the error stays in the console of whoever is developing.
 */
const options = sentryOptions();

if (options !== undefined) Sentry.init(options);

/**
 * Ties an error to the navigation that was happening when it broke. Without
 * it, a failure during a route change shows up with the address of the page
 * being left behind.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
