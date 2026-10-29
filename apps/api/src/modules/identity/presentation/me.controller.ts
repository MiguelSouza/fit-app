import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { errorResponseSchema, meResponseSchema, type MeResponse } from '@fit-app/contracts';
import { ApiInternalServerErrorResponse, ApiNotFoundResponse, ApiOperation } from '@nestjs/swagger';

import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import { type AuthenticatedUser } from '../../../shared/auth/authenticated-user';
import { SchemaResponse } from '../../../shared/presentation/schema-response.decorator';
import { GetMyIdentityUseCase } from '../application/get-my-identity.use-case';
import { toMeResponse } from './identity.presenter';

/**
 * `GET /v1/me`: who the caller is. The version comes from `defaultVersion` in
 * `bootstrap.ts`, so the path here stays version free.
 *
 * Thin on purpose (CLAUDE.md, "Não faça": no business rule in a controller):
 * it hands the caller's id to the use case and the answer to the presenter.
 * The id is the `sub` of the token the global guard verified, so nobody can
 * ask about another person.
 */
@Controller({ path: 'me' })
export class MeController {
  constructor(private readonly getMyIdentity: GetMyIdentityUseCase) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Identidade de quem fez a chamada',
    description:
      'Responde o perfil, o tipo de profissional e as organizações de quem está chamando. ' +
      'Quem entrou no Supabase Auth e ainda não concluiu o primeiro acesso não tem perfil, ' +
      'e a resposta é 404 — é o que leva o painel à tela de primeiro acesso.',
  })
  @SchemaResponse(meResponseSchema, 'Identidade de quem fez a chamada')
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não tem perfil: `identity.profile.not_found`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async get(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return toMeResponse(await this.getMyIdentity.execute(user.id));
  }
}
