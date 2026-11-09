import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database/database.module';
import { AcceptInvitationUseCase } from './application/accept-invitation.use-case';
import { CreateInvitationUseCase } from './application/create-invitation.use-case';
import { GetMyIdentityUseCase } from './application/get-my-identity.use-case';
import { ListInvitationsUseCase } from './application/list-invitations.use-case';
import { LoadProfessionalCaller } from './application/load-professional-caller';
import { PatientAccessService } from './application/patient-access.service';
import { IDENTITY_REGISTRY } from './application/ports/identity-registry.port';
import { INVITATION_ACCEPTANCE_REPOSITORY } from './application/ports/invitation-acceptance.port';
import { INVITATION_REPOSITORY } from './application/ports/invitation-repository.port';
import { INVITATION_TOKEN_ISSUER } from './application/ports/invitation-token.port';
import { PATIENT_ACCESS_REPOSITORY } from './application/ports/patient-access.port';
import { RegisterProfessionalUseCase } from './application/register-professional.use-case';
import { RevokeInvitationUseCase } from './application/revoke-invitation.use-case';
import { CryptoInvitationTokenIssuer } from './infrastructure/crypto-invitation-token.issuer';
import { DrizzleIdentityRegistry } from './infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationAcceptanceRepository } from './infrastructure/drizzle-invitation-acceptance.repository';
import { DrizzleInvitationRepository } from './infrastructure/drizzle-invitation.repository';
import { DrizzlePatientAccessRepository } from './infrastructure/drizzle-patient-access.repository';
import { InvitationsController } from './presentation/invitations.controller';
import { MeController } from './presentation/me.controller';
import { PatientAccessGuard } from './presentation/patient-access.guard';
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
 * the identity of whoever is calling —, card I-02, the invitation by link,
 * card I-03, the acceptance of it (the patient, the care link and the
 * consents), and card I-04, the access rule the rest of the API depends on,
 * which is the only thing this module exports to the others. The access log
 * (`identity.logAccess`) is the rest of the module and comes with its own
 * card.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [MeController, ProfessionalsController, InvitationsController],
  providers: [
    GetMyIdentityUseCase,
    RegisterProfessionalUseCase,
    LoadProfessionalCaller,
    CreateInvitationUseCase,
    ListInvitationsUseCase,
    RevokeInvitationUseCase,
    AcceptInvitationUseCase,
    PatientAccessService,
    PatientAccessGuard,
    { provide: IDENTITY_REGISTRY, useClass: DrizzleIdentityRegistry },
    { provide: INVITATION_REPOSITORY, useClass: DrizzleInvitationRepository },
    { provide: INVITATION_ACCEPTANCE_REPOSITORY, useClass: DrizzleInvitationAcceptanceRepository },
    { provide: INVITATION_TOKEN_ISSUER, useClass: CryptoInvitationTokenIssuer },
    { provide: PATIENT_ACCESS_REPOSITORY, useClass: DrizzlePatientAccessRepository },
  ],

  // The access rule, for the modules whose routes have a patient in them: the
  // service a use case injects and the guard `@RequiresPatientAccess()` puts
  // in front of a handler.
  //
  // `LoadProfessionalCaller` is in here for one reason, and it is Nest's and
  // not ours: a guard named by `@UseGuards(SomeClass)` is instantiated in the
  // module of the **controller** that uses it, so its own constructor
  // dependencies have to be reachable from there. Leaving it out breaks the
  // first `nutrition` controller that decorates a route, with a message about
  // a provider nobody outside this module has heard of.
  //
  // The ports stay private all the same: `PATIENT_ACCESS_REPOSITORY` is not
  // exported, `index.ts` does not name any of these classes except the
  // service, and lint keeps another module from importing the files
  // (CLAUDE.md rule 1).
  exports: [PatientAccessService, PatientAccessGuard, LoadProfessionalCaller],
})
export class IdentityModule {}
