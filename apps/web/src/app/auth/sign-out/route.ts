import { NextResponse, type NextRequest } from 'next/server';

import { SIGN_IN_PATH } from '@/lib/routes';
import { supabaseRouteAuth } from '@/lib/supabase/server';

/**
 * Ends the session: revokes the refresh token at Auth and wipes the cookies.
 *
 * `POST` only, which is why the side menu has a `<form method="post">` and not a
 * link. Signing out is a change of state: on a `GET`, anything that prefetches a
 * URL — the browser, an antivirus, the `<Link>` of Next.js itself — would sign
 * the person out without them clicking on anything.
 *
 * 303 and not 307: the browser has to turn the `POST` into a `GET` when it
 * follows the redirect, otherwise it posts again to the sign-in screen.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL(SIGN_IN_PATH, request.url), { status: 303 });

  await supabaseRouteAuth(request, response).signOut();

  return response;
}
