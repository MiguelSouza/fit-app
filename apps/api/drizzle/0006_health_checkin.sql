CREATE SCHEMA "health";
--> statement-breakpoint
CREATE TYPE "health"."checkin_symptom" AS ENUM('bloating', 'nausea', 'heartburn', 'constipation', 'diarrhea', 'headache', 'cramps', 'muscle_soreness', 'dizziness', 'other');--> statement-breakpoint
CREATE TABLE "health"."checkin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"date" date NOT NULL,
	"energy" smallint NOT NULL,
	"sleep_quality" smallint NOT NULL,
	"hunger" smallint NOT NULL,
	"symptoms" "health"."checkin_symptom"[] DEFAULT '{}' NOT NULL,
	"other_symptom" text,
	"note" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_energy_scale" CHECK ("health"."checkin"."energy" between 1 and 5),
	CONSTRAINT "checkin_sleep_quality_scale" CHECK ("health"."checkin"."sleep_quality" between 1 and 5),
	CONSTRAINT "checkin_hunger_scale" CHECK ("health"."checkin"."hunger" between 1 and 5),
	CONSTRAINT "checkin_other_symptom_needs_other" CHECK ("health"."checkin"."other_symptom" is null or 'other' = any("health"."checkin"."symptoms"))
);
--> statement-breakpoint
ALTER TABLE "health"."checkin" ADD CONSTRAINT "checkin_patient_profile_id_patient_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "identity"."patient"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkin_patient_profile_id_date_idx" ON "health"."checkin" USING btree ("patient_profile_id","date");