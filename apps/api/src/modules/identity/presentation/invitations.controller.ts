import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  createdInvitationSchema,
  createInvitationRequestSchema,
  errorResponseSchema,
  invitationIdSchema,
  invitationListSchema,
  invitationSchema,
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
} from '@nestjs/swagger';

import { type AuthenticatedUser } from '../../../shared/auth/authenticated-user';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import {
  SchemaCreatedResponse,
  SchemaResponse,
} from '../../../shared/presentation/schema-response.decorator';
import { CreateInvitationUseCase } from '../application/create-invitation.use-case';
import { ListInvitationsUseCase } from '../application/list-invitations.use-case';
import { RevokeInvitationUseCase } from '../application/revoke-invitation.use-case';
import {
  toCreatedInvitationResponse,
  toInvitationListResponse,
  toInvitationResponse,
} from './invitation.presenter';

/**
 * The invitations of a practice: `/v1/invitations` (card I-02).
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
}
