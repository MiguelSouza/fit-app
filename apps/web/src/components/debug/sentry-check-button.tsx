'use client';

import { Button } from '@/components/ui/button';
import { SENTRY_CHECK_MESSAGE } from '@/lib/sentry';

/**
 * The browser half of the check (`/debug/sentry`): an error thrown from a
 * click handler, which is where the global handler of the SDK picks it up.
 *
 * Thrown from the handler and not during render on purpose. A render that
 * throws is caught by `app/global-error.tsx`, which reports it — but only in a
 * production build; in `next dev` the error overlay takes over first, and the
 * check would look broken. This path works in both.
 */
export function SentryCheckButton() {
  return (
    <Button
      variant="outline"
      onClick={() => {
        throw new Error(SENTRY_CHECK_MESSAGE);
      }}
    >
      Provocar um erro no navegador
    </Button>
  );
}
