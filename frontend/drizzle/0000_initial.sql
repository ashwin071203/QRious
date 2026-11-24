CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendee_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attendee_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendee_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"salt" "bytea" NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "ck_recovery_codes_status" CHECK (status IN ('active','rotated','used','revoked'))
);
--> statement-breakpoint
CREATE TABLE "attendee_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendee_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"previous_token_hash" "bytea",
	"previous_token_valid_until" timestamp with time zone,
	"token_issued_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"client_kind" text DEFAULT 'web' NOT NULL,
	"user_agent_summary" text,
	CONSTRAINT "ck_attendee_sessions_reason" CHECK (revoked_reason IS NULL OR revoked_reason IN ('logout','user_revoked','admin','suspension','deletion','recovery','token_reuse'))
);
--> statement-breakpoint
CREATE TABLE "attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"last_active_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_attendees_status" CHECK (status IN ('active','suspended','deactivated','deleted'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"organization_id" uuid,
	"event_id" uuid,
	"ip_hash" "bytea",
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ck_audit_logs_actor" CHECK (actor_type IN ('attendee','organizer','admin','system','gateway'))
);
--> statement-breakpoint
CREATE TABLE "category_interest_suggestions" (
	"category_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"rank" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "category_interest_suggestions_category_id_interest_id_pk" PRIMARY KEY("category_id","interest_id")
);
--> statement-breakpoint
CREATE TABLE "category_skill_suggestions" (
	"category_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"rank" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "category_skill_suggestions_category_id_skill_id_pk" PRIMARY KEY("category_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "connection_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"actor_attendee_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_attendee_id" uuid NOT NULL,
	"addressee_attendee_id" uuid NOT NULL,
	"attendee_low_id" uuid NOT NULL,
	"attendee_high_id" uuid NOT NULL,
	"origin_event_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"intro_message" text,
	"requested_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "ck_connections_not_self" CHECK (requester_attendee_id <> addressee_attendee_id),
	CONSTRAINT "ck_connections_pair_order" CHECK (attendee_low_id < attendee_high_id),
	CONSTRAINT "ck_connections_status" CHECK (status IN ('pending','accepted','declined','withdrawn','removed'))
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"last_read_message_id" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"typing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_attendee_id_pk" PRIMARY KEY("conversation_id","attendee_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid,
	"attendee_low_id" uuid NOT NULL,
	"attendee_high_id" uuid NOT NULL,
	"origin_event_id" uuid NOT NULL,
	"last_message_id" integer,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_conversations_pair_order" CHECK (attendee_low_id < attendee_high_id)
);
--> statement-breakpoint
CREATE TABLE "event_activity_counters" (
	"event_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_activity_counters_event_id_bucket_start_kind_pk" PRIMARY KEY("event_id","bucket_start","kind"),
	CONSTRAINT "ck_activity_kind" CHECK (kind IN ('join','status_change','connection_accepted','message_sent'))
);
--> statement-breakpoint
CREATE TABLE "event_availability" (
	"participant_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open_to_conversations' NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_event_availability_status" CHECK (status IN ('available_now','open_to_conversations','meet_new_people','looking_for_collaborators','quick_conversations','temporarily_unavailable','discovery_paused')),
	CONSTRAINT "ck_event_availability_visibility" CHECK (visibility IN ('members','connections','hidden'))
);
--> statement-breakpoint
CREATE TABLE "event_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_intentions" (
	"event_id" uuid NOT NULL,
	"intention_id" uuid NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_intentions_event_id_intention_id_pk" PRIMARY KEY("event_id","intention_id")
);
--> statement-breakpoint
CREATE TABLE "event_networking_settings" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"discover_enabled" boolean DEFAULT true NOT NULL,
	"anonymous_browsing_enabled" boolean DEFAULT true NOT NULL,
	"smart_matching_enabled" boolean DEFAULT true NOT NULL,
	"pulse_enabled" boolean DEFAULT true NOT NULL,
	"connections_enabled" boolean DEFAULT true NOT NULL,
	"messaging_enabled" boolean DEFAULT true NOT NULL,
	"availability_enabled" boolean DEFAULT true NOT NULL,
	"premium_highlighting_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "event_participant_intentions" (
	"participant_id" uuid NOT NULL,
	"intention_id" uuid NOT NULL,
	CONSTRAINT "event_participant_intentions_participant_id_intention_id_pk" PRIMARY KEY("participant_id","intention_id")
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"discovery_paused" boolean DEFAULT false NOT NULL,
	"joined_via_qr_code_id" uuid,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removal_reason" text,
	"export_consent" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ck_event_participants_status" CHECK (status IN ('active','left','removed'))
);
--> statement-breakpoint
CREATE TABLE "event_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"public_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ck_event_qr_codes_status" CHECK (status IN ('active','revoked'))
);
--> statement-breakpoint
CREATE TABLE "event_suggested_interests" (
	"event_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_suggested_interests_event_id_interest_id_pk" PRIMARY KEY("event_id","interest_id")
);
--> statement-breakpoint
CREATE TABLE "event_suggested_skills" (
	"event_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_suggested_skills_event_id_skill_id_pk" PRIMARY KEY("event_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"banner_url" text,
	"banner_key" text,
	"venue_name" text NOT NULL,
	"venue_address" text,
	"city" text,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"website" text,
	"max_participants" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"moderation_status" text DEFAULT 'ok' NOT NULL,
	"qr_access_enabled" boolean DEFAULT true NOT NULL,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_events_time_order" CHECK (ends_at > starts_at),
	CONSTRAINT "ck_events_max_participants" CHECK (max_participants IS NULL OR max_participants > 0),
	CONSTRAINT "ck_events_participant_count" CHECK (participant_count >= 0),
	CONSTRAINT "ck_events_status" CHECK (status IN ('draft','published','active','networking_paused','ended','archived')),
	CONSTRAINT "ck_events_moderation" CHECK (moderation_status IN ('ok','suspended'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"attendee_id" uuid,
	"session_id" uuid,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_idempotency_keys" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "interest_aliases" (
	"alias_normalized" text PRIMARY KEY NOT NULL,
	"interest_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"merged_into_id" uuid,
	"group_name" text,
	"created_by_attendee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_interests_status" CHECK (status IN ('approved','pending','rejected','merged'))
);
--> statement-breakpoint
CREATE TABLE "match_dismissals" (
	"attendee_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"dismissed_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_dismissals_attendee_id_event_id_dismissed_profile_id_pk" PRIMARY KEY("attendee_id","event_id","dismissed_profile_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_attendee_id" uuid NOT NULL,
	"client_message_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_messages_body" CHECK (length(btrim(body)) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "networking_intentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"pulse_group" text DEFAULT 'other' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_networking_intentions_group" CHECK (pulse_group IN ('collaboration','social','professional','creative','other'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"attendee_id" uuid PRIMARY KEY NOT NULL,
	"connection_requests" boolean DEFAULT true NOT NULL,
	"connection_accepted" boolean DEFAULT true NOT NULL,
	"messages" boolean DEFAULT true NOT NULL,
	"event_updates" boolean DEFAULT true NOT NULL,
	"billing" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"event_id" uuid,
	"actor_profile_id" uuid,
	"entity_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "ck_notifications_type" CHECK (type IN ('connection_request','connection_accepted','message','event_update','system','billing'))
);
--> statement-breakpoint
CREATE TABLE "organization_entitlements" (
	"organization_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"limit_value" integer,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	CONSTRAINT "organization_entitlements_organization_id_feature_key_source_type_source_id_pk" PRIMARY KEY("organization_id","feature_key","source_type","source_id"),
	CONSTRAINT "ck_oe_source" CHECK (source_type IN ('plan','subscription','promo','event_purchase'))
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"organizer_user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_organizer_user_id_pk" PRIMARY KEY("organization_id","organizer_user_id"),
	CONSTRAINT "ck_organization_members_role" CHECK (role IN ('owner','member'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"logo_url" text,
	"logo_key" text,
	"contact_email" text,
	"contact_phone" text,
	"website" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_organizations_status" CHECK (status IN ('active','suspended'))
);
--> statement-breakpoint
CREATE TABLE "organizer_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"salt" "bytea" NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent_summary" text
);
--> statement-breakpoint
CREATE TABLE "organizer_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_organizer_users_status" CHECK (status IN ('active','suspended'))
);
--> statement-breakpoint
CREATE TABLE "payment_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway" text DEFAULT 'razorpay' NOT NULL,
	"gateway_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid,
	"payer_type" text NOT NULL,
	"attendee_id" uuid,
	"organization_id" uuid,
	"gateway" text DEFAULT 'razorpay' NOT NULL,
	"gateway_order_id" text,
	"gateway_payment_id" text,
	"amount_minor" integer NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"method" text,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_payments_status" CHECK (status IN ('created','authorized','captured','failed','refunded','partially_refunded')),
	CONSTRAINT "ck_payments_amounts" CHECK (amount_minor >= 0 AND refunded_minor >= 0 AND refunded_minor <= amount_minor)
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_interests" (
	"profile_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_interests_profile_id_interest_id_pk" PRIMARY KEY("profile_id","interest_id")
);
--> statement-breakpoint
CREATE TABLE "profile_looking_for_skills" (
	"profile_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "profile_looking_for_skills_profile_id_skill_id_pk" PRIMARY KEY("profile_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "profile_skills" (
	"profile_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_skills_profile_id_skill_id_pk" PRIMARY KEY("profile_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "promotional_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_type" text NOT NULL,
	"attendee_id" uuid,
	"organization_id" uuid,
	"plan_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"reason" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "ck_promo_period" CHECK (ends_at > starts_at)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "saved_profiles" (
	"attendee_id" uuid NOT NULL,
	"saved_profile_id" uuid NOT NULL,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_profiles_attendee_id_saved_profile_id_pk" PRIMARY KEY("attendee_id","saved_profile_id")
);
--> statement-breakpoint
CREATE TABLE "skill_aliases" (
	"alias_normalized" text PRIMARY KEY NOT NULL,
	"skill_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"merged_into_id" uuid,
	"group_name" text,
	"created_by_attendee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_skills_status" CHECK (status IN ('approved','pending','rejected','merged'))
);
--> statement-breakpoint
CREATE TABLE "social_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_social_links_https" CHECK (url ~ '^https://'),
	CONSTRAINT "ck_social_links_platform" CHECK (platform IN ('instagram','linkedin','x','github','behance','dribbble','youtube','spotify','soundcloud','website','portfolio','other')),
	CONSTRAINT "ck_social_links_visibility" CHECK (visibility IN ('public','members','connections'))
);
--> statement-breakpoint
CREATE TABLE "subscription_features" (
	"plan_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"limit_value" integer,
	CONSTRAINT "subscription_features_plan_id_feature_key_pk" PRIMARY KEY("plan_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text NOT NULL,
	"subscription_id" uuid,
	"payment_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"issued_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"audience" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"billing_period" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"gateway_plan_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_plans_price" CHECK (price_minor >= 0),
	CONSTRAINT "ck_plans_audience" CHECK (audience IN ('attendee','organization')),
	CONSTRAINT "ck_plans_period" CHECK (billing_period IN ('none','month','year','one_time'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"subscriber_type" text NOT NULL,
	"attendee_id" uuid,
	"organization_id" uuid,
	"status" text DEFAULT 'created' NOT NULL,
	"gateway" text DEFAULT 'razorpay' NOT NULL,
	"gateway_subscription_id" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_subscriptions_status" CHECK (status IN ('created','authenticated','active','pending','halted','cancelled','completed','expired')),
	CONSTRAINT "ck_subscriptions_subscriber" CHECK ((subscriber_type = 'attendee' AND attendee_id IS NOT NULL AND organization_id IS NULL) OR (subscriber_type = 'organization' AND organization_id IS NOT NULL AND attendee_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_attendee_id" uuid NOT NULL,
	"blocked_attendee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_attendee_id_blocked_attendee_id_pk" PRIMARY KEY("blocker_attendee_id","blocked_attendee_id"),
	CONSTRAINT "ck_user_blocks_not_self" CHECK (blocker_attendee_id <> blocked_attendee_id)
);
--> statement-breakpoint
CREATE TABLE "user_entitlements" (
	"attendee_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"limit_value" integer,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	CONSTRAINT "user_entitlements_attendee_id_feature_key_source_type_source_id_pk" PRIMARY KEY("attendee_id","feature_key","source_type","source_id"),
	CONSTRAINT "ck_ue_source" CHECK (source_type IN ('plan','subscription','promo','event_purchase'))
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendee_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"username" text NOT NULL,
	"username_normalized" text NOT NULL,
	"username_changed_at" timestamp with time zone,
	"bio" text,
	"profession" text,
	"profession_normalized" text,
	"company" text,
	"location" text,
	"looking_for_text" text,
	"can_offer_text" text,
	"photo_key" text,
	"photo_url" text,
	"thumb_url" text,
	"photo_updated_at" timestamp with time zone,
	"is_public" boolean DEFAULT true NOT NULL,
	"anonymous_visibility_consented_at" timestamp with time zone,
	"company_visibility" text DEFAULT 'members' NOT NULL,
	"location_visibility" text DEFAULT 'members' NOT NULL,
	"show_saved_me" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_user_profiles_display_name" CHECK (length(btrim(display_name)) BETWEEN 1 AND 60),
	CONSTRAINT "ck_user_profiles_username_format" CHECK (username_normalized ~ '^[a-z0-9]([a-z0-9_]|\.(?!\.)){1,28}[a-z0-9_]$'),
	CONSTRAINT "ck_user_profiles_company_visibility" CHECK (company_visibility IN ('public','members','connections')),
	CONSTRAINT "ck_user_profiles_location_visibility" CHECK (location_visibility IN ('public','members','connections'))
);
--> statement-breakpoint
CREATE TABLE "user_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_attendee_id" uuid,
	"reported_attendee_id" uuid NOT NULL,
	"event_id" uuid,
	"message_id" integer,
	"message_excerpt" text,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"resolved_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "ck_user_reports_reason" CHECK (reason IN ('spam','harassment','inappropriate_content','fake_profile','underage','other')),
	CONSTRAINT "ck_user_reports_status" CHECK (status IN ('open','in_review','actioned','dismissed'))
);
--> statement-breakpoint
CREATE TABLE "username_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"username_normalized" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"reserved_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendee_recovery_codes" ADD CONSTRAINT "attendee_recovery_codes_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendee_sessions" ADD CONSTRAINT "attendee_sessions_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_interest_suggestions" ADD CONSTRAINT "category_interest_suggestions_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_interest_suggestions" ADD CONSTRAINT "category_interest_suggestions_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_skill_suggestions" ADD CONSTRAINT "category_skill_suggestions_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_skill_suggestions" ADD CONSTRAINT "category_skill_suggestions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_history" ADD CONSTRAINT "connection_history_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_requester_attendee_id_attendees_id_fk" FOREIGN KEY ("requester_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_addressee_attendee_id_attendees_id_fk" FOREIGN KEY ("addressee_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_origin_event_id_events_id_fk" FOREIGN KEY ("origin_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_origin_event_id_events_id_fk" FOREIGN KEY ("origin_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_activity_counters" ADD CONSTRAINT "event_activity_counters_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_availability" ADD CONSTRAINT "event_availability_participant_id_event_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."event_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_intentions" ADD CONSTRAINT "event_intentions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_intentions" ADD CONSTRAINT "event_intentions_intention_id_networking_intentions_id_fk" FOREIGN KEY ("intention_id") REFERENCES "public"."networking_intentions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_networking_settings" ADD CONSTRAINT "event_networking_settings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participant_intentions" ADD CONSTRAINT "event_participant_intentions_participant_id_event_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."event_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participant_intentions" ADD CONSTRAINT "event_participant_intentions_intention_id_networking_intentions_id_fk" FOREIGN KEY ("intention_id") REFERENCES "public"."networking_intentions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_joined_via_qr_code_id_event_qr_codes_id_fk" FOREIGN KEY ("joined_via_qr_code_id") REFERENCES "public"."event_qr_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_removed_by_organizer_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."organizer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_purchases" ADD CONSTRAINT "event_purchases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_purchases" ADD CONSTRAINT "event_purchases_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_purchases" ADD CONSTRAINT "event_purchases_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_qr_codes" ADD CONSTRAINT "event_qr_codes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_qr_codes" ADD CONSTRAINT "event_qr_codes_created_by_organizer_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."organizer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_qr_codes" ADD CONSTRAINT "event_qr_codes_revoked_by_organizer_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."organizer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_suggested_interests" ADD CONSTRAINT "event_suggested_interests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_suggested_interests" ADD CONSTRAINT "event_suggested_interests_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_suggested_skills" ADD CONSTRAINT "event_suggested_skills_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_suggested_skills" ADD CONSTRAINT "event_suggested_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_organizer_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."organizer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_aliases" ADD CONSTRAINT "interest_aliases_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_created_by_attendee_id_attendees_id_fk" FOREIGN KEY ("created_by_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_dismissals" ADD CONSTRAINT "match_dismissals_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_dismissals" ADD CONSTRAINT "match_dismissals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_dismissals" ADD CONSTRAINT "match_dismissals_dismissed_profile_id_user_profiles_id_fk" FOREIGN KEY ("dismissed_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_attendee_id_attendees_id_fk" FOREIGN KEY ("sender_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "networking_intentions" ADD CONSTRAINT "networking_intentions_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_profile_id_user_profiles_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_entitlements" ADD CONSTRAINT "organization_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizer_user_id_organizer_users_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."organizer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_organizer_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."organizer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_recovery_codes" ADD CONSTRAINT "organizer_recovery_codes_user_id_organizer_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."organizer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_sessions" ADD CONSTRAINT "organizer_sessions_user_id_organizer_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."organizer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_looking_for_skills" ADD CONSTRAINT "profile_looking_for_skills_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_looking_for_skills" ADD CONSTRAINT "profile_looking_for_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotional_access" ADD CONSTRAINT "promotional_access_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotional_access" ADD CONSTRAINT "promotional_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotional_access" ADD CONSTRAINT "promotional_access_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotional_access" ADD CONSTRAINT "promotional_access_granted_by_organizer_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."organizer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_profiles" ADD CONSTRAINT "saved_profiles_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_profiles" ADD CONSTRAINT "saved_profiles_saved_profile_id_user_profiles_id_fk" FOREIGN KEY ("saved_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_profiles" ADD CONSTRAINT "saved_profiles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_aliases" ADD CONSTRAINT "skill_aliases_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_created_by_attendee_id_attendees_id_fk" FOREIGN KEY ("created_by_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_links" ADD CONSTRAINT "social_links_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_features" ADD CONSTRAINT "subscription_features_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_attendee_id_attendees_id_fk" FOREIGN KEY ("blocker_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_attendee_id_attendees_id_fk" FOREIGN KEY ("blocked_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reporter_attendee_id_attendees_id_fk" FOREIGN KEY ("reporter_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reported_attendee_id_attendees_id_fk" FOREIGN KEY ("reported_attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "username_history" ADD CONSTRAINT "username_history_profile_id_user_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_deletion_pending" ON "account_deletion_requests" USING btree ("scheduled_for") WHERE completed_at IS NULL AND cancelled_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_recovery_codes_one_active" ON "attendee_recovery_codes" USING btree ("attendee_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "ux_attendee_sessions_token" ON "attendee_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_attendee_sessions_prev_token" ON "attendee_sessions" USING btree ("previous_token_hash");--> statement-breakpoint
CREATE INDEX "ix_attendee_sessions_active" ON "attendee_sessions" USING btree ("attendee_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "ix_audit_logs_org" ON "audit_logs" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_target" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ix_audit_logs_time" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_connections_live_pair" ON "connections" USING btree ("attendee_low_id","attendee_high_id") WHERE status IN ('pending','accepted');--> statement-breakpoint
CREATE INDEX "ix_connections_addressee" ON "connections" USING btree ("addressee_attendee_id","status");--> statement-breakpoint
CREATE INDEX "ix_connections_requester" ON "connections" USING btree ("requester_attendee_id","status");--> statement-breakpoint
CREATE INDEX "ix_conversation_members_attendee" ON "conversation_members" USING btree ("attendee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_conversations_pair" ON "conversations" USING btree ("attendee_low_id","attendee_high_id");--> statement-breakpoint
CREATE INDEX "ix_event_availability_status" ON "event_availability" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_event_categories_slug" ON "event_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_event_participants_pair" ON "event_participants" USING btree ("event_id","attendee_id");--> statement-breakpoint
CREATE INDEX "ix_event_participants_attendee" ON "event_participants" USING btree ("attendee_id","status");--> statement-breakpoint
CREATE INDEX "ix_event_participants_discoverable" ON "event_participants" USING btree ("event_id","status") WHERE discovery_paused = false;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_event_purchases_paid" ON "event_purchases" USING btree ("event_id","plan_id") WHERE status = 'paid';--> statement-breakpoint
CREATE UNIQUE INDEX "ux_event_qr_codes_code" ON "event_qr_codes" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_event_qr_codes_one_active" ON "event_qr_codes" USING btree ("event_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "ix_events_org_status" ON "events" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ix_events_status_starts" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_interests_normalized" ON "interests" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "ix_interests_name_trgm" ON "interests" USING gin (normalized_name gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_messages_client_id" ON "messages" USING btree ("conversation_id","client_message_id");--> statement-breakpoint
CREATE INDEX "ix_messages_conversation" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "ix_moderation_target" ON "moderation_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_networking_intentions_slug" ON "networking_intentions" USING btree (coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),"slug");--> statement-breakpoint
CREATE INDEX "ix_notifications_attendee" ON "notifications" USING btree ("attendee_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_notifications_unread" ON "notifications" USING btree ("attendee_id") WHERE read_at IS NULL;--> statement-breakpoint
CREATE INDEX "ix_organization_members_user" ON "organization_members" USING btree ("organizer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_organizations_slug" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_organizer_recovery_one_active" ON "organizer_recovery_codes" USING btree ("user_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "ux_organizer_sessions_token" ON "organizer_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_organizer_sessions_user" ON "organizer_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_organizer_users_email" ON "organizer_users" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payment_webhooks_event" ON "payment_webhooks" USING btree ("gateway_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payments_order" ON "payments" USING btree ("gateway_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payments_payment" ON "payments" USING btree ("gateway_payment_id");--> statement-breakpoint
CREATE INDEX "ix_profile_interests_interest" ON "profile_interests" USING btree ("interest_id");--> statement-breakpoint
CREATE INDEX "ix_profile_skills_skill" ON "profile_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "ix_rate_limit_window" ON "rate_limit_counters" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "ix_saved_profiles_saved" ON "saved_profiles" USING btree ("saved_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_skills_normalized" ON "skills" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "ix_skills_name_trgm" ON "skills" USING gin (normalized_name gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_social_links_url" ON "social_links" USING btree ("profile_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_invoices_number" ON "subscription_invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_subscription_plans_code" ON "subscription_plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_subscriptions_gateway_id" ON "subscriptions" USING btree ("gateway_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_subscriptions_attendee_live" ON "subscriptions" USING btree ("attendee_id") WHERE attendee_id IS NOT NULL AND status IN ('created','authenticated','active','pending');--> statement-breakpoint
CREATE UNIQUE INDEX "ux_subscriptions_org_live" ON "subscriptions" USING btree ("organization_id") WHERE organization_id IS NOT NULL AND status IN ('created','authenticated','active','pending');--> statement-breakpoint
CREATE INDEX "ix_user_blocks_blocked" ON "user_blocks" USING btree ("blocked_attendee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_user_profiles_attendee" ON "user_profiles" USING btree ("attendee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_user_profiles_username" ON "user_profiles" USING btree ("username_normalized");--> statement-breakpoint
CREATE INDEX "ix_user_profiles_display_name_trgm" ON "user_profiles" USING gin (lower(display_name) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_user_profiles_username_trgm" ON "user_profiles" USING gin (username_normalized gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_user_profiles_profession" ON "user_profiles" USING btree ("profession_normalized");--> statement-breakpoint
CREATE INDEX "ix_user_reports_status" ON "user_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ix_user_reports_event" ON "user_reports" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "ix_username_history_name" ON "username_history" USING btree ("username_normalized","reserved_until");