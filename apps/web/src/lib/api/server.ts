import { createFitAppApiClient, type MeResponse } from '@fit-app/api-client';

import { publicEnv } from '@/lib/env';
import { supabaseServerAuth } from '@/lib/supabase/server';

/**
 * The API, called from a Server Component.
 *
 * Why there is a second client next to `lib/api/client.ts`: that one is the
 * browser's and reads the session from the Auth client of the tab, which does
 * not exist on the server. Here the token comes from the cookies of the
 * request, and a **new client per call** — nothing is cached, because a client
 * that kept one request's token would send it on the next person's request.
 *
 * `getSession()` is enough to read the token: who verifies the signature is
 * the API, with the global guard of ADR 0007. The panel only carries the
 * envelope.
 */
async function serverApiClient() {
  const auth = await supabaseServerAuth();
  const { data } = await auth.getSession();
  const token = data.session?.access_token;

  const client = createFitAppApiClient({ baseUrl: publicEnv().apiUrl });

  client.use({
    onRequest: ({ request }) => {
      if (token != null) request.headers.set('Authorization', `Bearer ${token}`);

      return request;
    },
  });

  return client;
}

/**
 * What the panel knows about the caller before rendering anything.
 *
 * Three answers, and the third is the one that matters: `unregistered` is the
 * 404 of `GET /v1/me`, which is how the API says "signed in, first access not
 * finished" (`identity.profile.not_found`). `unavailable` is everything else —
 * the API down, a network error — and it deliberately is **not** read as "not
 * registered": a professional who is registered must not be sent back to the
 * first access screen because a request failed.
 */
export type MyIdentity =
  | { readonly status: 'registered'; readonly me: MeResponse }
  | { readonly status: 'unregistered' }
  | { readonly status: 'unavailable' };

/** The code the API answers when the caller has no profile yet. */
const PROFILE_NOT_FOUND = 'identity.profile.not_found';

export async function loadMyIdentity(): Promise<MyIdentity> {
  const client = await serverApiClient();

  try {
    const { data, error } = await client.GET('/v1/me');

    if (error) {
      return error.error.code === PROFILE_NOT_FOUND
        ? { status: 'unregistered' }
        : { status: 'unavailable' };
    }

    return { status: 'registered', me: data };
  } catch {
    // The API did not answer at all. Nothing is logged here: the error of a
    // failed call can carry the request, and the header of this one is the
    // token.
    return { status: 'unavailable' };
  }
}
