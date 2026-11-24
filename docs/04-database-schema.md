# 04 — Database Schema (PostgreSQL 16)

Conventions: snake_case; `uuid` primary keys generated as **UUIDv7** by the app unless noted; all timestamps `timestamptz` in UTC; enums stored as `text` with `CHECK` constraints (easier to change than PG enums); `created_at` defaults to `now()`; soft state via status columns; `xmin` used as the optimistic concurrency token on mutable aggregates. Extensions: `pg_trgm` (search), `unaccent`.

Every PRD §11.1 and §20.1 entity is listed below with its table name. Tables added beyond the PRD are marked **(+)** with the reason.

---

## 1. Identity

### attendees
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK — internal attendee ID, never exposed in APIs |
| status | text | `active│suspended│deactivated│deleted`, default `active` |
| suspended_reason | text | null |
| last_active_at | timestamptz | |
| deactivated_at, deleted_at | timestamptz | null |
| created_at | timestamptz | not null |

### attendee_sessions
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| attendee_id | uuid | FK → attendees ON DELETE CASCADE, indexed |
| token_hash | bytea(32) | **UNIQUE** — SHA-256 of the 256-bit random token |
| previous_token_hash | bytea(32) | null, **UNIQUE** — previous token during rotation grace |
| previous_token_valid_until | timestamptz | null — 2-minute grace after rotation |
| token_issued_at | timestamptz | rotation at most every 24 h (D-13) |
| created_at, last_seen_at | timestamptz | |
| expires_at | timestamptz | **idle expiry: last use + 30 d** (sliding, capped at absolute) |
| absolute_expires_at | timestamptz | **creation + 180 d** (D-13) |
| revoked_at | timestamptz | null |
| revoked_reason | text | `logout│user_revoked│admin│suspension│deletion│recovery` |
| client_kind | text | `web│mobile` |
| user_agent_summary | text | for example "Chrome on Android" (no raw UA) |

Index: `(attendee_id) WHERE revoked_at IS NULL`.

### attendee_recovery_codes (+) — D-13 recovery code (hash only)
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| attendee_id | uuid | FK → attendees CASCADE |
| code_hash | bytea(32) | HMAC-SHA-256(pepper, salt ‖ normalized code); raw code never stored |
| salt | bytea(16) | random per code |
| status | text | `active│rotated│used│revoked` |
| failed_attempts | int | default 0 (reset on success/rotation) |
| locked_until | timestamptz | null — set for 1 h after 5 failures |
| created_at, used_at, rotated_at | timestamptz | |

**Partial UNIQUE `(attendee_id) WHERE status = 'active'`**, so there's exactly one active code per attendee.

### idempotency_keys (+) — required by §12.5 idempotency
PK `(scope, key)`; `request_hash bytea`, `attendee_id uuid null`, `response_status int`, `response_body jsonb`, `session_id uuid null`, `created_at`, `expires_at` (24 h; purged by worker).

---

## 2. Profiles

### user_profiles
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK — **public profile ID** (random UUIDv4, not time-ordered, to avoid enumeration) |
| attendee_id | uuid | FK → attendees, **UNIQUE** (one attendee → one global profile) |
| display_name | varchar(60) | not null, `CHECK (length(trim(display_name)) > 0)` |
| username | varchar(30) | not null (as typed, lowercase) |
| username_normalized | varchar(30) | not null, **UNIQUE** — `lower()`, format `CHECK (username_normalized ~ '^[a-z0-9](?:[a-z0-9_]|\.(?!\.)){1,28}[a-z0-9_]$')` |
| username_changed_at | timestamptz | null (30-day rule) |
| bio | varchar(500) | null |
| profession | varchar(100) | null |
| profession_normalized | varchar(100) | null, indexed |
| company | varchar(100) | null |
| location | varchar(100) | null |
| looking_for_text | varchar(500) | null |
| can_offer_text | varchar(500) | null |
| photo_key | text | null — object-storage key (random) |
| photo_updated_at | timestamptz | null |
| is_public | boolean | not null, default **true** — "visible to visitors without a profile" (D-08) |
| anonymous_visibility_consented_at | timestamptz | null — when the attendee accepted the visibility explanation (D-08) |
| company_visibility | text | `public│members│connections`, default `members` |
| location_visibility | text | same, default `members` |
| show_saved_me | boolean | default false (D-04) |
| premium_theme | jsonb | null (premium customization) |
| (search) | — | trigram GIN indexes on `display_name` and `username_normalized` (pg_trgm) serve name search |
| created_at, updated_at | timestamptz | |

