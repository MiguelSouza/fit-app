/**
 * Public API of `@fit-app/contracts`: the DTOs of the whole platform, as Zod
 * schemas, with the types inferred from them.
 *
 * CLAUDE.md rule 7 ("Contratos primeiro"): a DTO is born here. The API
 * validates request and response against these schemas and generates the
 * OpenAPI document from them; the panel and the app get their types from the
 * client generated out of that document (`packages/api-client`).
 *
 * The folders mirror the API: one per module, plus `shared` for what every
 * endpoint answers. Nothing in here imports NestJS, a database or anything
 * with I/O — it is read by a Nest app, by Next.js and by a code generator.
 */
export {
  componentCheckSchema,
  componentStatusSchema,
  healthResponseSchema,
  type ComponentCheck,
  type ComponentStatus,
  type HealthResponse,
} from './health-check/health-response';

export { consentTypeSchema, type ConsentType } from './identity/consent';

export {
  acceptedInvitationSchema,
  acceptInvitationRequestSchema,
  type AcceptedInvitation,
  type AcceptInvitationRequest,
} from './identity/invitation-acceptance';

export {
  createdInvitationSchema,
  createInvitationRequestSchema,
  invitationIdSchema,
  invitationListSchema,
  invitationSchema,
  invitationStatusSchema,
  type CreatedInvitation,
  type CreateInvitationRequest,
  type Invitation,
  type InvitationList,
  type InvitationStatus,
} from './identity/invitation';

export {
  meResponseSchema,
  personRoleSchema,
  type MeResponse,
  type PersonRole,
} from './identity/me';

export {
  organizationKindSchema,
  organizationMembershipSchema,
  organizationRoleSchema,
  type OrganizationKind,
  type OrganizationMembership,
  type OrganizationRole,
} from './identity/organization';

export {
  professionalIdentitySchema,
  professionalTypeSchema,
  registerProfessionalRequestSchema,
  type ProfessionalIdentity,
  type ProfessionalType,
  type RegisterProfessionalRequest,
} from './identity/professional';

export { errorResponseSchema, type ErrorResponse } from './shared/error-response';
