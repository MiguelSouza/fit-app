import { Inject, Injectable } from '@nestjs/common';

import { type ConsentType } from '../domain/consent';
import {
  InvitationAlreadyAcceptedError,
  InvitationNotFoundError,
  ProfileIsNotPatientError,
} from '../domain/identity-errors';
import { invitationAcceptanceOf, type AcceptedInvitation } from '../domain/invitation-acceptance';
import { IDENTITY_REGISTRY, type IdentityRegistry } from './ports/identity-registry.port';
import {
  INVITATION_ACCEPTANCE_REPOSITORY,
  type InvitationAcceptanceRepository,
} from './ports/invitation-acceptance.port';
import { INVITATION_TOKEN_ISSUER, type InvitationTokenIssuer } from './ports/invitation-token.port';

/** What the patient fills in on the screen the link opens. */
export interface AcceptInvitationInput {
  /** The token out of the link. Plain text, and it goes no further than here. */
  readonly token: string;
  readonly fullName: string;
  readonly timeZone: string | null;
  /** The purposes they ticked. Which are required is the domain's answer. */
  readonly consents: readonly ConsentType[];
}

/**
 * The patient's side of the invitation: the account becomes a patient, the
 * consents are recorded and the practice starts following them (card I-03).
 *
 * **Authorization.** The subject is the caller themselves, so there is no link
 * and no consent to check *before* — this is the request that creates both.
 * What matters is that the person joining is the person who sent the request,
 * and that is why the profile is keyed by the `sub` of the verified token and
 * never by a field of the body (ADR 0007). The only thing that grants the
 * practice access to them is the token in the link, which is a bearer
 * credential of 256 random bits (ADR 0015), and the practice the patient joins
 * is the invitation's — nothing in the request names an organization.
 *
 * **One transaction.** The profile, the patient, the care link, the consents
 * and the invitation being marked as used are one write (see the port): a
 * patient with a link and no consent, or a consumed invitation with no link,
 * are states nobody should ever have to clean up.
 *
 * **Nothing is logged.** Not the token, which is a credential, not the name,
 * and not which purposes somebody consented to — all three are either a secret
 * or personal data (CLAUDE.md, "Saúde e LGPD"). There is no log line here at
 * all.
 */
@Injectable()
export class AcceptInvitationUseCase {
  constructor(
    @Inject(IDENTITY_REGISTRY) private readonly registry: IdentityRegistry,
    @Inject(INVITATION_ACCEPTANCE_REPOSITORY)
    private readonly acceptances: InvitationAcceptanceRepository,
    @Inject(INVITATION_TOKEN_ISSUER) private readonly tokens: InvitationTokenIssuer,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token: the account the
   *   patient has just signed up with
   * @param input the link, the name and the consents
   * @throws InvitationNotFoundError when no invitation has that token
   * @throws InvitationExpiredError, InvitationRevokedError,
   *   InvitationAlreadyAcceptedError when the link may no longer be used
   * @throws MissingRequiredConsentError when a required consent is missing
   * @throws ProfileIsNotPatientError when the account is a professional's
   */
  async execute(authUserId: string, input: AcceptInvitationInput): Promise<AcceptedInvitation> {
    const now = new Date();

    const invitation = await this.acceptances.findByTokenHash(this.tokens.hashOf(input.token));

    // A token that matches no row. 404 and the same answer a wrong link gets:
    // there is nothing here to say anything else about.
    if (invitation === undefined) throw new InvitationNotFoundError();

    const existing = await this.registry.findByAuthUserId(authUserId);

    // Signed up as a professional and holding a patient's link. The refusal is
    // also inside the transaction, where a race cannot get past it; this one
    // is what answers before anything is written.
    if (existing !== undefined && existing.role !== 'patient') throw new ProfileIsNotPatientError();

    const accepted = await this.acceptances.accept(
      invitationAcceptanceOf({
        invitation,
        authUserId,
        fullName: input.fullName,
        timeZone: input.timeZone,
        consents: input.consents,
        now,
      }),
    );

    // Nothing was written, the invitation having just been read as pending:
    // somebody opened the same link twice, or the professional revoked it in
    // between. The link is of single use and it is spent.
    if (accepted === undefined) throw new InvitationAlreadyAcceptedError();

    return accepted;
  }
}
