import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database/database.module';
import { GetMyIdentityUseCase } from './application/get-my-identity.use-case';
import { IDENTITY_REGISTRY } from './application/ports/identity-registry.port';
import { DrizzleIdentityRegistry } from './infrastructure/drizzle-identity-registry.repository';
import { MeController } from './presentation/me.controller';
import { ProfessionalsController } from './presentation/professionals.controller';
import { RegisterProfessionalUseCase } from './application/register-professional.use-case';

/**
 * `identity`: pessoas, organizações, vínculos, convites, consentimentos,
 * registro de acessos.
 *
 * Owns the `identity` Postgres schema and reads nothing else (CLAUDE.md rule
 * 2). Where the port meets its adapter is right here: the use cases ask for
 * `IDENTITY_REGISTRY`, and this module decides that Postgres is what answers
 * it.
 *
 * What is wired today is card I-01 — the first access of a professional and
 * the identity of whoever is calling. Links, invitations, consents and the
 * access service the rest of the API will depend on come with their own cards,
 * and leave through `index.ts` when they do.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [MeController, ProfessionalsController],
  providers: [
    GetMyIdentityUseCase,
    RegisterProfessionalUseCase,
    { provide: IDENTITY_REGISTRY, useClass: DrizzleIdentityRegistry },
  ],
})
export class IdentityModule {}
