import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';
import { type SupabaseAuth } from '@/lib/supabase/auth';

let auth: SupabaseAuth | undefined;

/**
 * Supabase Auth in the browser: this is what signs a person in and out and
 * changes their password.
 *
 * `createBrowserClient` from `@supabase/ssr` keeps the session in a **cookie**,
 * not in `localStorage`. That is what lets the server read the same session —
 * `proxy.ts` to turn away a protected route, the layout of the panel to know
 * who is signed in (ADR 0011).
 *
 * It is a function, called from inside the submit handler, because during
 * `next build` the body of a client component runs on the server, where there
 * is no cookie and no `NEXT_PUBLIC_*`. No component calls this while
 * rendering.
 *
 * One instance per tab: the client holds the timer that refreshes the token,
 * and two of them would fight over the same refresh token.
 */
export function supabaseBrowserAuth(): SupabaseAuth {
  if (!auth) {
    const { supabaseUrl, supabaseAnonKey } = publicEnv();

    auth = createBrowserClient(supabaseUrl, supabaseAnonKey).auth;
  }

  return auth;
}
