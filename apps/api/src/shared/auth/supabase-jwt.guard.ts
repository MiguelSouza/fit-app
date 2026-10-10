import {
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';

import { InvalidAccessTokenError, isRoutineRefusal, readBearerToken } from './access-token';
import { setAuthenticatedUser } from './authenticated-user';
import { IS_PUBLIC_ROUTE } from './public.decorator';
import { SupabaseTokenVerifier } from './supabase-token-verifier';

/**
 * One text for every refusal, in pt-BR and ready for i18n.
 *
 * Deliberately the same whether the token was missing, expired, forged or
 * signed for another project: the client's move is identical — refresh the
 * session or send the user to the login — and a message that distinguishes the
 * cases is a probe for whoever is trying tokens. The reason goes to the log,
 * where it helps.
 */
const REFUSED = 'Sessão inválida ou expirada. Entre novamente.';

/**
 * The gate every request passes: no valid Supabase token, no handler.
 *
 * Registered as `APP_GUARD` in `auth.module.ts`, so a new controller is
 * protected by existing. What opens a route is `@Public()` and nothing else
 * (CLAUDE.md, "Saúde e LGPD": this API answers about patients).
 *
 * It stops at authentication. Whether this caller may see *this* patient is
 * the access check of `identity`, in the use case, which is a different
 * question and a 403.
 */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private readonly logger = new Logger('AuthGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: SupabaseTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) return true;

    const request = context.switchToHttp().getRequest<Request>();

    try {
      const user = await this.verifier.verify(readBearerToken(request.headers.authorization));

      setAuthenticatedUser(request, user);

      return true;
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        // The reason code and nothing else. No token, no fragment of one, no
        // user id — there is no verified user to name (CLAUDE.md, "Saúde e
        // LGPD").
        //
        // A token nobody sent or one that simply expired is traffic, and stays
        // at `debug`. A token that did not come from this project is the line
        // someone will look for in CloudWatch, where the level is `info`.
        const line = `access token refused (${error.reason})`;

        if (isRoutineRefusal(error.reason)) this.logger.debug(line);
        else this.logger.warn(line);

        throw new UnauthorizedException(REFUSED);
      }

      // Not the caller's fault: let it become a 500 instead of blaming them.
      throw error;
    }
  }

  /**
   * `getAllAndOverride`: the handler is asked first and the controller next,
   * and the first of the two that says anything decides.
   *
   * The decorator only ever says "open", so this is a one way door: `@Public()`
   * on a handler opens that route on an otherwise protected controller, and
   * `@Public()` on a controller opens every route under it, including one added
   * later that forgets to think about it. A protected route does not live on a
   * public controller — it gets one of its own. Both halves are pinned in
   * `supabase-jwt.guard.spec.ts`.
   */
  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
