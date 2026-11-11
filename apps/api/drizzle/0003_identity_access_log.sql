CREATE TYPE "identity"."access_log_action" AS ENUM('view', 'export');--> statement-breakpoint
CREATE TYPE "identity"."access_log_resource" AS ENUM('patient_chart');--> statement-breakpoint
CREATE TABLE "identity"."access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_profile_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"resource" "identity"."access_log_resource" NOT NULL,
	"action" "identity"."access_log_action" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."access_log" ADD CONSTRAINT "access_log_actor_profile_id_profile_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "identity"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."access_log" ADD CONSTRAINT "access_log_patient_profile_id_patient_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "identity"."patient"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_patient_profile_id_occurred_at_id_idx" ON "identity"."access_log" USING btree ("patient_profile_id","occurred_at","id");