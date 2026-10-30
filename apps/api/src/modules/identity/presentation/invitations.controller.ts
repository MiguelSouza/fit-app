import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  acceptedInvitationSchema,
  acceptInvitationRequestSchema,
  createdInvitationSchema,
  createInvitationRequestSchema,
  errorResponseSchema,
  invitationIdSchema,
  invitationListSchema,
  invitationSchema,
  type AcceptedInvitation,
  type AcceptInvitationRequest,
  type CreatedInvitation,
  type CreateInvitationRequest,
  type Invitation,
  type InvitationList,
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
import { AcceptInvitationUseCase } from '../application/accept-invitation.use-case';
import { CreateInvitationUseCase } from '../application/create-invitation.use-case';
import { ListInvitationsUseCase } from '../application/list-invitations.use-case';
import { RevokeInvitationUseCase } from '../application/revoke-invitation.use-case';
import {
  toAcceptedInvitationResponse,
  toCreatedInvitationResponse,
  toInvitationListResponse,
  toInvitationResponse,
} from './invitation.presenter';

/**
 * The invitations: `/v1/invitations` — the professional's three requests (card
 * I-02) and the patient's one (card I-03).
 *
 * Both sides live here because it is one resource. Who may do what is not a
 * matter of which controller a route is in: the three below resolve a
 * professional of a practice from the token, and the acceptance resolves the
 * practice from the invitation the token in the link opens.
 *
 * No organization in any path and no professional id in any body: the practice
 * is read from the verified token, inside the use case (ADR 0007). A path with
 * an organization in it would be a path somebody tries another organization
 * in.
 *
 * Thin, as every controller here (CLAUDE.md, "Não faça": no business rule in a
 * controller). The status of an invitation is not computed here either — the
 * presenter reads it off the dates, with the instant of the request.
 */
@Controller({ path: 'invitations' })
export class InvitationsController {
  constructor(
    private readonly createInvitation: CreateInvitationUseCase,
    private readonly listInvitations: ListInvitationsUseCase,
    private readonly revokeInvitation: RevokeInvitationUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
  ) {}

  /**
   * Answers **201** and the token, once: creating an invitation creates a
   * resource, and the clients type the answer by status code. Calling it again
   * creates another invitation — this one is deliberately not idempotent, a
   * professional may invite two people with no name at all.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Criar um convite de paciente',
    description:
      'Cria o convite na organização de quem está chamando e responde o token do link, ' +
      'em texto puro, **uma única vez**: o banco guarda só o hash. Quem perder o link ' +
      'revoga o convite e cria outro. Nome e contato são opcionais, e o convite expira ' +
      'em 14 dias.',
  })
  @SchemaCreatedResponse(createdInvitationSchema, 'O convite criado e o token do link')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description: 'Corpo inválido: `api.request.invalid`',
  })
  @ApiForbiddenResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não é profissional: `identity.professional.required`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não tem perfil: `identity.profile.not_found`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: createInvitationRequestSchema }) body: CreateInvitationRequest,
  ): Promise<CreatedInvitation> {
    // The contract leaves out what was not filled in; the domain says "not
    // said" with `null`, so it can tell it apart from an empty string.
    const issued = await this.createInvitation.execute(user.id, {
      name: body.name ?? null,
      contact: body.contact ?? null,
    });

    return toCreatedInvitationResponse(issued, new Date());
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Convites da organização',
    description:
      'Lista os convites da organização de quem está chamando, do mais recente para o mais ' +
      'antigo, com a situação de cada um. O token não vem aqui: ele é respondido só na criação.',
  })
  @SchemaResponse(invitationListSchema, 'Convites da organização do profissional')
  @ApiForbiddenResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não é profissional: `identity.professional.required`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description: 'Quem chamou não tem perfil: `identity.profile.not_found`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<InvitationList> {
    return toInvitationListResponse(await this.listInvitations.execute(user.id), new Date());
  }

  /**
   * `POST .../revoke` and not `DELETE`: revoking is not deleting. The row
   * stays, with the instant it was revoked on it, because the professional's
   * list has to keep saying that the link was cancelled and not that it never
   * existed.
   */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revogar um convite',
    description:
      'Cancela um convite ainda pendente da organização de quem está chamando: o link para ' +
      'de funcionar na hora. Convite de outra organização responde 404. Convite já aceito, ' +
      'já revogado ou expirado responde 409 — não há o que revogar.',
  })
  @SchemaResponse(invitationSchema, 'O convite, revogado')
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
    description: 'Convite que não é desta organização: `identity.invitation.not_found`',
  })
  @ApiConflictResponse({
    standardSchema: errorResponseSchema,
    description: 'O convite já não está pendente: `identity.invitation.not_pending`',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', { schema: invitationIdSchema }) invitationId: string,
  ): Promise<Invitation> {
    return toInvitationResponse(
      await this.revokeInvitation.execute(user.id, invitationId),
      new Date(),
    );
  }

  /**
   * The patient's side of the link (card I-03). **201**: it creates the
   * patient and the care link, and the clients type the answer by status code.
   *
   * `POST .../accept` with the token in the **body** and not
   * `POST .../{token}/accept`: the token is a bearer credential, and a path is
   * what lands in an access log, in a referrer header and in a Sentry
   * breadcrumb — the same reasoning that keeps it in the query string of the
   * panel's link (ADR 0015). The invitation's id is nowhere in this request
   * either: the patient does not know it, and the token is what names the
   * invitation.
   */
  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Aceitar um convite de paciente',
    description:
      'Quem abriu o link, já autenticado no Supabase Auth, vira paciente: cria o perfil se ' +
      'ainda não existir, registra os consentimentos com a versão do termo, abre o vínculo ' +
      'com a organização do convite e marca o convite como aceito — tudo numa transação. ' +
      '`health_data` e `share_with_professional` são obrigatórios; `wearable_data` e ' +
      '`ai_processing` podem vir depois. O convite é de uso único.',
  })
  @SchemaCreatedResponse(acceptedInvitationSchema, 'O vínculo criado pelo aceite')
  @ApiBadRequestResponse({
    standardSchema: errorResponseSchema,
    description: 'Corpo inválido: `api.request.invalid`',
  })
  @ApiNotFoundResponse({
    standardSchema: errorResponseSchema,
    description: 'Nenhum convite com esse token: `identity.invitation.not_found`',
  })
  @ApiConflictResponse({
    standardSchema: errorResponseSchema,
    description:
      'O convite já foi usado, foi cancelado ou expirou: ' +
      '`identity.invitation.already_accepted`, `identity.invitation.revoked`, ' +
      '`identity.invitation.expired`. Ou a conta é de um profissional: ' +
      '`identity.profile.not_patient`',
  })
  @ApiUnprocessableEntityResponse({
    standardSchema: errorResponseSchema,
    description:
      'Faltou um consentimento obrigatório: `identity.consent.required_missing`. O convite ' +
      'segue válido',
  })
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: acceptInvitationRequestSchema }) body: AcceptInvitationRequest,
  ): Promise<AcceptedInvitation> {
    // The contract leaves out what was not filled in; the domain says "not
    // said" with `null`, so the default zone is decided in one place.
    return toAcceptedInvitationResponse(
      await this.acceptInvitation.execute(user.id, {
        token: body.token,
        fullName: body.fullName,
        timeZone: body.timeZone ?? null,
        consents: body.consents,
      }),
    );
  }
}
