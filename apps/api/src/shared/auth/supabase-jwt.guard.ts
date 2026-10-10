import {
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';

import { InvalidAccessTokenError, readBearerToken } from './access-token';
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
        // A reason code and the route. No token, no fragment of one, no user
        // id — there is no verified user to name (CLAUDE.md, "Saúde e LGPD").
        this.logger.debug(`access token refused (${error.reason})`);

        throw new UnauthorizedException(REFUSED);
      }

      // Not the caller's fault: let it become a 500 instead of blaming them.
      throw error;
    }
  }

  /**
   * `getAllAndOverride` so `@Public()` on the handler wins over the
   * controller, which is how a mostly-open controller keeps one closed route.
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
