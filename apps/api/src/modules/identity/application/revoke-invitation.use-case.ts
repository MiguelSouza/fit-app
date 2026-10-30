import { Inject, Injectable } from '@nestjs/common';

import { InvitationNotFoundError, InvitationNotPendingError } from '../domain/identity-errors';
import { isPending, type Invitation } from '../domain/invitation';
import { LoadProfessionalCaller } from './load-professional-caller';
import {
  INVITATION_REPOSITORY,
  type InvitationRepository,
} from './ports/invitation-repository.port';

/**
 * Taking a link back before it is used (card I-02).
 *
 * **Authorization.** The caller is a professional of a practice, and the
 * invitation is looked up **inside that practice**: an id that belongs to
 * somebody else's organization is answered as not found, which is both the
 * honest answer — it is not there, as far as this caller is concerned — and
 * the one that does not confirm that the id exists.
 *
 * Only a pending invitation can be revoked: one that was accepted is spent and
 * revoking it would suggest the patient was removed, which is a different
 * thing with a card of its own; one that expired is already closed. The check
 * runs twice on purpose — here, to say *why* in a message the professional can
 * read, and inside the write, where a revocation racing an acceptance is
 * decided by the database and not by what this process read a moment ago.
 */
@Injectable()
export class RevokeInvitationUseCase {
  constructor(
    private readonly loadCaller: LoadProfessionalCaller,
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @param invitationId the invitation, which has to be the caller's practice's
   * @throws InvitationNotFoundError when it is not this organization's
   * @throws InvitationNotPendingError when it was accepted, revoked or expired
   */
  async execute(authUserId: string, invitationId: string): Promise<Invitation> {
    const caller = await this.loadCaller.execute(authUserId);
    const now = new Date();

    const found = await this.invitations.findById(invitationId, caller.organizationId);

    if (found === undefined) throw new InvitationNotFoundError();
    if (!isPending(found, now)) throw new InvitationNotPendingError();

    const revoked = await this.invitations.revoke(invitationId, caller.organizationId, now);

    // Nothing was written, having just been read as pending: somebody accepted
    // the invitation in between. The answer is the same as above — there is
    // nothing left to take back — and the patient who got in stays in.
    if (revoked === undefined) throw new InvitationNotPendingError();

    return revoked;
  }
}
