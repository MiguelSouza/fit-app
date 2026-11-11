import {
  type CareRelationshipStatus as CareRelationshipStatusDto,
  type EndedCareRelationship as EndedCareRelationshipDto,
} from '@fit-app/contracts';

import {
  careRelationshipStatusOf,
  type CareRelationshipStatus,
  type EndedCareRelationship,
} from '../domain/care-relationship';

/**
 * The ended follow-up as the contract answers it (card I-07).
 *
 * Two things happen here and nowhere else, as in `consent.presenter.ts`. The
 * instants become ISO 8601 text in UTC, which is what the contract declares and
 * what every client parses (CLAUDE.md, "Dados de saúde"). And the two
 * vocabularies are checked against each other: the domain declares its own
 * statuses (`domain/care-relationship.ts`) and the assignment below only
 * compiles while the contract still has every value the domain can produce.
 *
 * The status is **read off the row** and not written as the literal `'ended'`,
 * even though it can only be that here: the status of a link has exactly one
 * definition in this codebase (`careRelationshipStatusOf`), and a presenter
 * that hard-codes the answer is the second one.
 *
 * What does not cross over is `invitationId`. It is the audit trail of where
 * the link came from and the platform's own business; the client that just
 * ended a follow-up has nothing to do with it.
 */
export function toEndedCareRelationshipResponse(
  ended: EndedCareRelationship,
): EndedCareRelationshipDto {
  return {
    id: ended.id,
    organizationId: ended.organizationId,
    status: toCareRelationshipStatus(careRelationshipStatusOf(ended)),
    startedAt: ended.startedAt.toISOString(),
    endedAt: ended.endedAt.toISOString(),
  };
}

/** Where the domain's statuses and the contract's are checked to be the same word. */
function toCareRelationshipStatus(status: CareRelationshipStatus): CareRelationshipStatusDto {
  return status;
}
