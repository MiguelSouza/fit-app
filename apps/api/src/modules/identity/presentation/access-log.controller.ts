import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  accessLogPageSchema,
  accessLogQuerySchema,
  errorResponseSchema,
  ACCESS_LOG_DEFAULT_PAGE_SIZE,
  ACCESS_LOG_MAX_PAGE_SIZE,
  type AccessLogPage,
  type AccessLogQuery,
} from '@fit-app/contracts';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';

import { type AuthenticatedUser } from '../../../shared/auth/authenticated-user';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import { SchemaResponse } from '../../../shared/presentation/schema-response.decorator';
import { ListMyAccessLogUseCase } from '../application/list-my-access-log.use-case';
import { toAccessLogPageResponse } from './access-log.presenter';

/**
 * `GET /v1/me/access-log`: quem viu os meus dados (card I-06).
 *
 * Under `me`, like the consents and for the same reason: the subject is the
 * caller, read from the verified token (ADR 0007), so there is no patient id
 * in the path and nothing a professional could point at somebody else. That is
 * the card's second acceptance criterion — "paciente vê só os próprios
 * registros" — made structural instead of checked.
 *
 * **Read only, and that is the whole controller.** There is no route here that
 * edits a record and none that removes one, in this file or in any other: the
 * API has no such operation at all, and the table refuses both anyway
 * (migration `0004`). The records are written by `identity.logAccess`, which
 * other modules call when they open or export a patient's data — never by a
 * request a client makes.
 *
 * Thin, as every controller here (CLAUDE.md, "Não faça": no business rule in a
 * controller).
 */
@Controller({ path: 'me/access-log' })
export class AccessLogController {
  constructor(private readonly listMyAccessLog: ListMyAccessLogUseCase) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Quem acessou os dados de quem fez a chamada',
    description:
      'Lista os acessos aos dados do paciente — quem, o quê e quando —, do mais recente ' +
      'para o mais antigo. Cada abertura de ficha e cada exportação é uma linha, e as ' +
      'linhas nunca mudam nem somem. Só o próprio paciente pode pedir, e a lista é só a ' +
      'dele. A página continua pelo `nextCursor` da anterior; quando ele não vem, acabou.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Quantos registros a página traz, de 1 a ${ACCESS_LOG_MAX_PAGE_SIZE}`,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: ACCESS_LOG_MAX_PAGE_SIZE,
      default: ACCESS_LOG_DEFAULT_PAGE_SIZE,
    },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description:
      'Cursor da próxima página, exatamente como veio em `nextCursor`. Opaco: é a API que ' +
      'o emite e o cliente só o devolve',
    schema: { type: 'string' },
  })
  @SchemaResponse(accessLogPageSchema, 'Uma página do registro de acessos do paciente')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description:
      'Paginação inválida: `api.request.invalid`, ou um cursor que não é desta API, ' +
      '`identity.access_log.invalid_cursor`',
  })
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
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query({ schema: accessLogQuerySchema }) query: AccessLogQuery,
  ): Promise<AccessLogPage> {
    return toAccessLogPageResponse(await this.listMyAccessLog.execute(user.id, query));
  }
}
