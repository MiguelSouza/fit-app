import createClient, { type Client, type ClientOptions } from 'openapi-fetch';

import { type components, type paths } from './generated/openapi';

/**
 * Public API of `@fit-app/api-client`: a typed client over the API, and the
 * DTOs under the names the contract gives them.
 *
 * Everything here hangs off `src/generated/openapi.ts`, which is generated
 * from `apps/api/openapi.json` by `pnpm api:generate` and is not edited by
 * hand. The path of a request, its body and the shape of its answer are all
 * checked at compile time against that document: a field that the API stopped
 * answering is a build error here, not a surprise at runtime.
 */
export type { components, operations, paths } from './generated/openapi';

/** `GET /v1/me` */
export type MeResponse = components['schemas']['MeResponse'];
export type PersonRole = components['schemas']['PersonRole'];
export type ProfessionalIdentity = components['schemas']['ProfessionalIdentity'];
export type ProfessionalType = components['schemas']['ProfessionalType'];
export type OrganizationMembership = components['schemas']['OrganizationMembership'];
export type OrganizationKind = components['schemas']['OrganizationKind'];
export type OrganizationRole = components['schemas']['OrganizationRole'];

/** `POST /v1/professionals/me` */
export type RegisterProfessionalRequest = components['schemas']['RegisterProfessionalRequest'];

/** `POST /v1/invitations`, `GET /v1/invitations`, `POST /v1/invitations/{id}/revoke` */
export type Invitation = components['schemas']['Invitation'];
export type InvitationStatus = components['schemas']['InvitationStatus'];
export type InvitationList = components['schemas']['InvitationList'];
export type CreateInvitationRequest = components['schemas']['CreateInvitationRequest'];
export type CreatedInvitation = components['schemas']['CreatedInvitation'];

/** `GET /v1/health` */
export type HealthResponse = components['schemas']['HealthResponse'];
export type ComponentCheck = components['schemas']['ComponentCheck'];
export type ComponentStatus = components['schemas']['ComponentStatus'];

/** The envelope every error of the API comes in, whatever the status code. */
export type ErrorResponse = components['schemas']['ErrorResponse'];

export type FitAppApiClient = Client<paths>;

/**
 * `baseUrl` is required: the panel and the app read the API's address from
 * their own environment, and a client that silently defaults to the current
 * origin is a client that calls the wrong host in staging.
 */
export type FitAppApiClientOptions = ClientOptions & { baseUrl: string };

/**
 * Opens a client against the API.
 *
 * The caller owns the credentials: pass the access token as a header, or a
 * middleware that refreshes it, the way `openapi-fetch` takes them. Nothing is
 * stored here.
 *
 * @param options everything `openapi-fetch` accepts, with `baseUrl` required
 */
export function createFitAppApiClient(options: FitAppApiClientOptions): FitAppApiClient {
  return createClient<paths>(options);
}
