import { type NextRequest, type NextResponse } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy-session';

/**
 * Runs before every request: refreshes the session and turns away a protected
 * route without one. The logic lives in `lib/supabase/proxy-session.ts`.
 *
 * The file is called `proxy.ts` because Next.js 16 renamed the middleware; what
 * it does is the same, and there can be only one per application.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  return updateSession(request);
}

export const config = {
  /**
   * Everything, except what has no session to refresh: the files Next.js serves
   * ready made, and images. An icon request that went to Auth to check a token
   * would be a round trip to the network per static file.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)',
  ],
};
