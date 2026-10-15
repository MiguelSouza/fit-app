import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';
import {
  DESTINATION_PARAM,
  HOME_PATH,
  isPublicPath,
  isSignedOutOnlyPath,
  SIGN_IN_PATH,
} from '@/lib/routes';

/**
 * Refreshes the session and decides whether the request goes through or is
 * redirected. It is the body of `proxy.ts`, kept apart from it because Next.js
 * accepts a single proxy file and that file should stay readable.
 *
 * Two things happen here, in this order:
 *
 * 1. **The session is refreshed.** A Supabase access token lives one hour
 *    (`supabase/config.toml`). Since the cookie is the only copy of the
 *    session, somebody has to swap it for the new one before the response goes
 *    out — and that somebody is this file, because a Server Component cannot
 *    write cookies.
 * 2. **The route is checked.** With no session, a protected route becomes a
 *    redirect to the sign-in screen, keeping where the person meant to go.
 *
 * This is **not** authorization. Who may see what is a question for the API,
 * answered by the access service of the `identity` module inside the use case
 * (ADR 0007). The panel only knows whether a session exists.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Rebuilt inside `setAll` for a reason: `NextResponse.next({ request })`
  // freezes the cookies of the request for whoever comes next, so the
  // refreshed cookie only reaches the Server Component if the response is put
  // together after the refresh.
  let response = NextResponse.next({ request });

  // What `@supabase/ssr` asks for on a response that writes a session cookie,
  // kept here because it has to survive a swap of the response: the library
  // hands these over on the first cookie write and on no other, so reading them
  // off a response that was replaced afterwards finds nothing.
  const noStore: Record<string, string> = {};

  const { supabaseUrl, supabaseAnonKey } = publicEnv();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),

      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // `Cache-Control: private, no-store` and friends. A response that
        // writes a session cookie must not be cached by any CDN: the next
        // person would be handed this person's token.
        Object.assign(noStore, headers);

        for (const [header, value] of Object.entries(noStore)) {
          response.headers.set(header, value);
        }
      },
    },
  });

  // `getUser` and not `getClaims`: verifying locally needs an asymmetric key,
  // and the project signs with a shared secret (ADR 0007). Here the token is
  // checked against the Auth server.
  const { data } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!data.user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = SIGN_IN_PATH;
    url.search = '';
    url.searchParams.set(DESTINATION_PARAM, `${pathname}${request.nextUrl.search}`);

    return redirectKeepingCookies(url, response, noStore);
  }

  if (data.user && isSignedOutOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = HOME_PATH;
    url.search = '';

    return redirectKeepingCookies(url, response, noStore);
  }

  return response;
}

/**
 * Redirects without losing what the refresh has just written. Swapping the
 * response and forgetting the cookies throws the refreshed session away, and
 * what that looks like is being signed out of nowhere once an hour.
 *
 * The cache headers come along for the same reason they are set at all: this
 * redirect carries the refreshed cookie too, and a cached redirect hands the
 * next person this person's token. Only those headers cross over — copying
 * `from` whole would bring `x-middleware-next` with it, which tells Next.js to
 * carry on with the request instead of redirecting.
 */
function redirectKeepingCookies(
  url: URL,
  from: NextResponse,
  noStore: Record<string, string>,
): NextResponse {
  const redirect = NextResponse.redirect(url);

  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }

  for (const [header, value] of Object.entries(noStore)) {
    redirect.headers.set(header, value);
  }

  return redirect;
}
