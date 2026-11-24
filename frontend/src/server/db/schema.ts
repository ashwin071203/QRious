/**
 * QRious database schema (PostgreSQL 16). Source of truth: docs/04-database-schema.md.
 * Conventions: snake_case, uuid PKs, timestamptz (UTC), text enums guarded by CHECK constraints,
 * partial unique indexes for the business invariants.
 */
import { sql } from "drizzle-orm";
import {
  bigint, bigserial, boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const inList = (col: string, values: readonly string[], nullable = false) =>
  sql.raw(`${nullable ? `${col} IS NULL OR ` : ""}${col} IN (${values.map((v) => `'${v}'`).join(",")})`);

// ---------- Enumerations (stored as text) ----------
export const ATTENDEE_STATUS = ["active", "suspended", "deactivated", "deleted"] as const;
export const SESSION_REVOKED = ["logout", "user_revoked", "admin", "suspension", "deletion", "recovery", "token_reuse"] as const;
export const RECOVERY_STATUS = ["active", "rotated", "used", "revoked"] as const;
export const VISIBILITY = ["public", "members", "connections"] as const;
export const SOCIAL_PLATFORMS = ["instagram", "linkedin", "x", "github", "behance", "dribbble", "youtube", "spotify", "soundcloud", "website", "portfolio", "other"] as const;
export const TAG_STATUS = ["approved", "pending", "rejected", "merged"] as const;
export const PULSE_GROUP = ["collaboration", "social", "professional", "creative", "other"] as const;
export const ORG_ROLE = ["owner", "member"] as const;
export const ACTIVE_SUSPENDED = ["active", "suspended"] as const;
export const EVENT_STATUS = ["draft", "published", "active", "networking_paused", "ended", "archived"] as const;
export const MODERATION_STATUS = ["ok", "suspended"] as const;
export const QR_STATUS = ["active", "revoked"] as const;
export const PARTICIPANT_STATUS = ["active", "left", "removed"] as const;
export const AVAILABILITY = ["available_now", "open_to_conversations", "meet_new_people", "looking_for_collaborators", "quick_conversations", "temporarily_unavailable", "discovery_paused"] as const;
export const AVAILABILITY_VISIBILITY = ["members", "connections", "hidden"] as const;
export const ACTIVITY_KIND = ["join", "status_change", "connection_accepted", "message_sent"] as const;
export const CONNECTION_STATUS = ["pending", "accepted", "declined", "withdrawn", "removed"] as const;
export const NOTIFICATION_TYPE = ["connection_request", "connection_accepted", "message", "event_update", "system", "billing"] as const;
/** Notification categories (preferences are per category). Attendee and organizer categories share one table. */
export const NOTIFICATION_CATEGORY = ["messages", "groups", "connections", "events", "matches", "billing", "account", "security", "announcements",
  "org_participants", "org_events", "org_engagement", "org_billing", "organization"] as const;
export const RECIPIENT_TYPE = ["attendee", "organizer"] as const;
export const REPORT_REASON = ["spam", "harassment", "inappropriate_content", "fake_profile", "underage", "other"] as const;
export const REPORT_STATUS = ["open", "in_review", "actioned", "dismissed"] as const;
export const ACTOR_TYPE = ["attendee", "organizer", "admin", "system", "gateway"] as const;
export const PLAN_AUDIENCE = ["attendee", "organization"] as const;
export const BILLING_PERIOD = ["none", "month", "year", "one_time"] as const;
export const SUBSCRIPTION_STATUS = ["created", "authenticated", "active", "pending", "halted", "cancelled", "completed", "expired"] as const;
export const PAYMENT_STATUS = ["created", "authorized", "captured", "failed", "refunded", "partially_refunded"] as const;
export const ENTITLEMENT_SOURCE = ["plan", "subscription", "promo", "event_purchase"] as const;

// ---------- Identity ----------
export const attendees = pgTable("attendees", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("active"),
  suspendedReason: text("suspended_reason"),
  lastActiveAt: ts("last_active_at"),
  deactivatedAt: ts("deactivated_at"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, () => [check("ck_attendees_status", inList("status", ATTENDEE_STATUS))]);

export const attendeeSessions = pgTable("attendee_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  tokenHash: bytea("token_hash").notNull(),
  previousTokenHash: bytea("previous_token_hash"),
  previousTokenValidUntil: ts("previous_token_valid_until"),
  tokenIssuedAt: ts("token_issued_at").notNull(),
  createdAt: createdAt(),
  lastSeenAt: ts("last_seen_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  absoluteExpiresAt: ts("absolute_expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  revokedReason: text("revoked_reason"),
  clientKind: text("client_kind").notNull().default("web"),
  userAgentSummary: text("user_agent_summary"),
}, (t) => [
  uniqueIndex("ux_attendee_sessions_token").on(t.tokenHash),
  uniqueIndex("ux_attendee_sessions_prev_token").on(t.previousTokenHash),
  index("ix_attendee_sessions_active").on(t.attendeeId).where(sql`revoked_at IS NULL`),
  check("ck_attendee_sessions_reason", inList("revoked_reason", SESSION_REVOKED, true)),
]);

export const attendeeRecoveryCodes = pgTable("attendee_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  codeHash: bytea("code_hash").notNull(),
  salt: bytea("salt").notNull(),
  status: text("status").notNull().default("active"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: createdAt(),
  usedAt: ts("used_at"),
  rotatedAt: ts("rotated_at"),
}, (t) => [
  uniqueIndex("ux_recovery_codes_one_active").on(t.attendeeId).where(sql`status = 'active'`),
  check("ck_recovery_codes_status", inList("status", RECOVERY_STATUS)),
]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  scope: text("scope").notNull(),
  key: uuid("key").notNull(),
  requestHash: bytea("request_hash").notNull(),
  attendeeId: uuid("attendee_id"),
  sessionId: uuid("session_id"),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body").notNull(),
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [primaryKey({ name: "pk_idempotency_keys", columns: [t.scope, t.key] })]);

// ---------- Taxonomy ----------
export const eventCategories = pgTable("event_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  sortOrder: smallint("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [uniqueIndex("ux_event_categories_slug").on(t.slug)]);

const tagColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  status: text("status").notNull().default("approved"),
  mergedIntoId: uuid("merged_into_id"),
  groupName: text("group_name"),
  createdByAttendeeId: uuid("created_by_attendee_id").references(() => attendees.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});
export const interests = pgTable("interests", tagColumns(), (t) => [
  uniqueIndex("ux_interests_normalized").on(t.normalizedName),
  index("ix_interests_name_trgm").using("gin", sql`normalized_name gin_trgm_ops`),
  check("ck_interests_status", inList("status", TAG_STATUS)),
]);
export const skills = pgTable("skills", tagColumns(), (t) => [
  uniqueIndex("ux_skills_normalized").on(t.normalizedName),
  index("ix_skills_name_trgm").using("gin", sql`normalized_name gin_trgm_ops`),
  check("ck_skills_status", inList("status", TAG_STATUS)),
]);
export const interestAliases = pgTable("interest_aliases", {
  aliasNormalized: text("alias_normalized").primaryKey(),
  interestId: uuid("interest_id").notNull().references(() => interests.id, { onDelete: "cascade" }),
});
export const skillAliases = pgTable("skill_aliases", {
  aliasNormalized: text("alias_normalized").primaryKey(),
  skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
});
export const categoryInterestSuggestions = pgTable("category_interest_suggestions", {
  categoryId: uuid("category_id").notNull().references(() => eventCategories.id, { onDelete: "cascade" }),
  interestId: uuid("interest_id").notNull().references(() => interests.id, { onDelete: "cascade" }),
  rank: smallint("rank").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.categoryId, t.interestId] })]);
