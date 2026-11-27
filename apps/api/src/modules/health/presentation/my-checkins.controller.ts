import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, Query } from '@nestjs/common';
import {
  checkinDateSchema,
  checkinListSchema,
  checkinPeriodQuerySchema,
  checkinSchema,
  errorResponseSchema,
  recordCheckinRequestSchema,
  CHECKIN_PERIOD_MAX_DAYS,
  type Checkin,
  type CheckinList,
  type CheckinPeriodQuery,
  type RecordCheckinRequest,
} from '@fit-app/contracts';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { type AuthenticatedUser } from '../../../shared/auth/authenticated-user';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import { SchemaResponse } from '../../../shared/presentation/schema-response.decorator';
import { ListMyCheckinsUseCase } from '../application/list-my-checkins.use-case';
import { RecordCheckinUseCase } from '../application/record-checkin.use-case';
import { toCheckinListResponse, toCheckinResponse } from './checkin.presenter';

/**
 * The patient's own check-ins: `/v1/me/checkins` (card P-02).
 *
 * Under `me` and not under a patient id, which is the whole authorization
 * story of this controller: the subject of both routes is the caller, read
 * from the verified token (ADR 0007), so there is no id to try and no route a
 * professional could point at somebody else. A professional calling either
 * gets 403, and reads a patient's check-ins through
 * `/v1/patients/{patientId}/checkins`, where the access rule and the access
 * log are.
 *
 * Thin, as every controller here (CLAUDE.md, "Não faça": no business rule in a
 * controller). Which day may still be written, which zone that is decided in
 * and how the answers are normalized are the domain's, and they are the same
 * for any caller.
 */
@Controller({ path: 'me/checkins' })
export class MyCheckinsController {
  constructor(
    private readonly recordCheckin: RecordCheckinUseCase,
    private readonly listMyCheckins: ListMyCheckinsUseCase,
  ) {}

  /**
   * **`PUT` and not `POST`**, with the day in the path: the address of a
   * check-in is the patient and the day, the request carries the whole of it,
   * and sending it twice leaves one check-in. That is the acceptance criterion
   * "um check-in por paciente por dia (atualiza, não duplica)" written into the
   * shape of the endpoint, instead of being a rule a client has to know.
   *
   * It answers **200** for both the first save and a correction, and not 201
   * for one of them: a client that had to tell the two apart would be a client
   * that treats a retry as a different outcome. What actually happened is
   * readable in the answer — `recordedAt` and `updatedAt` are the same instant
   * on a first save.
   */
  @Put(':date')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Salvar o check-in de um dia',
    description:
      'Grava o check-in do dia, ou corrige o que já estava lá: é **um por paciente por ' +
      'dia**, e mandar duas vezes não cria dois. O conjunto de respostas é substituído ' +
      'inteiro, então sintoma retirado e nota apagada somem de verdade. `recordedAt` é a ' +
      'primeira gravação e não se move; `updatedAt` acompanha cada correção. ' +
      '**Só no próprio dia**: o dia é lido no fuso do paciente, e qualquer outro responde ' +
      '422. Só o próprio paciente pode gravar.',
  })
  @ApiParam({
    name: 'date',
    description: 'O dia do check-in, `YYYY-MM-DD`, no fuso do paciente',
    schema: { type: 'string', example: '2026-11-27' },
  })
  @SchemaResponse(checkinSchema, 'O check-in do dia, como ficou')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description:
      'Corpo inválido (`api.request.invalid`) ou dia que não existe no calendário ' +
      '(`health.checkin.invalid_date`)',
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
    description: 'O dia não é hoje no fuso do paciente: `health.checkin.window_closed`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Param('date', { schema: checkinDateSchema }) date: string,
    @Body({ schema: recordCheckinRequestSchema }) body: RecordCheckinRequest,
  ): Promise<Checkin> {
    return toCheckinResponse(await this.recordCheckin.execute(user.id, date, body));
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Os check-ins de quem fez a chamada, num período',
    description:
      'Lista os check-ins do paciente entre `from` e `to`, os dois dias incluídos, do mais ' +
      'antigo para o mais recente. Dia sem check-in simplesmente não vem na lista — a API ' +
      'não preenche o que ninguém respondeu. Só o próprio paciente pode pedir.',
  })
  @ApiQuery({
    name: 'from',
    required: true,
    description: 'Primeiro dia do período, incluído, `YYYY-MM-DD`',
    schema: { type: 'string', example: '2026-11-01' },
  })
  @ApiQuery({
    name: 'to',
    required: true,
    description: 'Último dia do período, incluído, `YYYY-MM-DD`',
    schema: { type: 'string', example: '2026-11-27' },
  })
  @SchemaResponse(checkinListSchema, 'Os check-ins do período')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description:
      'Período inválido: `api.request.invalid`, `health.checkin.invalid_date`, ' +
      '`health.checkin.invalid_period` ou, acima de ' +
      `${CHECKIN_PERIOD_MAX_DAYS} dias, \`health.checkin.period_too_long\``,
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
    @Query({ schema: checkinPeriodQuerySchema }) query: CheckinPeriodQuery,
  ): Promise<CheckinList> {
    return toCheckinListResponse(await this.listMyCheckins.execute(user.id, query.from, query.to));
  }
}
