import {
  type AcceptedInvitation as AcceptedInvitationDto,
  type ConsentType as ConsentTypeDto,
  type CreatedInvitation,
  type Invitation as InvitationDto,
  type InvitationList,
  type InvitationStatus as InvitationStatusDto,
} from '@fit-app/contracts';

import { type IssuedInvitation } from '../application/create-invitation.use-case';
import { type ConsentType } from '../domain/consent';
import { invitationStatusOf, type Invitation, type InvitationStatus } from '../domain/invitation';
import { type AcceptedInvitation } from '../domain/invitation-acceptance';

/**
 * The domain's invitations as the contract answers them.
 *
 * Two things happen here and nowhere else. The **status** is computed, at the
 * instant of the request: the domain carries three dates and the client gets
 * one word, so no panel and no app has to know what "expired" means. And the
 * dates become ISO 8601 text in UTC, which is what the contract declares and
 * what every client parses (CLAUDE.md, "Dados de saúde": UTC in the database,
 * the person's time zone on the way out).
 *
 * This is also where the two vocabularies are checked against each other: the
 * domain declares its own statuses (`domain/invitation.ts`) and the assignment
 * below only compiles while the contract still has every value the domain can
 * produce.
 *
 * What does **not** cross over is `organizationId`: the organization is the
 * caller's own, every row in the answer belongs to it, and repeating it on
 * every invitation would only invite a client to start sending it back.
 */
export function toInvitationResponse(invitation: Invitation, now: Date): InvitationDto {
  return {
    id: invitation.id,
    status: toInvitationStatus(invitationStatusOf(invitation, now)),

    // Omitted, not null: the contract makes both optional, because an
    // invitation with no name and no contact is a valid invitation.
    ...(invitation.name === null ? {} : { name: invitation.name }),
    ...(invitation.contact === null ? {} : { contact: invitation.contact }),

    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    ...(invitation.acceptedAt === null ? {} : { acceptedAt: invitation.acceptedAt.toISOString() }),
    ...(invitation.revokedAt === null ? {} : { revokedAt: invitation.revokedAt.toISOString() }),
  };
}

/** The list, in the order the use case answered it: the most recent first. */
export function toInvitationListResponse(
  invitations: readonly Invitation[],
  now: Date,
): InvitationList {
  return { invitations: invitations.map((invitation) => toInvitationResponse(invitation, now)) };
}

/**
 * The creation's answer: the invitation, and the token, once.
 *
 * The token is passed through untouched — it is the only thing in this
 * response that is not derived from a row, and the only time it exists outside
 * the professional's hands.
 */
export function toCreatedInvitationResponse(
  issued: IssuedInvitation,
  now: Date,
): CreatedInvitation {
  return { invitation: toInvitationResponse(issued.invitation, now), token: issued.token };
}

/**
 * The acceptance's answer: where the patient ended up (card I-03).
 *
 * Ids, one instant and the purposes in force — and no personal data of
 * anybody, not the patient's name and not the practice's. The instant becomes
 * ISO 8601 in UTC here, as every date of this API does.
 */
export function toAcceptedInvitationResponse(accepted: AcceptedInvitation): AcceptedInvitationDto {
  return {
    profileId: accepted.profileId,
    organizationId: accepted.organizationId,
    careRelationshipId: accepted.careRelationshipId,
    acceptedAt: accepted.acceptedAt.toISOString(),
    consents: accepted.consents.map(toConsentType),
  };
}

/** Where the domain's status and the contract's are checked to be the same word. */
function toInvitationStatus(status: InvitationStatus): InvitationStatusDto {
  return status;
}

/** The same check for the purposes: the domain declares its own four words. */
function toConsentType(type: ConsentType): ConsentTypeDto {
  return type;
}
