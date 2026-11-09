import {
  type AcceptedInvitation,
  type AcceptInvitationRequest,
  type CreatedInvitation,
  type CreateInvitationRequest,
  type HealthResponse,
  type Invitation,
  type InvitationList,
  type MeResponse,
  type OrganizationMembership,
  type ProfessionalIdentity,
  type RegisterProfessionalRequest,
} from './index';

/**
 * The fields of the contract the clients read today, pinned at the type level.
 *
 * It has no runtime job. What it does is make `pnpm typecheck` fail when a
 * field is renamed or dropped in `packages/contracts` and the document is
 * regenerated — which is the acceptance criterion of card F-09 and the only
 * thing that catches a breaking contract change before a client ships against
 * it. A field that is no longer in `MeResponse` is no longer in `keyof
 * MeResponse`, and the alias below stops compiling.
 *
 * Adding a field to a schema breaks nothing here, which is the point: the list
 * is what is already being read, not everything that exists.
 */
type FieldsOf<Dto, Fields extends keyof Dto> = Fields;

export type MeResponseFields = FieldsOf<
  MeResponse,
  'personId' | 'role' | 'timeZone' | 'professional'
>;

export type ProfessionalIdentityFields = FieldsOf<
  ProfessionalIdentity,
  'type' | 'councilNumber' | 'specialty' | 'organizations'
>;

export type OrganizationMembershipFields = FieldsOf<
  OrganizationMembership,
  'organizationId' | 'name' | 'kind' | 'role'
>;

export type RegisterProfessionalRequestFields = FieldsOf<
  RegisterProfessionalRequest,
  'fullName' | 'councilNumber' | 'specialty' | 'professionalType'
>;

export type InvitationFields = FieldsOf<
  Invitation,
  'id' | 'status' | 'name' | 'contact' | 'createdAt' | 'expiresAt' | 'acceptedAt' | 'revokedAt'
>;

export type InvitationListFields = FieldsOf<InvitationList, 'invitations'>;

export type CreatedInvitationFields = FieldsOf<CreatedInvitation, 'invitation' | 'token'>;

export type CreateInvitationRequestFields = FieldsOf<CreateInvitationRequest, 'name' | 'contact'>;

export type AcceptInvitationRequestFields = FieldsOf<
  AcceptInvitationRequest,
  'token' | 'fullName' | 'timeZone' | 'consents'
>;

export type AcceptedInvitationFields = FieldsOf<
  AcceptedInvitation,
  'profileId' | 'organizationId' | 'careRelationshipId' | 'acceptedAt' | 'consents'
>;

export type HealthResponseFields = FieldsOf<HealthResponse, 'status' | 'checks'>;
