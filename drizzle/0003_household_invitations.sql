CREATE TABLE "household_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" text,
	CONSTRAINT "household_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "household_invitations_tenant_id" UNIQUE("household_id","id"),
	CONSTRAINT "household_invitations_acceptance_paired" CHECK (("household_invitations"."accepted_at" IS NULL) = ("household_invitations"."accepted_by_user_id" IS NULL)),
	CONSTRAINT "household_invitations_hash_valid" CHECK ("household_invitations"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "household_invitations_version_positive" CHECK ("household_invitations"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_creator_tenant_fk" FOREIGN KEY ("household_id","created_by_member_id") REFERENCES "public"."household_members"("household_id","id") ON DELETE restrict ON UPDATE no action;