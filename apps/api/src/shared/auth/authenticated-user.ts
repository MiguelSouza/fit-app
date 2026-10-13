import { type Request } from 'express';

/**
 * Who is calling, as the verified access token says — nothing more.
 *
 * This is authentication, not authorization. Knowing the caller is `sub` is
 * not permission to read a patient: that needs an active link and a
 * `share_with_professional` consent in force, and it is the access service of
 * `identity` that answers it (CLAUDE.md, "Saúde e LGPD"). This type is what
 * that check will take as its subject.
 */
export interface AuthenticatedUser {
  /** The Supabase user id, from the `sub` claim. An id, never a name. */
  readonly id: string;
  /**
   * The role the token carries (`authenticated`, for everyone who signed in).
   *
   * It is not the domain role: whether the person is a professional or a
   * patient, and the `professional_type` that decides who may edit a meal
   * plan, live in `identity` and come with its card. Read from the token's
   * own `role` claim and never from `user_metadata`, which the user can
   * write.
   */
  readonly role: string;
}

/**
 * Where the guard leaves the caller for `@CurrentUser()` to pick up.
 *
 * A symbol and not a string: `Object.entries` skips symbol keys, so a request
 * that ends up inside a log object cannot carry the user out with it, and
 * nothing collides with a property Express or another middleware may add.
 */
const AUTHENTICATED_USER = Symbol('fit-app.api.authenticatedUser');

type RequestWithUser = Request & { [AUTHENTICATED_USER]?: AuthenticatedUser };

export function setAuthenticatedUser(request: Request, user: AuthenticatedUser): void {
  (request as RequestWithUser)[AUTHENTICATED_USER] = user;
}

/** The caller of this request, or `undefined` on a route that let one through. */
export function authenticatedUserOf(request: Request): AuthenticatedUser | undefined {
  return (request as RequestWithUser)[AUTHENTICATED_USER];
}
