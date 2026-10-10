import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Metadata key the guard reads. Namespaced so nothing else can set it by accident. */
export const IS_PUBLIC_ROUTE = 'fit-app:auth:public';

/**
 * Lets a route answer without a token.
 *
 * The guard is global and refuses by default, so forgetting this on a route
 * that should be open is a 401 somebody notices; forgetting the opposite — a
 * decorator that opens a route — is not something that can happen by
 * omission. That asymmetry is the reason the global guard exists at all
 * instead of a `@Authenticated()` on every controller.
 *
 * It goes on a handler or on a whole controller, and it is the only way a
 * route gets to be public: `/v1/health`, which an ALB target group calls with
 * no token, and the invitation flow of `identity`, where someone accepts an
 * invitation before having an account.
 *
 * `@CurrentUser()` has nothing to return on a public route. A route that needs
 * the caller is not public.
 */
export function Public(): CustomDecorator<string> {
  return SetMetadata(IS_PUBLIC_ROUTE, true);
}
