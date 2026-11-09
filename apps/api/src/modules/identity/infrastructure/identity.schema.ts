import type {
  ConsentType,
  OrganizationKind,
  OrganizationRole,
  PersonRole,
  ProfessionalType,
} from '@fit-app/contracts';
import { sql } from 'drizzle-orm';
import {
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The tables of `identity`, in the `identity` schema and nowhere else
 * (ADR 0004, CLAUDE.md rule 2). Drizzle Kit finds this file through the glob
 * in `drizzle.config.ts`, and the SQL it generates is reviewed in the pull
 * request.
 *
 * What is here is what cards I-01 to I-03 need: the person, the professional,
 * the practice and the membership; the invitation; and the patient, the care
 * link and the consents the acceptance of an invitation creates. The access
 * log is the rest of the module and comes with its own card.
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
const CONSENT_TYPES = [
  'health_data',
  'share_with_professional',
  'wearable_data',
  'ai_processing',
] as const;

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
export type ConsentTypeDrift = Nothing<Drift<(typeof CONSENT_TYPES)[number], ConsentType>>;

export const personRoleEnum = identitySchema.enum('person_role', PERSON_ROLES);

export const professionalTypeEnum = identitySchema.enum('professional_type', PROFESSIONAL_TYPES);

export const organizationKindEnum = identitySchema.enum('organization_kind', ORGANIZATION_KINDS);

export const organizationRoleEnum = identitySchema.enum('organization_role', ORGANIZATION_ROLES);

export const consentTypeEnum = identitySchema.enum('consent_type', CONSENT_TYPES);

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
 * The patient half of a person: the person a practice follows (card I-03).
 *
 * Keyed by the profile, as `professional` is — one row per patient, or none,
 * and the same person is never two patients. It holds almost nothing today,
 * and that is the honest state of it: what a patient *is* to this platform is
 * their check-ins, their measurements and their plan, and each of those is
 * another module's table with a card of its own. What the row gives already is
 * what no join can fake — "this profile is a patient", written once, which is
 * what a foreign key from `nutrition` or `health` will point at.
 */
export const patient = identitySchema.table('patient', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profile.id, { onDelete: 'cascade' }),

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

/**
 * An invitation: the link a professional sends a patient so they join the
 * practice (card I-02).
 *
 * **The token is not here.** `token_hash` is the SHA-256 of it, and the token
 * itself is answered once, on the creation, and never written anywhere: a
 * backup, a replica or a leaked dump of this table cannot be turned back into
 * a working link. The unique index is on the hash, which is also how the
 * acceptance will look an invitation up — one index, one lookup, no scan.
 *
 * **There is no status column.** The four statuses the panel shows are read
 * off these three timestamps (`expires_at`, `accepted_at`, `revoked_at`) by
 * `domain/invitation.ts`. A stored status would need a job to turn `pending`
 * into `expired` at midnight, and would be wrong until it ran.
 *
 * It belongs to the organization, not to the professional who sent it: the
 * practice is what the patient joins, and in a clinic another member has to be
 * able to see the invitation. Who sent it is kept all the same, in
 * `invited_by_profile_id`.
 */
export const invitation = identitySchema.table(
  'invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    invitedByProfileId: uuid('invited_by_profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),

    /** SHA-256 of the token, in hex. Unique: one row per link, ever. */
    tokenHash: text('token_hash').notNull().unique(),

    /**
     * What the professional wrote down about whoever they invited, so their own
     * list says who each link was for. Personal data of a person who is not
     * even on the platform yet: it stays in this table and in the answer to the
     * professional who typed it, and never reaches a log (CLAUDE.md, "Saúde e
     * LGPD" — the masking list of `@fit-app/observability` covers both names).
     */
    name: text('name'),

    contact: text('contact'),

    /**
     * Fourteen days after the creation. No default here: the lifetime is a
     * product rule and it lives in the domain, in one place, so a seed and a
     * test land on the same one.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** Set once, by the acceptance. A link is of single use. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: createdAt(),
  },
  (table) => [
    // The question the "Convites" screen asks: every invitation of this
    // practice, the most recent first.
    index('invitation_organization_id_created_at_idx').on(table.organizationId, table.createdAt),
  ],
);

/**
 * The link between a practice and a patient — the "vínculo ativo" every
 * authorization rule of this platform asks about (CLAUDE.md, "Saúde e LGPD").
 * It is born when a patient accepts an invitation (card I-03).
 *
 * **It belongs to the organization**, not to the professional who invited, for
 * the same reason the invitation does (ADR 0015): the practice is what the
 * patient joined, and in a clinic another member has to be able to take the
 * follow-up over. `invitation_id` is where the link came from, which is the
 * audit trail LGPD asks of "por que este profissional vê este paciente" — and
 * it is the only place that pairing is written down, since the invitation
 * itself has no patient column.
 *
 * **There is no status column**, as on the invitation: `active` and `ended` are
 * read off `ended_at` by `domain/care-relationship.ts`, at the instant
 * somebody asks.
 *
 * The unique index on the pair is what makes the acceptance criterion
 * "paciente que já existe só ganha o novo vínculo" survive a double click: a
 * second acceptance in the same practice cannot produce a second link, and the
 * patient's other practices are other rows.
 */
export const careRelationship = identitySchema.table(
  'care_relationship',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    patientProfileId: uuid('patient_profile_id')
      .notNull()
      .references(() => patient.profileId, { onDelete: 'cascade' }),

    /**
     * `cascade` like every other key in this schema, and not `restrict` to
     * protect the trail: an invitation is never deleted (ADR 0015 — even an
     * expired one stays), and a `restrict` here would be a trap, because
     * deleting an organization cascades to both tables and the two actions
     * would race each other in the same statement.
     */
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => invitation.id, { onDelete: 'cascade' }),

    /**
     * When the follow-up started, which is the instant the invitation was
     * accepted. Decided in the domain, not defaulted here, so a seed and a
     * test land on the same one.
     */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),

    /** `null` while the practice still follows this patient. */
    endedAt: timestamp('ended_at', { withTimezone: true }),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('care_relationship_organization_id_patient_profile_id_idx').on(
      table.organizationId,
      table.patientProfileId,
    ),
    // The question the patient's own side asks: which practices follow me.
    index('care_relationship_patient_profile_id_idx').on(table.patientProfileId),
  ],
);

