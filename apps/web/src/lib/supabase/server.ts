import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { type NextRequest, type NextResponse } from 'next/server';

import { publicEnv } from '@/lib/env';
import { type SupabaseAuth } from '@/lib/supabase/auth';

/**
 * Supabase Auth inside a Server Component, reading the session from the cookies
 * of the request.
 *
 * One client per request, always: it carries the session of whoever is calling,
 * and reusing one across requests would serve one person's session to another.
 *
 * Whoever asks "who is this?" here uses `getUser()`, never `getSession()`:
 * `getSession` only decodes the cookie, which is input, while `getUser` checks
 * the token with the Auth server. In a Server Component the difference is
 * between trusting and verifying.
 */
export async function supabaseServerAuth(): Promise<SupabaseAuth> {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),

      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component does not write cookies, and Next.js throws when
          // one tries. Which is fine: refreshing the token is `proxy.ts`'s job,
          // and it runs earlier, where it can write to the response. What
          // matters here is not bringing the page down over it.
        }
      },
    },
  }).auth;
}

/**
 * Supabase Auth inside a Route Handler, writing the cookies **on the response
 * that is about to go out**.
 *
 * That is the difference from the function above, and it is the whole point:
 * the two routes under `app/auth` exist precisely to change the session — one
 * creates it, the other wipes it — and both answer with a redirect, a response
 * built by hand. Binding the client to it puts the `Set-Cookie` in the same
 * place, without depending on the framework to join the two afterwards.
 *
 * `response` has to be the response the handler returns.
 */
export function supabaseRouteAuth(request: NextRequest, response: NextResponse): SupabaseAuth {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),

      setAll: (cookiesToSet, headers) => {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // A response that writes a session cookie must not be cached by any
        // CDN: the next person would be handed this person's token.
        for (const [header, value] of Object.entries(headers)) {
          response.headers.set(header, value);
        }
      },
    },
  }).auth;
}
