import { type Metadata } from 'next';

import { NewPasswordForm } from '@/components/auth/new-password-form';

export const metadata: Metadata = {
  title: 'Criar uma senha nova',
};

/**
 * Where the recovery link ends up.
 *
 * The route is protected like any other of the panel, and that is what makes it
 * safe: whoever gets here only gets here because `auth/callback` traded the code
 * from the e-mail for a session. With no session, `proxy.ts` sends them to the
 * sign-in screen.
 */
export default function NewPasswordPage() {
  return <NewPasswordForm />;
}