export const categorySkillSuggestions = pgTable("category_skill_suggestions", {
  categoryId: uuid("category_id").notNull().references(() => eventCategories.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  rank: smallint("rank").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.categoryId, t.skillId] })]);
export const networkingIntentions = pgTable("networking_intentions", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id").references(() => eventCategories.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  label: text("label").notNull(),
  pulseGroup: text("pulse_group").notNull().default("other"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: smallint("sort_order").notNull().default(0),
}, (t) => [
  uniqueIndex("ux_networking_intentions_slug").on(sql`coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid)`, t.slug),
  check("ck_networking_intentions_group", inList("pulse_group", PULSE_GROUP)),
]);

// ---------- Profiles ----------
export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  username: text("username").notNull(),
  usernameNormalized: text("username_normalized").notNull(),
  usernameChangedAt: ts("username_changed_at"),
  bio: text("bio"),
  profession: text("profession"),
  professionNormalized: text("profession_normalized"),
  company: text("company"),
  location: text("location"),
  lookingForText: text("looking_for_text"),
  canOfferText: text("can_offer_text"),
  photoKey: text("photo_key"),
  photoUrl: text("photo_url"),
  thumbUrl: text("thumb_url"),
  photoUpdatedAt: ts("photo_updated_at"),
  isPublic: boolean("is_public").notNull().default(true),
  anonymousVisibilityConsentedAt: ts("anonymous_visibility_consented_at"),
  companyVisibility: text("company_visibility").notNull().default("members"),
  /** Activity status (Active now / Last seen) shown to accepted connections. Reciprocal: hiding yours hides others' from you. */
  showActivityStatus: boolean("show_activity_status").notNull().default(true),
  locationVisibility: text("location_visibility").notNull().default("members"),
  showSavedMe: boolean("show_saved_me").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_user_profiles_attendee").on(t.attendeeId),
  uniqueIndex("ux_user_profiles_username").on(t.usernameNormalized),
  index("ix_user_profiles_display_name_trgm").using("gin", sql`lower(display_name) gin_trgm_ops`),
  index("ix_user_profiles_username_trgm").using("gin", sql`username_normalized gin_trgm_ops`),
  index("ix_user_profiles_profession").on(t.professionNormalized),
  check("ck_user_profiles_display_name", sql`length(btrim(display_name)) BETWEEN 1 AND 60`),
  check("ck_user_profiles_username_format", sql`username_normalized ~ '^[a-z0-9]([a-z0-9_]|\\.(?!\\.)){1,28}[a-z0-9_]$'`),
  check("ck_user_profiles_company_visibility", inList("company_visibility", VISIBILITY)),
  check("ck_user_profiles_location_visibility", inList("location_visibility", VISIBILITY)),
]);

