CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TYPE "identity"."organization_kind" AS ENUM('solo', 'clinic');--> statement-breakpoint
CREATE TYPE "identity"."organization_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "identity"."person_role" AS ENUM('professional', 'patient');--> statement-breakpoint
CREATE TYPE "identity"."professional_type" AS ENUM('nutritionist', 'trainer');--> statement-breakpoint
CREATE TABLE "identity"."organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "identity"."organization_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."organization_member" (
	"organization_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"role" "identity"."organization_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_organization_id_profile_id_pk" PRIMARY KEY("organization_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."professional" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"professional_type" "identity"."professional_type" DEFAULT 'nutritionist' NOT NULL,
	"council_number" text NOT NULL,
	"specialty" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"role" "identity"."person_role" NOT NULL,
	"full_name" text NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "identity"."organization_member" ADD CONSTRAINT "organization_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."organization_member" ADD CONSTRAINT "organization_member_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "identity"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."professional" ADD CONSTRAINT "professional_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "identity"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_member_profile_id_idx" ON "identity"."organization_member" USING btree ("profile_id");