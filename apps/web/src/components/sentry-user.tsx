'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Tells Sentry, in the browser, who is using the panel — **by id and nothing
 * else** (CLAUDE.md, "Saúde e LGPD": ids and codes, never a name or an
 * e-mail).
 *
 * It renders nothing: it exists because the layout that knows the session is a
 * server component, and the SDK of the browser is a different process from the
 * one that rendered it.
 *
 * The clean up matters as much as the call. Signing out leaves the same tab
 * open, and an event after that must not still be attributed to whoever was
 * signed in before.
 */
export function SentryUser({ id }: { id: string }) {
  useEffect(() => {
    Sentry.setUser({ id });

    return () => Sentry.setUser(null);
  }, [id]);

  return null;
}