export const usernameHistory = pgTable("username_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  usernameNormalized: text("username_normalized").notNull(),
  changedAt: ts("changed_at").notNull(),
  reservedUntil: ts("reserved_until").notNull(),
}, (t) => [index("ix_username_history_name").on(t.usernameNormalized, t.reservedUntil)]);

export const socialLinks = pgTable("social_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  url: text("url").notNull(),
  visibility: text("visibility").notNull().default("members"),
  sortOrder: smallint("sort_order").notNull().default(0),
}, (t) => [
  uniqueIndex("ux_social_links_url").on(t.profileId, t.url),
  check("ck_social_links_https", sql`url ~ '^https://'`),
  check("ck_social_links_platform", inList("platform", SOCIAL_PLATFORMS)),
  check("ck_social_links_visibility", inList("visibility", VISIBILITY)),
]);

export const profileInterests = pgTable("profile_interests", {
  profileId: uuid("profile_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  interestId: uuid("interest_id").notNull().references(() => interests.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.profileId, t.interestId] }), index("ix_profile_interests_interest").on(t.interestId)]);
export const profileSkills = pgTable("profile_skills", {
  profileId: uuid("profile_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.profileId, t.skillId] }), index("ix_profile_skills_skill").on(t.skillId)]);
export const profileLookingForSkills = pgTable("profile_looking_for_skills", {
  profileId: uuid("profile_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "restrict" }),
}, (t) => [primaryKey({ columns: [t.profileId, t.skillId] })]);

// ---------- Organizers & organizations ----------
export const organizerUsers = pgTable("organizer_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  emailNormalized: text("email_normalized").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("active"),
  isAdmin: boolean("is_admin").notNull().default(false),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  passwordChangedAt: ts("password_changed_at").notNull().defaultNow(),
  // Admin TOTP MFA (D-24): AES-256-GCM-encrypted secret; last accepted time-step prevents code replay.
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabledAt: ts("totp_enabled_at"),
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  totpFailedAttempts: integer("totp_failed_attempts").notNull().default(0),
  totpLockedUntil: ts("totp_locked_until"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("ux_organizer_users_email").on(t.emailNormalized),
  check("ck_organizer_users_status", inList("status", ACTIVE_SUSPENDED)),
]);

export const organizerSessions = pgTable("organizer_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => organizerUsers.id, { onDelete: "cascade" }),
  tokenHash: bytea("token_hash").notNull(),
  createdAt: createdAt(),
  lastSeenAt: ts("last_seen_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  mfaVerifiedAt: ts("mfa_verified_at"),
  userAgentSummary: text("user_agent_summary"),
}, (t) => [uniqueIndex("ux_organizer_sessions_token").on(t.tokenHash), index("ix_organizer_sessions_user").on(t.userId)]);

export const organizerRecoveryCodes = pgTable("organizer_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => organizerUsers.id, { onDelete: "cascade" }),
  codeHash: bytea("code_hash").notNull(),
  salt: bytea("salt").notNull(),
  status: text("status").notNull().default("active"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: createdAt(),
  usedAt: ts("used_at"),
}, (t) => [uniqueIndex("ux_organizer_recovery_one_active").on(t.userId).where(sql`status = 'active'`)]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  logoKey: text("logo_key"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  status: text("status").notNull().default("active"),
  /** Lifetime count of successfully created events. Never decremented (deleting an event does not restore allowance). */
  eventsCreatedCount: integer("events_created_count").notNull().default(0),
  createdBy: uuid("created_by").references(() => organizerUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("ux_organizations_slug").on(t.slug), check("ck_organizations_status", inList("status", ACTIVE_SUSPENDED)),
  check("ck_organizations_events_created", sql`events_created_count >= 0`)]);

export const organizationMembers = pgTable("organization_members", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  organizerUserId: uuid("organizer_user_id").notNull().references(() => organizerUsers.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.organizationId, t.organizerUserId] }),
  index("ix_organization_members_user").on(t.organizerUserId),
  check("ck_organization_members_role", inList("role", ORG_ROLE)),
]);

// ---------- Events ----------
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  categoryId: uuid("category_id").notNull().references(() => eventCategories.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  bannerUrl: text("banner_url"),
  bannerKey: text("banner_key"),
  venueName: text("venue_name").notNull(),
  venueAddress: text("venue_address"),
  city: text("city"),
  timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  website: text("website"),
  maxParticipants: integer("max_participants"),
  status: text("status").notNull().default("draft"),
  moderationStatus: text("moderation_status").notNull().default("ok"),
  qrAccessEnabled: boolean("qr_access_enabled").notNull().default(true),
  participantCount: integer("participant_count").notNull().default(0),
  /** Which entitlement paid for creating this event: free allowance, a Pro/Business plan, or a single-event credit. */
  allowanceSource: text("allowance_source"),
  publishedAt: ts("published_at"),
  activatedAt: ts("activated_at"),
  endedAt: ts("ended_at"),
  archivedAt: ts("archived_at"),
  createdBy: uuid("created_by").references(() => organizerUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ix_events_org_status").on(t.organizationId, t.status),
  index("ix_events_status_starts").on(t.status, t.startsAt),
  check("ck_events_time_order", sql`ends_at > starts_at`),
  check("ck_events_max_participants", sql`max_participants IS NULL OR max_participants > 0`),
  check("ck_events_participant_count", sql`participant_count >= 0`),
  check("ck_events_status", inList("status", EVENT_STATUS)),
  check("ck_events_moderation", inList("moderation_status", MODERATION_STATUS)),
  check("ck_events_allowance_source", sql`allowance_source IS NULL OR allowance_source IN ('free','plan','credit')`),
]);

export const eventQrCodes = pgTable("event_qr_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  publicCode: text("public_code").notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: ts("expires_at"),
  createdBy: uuid("created_by").references(() => organizerUsers.id, { onDelete: "set null" }),
  revokedBy: uuid("revoked_by").references(() => organizerUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  revokedAt: ts("revoked_at"),
}, (t) => [
  uniqueIndex("ux_event_qr_codes_code").on(t.publicCode),
  uniqueIndex("ux_event_qr_codes_one_active").on(t.eventId).where(sql`status = 'active'`),
  check("ck_event_qr_codes_status", inList("status", QR_STATUS)),
]);

export const eventNetworkingSettings = pgTable("event_networking_settings", {
  eventId: uuid("event_id").primaryKey().references(() => events.id, { onDelete: "cascade" }),
  discoverEnabled: boolean("discover_enabled").notNull().default(true),
  anonymousBrowsingEnabled: boolean("anonymous_browsing_enabled").notNull().default(true),
  smartMatchingEnabled: boolean("smart_matching_enabled").notNull().default(true),
  pulseEnabled: boolean("pulse_enabled").notNull().default(true),
  connectionsEnabled: boolean("connections_enabled").notNull().default(true),
  messagingEnabled: boolean("messaging_enabled").notNull().default(true),
  availabilityEnabled: boolean("availability_enabled").notNull().default(true),
  premiumHighlightingEnabled: boolean("premium_highlighting_enabled").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

export const eventSuggestedInterests = pgTable("event_suggested_interests", {
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  interestId: uuid("interest_id").notNull().references(() => interests.id, { onDelete: "cascade" }),
  sortOrder: smallint("sort_order").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.eventId, t.interestId] })]);
export const eventSuggestedSkills = pgTable("event_suggested_skills", {
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  sortOrder: smallint("sort_order").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.eventId, t.skillId] })]);
export const eventIntentions = pgTable("event_intentions", {
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  intentionId: uuid("intention_id").notNull().references(() => networkingIntentions.id, { onDelete: "cascade" }),
  sortOrder: smallint("sort_order").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.eventId, t.intentionId] })]);

