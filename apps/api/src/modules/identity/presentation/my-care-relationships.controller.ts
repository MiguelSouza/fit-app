import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  careRelationshipIdSchema,
  endedCareRelationshipSchema,
  errorResponseSchema,
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
 * The patient's own side of the follow-up: `/v1/me/care-relationships`
 * (card I-07).
 *
 * Under `me`, as the consents are, and for the same reason: the subject of the
 * request is the caller, read from the verified token (ADR 0007), so no
 * professional can point this route at somebody else's link. The id in the path
 * is the link's, and the app already holds it — the acceptance of the invitation
 * answered it (`AcceptedInvitation.careRelationshipId`).
 *
 * Thin, as every controller here (CLAUDE.md, "Não faça": no business rule in a
 * controller).
 */
@Controller({ path: 'me/care-relationships' })
export class MyCareRelationshipsController {
  constructor(private readonly endCareRelationship: EndCareRelationshipUseCase) {}

  /**
   * `POST .../end` and not `DELETE`, for the same reason the revocation of a
   * consent is a `POST`: nothing is deleted. The row stays with `ended_at` on
   * it — it is the record of why that practice ever saw this patient — and a
   * `DELETE` would tell every client the opposite.
   */
  @Post(':careRelationshipId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Encerrar o acompanhamento (lado do paciente)',
    description:
      'Encerra o vínculo com a prática agora: a linha continua no banco, com a data em que o ' +
      'acompanhamento começou, e ganha a data do encerramento. O corte é imediato — o ' +
      'profissional recebe 404 nos dados do paciente já na requisição seguinte. **Nada é ' +
      'apagado**: o histórico do paciente continua sendo dele. Vínculo que já foi encerrado ' +
      'responde 409, e vínculo que não é de quem chamou responde 404. Voltar a ser acompanhado ' +
      'pela mesma prática é aceitar um convite novo.',
  })
  @SchemaResponse(endedCareRelationshipSchema, 'O vínculo encerrado, com as duas datas')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description: 'Id que não é um uuid: `api.request.invalid`',
  })
  @ApiForbiddenResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não é paciente: `identity.patient.required`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description:
      'Quem chamou não tem perfil (`identity.profile.not_found`) ou o vínculo não é dele ' +
      '(`identity.care_relationship.not_found`)',
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
    @Param('careRelationshipId', { schema: careRelationshipIdSchema }) careRelationshipId: string,
  ): Promise<EndedCareRelationship> {
    return toEndedCareRelationshipResponse(
      await this.endCareRelationship.byPatient(user.id, careRelationshipId),
    );
  }
}
