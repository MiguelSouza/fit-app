import {
  type MeResponse,
  type OrganizationMembership as OrganizationMembershipDto,
  type ProfessionalIdentity,
} from '@fit-app/contracts';

import {
  type OrganizationMembership,
  type RegisteredIdentity,
} from '../domain/registered-identity';

/**
 * The domain's identity as the contract answers it.
 *
 * This is also where the two vocabularies are checked against each other: the
 * domain declares its own roles and types (`domain/person.ts`) and the
 * assignments below only compile while the contract still has every value the
 * domain can produce. A value added on one side and forgotten on the other
 * stops the build here, which is the cheapest place for it to stop.
 *
 * What does **not** cross over is the person's name. The response says which
 * product the caller is in and what they may do; the only free text in it is
 * the name of their own practice (CLAUDE.md, "Saúde e LGPD" — a response
 * carries ids and codes).
 */
export function toMeResponse(identity: RegisteredIdentity): MeResponse {
  return {
    personId: identity.personId,
    role: identity.role,
    timeZone: identity.timeZone,

    // Omitted, not null: the contract makes it optional, because a patient has
    // no council number and belongs to no practice.
    ...(identity.professional === null
      ? {}
      : {
          professional: {
            type: identity.professional.type,
            councilNumber: identity.professional.councilNumber,
            ...(identity.professional.specialty === null
              ? {}
              : { specialty: identity.professional.specialty }),
            organizations: identity.organizations.map(toOrganizationMembership),
          } satisfies ProfessionalIdentity,
        }),
  };
}

function toOrganizationMembership(membership: OrganizationMembership): OrganizationMembershipDto {
  return {
    organizationId: membership.organizationId,
    name: membership.name,
    kind: membership.kind,
    role: membership.role,
  };
}
