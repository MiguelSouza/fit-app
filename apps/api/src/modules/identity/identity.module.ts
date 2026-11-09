import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { AcceptInvitationUseCase } from './application/accept-invitation.use-case';
import { CreateInvitationUseCase } from './application/create-invitation.use-case';
import { GetMyIdentityUseCase } from './application/get-my-identity.use-case';
import { GrantConsentUseCase } from './application/grant-consent.use-case';
import { ListMyConsentsUseCase } from './application/list-my-consents.use-case';
import { ListInvitationsUseCase } from './application/list-invitations.use-case';
import { LoadPatientCaller } from './application/load-patient-caller';
import { LoadProfessionalCaller } from './application/load-professional-caller';
import { PatientAccessService } from './application/patient-access.service';
import { CONSENT_REPOSITORY } from './application/ports/consent-repository.port';
import { IDENTITY_REGISTRY } from './application/ports/identity-registry.port';
import { INVITATION_ACCEPTANCE_REPOSITORY } from './application/ports/invitation-acceptance.port';
import { INVITATION_REPOSITORY } from './application/ports/invitation-repository.port';
import { INVITATION_TOKEN_ISSUER } from './application/ports/invitation-token.port';
import { PATIENT_ACCESS_REPOSITORY } from './application/ports/patient-access.port';
import { RegisterProfessionalUseCase } from './application/register-professional.use-case';
import { RevokeConsentUseCase } from './application/revoke-consent.use-case';
import { RevokeInvitationUseCase } from './application/revoke-invitation.use-case';
import { CryptoInvitationTokenIssuer } from './infrastructure/crypto-invitation-token.issuer';
import { DrizzleConsentRepository } from './infrastructure/drizzle-consent.repository';
import { DrizzleIdentityRegistry } from './infrastructure/drizzle-identity-registry.repository';
import { DrizzleInvitationAcceptanceRepository } from './infrastructure/drizzle-invitation-acceptance.repository';
import { DrizzleInvitationRepository } from './infrastructure/drizzle-invitation.repository';
import { DrizzlePatientAccessRepository } from './infrastructure/drizzle-patient-access.repository';
import { ConsentsController } from './presentation/consents.controller';
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
 * consents), card I-04, the access rule the rest of the API depends on, which
 * is the only thing this module exports to the others, and card I-05, the
 * patient giving and taking back one purpose — the first thing this module
 * announces as an event. The access log (`identity.logAccess`) is the rest of
 * the module and comes with its own card.
 */
@Module({
  // `EventsModule` is here for the revocation of a consent, which is the first
  // fact this module announces to the others (card I-05): it exports
  // `EVENT_BUS`, and the publisher never names the implementation (ADR 0009).
  imports: [DatabaseModule, EventsModule],
  controllers: [MeController, ProfessionalsController, InvitationsController, ConsentsController],
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
    LoadPatientCaller,
    ListMyConsentsUseCase,
    GrantConsentUseCase,
    RevokeConsentUseCase,
    { provide: IDENTITY_REGISTRY, useClass: DrizzleIdentityRegistry },
    { provide: CONSENT_REPOSITORY, useClass: DrizzleConsentRepository },
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