// ---------- Participation ----------
export const eventParticipants = pgTable("event_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  discoveryPaused: boolean("discovery_paused").notNull().default(false),
  joinedViaQrCodeId: uuid("joined_via_qr_code_id").references(() => eventQrCodes.id, { onDelete: "set null" }),
  joinedAt: ts("joined_at").notNull(),
  leftAt: ts("left_at"),
  removedAt: ts("removed_at"),
  removedBy: uuid("removed_by").references(() => organizerUsers.id, { onDelete: "set null" }),
  removalReason: text("removal_reason"),
  exportConsent: boolean("export_consent").notNull().default(false),
}, (t) => [
  uniqueIndex("ux_event_participants_pair").on(t.eventId, t.attendeeId),
  index("ix_event_participants_attendee").on(t.attendeeId, t.status),
  index("ix_event_participants_discoverable").on(t.eventId, t.status).where(sql`discovery_paused = false`),
  check("ck_event_participants_status", inList("status", PARTICIPANT_STATUS)),
]);

export const eventAvailability = pgTable("event_availability", {
  participantId: uuid("participant_id").primaryKey().references(() => eventParticipants.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("open_to_conversations"),
  visibility: text("visibility").notNull().default("members"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("ix_event_availability_status").on(t.status),
  check("ck_event_availability_status", inList("status", AVAILABILITY)),
  check("ck_event_availability_visibility", inList("visibility", AVAILABILITY_VISIBILITY)),
]);

export const eventParticipantIntentions = pgTable("event_participant_intentions", {
  participantId: uuid("participant_id").notNull().references(() => eventParticipants.id, { onDelete: "cascade" }),
  intentionId: uuid("intention_id").notNull().references(() => networkingIntentions.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.participantId, t.intentionId] })]);

