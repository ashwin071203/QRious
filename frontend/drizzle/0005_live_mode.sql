ALTER TABLE "payment_webhooks" ADD COLUMN "gateway_mode" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "gateway_mode" text;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "gateway_plan_mode" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "gateway_mode" text;--> statement-breakpoint
-- Before this migration the app refused live keys (payments could only run in TEST mode), so every existing
-- gateway record is a test-mode record. New rows record the mode they were created in.
UPDATE "subscription_plans" SET "gateway_plan_mode" = 'test' WHERE "gateway_plan_id" IS NOT NULL;--> statement-breakpoint
UPDATE "subscriptions" SET "gateway_mode" = 'test' WHERE "gateway_subscription_id" IS NOT NULL;--> statement-breakpoint
UPDATE "payments" SET "gateway_mode" = 'test' WHERE "gateway_order_id" IS NOT NULL OR "gateway_payment_id" IS NOT NULL OR "subscription_id" IS NOT NULL;--> statement-breakpoint
UPDATE "payment_webhooks" SET "gateway_mode" = 'test';--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "ck_plans_gateway_mode" CHECK ("gateway_plan_mode" IS NULL OR "gateway_plan_mode" IN ('test','live'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "ck_subscriptions_gateway_mode" CHECK ("gateway_mode" IS NULL OR "gateway_mode" IN ('test','live'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "ck_payments_gateway_mode" CHECK ("gateway_mode" IS NULL OR "gateway_mode" IN ('test','live'));
