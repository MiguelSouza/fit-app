import { Inject, Injectable } from '@nestjs/common';

import { invitationToCreate, type Invitation } from '../domain/invitation';
import { LoadProfessionalCaller } from './load-professional-caller';
import {
  INVITATION_REPOSITORY,
  type InvitationRepository,
} from './ports/invitation-repository.port';
import { INVITATION_TOKEN_ISSUER, type InvitationTokenIssuer } from './ports/invitation-token.port';

/** What the "Convidar paciente" screen asks for. `null` means "not filled in". */
export interface CreateInvitationInput {
  readonly name: string | null;
  readonly contact: string | null;
}

/**
 * The invitation, plus the token — the one and only time the token exists
 * outside the professional's hands.
 */
export interface IssuedInvitation {
  readonly invitation: Invitation;
  /** Plain text. It goes straight into the response and is never stored. */
  readonly token: string;
}

/**
 * Creating the link a professional sends a patient on WhatsApp (card I-02).
 *
 * **Authorization.** The subject is the caller: a professional of a practice,
 * resolved from the verified token, and the invitation belongs to *that*
 * practice. Nothing in the request names an organization, so there is no id to
 * tamper with — the acceptance criterion "convite pertence à organização do
 * profissional" holds by construction. No patient's data is read: an
 * invitation has no patient yet, which is why there is no link, no consent and
 * no access log here (CLAUDE.md, "Saúde e LGPD").
 *
 * **Nothing is logged.** Not the token, which is a credential, and not the
 * name or the contact, which are a person's. The masking of
 * `@fit-app/observability` would catch all three by field name; the use case
 * does not write a log line to begin with.
 */
@Injectable()
export class CreateInvitationUseCase {
  constructor(
    private readonly loadCaller: LoadProfessionalCaller,
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(INVITATION_TOKEN_ISSUER) private readonly tokens: InvitationTokenIssuer,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @param input the optional name and contact of whoever is being invited
   */
  async execute(authUserId: string, input: CreateInvitationInput): Promise<IssuedInvitation> {
    const caller = await this.loadCaller.execute(authUserId);
    const { token, tokenHash } = this.tokens.issue();

    const invitation = await this.invitations.create(
      invitationToCreate({
        organizationId: caller.organizationId,
        invitedByProfileId: caller.profileId,
        name: input.name,
        contact: input.contact,
        tokenHash,
        now: new Date(),
      }),
    );

    return { invitation, token };
  }
}