Indexes: trigram GIN on `display_name` and `username_normalized` (search).

### username_history (+) — D-16 impersonation hold
`id`, `profile_id` FK, `username_normalized`, `changed_at`, `reserved_until`. Index on `(username_normalized, reserved_until)`.

### social_links
`id` PK, `profile_id` FK CASCADE, `platform` text (`instagram│linkedin│x│github│behance│dribbble│youtube│spotify│soundcloud│website│portfolio│other`), `url` varchar(500) `CHECK (url ~ '^https://')`, `visibility` text (`public│members│connections`, default `members`), `sort_order` smallint. UNIQUE `(profile_id, url)`. Max 10 per profile (app rule).

---

## 3. Skills, interests, categories, intentions

### event_categories
`id` uuid PK, `slug` UNIQUE, `name`, `description`, `image_url`, `sort_order`, `is_active`. Seeded: concert, music-festival, wedding, social-gathering, college-festival, conference, workshop, business-meetup, art-exhibition, cultural-festival, community-gathering, sports-entertainment, other.

### interests / skills (same shape)
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | varchar(50) | display form |
| normalized_name | varchar(50) | **UNIQUE** — NFKC, lowercased, trimmed, single spaces |
| status | text | `approved│pending│rejected│merged` |
| merged_into_id | uuid | null, self-FK |
| group_name | varchar(50) | null (for example "Music", "Tech") |
| created_by_attendee_id | uuid | null FK |
| created_at | timestamptz | |

### interest_aliases / skill_aliases (+) — dedupe through normalization (§3.2)
`alias_normalized` PK, `interest_id`/`skill_id` FK (for example "ml" → "machine learning").

### category_interest_suggestions / category_skill_suggestions (+) — "suggestions based on event category"
PK `(category_id, interest_id)` / `(category_id, skill_id)`, `rank smallint`.

### networking_intentions
`id` PK, `category_id` FK null (null = global), `slug`, `label` ("Looking for singers"), `pulse_group` (`collaboration│social│professional│creative│other`), `is_active`, `sort_order`. UNIQUE `(category_id, slug)`.

### profile_interests / profile_skills
PK `(profile_id, interest_id)` / `(profile_id, skill_id)`, FK CASCADE, `created_at`. App rule: 1–20 each. Index on `(interest_id)` / `(skill_id)` for filters and Pulse.

### profile_looking_for_skills (+) — D-12 structured "looking for"
PK `(profile_id, skill_id)`. Max 10.

---

## 4. Organizations and organizers

### organizer_users (ASP.NET Core Identity `IdentityUser<Guid>`, renamed)
Identity columns (email, normalized_email UNIQUE, password_hash, security_stamp, two_factor_enabled, lockout…) plus `display_name`, `status` (`active│suspended`), `created_at`. Identity tables: `organizer_roles`, `organizer_user_roles`, `organizer_user_logins`, `organizer_user_tokens`, `organizer_user_claims`, `organizer_role_claims`. Roles: `PlatformAdmin`.

### organizations
`id` PK, `name` varchar(120), `slug` UNIQUE, `description` varchar(2000), `logo_key`, `contact_email`, `contact_phone`, `website`, `status` (`active│suspended`), `created_by` FK → organizer_users, `created_at`, `updated_at`.

### organization_members
PK `(organization_id, organizer_user_id)`, `role` (`owner│member`), `created_at`, `invited_by`. Partial index `(organization_id) WHERE role='owner'`; at least one owner is enforced in the app inside a transaction.

---

## 5. Events

### events
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK → organizations, indexed |
| category_id | uuid | FK → event_categories |
| name | varchar(150) | not null |
| description | varchar(5000) | null |
| banner_key | text | null |
| venue_name | varchar(150) | not null |
| venue_address | varchar(300) | null |
| city | varchar(100) | null |
| time_zone | varchar(64) | not null (IANA, for example `Asia/Kolkata`) |
| starts_at, ends_at | timestamptz | not null, `CHECK (ends_at > starts_at)` |
| website | varchar(300) | null |
| max_participants | int | null, `CHECK (max_participants > 0)` |
| status | text | `draft│published│active│networking_paused│ended│archived` |
| moderation_status | text | `ok│suspended` (admin), default ok |
| qr_access_enabled | boolean | default true |
| branding | jsonb | null (Pro) |
| participant_count | int | denormalized counter, maintained in the join/leave transaction |
| published_at, activated_at, ended_at, archived_at | timestamptz | null |
| created_by | uuid | FK → organizer_users |
| created_at, updated_at | timestamptz | |