export const eventActivityCounters = pgTable("event_activity_counters", {
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  bucketStart: ts("bucket_start").notNull(),
  kind: text("kind").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.eventId, t.bucketStart, t.kind] }), check("ck_activity_kind", inList("kind", ACTIVITY_KIND))]);

// ---------- Discovery ----------
export const savedProfiles = pgTable("saved_profiles", {
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  savedProfileId: uuid("saved_profile_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.attendeeId, t.savedProfileId] }), index("ix_saved_profiles_saved").on(t.savedProfileId)]);

export const matchDismissals = pgTable("match_dismissals", {
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  dismissedProfileId: uuid("dismissed_profile_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.attendeeId, t.eventId, t.dismissedProfileId] })]);

// ---------- Connections & messaging ----------
export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterAttendeeId: uuid("requester_attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  addresseeAttendeeId: uuid("addressee_attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  attendeeLowId: uuid("attendee_low_id").notNull(),
  attendeeHighId: uuid("attendee_high_id").notNull(),
  originEventId: uuid("origin_event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("pending"),
  introMessage: text("intro_message"),
  requestedAt: ts("requested_at").notNull(),
  respondedAt: ts("responded_at"),
  removedAt: ts("removed_at"),
  removedBy: uuid("removed_by"),
}, (t) => [
  uniqueIndex("ux_connections_live_pair").on(t.attendeeLowId, t.attendeeHighId).where(sql`status IN ('pending','accepted')`),
  index("ix_connections_addressee").on(t.addresseeAttendeeId, t.status),
  index("ix_connections_requester").on(t.requesterAttendeeId, t.status),
  check("ck_connections_not_self", sql`requester_attendee_id <> addressee_attendee_id`),
  check("ck_connections_pair_order", sql`attendee_low_id < attendee_high_id`),
  check("ck_connections_status", inList("status", CONNECTION_STATUS)),
]);

export const connectionHistory = pgTable("connection_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  connectionId: uuid("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  actorAttendeeId: uuid("actor_attendee_id").notNull(),
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  createdAt: createdAt(),
});

export const CONVERSATION_KIND = ["direct", "group"] as const;
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** direct: exactly two attendees (pair columns set). group: named, admin-managed, members added from accepted connections. */
  kind: text("kind").notNull().default("direct"),
  connectionId: uuid("connection_id").references(() => connections.id, { onDelete: "set null" }),
  attendeeLowId: uuid("attendee_low_id"),
  attendeeHighId: uuid("attendee_high_id"),
  originEventId: uuid("origin_event_id").references(() => events.id, { onDelete: "restrict" }),
  name: text("name"),
  photoUrl: text("photo_url"),
  photoKey: text("photo_key"),
  createdBy: uuid("created_by").references(() => attendees.id, { onDelete: "set null" }),
  lastMessageId: integer("last_message_id"),
  lastMessageAt: ts("last_message_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("ux_conversations_pair").on(t.attendeeLowId, t.attendeeHighId),
  check("ck_conversations_pair_order", sql`attendee_low_id < attendee_high_id`),
  check("ck_conversations_kind", inList("kind", CONVERSATION_KIND)),
  check("ck_conversations_shape", sql`(kind = 'direct' AND attendee_low_id IS NOT NULL AND attendee_high_id IS NOT NULL AND origin_event_id IS NOT NULL)
    OR (kind = 'group' AND attendee_low_id IS NULL AND attendee_high_id IS NULL AND name IS NOT NULL)`),
]);

export const conversationMembers = pgTable("conversation_members", {
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  lastReadMessageId: integer("last_read_message_id").notNull().default(0),
  lastReadAt: ts("last_read_at"),
  typingAt: ts("typing_at"),
  /** Group role. Direct conversations use "member" for both people. */
  role: text("role").notNull().default("member"),
  /** Group members only see messages after they joined (ids greater than this). */
  joinedAfterMessageId: integer("joined_after_message_id").notNull().default(0),
  joinedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.attendeeId] }), index("ix_conversation_members_attendee").on(t.attendeeId),
  check("ck_conversation_members_role", sql`role IN ('admin','member')`)]);

export const messages = pgTable("messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderAttendeeId: uuid("sender_attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  clientMessageId: uuid("client_message_id").notNull(),
  /** user: written by a person. system: group activity (created, member added/removed/left, renamed). */
  kind: text("kind").notNull().default("user"),
  body: text("body").notNull(),
  createdAt: createdAt(),
  deletedAt: ts("deleted_at"),
}, (t) => [
  uniqueIndex("ux_messages_client_id").on(t.conversationId, t.clientMessageId),
  index("ix_messages_conversation").on(t.conversationId, t.id),
  check("ck_messages_body", sql`length(btrim(body)) BETWEEN 1 AND 4000`),
  check("ck_messages_kind", sql`kind IN ('user','system')`),
]);