/**
 * What the patient consented to, one row per purpose (card I-03).
 *
 * One row per purpose and not a column per purpose: LGPD asks for consent per
 * finalidade, each given and revoked on its own, and `terms_version` records
 * which text was agreed to — which is the whole point of keeping it, since the
 * text changes and what the person agreed to does not.
 *
 * **A revocation is a new state of the row, never a delete**: `revoked_at` is
 * set, the row stays, and the history of "deu e tirou" survives — which is
 * what makes the platform able to answer, a year later, what it was allowed to
 * do when. A consent is *in force* when `revoked_at` is null, and the partial
 * unique index below is what keeps a profile from holding two in force for the
 * same purpose; granting again after a revocation is a new row.
 *
 * It belongs to the **profile** and not to the care relationship: the patient
 * consents to the platform processing their health data, and
 * `share_with_professional` is checked together with the active link of
 * whoever is asking. A consent per practice is a bigger model than this
 * product has patients for, and the day a patient has two practices and wants
 * to cut one off, the link is what ends.
 */
export const consent = identitySchema.table(
  'consent',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    profileId: uuid('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),

    type: consentTypeEnum('type').notNull(),

    /** Which version of the terms was shown. Decided by the API, never by the client. */
    termsVersion: text('terms_version').notNull(),

    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: createdAt(),
  },
  (table) => [
    // One consent in force per purpose, asked of the database. Partial,
    // because the revoked ones are history and there may be many of them.
    uniqueIndex('consent_profile_id_type_in_force_idx')
      .on(table.profileId, table.type)
      .where(sql`${table.revokedAt} is null`),
  ],
);

/** Everything the module's repositories talk to, as Drizzle takes it. */
export const identityTables = {
  profile,
  professional,
  patient,
  organization,
  organizationMember,
  invitation,
  careRelationship,
  consent,
};
