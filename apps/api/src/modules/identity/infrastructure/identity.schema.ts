import type {
  OrganizationKind,
  OrganizationRole,
  PersonRole,
  ProfessionalType,
} from '@fit-app/contracts';
import { index, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The tables of `identity`, in the `identity` schema and nowhere else
 * (ADR 0004, CLAUDE.md rule 2). Drizzle Kit finds this file through the glob
 * in `drizzle.config.ts`, and the SQL it generates is reviewed in the pull
 * request.
 *
 * What is here is what card I-01 needs: the person, the professional, the
 * practice and the membership. Links, invitations, consents and the access log
 * are the rest of the module and come with their own cards.
 */
export const IDENTITY_SCHEMA = 'identity';

export const identitySchema = pgSchema(IDENTITY_SCHEMA);

/**
 * The values of each database enum, written out here and checked against the
 * contract below.
 *
 * They are **not** read from the Zod enums at runtime, deliberately: Drizzle
 * Kit loads this file to generate a migration, and reading them would make
 * `pnpm db:generate` need `@fit-app/contracts` compiled first. The order is
 * part of the migration, so it is pinned here and only ever appended to.
 */
const PERSON_ROLES = ['professional', 'patient'] as const;
const PROFESSIONAL_TYPES = ['nutritionist', 'trainer'] as const;
const ORGANIZATION_KINDS = ['solo', 'clinic'] as const;
const ORGANIZATION_ROLES = ['owner', 'member'] as const;

/**
 * A type that has to be empty, as in `shared/events/domain-event.ts`: anything
 * else does not satisfy the constraint, and the error names what was found.
 */
type Nothing<Found extends never> = Found;

/** Whatever one of the two lists has and the other does not. */
type Drift<Column extends string, Contract extends string> =
  Exclude<Column, Contract> | Exclude<Contract, Column>;

/**
 * The guard against the two halves drifting apart: what a column accepts has
 * to be exactly what the API answers, and these aliases are `never` only while
 * that holds. A value added to a Zod enum and forgotten here — or the other way
 * round — stops the build with the value in the message.
 */
export type PersonRoleDrift = Nothing<Drift<(typeof PERSON_ROLES)[number], PersonRole>>;
export type ProfessionalTypeDrift = Nothing<
  Drift<(typeof PROFESSIONAL_TYPES)[number], ProfessionalType>
>;
export type OrganizationKindDrift = Nothing<
  Drift<(typeof ORGANIZATION_KINDS)[number], OrganizationKind>
>;
export type OrganizationRoleDrift = Nothing<
  Drift<(typeof ORGANIZATION_ROLES)[number], OrganizationRole>
>;

export const personRoleEnum = identitySchema.enum('person_role', PERSON_ROLES);

export const professionalTypeEnum = identitySchema.enum('professional_type', PROFESSIONAL_TYPES);

export const organizationKindEnum = identitySchema.enum('organization_kind', ORGANIZATION_KINDS);

export const organizationRoleEnum = identitySchema.enum('organization_role', ORGANIZATION_ROLES);

/**
 * When the row appeared, in UTC — every instant in this database is
 * (CLAUDE.md, "Dados de saúde"). A function and not a shared builder: a column
 * builder carries the state of one column, and two tables must not share one.
 */
function createdAt() {
  return timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
}

/**
 * A person. One row per human being on the platform, professional or patient.
 *
 * `id` is **ours** and not the Supabase user id: the login is Supabase's and
 * the domain is ours (ADR 0002), so the id that every other schema will point
 * at does not change if the identity provider ever does. `auth_user_id` is the
 * one Supabase Auth issues, and the unique index on it is what makes
 * registering twice impossible however many requests arrive at once.
 *
 * There is no foreign key to `auth.users`: that table belongs to Supabase, it
 * is not in a schema this module owns, and a test database has no Auth in it.
 * What keeps the two in step is the use case, which only ever writes the `sub`
 * of a verified token.
 */
export const profile = identitySchema.table('profile', {
  id: uuid('id').primaryKey().defaultRandom(),

  authUserId: uuid('auth_user_id').notNull().unique(),

  role: personRoleEnum('role').notNull(),

  /** Personal data. It stays in the database and never reaches a log. */
  fullName: text('full_name').notNull(),

  /**
   * The person's IANA time zone, which is what turns a UTC instant into
   * "yesterday night" (CLAUDE.md, "Dados de saúde"). It has no default here on
   * purpose: the default belongs to the domain, in one place, instead of being
   * half in the code and half in the column.
   */
  timeZone: text('time_zone').notNull(),

  createdAt: createdAt(),
});

/**
 * The professional half of a person: what they are licensed to do.
 *
 * One row per professional profile, keyed by the profile itself — a person is
 * one professional or none. `professional_type` is what every rule checks
 * ("só nutricionista edita plano alimentar"), and its default is here as well
 * as in the domain because a row inserted by hand in a migration or a seed
 * must land on the same one.
 */
export const professional = identitySchema.table('professional', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profile.id, { onDelete: 'cascade' }),

  professionalType: professionalTypeEnum('professional_type').notNull().default('nutritionist'),

  /** `CRN-3 12345`. Free text: the format differs by council and by region. */
  councilNumber: text('council_number').notNull(),

  specialty: text('specialty'),

  createdAt: createdAt(),
});

/**
 * A practice. Every professional belongs to one, and in the MVP it is the
 * `solo` practice created with their registration, named after them.
 */
export const organization = identitySchema.table('organization', {
  id: uuid('id').primaryKey().defaultRandom(),

  name: text('name').notNull(),

  kind: organizationKindEnum('kind').notNull(),

  createdAt: createdAt(),
});

/**
 * Who belongs to a practice, and as what. The primary key is the pair, so the
 * same person cannot be in the same practice twice.
 *
 * The index on `profile_id` is for the question `GET /v1/me` asks — which
 * practices is this person in — which the primary key cannot answer, since it
 * leads with the organization.
 */
export const organizationMember = identitySchema.table(
  'organization_member',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    profileId: uuid('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),

    role: organizationRoleEnum('role').notNull(),

    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.profileId] }),
    index('organization_member_profile_id_idx').on(table.profileId),
  ],
);

/** Everything the module's repository talks to, as Drizzle takes it. */
export const identityTables = { profile, professional, organization, organizationMember };
