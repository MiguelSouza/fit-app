import { type MeResponse } from '@fit-app/api-client';
import { queryOptions } from '@tanstack/react-query';

import { ApiError, apiClient } from '@/lib/api/client';

/**
 * `GET /v1/me`: who is using the panel.
 *
 * The type of the answer is the one from the contract, not a type written here:
 * a field the API stops answering breaks `pnpm typecheck` of the client package
 * (`packages/api-client`, ADR 0008).
 */
export const meQuery = queryOptions({
  queryKey: ['me'] as const,

  queryFn: async (): Promise<MeResponse> => {
    const { data, error } = await apiClient().GET('/v1/me');

    if (error) throw new ApiError(error.error.code, error.error.message);

    return data;
  },
});
