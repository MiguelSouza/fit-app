import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  errorResponseSchema,
  meResponseSchema,
  registerProfessionalRequestSchema,
  type MeResponse,
  type RegisterProfessionalRequest,
} from '@fit-app/contracts';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiOperation,
} from '@nestjs/swagger';

import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import { type AuthenticatedUser } from '../../../shared/auth/authenticated-user';
import { SchemaResponse } from '../../../shared/presentation/schema-response.decorator';
import { RegisterProfessionalUseCase } from '../application/register-professional.use-case';
import { toMeResponse } from './identity.presenter';

/**
 * `POST /v1/professionals/me`: the first access of a professional.
 *
 * `me` and not an id in the path: the only professional anybody may register
 * is themselves, and the person is the `sub` of the verified token (ADR 0007).
 * A path with an id would be a path somebody tries another id in.
 */
@Controller({ path: 'professionals' })
export class ProfessionalsController {
  constructor(private readonly registerProfessional: RegisterProfessionalUseCase) {}

  /**
   * Answers **200**, not 201, and always the registration as it stands: the
   * endpoint is idempotent, so "created" is not true of the second call, and
   * the generated clients type the answer by status code — one route that
   * sometimes answers 201 and sometimes 200 is a client with a body it cannot
   * read on one of the two.
   */
  @Post('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cadastro do profissional',
    description:
      'Cria o perfil, o profissional, a organização solo e o vínculo de owner, numa transação. ' +
      'Idempotente: chamar de novo responde o cadastro que já existe e não duplica nada. ' +
      'Sem `professionalType`, o cadastro é de `nutritionist`.',
  })
  @SchemaResponse(meResponseSchema, 'Identidade do profissional cadastrado')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description: 'Corpo inválido: `api.request.invalid`',
  })
  @ApiConflictResponse({
    standardSchema: errorResponseSchema,
    description: 'A conta já é de um paciente: `identity.profile.not_professional`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: registerProfessionalRequestSchema }) body: RegisterProfessionalRequest,
  ): Promise<MeResponse> {
    // The contract leaves out what was not filled in; the domain says "not
    // said" with `null`, so it can tell it apart from an empty string.
    const identity = await this.registerProfessional.execute(user.id, {
      fullName: body.fullName,
      councilNumber: body.councilNumber,
      specialty: body.specialty ?? null,
      professionalType: body.professionalType ?? null,
    });

    return toMeResponse(identity);
  }
}
