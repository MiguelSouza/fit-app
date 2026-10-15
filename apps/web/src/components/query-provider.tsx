'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

/**
 * The TanStack Query cache of the panel.
 *
 * A new client per server render and a single one in the browser. On the
 * server, a shared client would mix the cache of two people — and this cache
 * holds API answers about patients. In the browser a single one is the whole
 * point: it is what keeps the data between navigations.
 */
let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return new QueryClient(defaultOptions());

  browserQueryClient ??= new QueryClient(defaultOptions());

  return browserQueryClient;
}

function defaultOptions(): ConstructorParameters<typeof QueryClient>[0] {
  return {
    defaultOptions: {
      queries: {
        // Half a minute without calling again. The panel is a working screen:
        // switching section and coming back should not hit the API per click.
        staleTime: 30_000,

        // A contract or authorization error does not get better on the second
        // try, and insisting only delays the message on the screen. One retry
        // covers the network hiccup.
        retry: 1,
      },
    },
  };
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
