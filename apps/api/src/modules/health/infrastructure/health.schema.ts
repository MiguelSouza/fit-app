import { sql } from 'drizzle-orm';
import {
  check,
  date,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { type CheckinSymptom } from '../domain/checkin';

/**
 * The tables of `health`, in the `health` schema and nowhere else (ADR 0004,
 * CLAUDE.md rule 2). Drizzle Kit finds this file through the glob in
 * `drizzle.config.ts`, and the SQL it generates is reviewed in the pull
 * request.
 *
 * What is here is what card P-02 needs: the daily check-in. The wearable
 * tables — activities, sleep, daily metrics — and the measurements are other
 * cards, and they land beside it.
 */
export const HEALTH_SCHEMA = 'health';

export const healthSchema = pgSchema(HEALTH_SCHEMA);

/**
 * `identity.patient`, named here so the foreign key below can point at it.
 *
 * **It is not exported, and that is the whole trick.** A module never imports
 * another module's files (CLAUDE.md rule 1, enforced by lint), so this file
 * cannot read `identity.schema.ts` — and Drizzle needs a table object to build
 * a reference. Declaring it unexported gives the reference what it needs while
 * keeping Drizzle Kit from treating `identity.patient` as a table this schema
 * owns: the generator collects the tables a schema file **exports**, so the
 * only thing that comes out of this declaration is the constraint.
 *
 * One column, which is all a reference uses. The real table is `identity`'s
 * and this file has no business describing the rest of it.
 */
const identityPatient = pgSchema('identity').table('patient', {
  profileId: uuid('profile_id').primaryKey(),
});

/**
 * The symptoms a check-in may carry, written out here and checked against the
 * domain below.
 *
 * They are **not** read from the domain's array at runtime, deliberately, for
 * the reason `identity.schema.ts` gives for its own enums: Drizzle Kit loads
 * this file to generate a migration, and the order of the values is part of
 * that migration — so it is pinned here and only ever appended to.
 */
const CHECKIN_SYMPTOMS = [
  'bloating',
  'nausea',
  'heartburn',
  'constipation',
  'diarrhea',
  'headache',
  'cramps',
  'muscle_soreness',
  'dizziness',
  'other',
] as const;

/** A type that has to be empty, as in `identity.schema.ts`. */
type Nothing<Found extends never> = Found;

/** Whatever one of the two lists has and the other does not. */
type Drift<Column extends string, Domain extends string> =
  Exclude<Column, Domain> | Exclude<Domain, Column>;

/**
 * The guard against the two halves drifting apart: what the column accepts has
 * to be exactly what the domain can produce. A symptom added in one place and
 * forgotten in the other stops the build with the value in the message.
 */
export type CheckinSymptomDrift = Nothing<Drift<(typeof CHECKIN_SYMPTOMS)[number], CheckinSymptom>>;

export const checkinSymptomEnum = healthSchema.enum('checkin_symptom', CHECKIN_SYMPTOMS);

/**
 * The daily check-in: one row per patient per day (card P-02).
 *
 * **The day is a `date` and not a timestamp**, which is the whole model in one
 * column: a check-in belongs to a Tuesday in the patient's life, and that
 * Tuesday is decided by the zone on their profile before anything is written
 * (`domain/checkin.ts`). A `timestamptz` here would need a time nobody chose
 * and would move the row across a border every time somebody read it in
 * another zone. The two instants of the row are `timestamptz`, as every instant
 * in this database is (CLAUDE.md, "Dados de saúde").
 *
 * **The unique index on (patient, day) is the acceptance criterion.** "Um
 * check-in por paciente por dia (atualiza, não duplica)" is asked of the
 * database and not of a check in the code: the write is an `insert ... on
 * conflict do update`, so two requests arriving at the same instant produce
 * one row, and both callers are answered the one that holds.
 *
 * `recorded_at` is when the patient first saved the day and **never moves**;
 * `updated_at` moves with every correction. They are what tells a check-in
 * filled in at breakfast from one fixed at midnight, and keeping both is what
 * makes "editável no mesmo dia" visible from the outside. `created_at` is when
 * the row landed, as on every other table here — the same millisecond as
 * `recorded_at` today, and not the same fact.
 *
 * The scales are checked by the database as well as by the domain. Not
 * belt-and-braces: a seed, a migration or a fix applied by hand writes no row
 * this platform would have to show a professional as if the patient had
 * answered it.
 */
export const checkin = healthSchema.table(
  'checkin',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The patient, as `identity.profile.id` — ours and never the Supabase user
     * id.
     *
     * The foreign key crosses into `identity`'s schema, which is the one thing
     * that schema said these tables would do: "this profile is a patient",
     * written once, is what no join can fake. `cascade`, like the keys of that
     * schema: a profile that is erased takes its check-ins with it, because a
     * check-in of nobody is not health data anybody may keep.
     *
     * Crossing with a **key** is not crossing with a **query**: no statement in
     * this module reads a column of `identity` (CLAUDE.md rule 2). What the
     * module needs from there — who is calling, who may read a patient — it
     * asks that module's public services for.
     */
    patientProfileId: uuid('patient_profile_id')
      .notNull()
      .references(() => identityPatient.profileId, { onDelete: 'cascade' }),

    /** The day, in the patient's own zone. `YYYY-MM-DD`, no time, no offset. */
    date: date('date').notNull(),

    energy: smallint('energy').notNull(),

    /** What the patient *thought* of their night. The wearable's measure is another table. */
    sleepQuality: smallint('sleep_quality').notNull(),

    hunger: smallint('hunger').notNull(),

    /**
     * The symptoms, as an array of the enum: a set, and the whole set is
     * rewritten on every save.
     *
     * An array and not a side table, which is the one place this schema trades
     * normal form for the shape of the question: a check-in is read whole,
     * always, by the day — never "quais check-ins tiveram náusea" without also
     * reading the day. A join table would be one more write per save and one
     * more read per day, to answer nothing new.
     */
    symptoms: checkinSymptomEnum('symptoms').array().notNull().default([]),

    /**
     * What `other` was, in the patient's words. Health data: it stays in this
     * column and in the answer to the patient and to whoever may read them,
     * and it never reaches a log (CLAUDE.md, "Saúde e LGPD").
     */
    otherSymptom: text('other_symptom'),

    /** The free note. Health data, like everything else in this row. */
    note: text('note'),

    /**
     * When the check-in was first saved. Decided by the domain and not
     * defaulted here, as everywhere else in this codebase, so a seed and a
     * test land on the same instant — and it is what `on conflict do update`
     * deliberately leaves alone.
     */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),

    /** When it last changed. Equal to `recorded_at` until somebody corrects it. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One check-in per patient per day, asked of the database.
    uniqueIndex('checkin_patient_profile_id_date_idx').on(table.patientProfileId, table.date),

    // The scales, as the database reads them. The bounds are written into the
    // SQL and not interpolated as parameters, because a check constraint has
    // nowhere to bind one. The names show up in the migration and in whatever
    // a hand-written statement gets back.
    check('checkin_energy_scale', sql`${table.energy} between 1 and 5`),
    check('checkin_sleep_quality_scale', sql`${table.sleepQuality} between 1 and 5`),
    check('checkin_hunger_scale', sql`${table.hunger} between 1 and 5`),

    // `other_symptom` only means something next to the chip it details, and
    // the domain already drops it otherwise — this is the same rule where a
    // hand-written insert cannot miss it.
    check(
      'checkin_other_symptom_needs_other',
      sql`${table.otherSymptom} is null or 'other' = any(${table.symptoms})`,
    ),
  ],
);

/** Everything the module's repositories talk to, as Drizzle takes it. */
export const healthTables = { checkin };