Indexes: `(organization_id, status)`, `(status, starts_at)` for the lifecycle worker. Lifecycle (D-06): networking opens automatically at `starts_at − 24 h` and closes at `ends_at`.

### event_qr_codes
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| event_id | uuid | FK CASCADE |
| public_code | varchar(16) | **UNIQUE** — 12-character base62 random (≈71 bits), in URL `/e/{public_code}` |
| status | text | `active│revoked` |
| expires_at | timestamptz | null |
| created_by, revoked_by | uuid | FK → organizer_users |
| created_at, revoked_at | timestamptz | |

**Partial UNIQUE `(event_id) WHERE status = 'active'`**, so there's one standard QR per event (MVP). Regenerate means revoke the old one and insert a new one in one transaction.

### event_networking_settings
PK/FK `event_id`; booleans `discover_enabled`, `anonymous_browsing_enabled`, `smart_matching_enabled`, `pulse_enabled`, `connections_enabled`, `messaging_enabled`, `availability_enabled`, `premium_highlighting_enabled` (D-04); `updated_at`, `updated_by`. Created with category defaults.

### event_suggested_interests / event_suggested_skills / event_intentions (+) — M17 "select suggested …, configure intentions"
PK `(event_id, interest_id│skill_id│intention_id)`, `sort_order`.

---

## 6. Participation and availability

### event_participants
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| event_id | uuid | FK |
| attendee_id | uuid | FK |
| status | text | `active│left│removed` |
| discovery_paused | boolean | default false |
| joined_via_qr_code_id | uuid | null FK |
| joined_at, left_at, removed_at | timestamptz | |
| removed_by | uuid | null FK → organizer_users |
| removal_reason | varchar(500) | null |
| export_consent | boolean | default false (BR-29) |

**UNIQUE `(event_id, attendee_id)`** prevents duplicate participation (rejoining updates the row back to `active` unless `removed`). Indexes: `(attendee_id, status)`, `(event_id, status) WHERE discovery_paused = false`.

### event_availability (PRD EventAvailability)
PK/FK `participant_id` → event_participants CASCADE; `status` (`available_now│open_to_conversations│meet_new_people│looking_for_collaborators│quick_conversations│temporarily_unavailable│discovery_paused`), `visibility` (`members│connections│hidden`), `updated_at`. Index `(status)`.

### event_participant_intentions (PRD EventNetworkingIntentions)
PK `(participant_id, intention_id)`. Rule: the intention must be enabled for the event.

### event_activity_counters (+) — Pulse "current networking activity" without exposing individuals
PK `(event_id, bucket_start, kind)`; `kind` (`join│status_change│connection_accepted│message_sent`), `count int`. 5-minute buckets, aggregate only, never per-person.

---

## 7. Discovery

### saved_profiles
PK `(attendee_id, saved_profile_id)`; `event_id` null FK (where it was saved); `created_at`. Index `(saved_profile_id)` for "who saved me" (premium, D-04).

### match_dismissals
PK `(attendee_id, event_id, dismissed_profile_id)`; `created_at`.

---

## 8. Connections

### connections
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| requester_attendee_id | uuid | FK |
| addressee_attendee_id | uuid | FK, `CHECK (requester ≠ addressee)` |
| attendee_low_id, attendee_high_id | uuid | normalized pair, `CHECK (attendee_low_id < attendee_high_id)` |
| origin_event_id | uuid | FK → events — the event through which the connection was originally established (BR-18, D-05). Never changes; event end/archive doesn't affect the row |
| status | text | `pending│accepted│declined│withdrawn│removed` |
| intro_message | varchar(300) | null |
| requested_at, responded_at, removed_at | timestamptz | |
| removed_by | uuid | null |

**Partial UNIQUE `(attendee_low_id, attendee_high_id) WHERE status IN ('pending','accepted')`** means no duplicate pending request in either direction and at most one live connection per pair (D-05). Indexes: `(addressee_attendee_id, status)`, `(requester_attendee_id, status)`.
Decline cooldown (app rule): after a decline, the same requester can't re-request that person for 30 days.

### connection_history
`id` bigint identity PK, `connection_id` FK, `actor_attendee_id`, `action` (`requested│accepted│declined│withdrawn│removed`), `from_status`, `to_status`, `created_at`.

