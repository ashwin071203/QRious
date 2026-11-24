CREATE TABLE "notification_settings" (
	"recipient_type" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"category" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_recipient_type_recipient_id_category_pk" PRIMARY KEY("recipient_type","recipient_id","category"),
	CONSTRAINT "ck_notification_settings_recipient" CHECK (recipient_type IN ('attendee','organizer')),
	CONSTRAINT "ck_notification_settings_category" CHECK (category IN ('messages','groups','connections','events','matches','billing','account','security','announcements','org_participants','org_events','org_engagement','org_billing','organization'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_type" text NOT NULL,
	"attendee_id" uuid,
	"organizer_user_id" uuid,
	"attendee_session_id" uuid,
	"organizer_session_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent_summary" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_push_subscriptions_recipient" CHECK ((recipient_type = 'attendee' AND attendee_id IS NOT NULL AND attendee_session_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (recipient_type = 'organizer' AND organizer_user_id IS NOT NULL AND organizer_session_id IS NOT NULL AND attendee_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "ck_notifications_type";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "attendee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "organizer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "category" text DEFAULT 'account' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organizer_user_id_organizer_users_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."organizer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_attendee_session_id_attendee_sessions_id_fk" FOREIGN KEY ("attendee_session_id") REFERENCES "public"."attendee_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organizer_session_id_organizer_sessions_id_fk" FOREIGN KEY ("organizer_session_id") REFERENCES "public"."organizer_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_push_subscriptions_endpoint" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "ix_push_subscriptions_attendee" ON "push_subscriptions" USING btree ("attendee_id");--> statement-breakpoint
CREATE INDEX "ix_push_subscriptions_organizer" ON "push_subscriptions" USING btree ("organizer_user_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizer_user_id_organizer_users_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."organizer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_notifications_organizer" ON "notifications" USING btree ("organizer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_notifications_push_pending" ON "notifications" USING btree ("created_at") WHERE push_status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "ux_notifications_attendee_dedupe" ON "notifications" USING btree ("attendee_id","dedupe_key") WHERE attendee_id IS NOT NULL AND dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_notifications_organizer_dedupe" ON "notifications" USING btree ("organizer_user_id","dedupe_key") WHERE organizer_user_id IS NOT NULL AND dedupe_key IS NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_recipient" CHECK ((attendee_id IS NOT NULL) <> (organizer_user_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_category" CHECK (category IN ('messages','groups','connections','events','matches','billing','account','security','announcements','org_participants','org_events','org_engagement','org_billing','organization'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "ck_notifications_push_status" CHECK (push_status IN ('none','pending','sending','sent','skipped'));--> statement-breakpoint
-- Backfill existing attendee notifications into the new shape.
UPDATE "notifications" SET
  "category" = CASE
    WHEN "type" = 'message' AND coalesce(("payload"->>'group')::boolean, false) THEN 'groups'
    WHEN "type" = 'message' THEN 'messages'
    WHEN "type" IN ('connection_request','connection_accepted') THEN 'connections'
    WHEN "type" = 'event_update' THEN 'events'
    WHEN "type" = 'billing' THEN 'billing'
    WHEN "payload"->>'kind' = 'account_recovered' THEN 'security'
    ELSE 'account' END,
  "title" = coalesce("payload"->>'message', ''),
  "body" = "payload"->>'preview',
  "link" = CASE
    WHEN "type" = 'message' AND "entity_id" IS NOT NULL THEN '/app/messages/' || "entity_id"
    WHEN "type" IN ('connection_request','connection_accepted') THEN '/app/connections'
    WHEN "type" = 'event_update' AND "event_id" IS NOT NULL THEN '/app/events/' || "event_id" || '/home'
    WHEN "type" = 'billing' THEN '/app/premium'
    ELSE NULL END,
  "dedupe_key" = CASE WHEN "type" = 'message' AND "entity_id" IS NOT NULL AND "read_at" IS NULL THEN 'conv:' || "entity_id" ELSE NULL END;
--> statement-breakpoint
-- Carry over attendee preferences (old booleans → per-category in-app + push).
INSERT INTO "notification_settings" ("recipient_type", "recipient_id", "category", "in_app", "push")
SELECT 'attendee', p."attendee_id", x.category, x.enabled, x.enabled FROM "notification_preferences" p
CROSS JOIN LATERAL (VALUES ('messages', p."messages"), ('groups', p."messages"), ('connections', p."connection_requests" OR p."connection_accepted"),
  ('events', p."event_updates"), ('billing', p."billing")) AS x(category, enabled)
WHERE x.enabled = false
ON CONFLICT DO NOTHING;
