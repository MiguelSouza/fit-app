import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database/database.module';
import { CreateInvitationUseCase } from './application/create-invitation.use-case';
import { GetMyIdentityUseCase } from './application/get-my-identity.use-case';
import { ListInvitationsUseCase } from './application/list-invitations.use-case';
import { LoadProfessionalCaller } from './application/load-professional-caller';
import { IDENTITY_REGISTRY } from './application/ports/identity-registry.port';
import { INVITATION_REPOSITORY } from './application/ports/invitation-repository.port';
import { INVITATION_TOKEN_ISSUER } from './application/ports/invitation-token.port';
import { RegisterProfessionalUseCase } from './application/register-professional.use-case';
import { RevokeInvitationUseCase } from './application/revoke-invitation.use-case';
import { CryptoInvitationTokenIssuer } from './infrastructure/crypto-invitation-token.issuer';
import { DrizzleIdentityRegistry } from './infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationRepository } from './infrastructure/drizzle-invitation.repository';
import { MeController } from './presentation/me.controller';
import { ProfessionalsController } from './presentation/professionals.controller';

/**
 * `identity`: pessoas, organizações, vínculos, convites, consentimentos,
 * registro de acessos.
 *
 * Owns the `identity` Postgres schema and reads nothing else (CLAUDE.md rule
 * 2). Where the ports meet their adapters is right here: the use cases ask for
 * `IDENTITY_REGISTRY`, `INVITATION_REPOSITORY` and `INVITATION_TOKEN_ISSUER`,
 * and this module decides that Postgres and `node:crypto` are what answer
 * them.
 *
 * What is wired today is card I-01 — the first access of a professional and
 * the identity of whoever is calling — and card I-02, the invitation by link.
 * Links, consents and the access service the rest of the API will depend on
 * come with their own cards, and leave through `index.ts` when they do.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [MeController, ProfessionalsController],
  providers: [
    GetMyIdentityUseCase,
    RegisterProfessionalUseCase,
    LoadProfessionalCaller,
    CreateInvitationUseCase,
    ListInvitationsUseCase,
    RevokeInvitationUseCase,
    { provide: IDENTITY_REGISTRY, useClass: DrizzleIdentityRegistry },
    { provide: INVITATION_REPOSITORY, useClass: DrizzleInvitationRepository },
    { provide: INVITATION_TOKEN_ISSUER, useClass: CryptoInvitationTokenIssuer },
  ],
})
export class IdentityModule {}
