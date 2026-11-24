ALTER TABLE "organizer_sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizer_users" ADD COLUMN "totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "organizer_users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizer_users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "organizer_users" ADD COLUMN "totp_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizer_users" ADD COLUMN "totp_locked_until" timestamp with time zone;