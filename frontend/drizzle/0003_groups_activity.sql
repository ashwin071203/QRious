ALTER TABLE "conversations" ALTER COLUMN "attendee_low_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "attendee_high_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "origin_event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "joined_after_message_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "kind" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "show_activity_status" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_attendees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."attendees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "ck_conversation_members_role" CHECK (role IN ('admin','member'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "ck_conversations_kind" CHECK (kind IN ('direct','group'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "ck_conversations_shape" CHECK ((kind = 'direct' AND attendee_low_id IS NOT NULL AND attendee_high_id IS NOT NULL AND origin_event_id IS NOT NULL)
    OR (kind = 'group' AND attendee_low_id IS NULL AND attendee_high_id IS NULL AND name IS NOT NULL));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "ck_messages_kind" CHECK (kind IN ('user','system'));