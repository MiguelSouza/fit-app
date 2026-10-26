import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/sentry';

/**
 * The same, for the edge runtime — where `proxy.ts` can end up running.
 *
 * It is a separate file and not a branch of the server one because the two
 * runtimes load different bundles: the edge build cannot carry anything that
 * reaches for Node.
 */
const options = sentryOptions();

if (options !== undefined) Sentry.init(options);
