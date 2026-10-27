import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/sentry';

/**
 * Sentry for the Node runtime of the panel: the server components, the route
 * handlers and the server actions (ADR 0013).
 *
 * Imported by `instrumentation.ts`, which Next.js runs before anything else in
 * the server process.
 */
const options = sentryOptions();

if (options !== undefined) Sentry.init(options);
