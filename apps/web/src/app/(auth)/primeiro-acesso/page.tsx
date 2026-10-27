import { type Metadata } from 'next';
import { redirect } from 'next/navigation';

import { FirstAccessForm } from '@/components/identity/first-access-form';
import { loadMyIdentity } from '@/lib/api/server';
import { HOME_PATH, SIGN_IN_PATH } from '@/lib/routes';
import { supabaseServerAuth } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Primeiro acesso',
};

/**
 * The first access of a professional (card I-01).
 *
 * It is in the `(auth)` group for its shell — the centred card, with no side
 * menu — and not for its rules: this screen **needs** a session, which is
 * checked here, like the panel's layout does for its own group.
 *
 * Whoever already has a profile has nothing to fill in and goes to the panel.
 * `unavailable` is on purpose not treated as "already registered": if the API
 * is not answering, the right thing is to show the form, let the person try,
 * and have the API refuse it if it has to.
 */
export default async function FirstAccessPage() {
  const auth = await supabaseServerAuth();
  const { data } = await auth.getUser();

  if (data.user == null) redirect(SIGN_IN_PATH);

  const identity = await loadMyIdentity();

  if (identity.status === 'registered') redirect(HOME_PATH);

  return <FirstAccessForm />;
}
