import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import {
  checkinListSchema,
  checkinPeriodQuerySchema,
  errorResponseSchema,
  patientIdSchema,
  CHECKIN_PERIOD_MAX_DAYS,
  type CheckinList,
  type CheckinPeriodQuery,
} from '@fit-app/contracts';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';

import { RecordsPatientAccess, RequiresPatientAccess } from '../../identity';
import { type AuthenticatedUser } from '../../../shared/auth/authenticated-user';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import { SchemaResponse } from '../../../shared/presentation/schema-response.decorator';
import { ListPatientCheckinsUseCase } from '../application/list-patient-checkins.use-case';
import { toCheckinListResponse } from './checkin.presenter';

/**
 * The professional's side of the check-ins:
 * `GET /v1/patients/{patientId}/checkins` (card P-02).
 *
 * It is the first route outside `identity` to carry a patient in the path, and
 * it carries both of that module's decorators, which are two different
 * obligations and not one (CLAUDE.md, "Saúde e LGPD": checar o acesso **e**
 * registrá-lo):
 *
 * - `@RequiresPatientAccess()` — active care link **and**
 *   `share_with_professional` in force, or 404 (ADR 0017). The use case asks
 *   the same service again on its first line, because a guard answers for an
 *   HTTP request and nothing else.
 * - `@RecordsPatientAccess('patient_checkins', 'view')` — one row in the
 *   patient's "quem viu meus dados" per request served (card I-06). Its own
 *   resource and not `patient_chart`: what happened is that somebody read a
 *   period of check-ins, and the log says that and not something bigger.
 *
 * There is no route here that writes. Not an omission: a check-in is what the
 * patient said, and a professional who could edit one would turn the single
 * source of data this platform has about how somebody feels into a note of
 * their own.
 *
 * Thin, as every controller here (CLAUDE.md, "Não faça").
 */
@Controller({ path: 'patients' })
export class PatientCheckinsController {
  constructor(private readonly listPatientCheckins: ListPatientCheckinsUseCase) {}

  @Get(':patientId/checkins')
  @HttpCode(HttpStatus.OK)
  @RequiresPatientAccess()
  @RecordsPatientAccess('patient_checkins', 'view')
  @ApiOperation({
    summary: 'Os check-ins de um paciente, num período',
    description:
      'Lista os check-ins do paciente entre `from` e `to`, os dois dias incluídos, do mais ' +
      'antigo para o mais recente — exatamente como o paciente respondeu, sem nota, score ' +
      'ou leitura da plataforma. Dia sem check-in não vem na lista. ' +
      '**Exige vínculo ativo e o consentimento de compartilhamento vigente**: sem um dos ' +
      'dois a resposta é 404, igual a um paciente que não existe. Cada chamada vira uma ' +
      'linha no registro de acessos do paciente.',
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
  @SchemaResponse(checkinListSchema, 'Os check-ins do paciente no período')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description:
      'Período inválido: `api.request.invalid`, `health.checkin.invalid_date`, ' +
      '`health.checkin.invalid_period` ou, acima de ' +
      `${CHECKIN_PERIOD_MAX_DAYS} dias, \`health.checkin.period_too_long\``,
  })
  @ApiForbiddenResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não é profissional: `identity.professional.required`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description:
      'Quem chamou não tem perfil (`identity.profile.not_found`) ou não pode ver esse ' +
      'paciente — sem vínculo, sem consentimento, ou paciente que não existe: ' +
      '`identity.patient.not_found`, a mesma resposta para os três',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', { schema: patientIdSchema }) patientId: string,
    @Query({ schema: checkinPeriodQuerySchema }) query: CheckinPeriodQuery,
  ): Promise<CheckinList> {
    return toCheckinListResponse(
      await this.listPatientCheckins.execute(user.id, patientId, query.from, query.to),
    );
  }
}
