CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"operation_id" uuid,
	"actor_member_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_tenant_id" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "domain_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"actor_member_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_operations_tenant_id" UNIQUE("household_id","id"),
	CONSTRAINT "domain_operations_tenant_key" UNIQUE("household_id","idempotency_key"),
	CONSTRAINT "domain_operations_key_nonempty" CHECK (length(btrim("domain_operations"."idempotency_key")) BETWEEN 1 AND 200),
	CONSTRAINT "domain_operations_kind_nonempty" CHECK (length(btrim("domain_operations"."kind")) BETWEEN 1 AND 100),
	CONSTRAINT "domain_operations_hash_valid" CHECK ("domain_operations"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_tenant_id" UNIQUE("household_id","id"),
	CONSTRAINT "household_members_tenant_user" UNIQUE("household_id","user_id"),
	CONSTRAINT "household_members_status_valid" CHECK ("household_members"."status" IN ('active', 'inactive')),
	CONSTRAINT "household_members_version_positive" CHECK ("household_members"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	CONSTRAINT "households_name_nonempty" CHECK (length(btrim("households"."name")) > 0),
	CONSTRAINT "households_version_positive" CHECK ("households"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "shopping_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"household_id" uuid NOT NULL,
	"include_planned_meals" boolean NOT NULL,
	"planning_horizon_days" integer DEFAULT 7 NOT NULL,
	CONSTRAINT "shopping_settings_household_unique" UNIQUE("household_id"),
	CONSTRAINT "shopping_settings_tenant_id" UNIQUE("household_id","id"),
	CONSTRAINT "shopping_settings_horizon_positive" CHECK ("shopping_settings"."planning_horizon_days" > 0),
	CONSTRAINT "shopping_settings_version_positive" CHECK ("shopping_settings"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_tenant_fk" FOREIGN KEY ("household_id","actor_member_id") REFERENCES "public"."household_members"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_operation_tenant_fk" FOREIGN KEY ("household_id","operation_id") REFERENCES "public"."domain_operations"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_operations" ADD CONSTRAINT "domain_operations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_operations" ADD CONSTRAINT "domain_operations_actor_tenant_fk" FOREIGN KEY ("household_id","actor_member_id") REFERENCES "public"."household_members"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_settings" ADD CONSTRAINT "shopping_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_household_occurred_idx" ON "audit_events" USING btree ("household_id","occurred_at");--> statement-breakpoint
CREATE INDEX "household_members_user_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
-- A CHECK cannot query pg_timezone_names. Validate the supported names with a trigger.
CREATE FUNCTION validate_household_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (NEW.timezone = 'UTC' OR NEW.timezone ~ '^[A-Za-z_]+/[A-Za-z0-9_+/-]+$')
     OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unsupported household timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER households_timezone_valid BEFORE INSERT OR UPDATE OF timezone ON households
FOR EACH ROW EXECUTE FUNCTION validate_household_timezone();
