CREATE TYPE "identity"."consent_type" AS ENUM('health_data', 'share_with_professional', 'wearable_data', 'ai_processing');--> statement-breakpoint
CREATE TABLE "identity"."care_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"type" "identity"."consent_type" NOT NULL,
	"terms_version" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."patient" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."care_relationship" ADD CONSTRAINT "care_relationship_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."care_relationship" ADD CONSTRAINT "care_relationship_patient_profile_id_patient_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "identity"."patient"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."care_relationship" ADD CONSTRAINT "care_relationship_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "identity"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."consent" ADD CONSTRAINT "consent_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "identity"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."patient" ADD CONSTRAINT "patient_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "identity"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "care_relationship_organization_id_patient_profile_id_idx" ON "identity"."care_relationship" USING btree ("organization_id","patient_profile_id");--> statement-breakpoint
CREATE INDEX "care_relationship_patient_profile_id_idx" ON "identity"."care_relationship" USING btree ("patient_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_profile_id_type_in_force_idx" ON "identity"."consent" USING btree ("profile_id","type") WHERE "identity"."consent"."revoked_at" is null;