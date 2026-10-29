import { z } from 'zod';

/**
 * What kind of practice an organization is.
 *
 * Every professional belongs to one (CLAUDE.md, "Módulos de domínio":
 * `identity` owns organizations and memberships). In the MVP the only one the
 * platform ever creates is `solo` — the practice of a single professional, who
 * owns it. `clinic` is why the column exists: the same professional model has
 * to hold a practice with more than one person in it without a migration that
 * rewrites every row.
 */
export const organizationKindSchema = z.enum(['solo', 'clinic']).meta({
  id: 'OrganizationKind',
  description: 'Tipo da organização: consultório individual ou clínica',
});

export type OrganizationKind = z.infer<typeof organizationKindSchema>;

/**
 * What a person may do inside an organization.
 *
 * It is **not** permission to read a patient: that needs an active link and a
 * `share_with_professional` consent in force, checked inside the use case
 * (CLAUDE.md, "Saúde e LGPD"). Being `owner` of a practice says who answers
 * for the practice, not whose chart is open.
 */
export const organizationRoleSchema = z.enum(['owner', 'member']).meta({
  id: 'OrganizationRole',
  description: 'Papel da pessoa dentro da organização',
});

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/**
 * One organization the caller belongs to, as the caller's own identity
 * response carries it.
 *
 * The `name` here is the practice's, and the practice of a solo professional
 * is named after them — which makes it the one name in this payload, and it
 * belongs to whoever is reading it. No third party, and no patient, shows up
 * in an organization list.
 */
export const organizationMembershipSchema = z
  .object({
    organizationId: z.uuid().meta({ description: 'Id da organização' }),

    name: z.string().min(1).meta({
      description: 'Nome da organização',
      example: 'Ana Souza',
    }),

    kind: organizationKindSchema,

    role: organizationRoleSchema,
  })
  .meta({
    id: 'OrganizationMembership',
    description: 'Vínculo da pessoa com uma organização',
  });

export type OrganizationMembership = z.infer<typeof organizationMembershipSchema>;