// ---------- Notifications ----------
/**
 * One notification for one recipient — an attendee OR an organizer account. Produced only by server/notifications
 * (notify()); dedupe_key coalesces repeats (e.g. one entry per conversation) and makes one-off notices idempotent.
 */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  attendeeId: uuid("attendee_id").references(() => attendees.id, { onDelete: "cascade" }),
  organizerUserId: uuid("organizer_user_id").references(() => organizerUsers.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  category: text("category").notNull().default("account"),
  title: text("title").notNull().default(""),
  body: text("body"),
  /** In-app path opened when the notification is clicked (always a relative path built by the server). */
  link: text("link"),
  dedupeKey: text("dedupe_key"),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  actorProfileId: uuid("actor_profile_id").references(() => userProfiles.id, { onDelete: "set null" }),
  entityId: uuid("entity_id"),
  payload: jsonb("payload").notNull().default({}),
  /** Web push: none (not wanted), pending, sending, sent, skipped (no device / recipient active in-app). */
  pushStatus: text("push_status").notNull().default("none"),
  createdAt: createdAt(),
  readAt: ts("read_at"),
}, (t) => [
  index("ix_notifications_attendee").on(t.attendeeId, t.createdAt),
  index("ix_notifications_unread").on(t.attendeeId).where(sql`read_at IS NULL`),
  index("ix_notifications_organizer").on(t.organizerUserId, t.createdAt),
  index("ix_notifications_push_pending").on(t.createdAt).where(sql`push_status = 'pending'`),
  uniqueIndex("ux_notifications_attendee_dedupe").on(t.attendeeId, t.dedupeKey).where(sql`attendee_id IS NOT NULL AND dedupe_key IS NOT NULL`),
  uniqueIndex("ux_notifications_organizer_dedupe").on(t.organizerUserId, t.dedupeKey).where(sql`organizer_user_id IS NOT NULL AND dedupe_key IS NOT NULL`),
  check("ck_notifications_recipient", sql`(attendee_id IS NOT NULL) <> (organizer_user_id IS NOT NULL)`),
  check("ck_notifications_category", inList("category", NOTIFICATION_CATEGORY)),
  check("ck_notifications_push_status", sql`push_status IN ('none','pending','sending','sent','skipped')`),
]);

/** Per-recipient, per-category delivery choices. Missing row = the category's default. */
export const notificationSettings = pgTable("notification_settings", {
  recipientType: text("recipient_type").notNull(),
  recipientId: uuid("recipient_id").notNull(),
  category: text("category").notNull(),
  inApp: boolean("in_app").notNull().default(true),
  push: boolean("push").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.recipientType, t.recipientId, t.category] }),
  check("ck_notification_settings_recipient", inList("recipient_type", RECIPIENT_TYPE)),
  check("ck_notification_settings_category", inList("category", NOTIFICATION_CATEGORY))]);

