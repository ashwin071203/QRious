CREATE TABLE "organization_event_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"payment_id" uuid,
	"granted_by" uuid,
	"reason" text,
	"consumed_at" timestamp with time zone,
	"consumed_event_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_event_credits_source" CHECK (source IN ('purchase','promo'))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "allowance_source" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "events_created_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "purpose" text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_event_credits" ADD CONSTRAINT "organization_event_credits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_credits" ADD CONSTRAINT "organization_event_credits_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_credits" ADD CONSTRAINT "organization_event_credits_granted_by_organizer_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."organizer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_event_credits" ADD CONSTRAINT "organization_event_credits_consumed_event_id_events_id_fk" FOREIGN KEY ("consumed_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_event_credits_payment" ON "organization_event_credits" USING btree ("payment_id") WHERE payment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_event_credits_org_available" ON "organization_event_credits" USING btree ("organization_id") WHERE consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_payments_org" ON "payments" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "ck_events_allowance_source" CHECK (allowance_source IS NULL OR allowance_source IN ('free','plan','credit'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "ck_organizations_events_created" CHECK (events_created_count >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_purpose" CHECK (purpose IN ('subscription','event_credit'));--> statement-breakpoint
-- Backfill: events that already exist count against each organization's lifetime allowance.
UPDATE "organizations" o SET "events_created_count" = (SELECT count(*) FROM "events" e WHERE e."organization_id" = o."id");