---

## 9. Messaging

### conversations
`id` PK, `connection_id` FK UNIQUE null, `attendee_low_id`, `attendee_high_id` (**UNIQUE pair**: one persistent conversation per pair, D-05), `origin_event_id` FK (the event through which the conversation was initiated), `last_message_id` bigint null, `last_message_at` timestamptz, `created_at`. Conversations are never deleted by organizer settings or event lifecycle.

### conversation_members
PK `(conversation_id, attendee_id)`; `last_read_message_id bigint` default 0, `last_read_at`, `muted boolean`, `joined_at`. Index `(attendee_id)`.

### messages
| Column | Type | Constraints |
|---|---|---|
| id | bigint identity | PK (monotonic, used for ordering and read markers) |
| conversation_id | uuid | FK → conversations (BR: messages reference valid conversations) |
| sender_attendee_id | uuid | FK |
| client_message_id | uuid | **UNIQUE `(conversation_id, client_message_id)`** — idempotent send |
| body | varchar(4000) | not null, `CHECK (length(trim(body)) > 0)` |
| created_at | timestamptz | |
| deleted_at | timestamptz | null (moderation removal) |

Index `(conversation_id, id DESC)`. Unread count = messages with `id > last_read_message_id` and sender ≠ me.

---

## 10. Notifications

### notifications
`id` uuid PK, `attendee_id` FK, `type` (`connection_request│connection_accepted│message│event_update│system│billing`), `event_id` null, `actor_profile_id` null, `entity_type`, `entity_id`, `payload jsonb` (display-safe fields only), `created_at`, `read_at` null.
Indexes: `(attendee_id, created_at DESC)`, `(attendee_id) WHERE read_at IS NULL`. Message notifications are coalesced per conversation (one unread per conversation).

### notification_preferences
PK/FK `attendee_id`; booleans `connection_requests`, `connection_accepted`, `messages`, `event_updates`, `billing`; `updated_at`.

---

## 11. Privacy and safety

### user_blocks
PK `(blocker_attendee_id, blocked_attendee_id)`, `CHECK (blocker ≠ blocked)`, `created_at`. Index `(blocked_attendee_id)`. Blocking also sets any pending/accepted connection to `removed` and hides the conversation for both.