/**
 * A browser/device push endpoint. Bound to the session that registered it: signing out or revoking that session
 * stops delivery to the device automatically (delivery only uses subscriptions whose session is still valid).
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientType: text("recipient_type").notNull(),
  attendeeId: uuid("attendee_id").references(() => attendees.id, { onDelete: "cascade" }),
  organizerUserId: uuid("organizer_user_id").references(() => organizerUsers.id, { onDelete: "cascade" }),
  attendeeSessionId: uuid("attendee_session_id").references(() => attendeeSessions.id, { onDelete: "cascade" }),
  organizerSessionId: uuid("organizer_session_id").references(() => organizerSessions.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgentSummary: text("user_agent_summary"),
  failureCount: integer("failure_count").notNull().default(0),
  lastSuccessAt: ts("last_success_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("ux_push_subscriptions_endpoint").on(t.endpoint),
  index("ix_push_subscriptions_attendee").on(t.attendeeId),
  index("ix_push_subscriptions_organizer").on(t.organizerUserId),
  check("ck_push_subscriptions_recipient", sql`(recipient_type = 'attendee' AND attendee_id IS NOT NULL AND attendee_session_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (recipient_type = 'organizer' AND organizer_user_id IS NOT NULL AND organizer_session_id IS NOT NULL AND attendee_id IS NULL)`),
]);

export const notificationPreferences = pgTable("notification_preferences", {
  attendeeId: uuid("attendee_id").primaryKey().references(() => attendees.id, { onDelete: "cascade" }),
  connectionRequests: boolean("connection_requests").notNull().default(true),
  connectionAccepted: boolean("connection_accepted").notNull().default(true),
  messages: boolean("messages").notNull().default(true),
  eventUpdates: boolean("event_updates").notNull().default(true),
  billing: boolean("billing").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------- Safety ----------
export const userBlocks = pgTable("user_blocks", {
  blockerAttendeeId: uuid("blocker_attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  blockedAttendeeId: uuid("blocked_attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.blockerAttendeeId, t.blockedAttendeeId] }),
  index("ix_user_blocks_blocked").on(t.blockedAttendeeId),
  check("ck_user_blocks_not_self", sql`blocker_attendee_id <> blocked_attendee_id`),
]);

export const userReports = pgTable("user_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterAttendeeId: uuid("reporter_attendee_id").references(() => attendees.id, { onDelete: "set null" }),
  reportedAttendeeId: uuid("reported_attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  messageId: integer("message_id"),
  messageExcerpt: text("message_excerpt"),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("open"),
  escalated: boolean("escalated").notNull().default(false),
  resolvedBy: uuid("resolved_by"),
  resolutionNote: text("resolution_note"),
  createdAt: createdAt(),
  resolvedAt: ts("resolved_at"),
}, (t) => [
  index("ix_user_reports_status").on(t.status, t.createdAt),
  index("ix_user_reports_event").on(t.eventId, t.status),
  check("ck_user_reports_reason", inList("reason", REPORT_REASON)),
  check("ck_user_reports_status", inList("status", REPORT_STATUS)),
]);

export const moderationActions = pgTable("moderation_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  action: text("action").notNull(),
  reason: text("reason"),
  reportId: uuid("report_id"),
  createdAt: createdAt(),
}, (t) => [index("ix_moderation_target").on(t.targetType, t.targetId)]);

export const accountDeletionRequests = pgTable("account_deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  requestedAt: ts("requested_at").notNull(),
  scheduledFor: ts("scheduled_for").notNull(),
  cancelledAt: ts("cancelled_at"),
  completedAt: ts("completed_at"),
}, (t) => [index("ix_deletion_pending").on(t.scheduledFor).where(sql`completed_at IS NULL AND cancelled_at IS NULL`)]);

// ---------- Platform ----------
export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  organizationId: uuid("organization_id"),
  eventId: uuid("event_id"),
  ipHash: bytea("ip_hash"),
  data: jsonb("data").notNull().default({}),
}, (t) => [
  index("ix_audit_logs_org").on(t.organizationId, t.occurredAt),
  index("ix_audit_logs_target").on(t.targetType, t.targetId),
  index("ix_audit_logs_time").on(t.occurredAt),
  check("ck_audit_logs_actor", inList("actor_type", ACTOR_TYPE)),
]);

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Fixed-window rate limiting that works across serverless instances. */
export const rateLimitCounters = pgTable("rate_limit_counters", {
  key: text("key").notNull(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("ix_rate_limit_window").on(t.windowStart)]);

// ---------- Billing ----------
export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  audience: text("audience").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  billingPeriod: text("billing_period").notNull(),
  priceMinor: integer("price_minor").notNull(),
  currency: text("currency").notNull().default("INR"),
  gatewayPlanId: text("gateway_plan_id"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: smallint("sort_order").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("ux_subscription_plans_code").on(t.code),
  check("ck_plans_price", sql`price_minor >= 0`),
  check("ck_plans_audience", inList("audience", PLAN_AUDIENCE)),
  check("ck_plans_period", inList("billing_period", BILLING_PERIOD)),
]);

