import { type Metadata } from 'next';

import { SignInForm } from '@/components/auth/sign-in-form';
import {
  DESTINATION_PARAM,
  ERROR_PARAM,
  EXPIRED_LINK_ERROR,
  HOME_PATH,
  internalPath,
} from '@/lib/routes';

export const metadata: Metadata = {
  title: 'Entrar',
};

/**
 * The sign-in screen.
 *
 * Both parameters it accepts come from outside — `destino`, set by `proxy.ts`
 * when it turns away a protected route, and `erro`, set by `auth/callback` when
 * the e-mail link is no good any more. Which is why both are filtered here,
 * before they become behaviour: `internalPath` refuses a destination pointing
 * outside, and the error only exists in one known value.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const destination = internalPath(single(params[DESTINATION_PARAM])) ?? HOME_PATH;
  const expiredLink = single(params[ERROR_PARAM]) === EXPIRED_LINK_ERROR;

  return <SignInForm destination={destination} expiredLink={expiredLink} />;
}

/** `?destino=/a&destino=/b` arrives as an array; neither of them will do. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
