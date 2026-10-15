/**
 * The paths of the panel, in one place.
 *
 * The module is deliberately text only: `proxy.ts` imports it, and the proxy
 * runs before any rendering and in a runtime without a DOM, so nothing here may
 * drag React, an icon or a component along behind it.
 */

/** The home of the panel, protected: the queue of who needs attention. */
export const HOME_PATH = '/';

export const PATIENTS_PATH = '/pacientes';
export const INVITES_PATH = '/convites';
export const SETTINGS_PATH = '/ajustes';

export const SIGN_IN_PATH = '/login';
export const PASSWORD_RESET_PATH = '/recuperar-senha';
export const NEW_PASSWORD_PATH = '/nova-senha';

/** Trades the code of an e-mail link for a session (`app/auth/callback`). */
export const AUTH_CALLBACK_PATH = '/auth/callback';

/** Ends the session (`app/auth/sign-out`); answers `POST` only. */
export const SIGN_OUT_PATH = '/auth/sign-out';

/**
 * Where to go back to after signing in, and the name of the parameter that
 * carries it. In Portuguese, like every path the user reads in the address bar.
 */
export const DESTINATION_PARAM = 'destino';

/** Tells the sign-in screen that the e-mail link was no good any more. */
export const ERROR_PARAM = 'erro';
export const EXPIRED_LINK_ERROR = 'link';

/**
 * The routes that answer without a session. A closed list, and not a path
 * pattern, for the same asymmetry as the global guard of the API (ADR 0007):
 * forgetting to open a route gives a redirect somebody notices immediately,
 * while a patient route left open by forgetting does not show up at all.
 */
const PUBLIC_PATHS: readonly string[] = [
  SIGN_IN_PATH,
  PASSWORD_RESET_PATH,
  AUTH_CALLBACK_PATH,
  SIGN_OUT_PATH,
];

/**
 * The routes that only make sense without a session: whoever is already in has
 * nothing to do on the sign-in screen.
 *
 * `/nova-senha` is deliberately out of the list — it *needs* the session the
 * recovery link has just created.
 */
const SIGNED_OUT_ONLY_PATHS: readonly string[] = [SIGN_IN_PATH, PASSWORD_RESET_PATH];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

export function isSignedOutOnlyPath(pathname: string): boolean {
  return SIGNED_OUT_ONLY_PATHS.includes(pathname);
}

/**
 * Returns the path only if it is internal to this panel.
 *
 * The destination after sign-in arrives in the URL, which is to say from
 * outside. Without this filter, `?destino=https://somewhere.else` would turn
 * the sign-in screen into an open redirector — the attacker sends the link, the
 * person really does sign in, and lands on their site already trusting the
 * page. `//` is barred because it is the form that looks like a path: a browser
 * reads `//somewhere.else` as a protocol-relative URL.
 */
export function internalPath(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;

  return value;
}
