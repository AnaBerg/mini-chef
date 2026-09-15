CREATE TABLE "household_creation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"household_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_creation_requests_user_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "household_creation_requests_hash_valid" CHECK ("household_creation_requests"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "household_creation_requests" ADD CONSTRAINT "household_creation_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_creation_requests" ADD CONSTRAINT "household_creation_requests_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_household_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.timezone ~* '^(posix|right)/'
     OR NOT (NEW.timezone = 'UTC' OR NEW.timezone ~ '^[A-Za-z_]+/[A-Za-z0-9_+/-]+$')
     OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unsupported household timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
