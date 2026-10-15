import { NextResponse, type NextRequest } from 'next/server';

import {
  DESTINATION_PARAM,
  ERROR_PARAM,
  EXPIRED_LINK_ERROR,
  HOME_PATH,
  internalPath,
  SIGN_IN_PATH,
} from '@/lib/routes';
import { supabaseRouteAuth } from '@/lib/supabase/server';

/**
 * The kinds of link this panel opens. Password recovery is what card F-13 asks
 * for; the invitation and the e-mail confirmation come with the `identity`
 * module, and until then an unknown type becomes "invalid link" instead of a
 * session nobody knows where came from.
 */
const HANDLED_OTP_TYPES = ['recovery'] as const;

type HandledOtpType = (typeof HANDLED_OTP_TYPES)[number];

/**
 * Where a link from an Auth e-mail lands: it trades whatever came in the URL for
 * a session in a cookie and sends the person to the destination.
 *
 * Both forms are accepted because Auth uses one or the other depending on the
 * flow of the client that asked for the e-mail:
 *
 * - **`code`** is the PKCE flow, which is the one `@supabase/ssr` uses. The
 *   browser stored the verifier in a cookie when it asked for the recovery, and
 *   that is why the exchange can happen here, on the server.
 * - **`token_hash` + `type`** is the shape of the default e-mail templates of a
 *   hosted project, which do not go through PKCE.
 *
 * It is a public route: whoever gets here has no session yet — it is what the
 * route is about to create. What protects it is the code itself, single use and
 * with an expiry.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const destination = internalPath(params.get(DESTINATION_PARAM)) ?? HOME_PATH;

  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  // The response is built before the exchange because it is where the cookies
  // of the new session get written.
  const response = NextResponse.redirect(new URL(destination, request.url));
  const auth = supabaseRouteAuth(request, response);

  if (code != null) {
    const { error } = await auth.exchangeCodeForSession(code);

    return error ? expiredLink(request) : response;
  }

  if (tokenHash != null && isHandledOtpType(type)) {
    const { error } = await auth.verifyOtp({ token_hash: tokenHash, type });

    return error ? expiredLink(request) : response;
  }

  // No code at all, or a type this panel does not handle. Auth also arrives
  // here with `?error=...` when the link had already expired on its side.
  return expiredLink(request);
}

function isHandledOtpType(value: string | null): value is HandledOtpType {
  return value != null && HANDLED_OTP_TYPES.some((handled) => handled === value);
}

function expiredLink(request: NextRequest): NextResponse {
  const url = new URL(SIGN_IN_PATH, request.url);
  url.searchParams.set(ERROR_PARAM, EXPIRED_LINK_ERROR);

  return NextResponse.redirect(url);
}