export const subscriptionFeatures = pgTable("subscription_features", {
  planId: uuid("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: "cascade" }),
  featureKey: text("feature_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  limitValue: integer("limit_value"),
}, (t) => [primaryKey({ columns: [t.planId, t.featureKey] })]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: "restrict" }),
  subscriberType: text("subscriber_type").notNull(),
  attendeeId: uuid("attendee_id").references(() => attendees.id, { onDelete: "restrict" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("created"),
  gateway: text("gateway").notNull().default("razorpay"),
  gatewaySubscriptionId: text("gateway_subscription_id"),
  currentPeriodStart: ts("current_period_start"),
  currentPeriodEnd: ts("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  cancelledAt: ts("cancelled_at"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_subscriptions_gateway_id").on(t.gatewaySubscriptionId),
  uniqueIndex("ux_subscriptions_attendee_live").on(t.attendeeId).where(sql`attendee_id IS NOT NULL AND status IN ('created','authenticated','active','pending')`),
  uniqueIndex("ux_subscriptions_org_live").on(t.organizationId).where(sql`organization_id IS NOT NULL AND status IN ('created','authenticated','active','pending')`),
  check("ck_subscriptions_status", inList("status", SUBSCRIPTION_STATUS)),
  check("ck_subscriptions_subscriber", sql`(subscriber_type = 'attendee' AND attendee_id IS NOT NULL AND organization_id IS NULL) OR (subscriber_type = 'organization' AND organization_id IS NOT NULL AND attendee_id IS NULL)`),
]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "restrict" }),
  payerType: text("payer_type").notNull(),
  attendeeId: uuid("attendee_id").references(() => attendees.id, { onDelete: "restrict" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  gateway: text("gateway").notNull().default("razorpay"),
  gatewayOrderId: text("gateway_order_id"),
  gatewayPaymentId: text("gateway_payment_id"),
  amountMinor: integer("amount_minor").notNull(),
  taxMinor: integer("tax_minor").notNull().default(0),
  feeMinor: integer("fee_minor").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("created"),
  refundedMinor: integer("refunded_minor").notNull().default(0),
  failureReason: text("failure_reason"),
  method: text("method"),
  /** What the payment buys: a recurring subscription charge or a one-time single-event credit. */
  purpose: text("purpose").notNull().default("subscription"),
  planId: uuid("plan_id").references(() => subscriptionPlans.id, { onDelete: "restrict" }),
  capturedAt: ts("captured_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("ux_payments_order").on(t.gatewayOrderId),
  uniqueIndex("ux_payments_payment").on(t.gatewayPaymentId),
  check("ck_payments_status", inList("status", PAYMENT_STATUS)),
  check("ck_payments_purpose", sql`purpose IN ('subscription','event_credit')`),
  index("ix_payments_org").on(t.organizationId, t.createdAt),
  check("ck_payments_amounts", sql`amount_minor >= 0 AND refunded_minor >= 0 AND refunded_minor <= amount_minor`),
]);

export const paymentWebhooks = pgTable("payment_webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  gateway: text("gateway").notNull().default("razorpay"),
  gatewayEventId: text("gateway_event_id").notNull(),
  eventType: text("event_type").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: createdAt(),
  processedAt: ts("processed_at"),
  processingError: text("processing_error"),
}, (t) => [uniqueIndex("ux_payment_webhooks_event").on(t.gatewayEventId)]);

export const subscriptionInvoices = pgTable("subscription_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceNumber: text("invoice_number").notNull(),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  amountMinor: integer("amount_minor").notNull(),
  taxMinor: integer("tax_minor").notNull().default(0),
  periodStart: ts("period_start"),
  periodEnd: ts("period_end"),
  issuedAt: ts("issued_at").notNull(),
}, (t) => [uniqueIndex("ux_invoices_number").on(t.invoiceNumber)]);

export const eventPurchases = pgTable("event_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
  planId: uuid("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("pending"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("ux_event_purchases_paid").on(t.eventId, t.planId).where(sql`status = 'paid'`)]);

/** One additional event an organization may create (bought as a Single Event package, or granted by an admin). */
export const organizationEventCredits = pgTable("organization_event_credits", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
  grantedBy: uuid("granted_by").references(() => organizerUsers.id, { onDelete: "set null" }),
  reason: text("reason"),
  /** Set when an event is created with this credit; kept even if that event is later deleted. */
  consumedAt: ts("consumed_at"),
  consumedEventId: uuid("consumed_event_id").references(() => events.id, { onDelete: "set null" }),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("ux_event_credits_payment").on(t.paymentId).where(sql`payment_id IS NOT NULL`),
  index("ix_event_credits_org_available").on(t.organizationId).where(sql`consumed_at IS NULL AND revoked_at IS NULL`),
  check("ck_event_credits_source", sql`source IN ('purchase','promo')`),
]);

export const userEntitlements = pgTable("user_entitlements", {
  attendeeId: uuid("attendee_id").notNull().references(() => attendees.id, { onDelete: "cascade" }),
  featureKey: text("feature_key").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  limitValue: integer("limit_value"),
  validFrom: ts("valid_from").notNull(),
  validUntil: ts("valid_until"),
}, (t) => [primaryKey({ columns: [t.attendeeId, t.featureKey, t.sourceType, t.sourceId] }), check("ck_ue_source", inList("source_type", ENTITLEMENT_SOURCE))]);

export const organizationEntitlements = pgTable("organization_entitlements", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  featureKey: text("feature_key").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  limitValue: integer("limit_value"),
  validFrom: ts("valid_from").notNull(),
  validUntil: ts("valid_until"),
}, (t) => [primaryKey({ columns: [t.organizationId, t.featureKey, t.sourceType, t.sourceId] }), check("ck_oe_source", inList("source_type", ENTITLEMENT_SOURCE))]);

export const promotionalAccess = pgTable("promotional_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriberType: text("subscriber_type").notNull(),
  attendeeId: uuid("attendee_id").references(() => attendees.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: "restrict" }),
  grantedBy: uuid("granted_by").notNull().references(() => organizerUsers.id, { onDelete: "restrict" }),
  reason: text("reason"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  revokedAt: ts("revoked_at"),
  revokedBy: uuid("revoked_by"),
}, () => [check("ck_promo_period", sql`ends_at > starts_at`)]);
