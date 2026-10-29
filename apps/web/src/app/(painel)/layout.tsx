import * as Sentry from '@sentry/nextjs';
import { redirect } from 'next/navigation';
import { type ReactNode } from 'react';

import { SideMenu } from '@/components/painel/side-menu';
import { QueryProvider } from '@/components/query-provider';
import { SentryUser } from '@/components/sentry-user';
import { loadMyIdentity } from '@/lib/api/server';
import { FIRST_ACCESS_PATH, SIGN_IN_PATH } from '@/lib/routes';
import { supabaseServerAuth } from '@/lib/supabase/server';

/**
 * The layout of the panel: the side menu, the cache of the API calls, the
 * session and the profile.
 *
 * The session is checked **here**, and not only in `proxy.ts`: the proxy is
 * cheap and is there to redirect before anything renders, but it is this layout
 * that asks Auth whether the token is good (`getUser`), and every page of the
 * group goes through it. A new route inside `(painel)` is born protected by
 * being in the folder — with nobody having to remember anything.
 *
 * A session is not a profile, which is the second check: whoever signed in and
 * never finished the first access has no profile, the API says so with a 404
 * on `GET /v1/me`, and the panel sends them to the screen that asks for the
 * name, the CRN and the specialty (card I-01). The proxy cannot do this one —
 * it would mean a call to the API on every request, including the static ones.
 *
 * Authorization stays with the API: an active link, a current consent and
 * `professional_type` are checked inside the use case (ADR 0007). The panel
 * only knows that a session exists and that there is a profile behind it.
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const auth = await supabaseServerAuth();
  const { data } = await auth.getUser();

  if (data.user == null) redirect(SIGN_IN_PATH);

  // Only `unregistered` redirects. An API that did not answer leaves the panel
  // standing, with the error showing inside the page: a professional who is
  // registered must not be sent to a first access screen because a request
  // failed.
  if ((await loadMyIdentity()).status === 'unregistered') redirect(FIRST_ACCESS_PATH);

  // Who an error of this request happened to, by id. The e-mail two lines
  // below goes on the screen of the person it belongs to and nowhere else —
  // never to Sentry (ADR 0013).
  Sentry.setUser({ id: data.user.id });

  return (
    <QueryProvider>
      <SentryUser id={data.user.id} />

      <div className="flex min-h-svh">
        <SideMenu accountEmail={data.user.email ?? ''} />

        <main className="flex flex-1 flex-col gap-6 px-8 py-8">{children}</main>
      </div>
    </QueryProvider>
  );
}
