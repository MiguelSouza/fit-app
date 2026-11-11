import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  endedCareRelationshipSchema,
  errorResponseSchema,
  patientIdSchema,
  type EndedCareRelationship,
} from '@fit-app/contracts';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
} from '@nestjs/swagger';

import { type AuthenticatedUser } from '../../../shared/auth/authenticated-user';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import { SchemaResponse } from '../../../shared/presentation/schema-response.decorator';
import { EndCareRelationshipUseCase } from '../application/end-care-relationship.use-case';
import { toEndedCareRelationshipResponse } from './care-relationship.presenter';

/**
 * The practice's side of the follow-up:
 * `POST /v1/patients/{patientId}/care-relationship/end` (card I-07).
 *
 * **It is not behind `@RequiresPatientAccess()`, and that is deliberate.** The
 * decorator is the rule for every route that *reads* a patient (ADR 0017), and
 * it requires the `share_with_professional` consent together with the active
 * link. Here nothing of the patient's is read, and a patient who revoked that
 * consent leaves an active link behind — the two are different records (ADR
 * 0018) — so a practice behind that guard could not close its own side of a
 * follow-up the patient had already walked away from. The authorization is the
 * use case's own and is no weaker: the link has to belong to a practice the
 * caller is a member of, and anything else answers the same 404 the guard
 * answers.
 *
 * It writes nothing to the access log either (card I-06): opening a chart and
 * exporting data are what get recorded, and this is neither.
 *
 * Thin, as every controller here (CLAUDE.md, "Não faça": no business rule in a
 * controller).
 */
@Controller({ path: 'patients' })
export class PatientCareRelationshipsController {
  constructor(private readonly endCareRelationship: EndCareRelationshipUseCase) {}

  /**
   * `POST .../end` and not `DELETE`: the patient is not being removed and
   * nothing is deleted. The link is dated and stays, which is what lets the
   * platform answer a year later why that practice ever saw this patient.
   */
  @Post(':patientId/care-relationship/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Encerrar o acompanhamento (lado do profissional)',
    description:
      'Encerra o vínculo da prática com o paciente agora: a linha continua no banco, com a ' +
      'data em que o acompanhamento começou, e ganha a data do encerramento. O corte é ' +
      'imediato — a prática recebe 404 nos dados desse paciente já na requisição seguinte. ' +
      '**Nada é apagado**: o histórico continua sendo do paciente. Paciente que não é de ' +
      'nenhuma prática de quem chamou responde 404, igual a um paciente que não existe; ' +
      'acompanhamento já encerrado responde 409. Não exige o consentimento de ' +
      'compartilhamento: o vínculo se encerra mesmo depois de o paciente ter revogado.',
  })
  @SchemaResponse(endedCareRelationshipSchema, 'O vínculo encerrado, com as duas datas')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description: 'Id que não é um uuid: `api.request.invalid`',
  })
  @ApiForbiddenResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não é profissional: `identity.professional.required`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description:
      'Quem chamou não tem perfil (`identity.profile.not_found`) ou o paciente não é de ' +
      'nenhuma prática dele (`identity.patient.not_found`)',
  })
  @ApiConflictResponse({
    standardSchema: errorResponseSchema,
    description: 'O acompanhamento já estava encerrado: `identity.care_relationship.already_ended`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', { schema: patientIdSchema }) patientId: string,
  ): Promise<EndedCareRelationship> {
    return toEndedCareRelationshipResponse(
      await this.endCareRelationship.byProfessional(user.id, patientId),
    );
  }
}
