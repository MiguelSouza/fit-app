import { Inject, Injectable } from '@nestjs/common';

import { type Invitation } from '../domain/invitation';
import { LoadProfessionalCaller } from './load-professional-caller';
import {
  INVITATION_REPOSITORY,
  type InvitationRepository,
} from './ports/invitation-repository.port';

/**
 * The invitations of the caller's practice, for the list on the "Convites"
 * screen (card I-02).
 *
 * **Authorization.** The organization comes from the caller and never from a
 * parameter, so a professional cannot ask for another practice's invitations:
 * there is no field in which to ask. Status is not computed here — it is read
 * off each invitation's dates by the presenter, at the instant of the request.
 *
 * No token leaves: the rows carry a hash and the hash is not in the response
 * either (`invitationSchema` in `@fit-app/contracts`).
 */
@Injectable()
export class ListInvitationsUseCase {
  constructor(
    private readonly loadCaller: LoadProfessionalCaller,
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
  ) {}

  /** @param authUserId the `sub` of the verified access token */
  async execute(authUserId: string): Promise<readonly Invitation[]> {
    const caller = await this.loadCaller.execute(authUserId);

    return this.invitations.listByOrganization(caller.organizationId);
  }
}
