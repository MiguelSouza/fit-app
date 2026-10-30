import {
  type CreatedInvitation,
  type CreateInvitationRequest,
  type Invitation,
} from '@fit-app/api-client';
import { queryOptions } from '@tanstack/react-query';

import { ApiError, apiClient } from '@/lib/api/client';

/**
 * The invitations of the professional's practice (card I-02).
 *
 * The types are the contract's, not types written here: a field the API stops
 * answering breaks `pnpm typecheck` of the client package
 * (`packages/api-client`, ADR 0008). Which organization the invitations belong
 * to is not a parameter of anything below — the API reads it from the token of
 * the session (ADR 0007).
 */
export const invitationsQuery = queryOptions({
  queryKey: ['invitations'] as const,

  queryFn: async (): Promise<readonly Invitation[]> => {
    const { data, error } = await apiClient().GET('/v1/invitations');

    if (error) throw new ApiError(error.error.code, error.error.message);

    return data.invitations;
  },
});

/**
 * `POST /v1/invitations`: creates the link.
 *
 * The answer carries the token, and this is the **only** moment the panel ever
 * sees it: it is not in the list, it is not in the query cache — the mutation's
 * result is what the screen shows, and it is gone on the next navigation. The
 * professional copies the link or revokes the invitation and makes another.
 */
export async function createInvitation(body: CreateInvitationRequest): Promise<CreatedInvitation> {
  const { data, error } = await apiClient().POST('/v1/invitations', { body });

  if (error) throw new ApiError(error.error.code, error.error.message);

  return data;
}

/** `POST /v1/invitations/{id}/revoke`: the link stops working immediately. */
export async function revokeInvitation(invitationId: string): Promise<Invitation> {
  const { data, error } = await apiClient().POST('/v1/invitations/{id}/revoke', {
    params: { path: { id: invitationId } },
  });

  if (error) throw new ApiError(error.error.code, error.error.message);

  return data;
}
