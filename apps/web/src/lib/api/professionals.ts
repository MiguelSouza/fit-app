import { type MeResponse, type RegisterProfessionalRequest } from '@fit-app/api-client';

import { ApiError, apiClient } from '@/lib/api/client';

/**
 * `POST /v1/professionals/me`: the first access of a professional.
 *
 * The body and the answer are the types of the contract, not types written
 * here: a field the API stops accepting breaks `pnpm typecheck` of the client
 * package (`packages/api-client`, ADR 0008).
 *
 * Who is being registered is not in the body — the API reads it from the token
 * of the session (ADR 0007).
 */
export async function registerProfessional(body: RegisterProfessionalRequest): Promise<MeResponse> {
  const { data, error } = await apiClient().POST('/v1/professionals/me', { body });

  if (error) throw new ApiError(error.error.code, error.error.message);

  return data;
}
