import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  consentListSchema,
  consentSchema,
  consentTypeSchema,
  errorResponseSchema,
  grantConsentRequestSchema,
  revokedConsentListSchema,
  type Consent,
  type ConsentList,
  type ConsentType,
  type GrantConsentRequest,
  type RevokedConsentList,
} from '@fit-app/contracts';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { type AuthenticatedUser } from '../../../shared/auth/authenticated-user';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import {
  SchemaCreatedResponse,
  SchemaResponse,
} from '../../../shared/presentation/schema-response.decorator';
import { GrantConsentUseCase } from '../application/grant-consent.use-case';
import { ListMyConsentsUseCase } from '../application/list-my-consents.use-case';
import { RevokeConsentUseCase } from '../application/revoke-consent.use-case';
import {
  toConsentListResponse,
  toConsentResponse,
  toRevokedConsentListResponse,
} from './consent.presenter';

/**
 * The patient's own consents: `/v1/me/consents` (card I-05).
 *
 * Under `me` and not under a patient id, which is the whole authorization
 * story of this controller: the subject of every route here is the caller, read
 * from the verified token (ADR 0007), so there is no id to try and no route a
 * professional could point at somebody else. A professional calling any of the
 * three gets 403.
 *
 * Thin, as every controller here (CLAUDE.md, "Não faça": no business rule in a
 * controller). Which purposes a revocation cascades to is the domain's answer,
 * and the version of the terms is decided there too — never sent by a client.
 */
@Controller({ path: 'me/consents' })
export class ConsentsController {
  constructor(
    private readonly listMyConsents: ListMyConsentsUseCase,
    private readonly grantConsent: GrantConsentUseCase,
    private readonly revokeConsent: RevokeConsentUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consentimentos vigentes de quem fez a chamada',
    description:
      'Lista as finalidades que o paciente consentiu e que seguem vigentes, com a data e a ' +
      'versão do termo de cada uma. O que foi revogado não vem aqui: a linha continua no ' +
      'banco, como histórico, mas já não vale. Só o próprio paciente pode pedir.',
  })
  @SchemaResponse(consentListSchema, 'Consentimentos vigentes do paciente')
  @ApiForbiddenResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não é paciente: `identity.patient.required`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não tem perfil: `identity.profile.not_found`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<ConsentList> {
    return toConsentListResponse(await this.listMyConsents.execute(user.id));
  }

  /**
   * Answers **201**: giving a consent creates the record the platform will
   * answer for, and the clients type the answer by status code. Giving a
   * purpose that is already in force answers 201 as well, with the consent that
   * is really there — the request is idempotent, and a 200 against a 201 would
   * make a client's retry look like a different outcome.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Dar um consentimento',
    description:
      'Registra uma finalidade com a versão do termo que a API serviu — a versão nunca vem ' +
      'do cliente. É idempotente: finalidade já vigente não cria linha nova e a resposta é ' +
      'o consentimento que já existe, com a data original. Dar de novo depois de revogar ' +
      'cria uma linha nova; a linha revogada fica. Toda finalidade exige `health_data` ' +
      'vigente, então quem revogou `health_data` dá esse primeiro.',
  })
  @SchemaCreatedResponse(consentSchema, 'O consentimento vigente para essa finalidade')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description: 'Corpo inválido: `api.request.invalid`',
  })
  @ApiForbiddenResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não é paciente: `identity.patient.required`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não tem perfil: `identity.profile.not_found`',
  })
  @ApiUnprocessableEntityResponse({
    standardSchema: errorResponseSchema,
    description:
      'A finalidade depende de `health_data`, que não está vigente: ' +
      '`identity.consent.health_data_required`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async grant(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: grantConsentRequestSchema }) body: GrantConsentRequest,
  ): Promise<Consent> {
    return toConsentResponse(await this.grantConsent.execute(user.id, body.type));
  }

  /**
   * `POST .../revoke` and not `DELETE`, as on an invitation and for a stronger
   * reason: revoking a consent is not deleting it. The row stays with
   * `revoked_at` on it, forever, because the platform has to be able to answer
   * a year later what it was allowed to do when — and a `DELETE` would tell
   * every client the opposite.
   */
  @Post(':type/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revogar um consentimento',
    description:
      'Marca a finalidade como revogada agora: a linha continua no banco, com `granted_at` ' +
      'e a versão do termo originais. O corte é imediato — revogar ' +
      '`share_with_professional` tira o acesso do profissional já na requisição seguinte. ' +
      '**Revogar `health_data` encerra o uso do app**: todas as finalidades vigentes caem ' +
      'na mesma transação, porque não há o que compartilhar, importar ou mandar para a IA ' +
      'sobre dados que a plataforma não pode mais guardar. O vínculo com a prática não é ' +
      'encerrado aqui, e nada é apagado. Finalidade que já não está vigente responde 409.',
  })
  @SchemaResponse(revokedConsentListSchema, 'O que a revogação encerrou')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description: 'Finalidade que não existe: `api.request.invalid`',
  })
  @ApiForbiddenResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não é paciente: `identity.patient.required`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não tem perfil: `identity.profile.not_found`',
  })
  @ApiConflictResponse({
    standardSchema: errorResponseSchema,
    description: 'A finalidade já não está vigente: `identity.consent.not_in_force`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type', { schema: consentTypeSchema }) type: ConsentType,
  ): Promise<RevokedConsentList> {
    return toRevokedConsentListResponse(await this.revokeConsent.execute(user.id, type));
  }
}
