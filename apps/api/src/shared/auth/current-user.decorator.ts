import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';

import { authenticatedUserOf, type AuthenticatedUser } from './authenticated-user';

/**
 * The caller of the request, as a controller parameter:
 *
 * ```ts
 * @Get('me')
 * me(@CurrentUser() user: AuthenticatedUser): ProfileResponse { ... }
 * ```
 *
 * The value comes from the token the global guard already verified, so a
 * handler never sees an unauthenticated caller and never has to check for
 * `undefined`. A client cannot put anything here: the guard writes it, the
 * request body and the query string are not consulted.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = authenticatedUserOf(context.switchToHttp().getRequest<Request>());

    if (user === undefined) {
      // Only reachable by asking for the caller on a route that was declared
      // `@Public()`. That is a wiring mistake, not a rejected request: it
      // comes out as a 500 with the generic body, and the stack points here.
      throw new Error('@CurrentUser() used on a route that does not require a token');
    }

    return user;
  },
);