### user_reports
`id` PK, `reporter_attendee_id` null FK, `reporter_organizer_user_id` null FK (`CHECK` exactly one), `reported_attendee_id` FK, `event_id` null, `message_id` bigint null (the reporter's own conversation only; that excerpt is attached to the report), `reason` (`spam│harassment│inappropriate_content│fake_profile│underage│other`), `details` varchar(1000), `status` (`open│in_review│actioned│dismissed`), `assigned_admin_id`, `resolution_note`, `created_at`, `resolved_at`. Indexes `(status, created_at)`, `(event_id, status)`.

### moderation_actions
`id` PK, `actor_type` (`admin│organizer│system`), `actor_id`, `target_type` (`attendee│event│organization│interest│skill│message│participant`), `target_id`, `action` (`suspend│restore│remove_participant│suspend_event│restore_event│approve_tag│reject_tag│merge_tag│delete_message│dismiss_report`), `reason`, `report_id` null FK, `metadata jsonb`, `created_at`. Append-only.

### account_deletion_requests (+) — D-19
`id` PK, `attendee_id` FK, `requested_at`, `scheduled_for`, `cancelled_at`, `completed_at`.

---

## 12. Platform

### audit_logs
`id` bigint identity PK, `occurred_at`, `actor_type` (`attendee│organizer│admin│system│gateway`), `actor_id`, `action` (for example `event.published`, `qr.revoked`, `participant.removed`, `admin.user_suspended`), `target_type`, `target_id`, `organization_id` null, `event_id` null, `ip_hash` bytea (salted), `data jsonb`. **Append-only**: the app DB role has INSERT/SELECT only on this table. Index `(organization_id, occurred_at)`, `(target_type, target_id)`.

### platform_settings
PK `key` text, `value jsonb`, `updated_at`, `updated_by`.

### outbox_messages (+) — reliable post-commit side effects (notifications, SignalR fan-out, Pulse invalidation)
`id` bigint PK, `type`, `payload jsonb`, `created_at`, `processed_at`, `attempts`, `error`.

---

## 13. Billing (PRD §20.1)

### subscription_plans
`id` PK, `code` UNIQUE (`attendee_free│attendee_premium_monthly│attendee_premium_yearly│org_starter│org_pro_monthly│org_business_monthly│org_event_package_s│…`), `audience` (`attendee│organization`), `name`, `description`, `billing_period` (`none│month│year│one_time`), `price_minor` int (paise), `currency` char(3) default `INR`, `tax_inclusive` bool, `gateway_plan_id` null, `is_active`, `sort_order`, `created_at`.

### subscription_features
PK `(plan_id, feature_key)`, `enabled bool`, `limit_value int null` (null = unlimited). All numeric limits are seeded **null** until the D-20 values are approved; essential features are never represented as gated features.

### subscriptions
`id` PK, `plan_id` FK, `subscriber_type` (`attendee│organization`), `attendee_id` null FK, `organization_id` null FK, `CHECK` exactly one subscriber matching the type, `status` (`created│authenticated│active│pending│halted│cancelled│completed│expired`), `gateway`, `gateway_subscription_id` **UNIQUE** null, `current_period_start`, `current_period_end`, `cancel_at_period_end bool`, `cancelled_at`, `created_at`, `updated_at`.
**Partial UNIQUE `(attendee_id) WHERE status IN ('created','authenticated','active','pending')`**, and the same for `organization_id`, so retries never create duplicate live subscriptions.

### payments
`id` PK, `subscription_id` null FK, `event_purchase_id` null FK, `payer_type`, `attendee_id`/`organization_id`, `gateway`, `gateway_order_id` UNIQUE null, `gateway_payment_id` **UNIQUE** null, `amount_minor`, `tax_minor`, `fee_minor`, `currency`, `status` (`created│authorized│captured│failed│refunded│partially_refunded`), `refunded_minor` default 0, `failure_code`, `failure_reason`, `method` (`upi│card│netbanking│wallet`; no credentials, BR-28), `captured_at`, `created_at`.

### payment_webhooks
`id` PK, `gateway`, `gateway_event_id` **UNIQUE** (idempotency), `event_type`, `signature_valid bool`, `payload jsonb`, `received_at`, `processed_at`, `attempts`, `processing_error`.

### subscription_invoices
`id` PK, `invoice_number` UNIQUE (sequential per financial year, `QR/2026-27/000123`), `subscription_id` null, `payment_id` FK, `gateway_invoice_id` UNIQUE null, `amount_minor`, `tax_minor`, `period_start`, `period_end`, `issued_at`, `status`, `billing_name`, `billing_gstin` null.

### event_purchases (+) — §19.3 individual event packages
`id` PK, `organization_id`, `event_id` FK, `plan_id`, `status` (`pending│paid│refunded`), `created_at`. UNIQUE `(event_id, plan_id) WHERE status='paid'`.

### user_entitlements / organization_entitlements
PK `(attendee_id│organization_id, feature_key, source_type, source_id)`; `source_type` (`subscription│promo│event_purchase`), `enabled`, `limit_value`, `valid_from`, `valid_until`. Rebuilt in the same transaction as any subscription, promo or refund change. An expiry worker removes stale rows hourly (BR-27).

### promotional_access
`id` PK, `subscriber_type`, `attendee_id`/`organization_id`, `plan_id`, `granted_by` FK → organizer_users (admin), `reason`, `starts_at`, `ends_at`, `revoked_at`, `revoked_by`.

---

## 14. Relationship summary (PRD §11.2 check)

| PRD relationship | Enforced by |
|---|---|
| One attendee → one global profile | `user_profiles.attendee_id UNIQUE` |
| Attendee ↔ many events | `event_participants` with `UNIQUE(event_id, attendee_id)` |
| Organization → many events | `events.organization_id` FK |
| Availability belongs to event participation | `event_availability.participant_id` PK/FK |
| Intentions differ per event | `event_participant_intentions` keyed by participant |
| Connections associated with an event | `connections.origin_event_id` |
| Conversation → many messages | `messages.conversation_id` FK |
| Members define conversation access | `conversation_members` checked on every read/write |
| Many sessions per attendee | `attendee_sessions.attendee_id` (no unique) |

## 15. Constraint checklist (PRD §11.3, §20.1)
Username case-insensitive unique ✔ · display names duplicable ✔ · no duplicate participation ✔ · no duplicate pending requests ✔ · unique token hashes ✔ · messages reference conversations ✔ · organizer access restricted (app authorization + `organization_id` on every query) ✔ · unique gateway transaction IDs ✔ · idempotent webhooks ✔ · no payment credentials stored ✔
