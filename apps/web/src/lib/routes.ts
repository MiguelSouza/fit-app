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

/**
 * The first access of a professional: name, CRN and specialty, asked once
 * (card I-01).
 *
 * It needs a session and it is **not** in the panel: whoever lands here has
 * signed in and has no profile yet, so there is nothing for a side menu to
 * open. It is not public either — the proxy turns it away without a session,
 * like every path that is not on the list below.
 */
export const FIRST_ACCESS_PATH = '/primeiro-acesso';

/**
 * Where the link of an invitation points: the screen the **patient** opens
 * after getting it on WhatsApp (card I-02 creates the link; accepting it is
 * the card of the professional–patient link).
 *
 * In Portuguese and short, because it is read out of a WhatsApp message, and
 * on the panel's own origin: the professional's browser is already there, so
 * the base of the link is the origin of the page that built it and nothing has
 * to be configured per environment.
 */
export const INVITE_PATH = '/convite';

/**
 * The full link to send, from the token the API answered once.
 *
 * The token goes in the path and never in a query string: the query string is
 * the part that leaks — into `Referer`, into analytics, into the access log of
 * whatever sits in front — and this platform's own Sentry filter keeps a path
 * and drops a query for exactly that reason (`@fit-app/observability`).
 *
 * @param origin where the panel is being served from (`location.origin`)
 * @param token the token of the invitation, in plain text
 */
export function inviteLink(origin: string, token: string): string {
  return `${origin}${INVITE_PATH}/${encodeURIComponent(token)}`;
}

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
 * An origin that resolves nothing, used only to ask the URL parser what a
 * destination means. `.invalid` is reserved for exactly this (RFC 2606), so no
 * name ever answers for it.
 */
const INTERNAL_ORIGIN = 'http://destino.invalid';

/**
 * Returns the path only if it is internal to this panel, normalized the way the
 * browser will read it.
 *
 * The destination after sign-in arrives in the URL, which is to say from
 * outside. Without this filter, `?destino=https://somewhere.else` would turn
 * the sign-in screen into an open redirector — the attacker sends the link, the
 * person really does sign in, and lands on their site already trusting the
 * page.
 *
 * Checking the text is not enough, and this is the part that bites: the URL
 * parser of a `http(s)` address reads a **backslash as a slash** and throws
 * away tabs and line breaks, so `/\somewhere.else` and `/<tab>/somewhere.else`
 * both start with a single `/` and both resolve to another host. So the
 * destination is resolved against an origin that does not exist and only
 * accepted if it stayed there — which is the same question the redirect is
 * going to ask, asked once, here.
 */
export function internalPath(value: string | null | undefined): string | undefined {
  if (value == null || !value.startsWith('/')) return undefined;

  let resolved: URL;

  try {
    resolved = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return undefined;
  }

  if (resolved.origin !== INTERNAL_ORIGIN) return undefined;

  // What goes back is what the parser made of it, not what came in: whoever
  // redirects then uses the very string that was checked.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
