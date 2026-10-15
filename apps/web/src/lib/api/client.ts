import { createFitAppApiClient, type FitAppApiClient } from '@fit-app/api-client';

import { publicEnv } from '@/lib/env';
import { supabaseBrowserAuth } from '@/lib/supabase/browser';

/**
 * The error of a call the API did answer, with its error envelope inside.
 *
 * `code` is the stable identifier (`nutrition.plan.not_found`), which is what
 * works as an i18n key; `message` already comes in pt-BR and ready to display,
 * and the contract guarantees it never carries patient data — which is why it
 * can go to the screen as it is.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let client: FitAppApiClient | undefined;

/**
 * The API client, with the token of the session in the header of every call.
 *
 * The panel builds no URL and types no response by hand: everything goes
 * through `@fit-app/api-client`, generated from the OpenAPI document (rule 7 of
 * `CLAUDE.md`).
 *
 * The token is read per request, not kept: a Supabase access token is good for
 * an hour and the Auth client refreshes it on its own, so asking at the moment
 * of the call is what sends a valid one. `getSession()` is enough here — who
 * verifies the signature is the API, with the global guard of ADR 0007; the
 * panel only carries the envelope.
 *
 * It is a function, called from inside the `queryFn`, for the same reason as
 * the Supabase client: during `next build` there is no environment to validate.
 */
export function apiClient(): FitAppApiClient {
  if (!client) {
    client = createFitAppApiClient({ baseUrl: publicEnv().apiUrl });

    client.use({
      onRequest: async ({ request }) => {
        const { data } = await supabaseBrowserAuth().getSession();
        const token = data.session?.access_token;

        if (token != null) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }

        return request;
      },
    });
  }

  return client;
}
