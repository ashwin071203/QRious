# 05 — Backend API Specification (v1)

Base URL as seen by browsers: **`{web origin}/api/v1`**. The Next.js web origin proxies to the API (same-origin cookies, D-10). Native mobile clients call the API host directly with a bearer token. SignalR hubs are on the API host, authenticated with a short-lived ticket. JSON, camelCase. The live OpenAPI document at `/swagger` is generated from code and is the binding contract. This file is the design intent.

## Conventions
- **Auth column:** `Anon` (no auth; may be enriched if a session exists) · `Att` (attendee session) · `Part` (attendee who is an active participant of `{eventId}`) · `Org` (member of the owning organization) · `Owner` (organization owner) · `Admin` (PlatformAdmin + MFA) · `Sig` (gateway signature).
- **Errors:** RFC 9457 ProblemDetails with a stable `code`, for example `username_taken`, `existing_identity`, `profile_required`, `event_not_joinable`, `event_full`, `feature_disabled`, `blocked`, `not_connected`, `rate_limited`, `qr_revoked`, `qr_expired`, `qr_disabled`, `entitlement_required`, `validation_failed` (with a field map).
- **Restricted anonymous actions** return `401` with `code: "profile_required"`, which the UI turns into the "create a profile to connect" explanation (BR-03).
- **Pagination:** cursor-based. `?cursor=&limit=` (default 20, max 24 for discovery, 50 elsewhere). Responses: `{ items, nextCursor }`. Anonymous responses never include totals.
- **Writes** accept an `Idempotency-Key` header where noted. Unsafe methods require an allowed `Origin` and the `X-QRious-Client: web|mobile` header (CSRF defence, see 07).
- **IDs** in URLs are public UUIDs. The internal attendee ID is never exposed; people are referenced by `profileId`.
- **Times** are ISO-8601 UTC; event payloads include `timeZone` for local display.

---

## 1. Public (QR entry, landing, anonymous discovery) — M01, M05
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/public/qr/{code}` | Anon | Resolve a QR code → `{ state: valid│revoked│expired│disabled│event_unavailable, event? }`. Unknown code → 404 `qr_invalid` |
| GET | `/public/events/{eventId}` | Anon | Landing payload: name, banner URLs, category, starts/ends, timeZone, venue, description, organizer {name, logo}, `networkingStatus` (`not_open│open│paused│ended`), `options { discoverAvailable, anonymousBrowsing, createProfileAvailable }`, `headline` (k-anonymized, D-15) |
| GET | `/public/events/{eventId}/people` | Anon | Anonymous discovery: `q` (display name/username prefix), `interests[]`, `skills[]`, `cursor`. Opted-in public profiles of active, non-paused participants; public fields only. Requires `anonymous_browsing_enabled` and networking open |
| GET | `/public/events/{eventId}/people/{profileId}` | Anon | Public profile card (public fields, public social links only). 404 if not public in that event |
| GET | `/public/events/{eventId}/facets` | Anon | Interests and skills available as filters (k ≥ 5 only) |
| GET | `/public/categories` | Anon | Event categories |

## 2. Attendee identity and onboarding — M02
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/onboarding/username-availability?u=` | Anon | `{ available, normalized, suggestions[] }` (rate-limited 30/min/IP) |
| GET | `/taxonomy/interests?q=&categoryId=` | Anon | Search approved interests; category suggestions first |
| GET | `/taxonomy/skills?q=&categoryId=` | Anon | Same for skills |
| POST | `/onboarding/profile` | Anon (+ `Idempotency-Key`) | **Atomic create** (03 §4.1). Body: `qrCode`, `displayName`, `username`, `interests[] {id│name}`, `skills[] {id│name}`, `isPublic` (default true) + `anonymousVisibilityConsent` (required true when `isPublic`), optional `bio, profession, company, location, lookingForText, canOfferText, lookingForSkills[], socialLinks[]`. → `201 { profile, eventId, redirectTo, recoveryCode }` + Set-Cookie. `recoveryCode` is returned **only on first creation**, never on idempotent replay. `409 existing_identity` if a session already exists |
| POST | `/recovery` | Anon | `{ username, recoveryCode }` → `200 { newRecoveryCode, redirectTo }` + Set-Cookie; all other sessions revoked; code rotated. Failure → generic `401 recovery_failed` (same for unknown username). Rate limit 5/15 min per IP; account lock 1 h after 5 failures |
| POST | `/me/recovery-code/regenerate` | Att | Invalidates the old code → `{ recoveryCode }` (shown once) |
| GET | `/me/recovery-code/status` | Att | `{ createdAt }` (never the code) |
| POST | `/realtime/ticket` | Att or Org | `{ hubUrl, ticket, expiresAt }` (single-use, 60 s) |
| GET | `/me/session` | Anon/Att | `{ authenticated, profile?: {id, displayName, username, photoUrl}, participations? }`; with `?eventId=` adds `isParticipant` |
| POST | `/me/session/logout` | Att | Revoke the current session; clear the cookie |
| GET | `/me/sessions` | Att | List own active sessions (device summary, last seen) |
| DELETE | `/me/sessions/{sessionId}` | Att | Revoke a session |

## 3. Profile and settings — M03, M12
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/me/profile` | Att | Full own profile including all privacy settings |
| PATCH | `/me/profile` | Att | Edit fields (username: format, uniqueness, 30-day rule) |
| PUT | `/me/profile/interests` | Att | Replace set (1–20) |
| PUT | `/me/profile/skills` | Att | Replace set (1–20) |
| PUT | `/me/profile/looking-for-skills` | Att | Replace set (0–10) |
| PUT | `/me/profile/social-links` | Att | Replace list (≤10) with per-link visibility |
| PUT | `/me/profile/photo` | Att | multipart `file` (jpeg/png/webp/heic, ≤5 MB) → validated, re-encoded → `{ photoUrl }` |
| DELETE | `/me/profile/photo` | Att | Remove photo (object deleted) |
| GET | `/me/profile/preview?as=public│member│connection` | Att | Shows the profile as each audience sees it |
| GET/PATCH | `/me/privacy` | Att | `isPublic` (turning on requires `anonymousVisibilityConsent: true`), `companyVisibility`, `locationVisibility` (`public│members│connections`); `showSavedMe` reserved for D-04 |
| GET/PUT | `/me/notification-preferences` | Att | M11 preferences |
| POST | `/me/deletion-request` | Att | Start deletion (D-19): account hidden everywhere, other sessions revoked; the current session is limited to the cancel screen |
| DELETE | `/me/deletion-request` | Att | Cancel within the 14-day grace period from the requesting device |

## 4. Participation and availability — M04, M08
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/me/events?scope=current│upcoming│previous` | Att | My events |
| POST | `/events/{eventId}/participation` | Att (+ Idempotency-Key) | Join (`qrCode` optional; checks joinable, full, removed) → event home |
| DELETE | `/events/{eventId}/participation` | Part | Leave event (pending requests from this event are withdrawn) |
| GET | `/events/{eventId}/me` | Part | My participation: availability, intentions, discoveryPaused |
| PATCH | `/events/{eventId}/me` | Part | `discoveryPaused`, `availabilityStatus`, `availabilityVisibility`, `intentions[]`, `exportConsent` → Pulse update |
| GET | `/events/{eventId}` | Part | Event summary for the attendee app |
| GET | `/events/{eventId}/home` | Part | Event home aggregate: event summary, my status, pending requests count, top 3 matches, pulse headline, unread counts, quick actions |
| GET | `/events/{eventId}/intentions` | Part | Intentions configured for the event |

## 5. Discovery and matching — M05, M06
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/events/{eventId}/people` | Part | Identified discovery: `q`, `interests[]`, `skills[]`, `profession`, `intentions[]`, `availability[]`, `company`, `location` (advanced filters require entitlement), `cursor`. Each card includes `commonInterests[]`, `complementarySkills[]`, `availability`, `connectionState` |
| GET | `/events/{eventId}/people/{profileId}` | Part | Member-level profile (connections-only fields included when connected) |
| GET | `/events/{eventId}/matches` | Part | Smart Matches: `{ profile, score, reasons[], breakdown? }` (breakdown is premium) |
| POST | `/events/{eventId}/matches/refresh` | Part | Recompute (rate-limited) |
| POST | `/events/{eventId}/matches/{profileId}/dismiss` | Part | Dismiss (BR-15) |
| GET | `/me/saved-profiles` | Att | Saved list |
| PUT | `/me/saved-profiles/{profileId}` | Att | Save (`eventId` in body; free-tier limit) |
| DELETE | `/me/saved-profiles/{profileId}` | Att | Unsave |
| GET | `/me/saved-by` | Att | Premium: count, plus profiles that opted in (D-04) |

## 6. Event Pulse — M07
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/events/{eventId}/pulse` | Part or Org | `{ totals {participants, discoverable, openToTalk, lookingForCollaborators}, byStatus[], byIntention[], topInterests[], topSkills[], activity[] }`. All k-anonymized; refreshed live through the hub |

## 7. Connections — M09
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/events/{eventId}/connections` | Part (+ Idempotency-Key) | `{ profileId, introMessage? }`. Checks: both active participants of `eventId`, the event's connection requests enabled, networking open, not blocked, cooldown, rate limit (20/h, 100/day). Existing accepted connection → `409 already_connected` (one persistent relationship per pair, D-05). `origin_event_id = eventId` |
| GET | `/me/connections?status=accepted` | Att | Accepted connections (with origin event) |
| GET | `/me/connection-requests?direction=received│sent` | Att | Pending requests |
| POST | `/connections/{id}/accept` | Att (addressee) | Accept → creates/reopens the conversation, notifies |
| POST | `/connections/{id}/decline` | Att (addressee) | Decline (requester isn't told explicitly; the request just leaves "pending") |
| POST | `/connections/{id}/withdraw` | Att (requester) | Withdraw |
| DELETE | `/connections/{id}` | Att (member) | Remove connection (conversation becomes read-only) |

## 8. Messaging — M10
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/conversations` | Att | List: other profile, last message preview, lastMessageAt, unreadCount, originEvent, canSend |
| POST | `/conversations` | Att | `{ profileId, eventId }`: start a conversation through an event (accepted connection, both participants, the event's messaging enabled). Returns the existing pair conversation if one exists (idempotent, D-05) |
| GET | `/conversations/{id}/messages?before=&limit=` | Att (member) | History, newest first |
| POST | `/conversations/{id}/messages` | Att (member) | `{ clientMessageId, body }` (≤4000 chars; 30/min). Rechecks membership, accepted connection, blocks, active accounts. **Not** affected by event end or organizer toggles (D-05) |
| POST | `/conversations/{id}/read` | Att (member) | `{ lastReadMessageId }` → read receipts |
| GET | `/me/unread-counts` | Att | `{ messages, notifications, requests }` |

**Hub `/hubs/attendee`**: `JoinEvent(eventId)` (participant check), `LeaveEvent`, `Typing(conversationId)`, `MarkRead(conversationId, messageId)`. Server events: `messageReceived`, `messageRead`, `typing`, `notification`, `connectionChanged`, `pulseUpdated`, `unreadCounts`.

## 9. Notifications — M11
| GET | `/me/notifications?cursor=` | Att | List |
|---|---|---|---|
| POST | `/me/notifications/{id}/read` | Att | Mark one read |
| POST | `/me/notifications/read-all` | Att | Mark all read |

## 10. Safety — M12
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/me/blocks` | Att | Blocked list |
| PUT | `/me/blocks/{profileId}` | Att | Block (removes connection, hides both sides everywhere) |
| DELETE | `/me/blocks/{profileId}` | Att | Unblock |
| POST | `/reports` | Att | `{ profileId, eventId?, messageId?, reason, details }` (10/day) |

## 11. Organizer auth and organization — M13
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/organizer/auth/register` | Anon | Email, password (≥12 chars, breached-password check), name → verification email |
| POST | `/organizer/auth/confirm-email` | Anon | Token |
| POST | `/organizer/auth/login` | Anon | Cookie sign-in; lockout after 5 failures/15 min; admin requires TOTP |
| POST | `/organizer/auth/logout` | Org | |
| POST | `/organizer/auth/forgot-password`, `/reset-password` | Anon | Email flow (always returns 202) |
| GET | `/organizer/me` | Org | User + organizations + roles |
| POST | `/organizations` | Org | Create organization (creator becomes Owner) |
| GET/PATCH | `/organizations/{orgId}` | Org / Owner | View / edit profile |
| PUT/DELETE | `/organizations/{orgId}/logo` | Owner | Logo upload / remove |
| GET/POST/DELETE | `/organizations/{orgId}/members[/{userId}]` | Owner | Business plan: invite or remove members |
| GET | `/organizations/{orgId}/dashboard` | Org | Totals, active events, participants, live activity, recent events |

## 12. Event management, QR, configuration — M14, M15, M17
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organizations/{orgId}/events?status=` | Org | Event list |
| POST | `/organizations/{orgId}/events` | Org | Create draft (category defaults applied to settings, suggestions, intentions) |
| GET/PATCH | `/organizer/events/{eventId}` | Org | View / edit (`xmin` concurrency) |
| PUT/DELETE | `/organizer/events/{eventId}/banner` | Org | Banner upload / remove |
| GET | `/organizer/events/{eventId}/preview` | Org | Landing payload for a draft |
| POST | `/organizer/events/{eventId}/publish` | Org | Validate required fields + plan limits → Published (auto-creates the QR if none) |
| POST | `.../unpublish`, `.../pause-networking`, `.../resume-networking`, `.../start-networking`, `.../end`, `.../archive` | Org | Lifecycle transitions (state machine in 03 §4.4); audited |
| GET/PUT | `/organizer/events/{eventId}/networking-settings` | Org | M17 toggles |
| PUT | `/organizer/events/{eventId}/suggestions` | Org | `{ interestIds[], skillIds[], intentionIds[] }` |
| POST | `/organizer/events/{eventId}/networking-settings/reset-defaults` | Org | Category defaults |
| GET | `/organizer/events/{eventId}/qr` | Org | Active QR: code, URL, status, enabled |
| GET | `/organizer/events/{eventId}/qr/image?format=png│svg&size=` | Org | Download (PNG 1024–4096 px, SVG) |
| POST | `/organizer/events/{eventId}/qr/regenerate` | Org | Revoke the old QR and issue a new one (audited) |
| POST | `/organizer/events/{eventId}/qr/revoke` | Org | Revoke without a replacement |
| PUT | `/organizer/events/{eventId}/qr/access` | Org | `{ enabled }` enable/disable QR access |

## 13. Participant management — M16
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organizer/events/{eventId}/participants?q=&status=&interest=&skill=&cursor=` | Org | Member-level card fields only (D-23) |
| GET | `/organizer/events/{eventId}/participants/stats` | Org | Counts by status/availability (Pro: detailed) |
| POST | `/organizer/events/{eventId}/participants/{participantId}/remove` | Org | Remove with reason (audited; attendee notified) |
| POST | `.../participants/{participantId}/restore` | Org | Restore access |
| GET | `/organizer/events/{eventId}/reports` | Org | Reports tied to this event (no message bodies unless attached by the reporter) |
| POST | `/organizer/events/{eventId}/reports/{reportId}/escalate` | Org | Send to platform admin |
| GET | `/organizer/events/{eventId}/participants/export` | Org (Pro) | CSV of consenting participants only (BR-29) |

**Hub `/hubs/organizer`**: `WatchEvent(eventId)` (ownership check) → `pulseUpdated`, `participantCountChanged`.

## 14. Billing — M18 (Phase 8B; PRD §20.2 endpoints kept, namespaced)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/plans?audience=attendee│organization` | Anon | Plans and features |
| GET | `/subscriptions/current` | Att or Org (`?organizationId=`) | Current plan, status, renewal date |
| POST | `/subscriptions/checkout` | Att / Owner (+ Idempotency-Key) | `{ planCode, organizationId? }` → `{ gateway, keyId, subscriptionId│orderId }` |
| POST | `/subscriptions/change-plan` | Att / Owner | Upgrade/downgrade/cycle change (gateway update) |
| POST | `/subscriptions/cancel` | Att / Owner | `{ atPeriodEnd: true }` |
| POST | `/subscriptions/restore` | Att / Owner | Undo a pending cancellation |
| POST | `/organizations/{orgId}/event-purchases` | Owner | Per-event package order |
| GET | `/payments/history` | Att / Owner | Payments and invoices |
| GET | `/invoices/{id}/pdf` | Att / Owner (owner of invoice) | Invoice PDF |
| GET | `/entitlements` | Att or Org | Effective feature flags and limits |
| — | *Gateway runs in Razorpay **test mode** until KYC and production approval (D-01)* | — | — |
| POST | `/payments/webhook/razorpay` | Sig | Verify HMAC (`X-Razorpay-Signature`), store, process idempotently, always 200 after a durable store |

## 15. Admin — PRD §7, §20, §21
All `/admin/*` require `Admin` and are audited.
| Area | Endpoints |
|---|---|
| Users | `GET /admin/attendees?q=` · `GET /admin/attendees/{profileId}` · `POST …/suspend` · `POST …/restore` · `POST …/revoke-sessions` |
| Organizers/orgs | `GET /admin/organizations?q=` · `POST /admin/organizations/{id}/suspend│restore` · `GET /admin/organizer-users?q=` |
| Events | `GET /admin/events?q=&status=` · `POST /admin/events/{id}/suspend│restore` |
| Reports | `GET /admin/reports?status=` · `POST /admin/reports/{id}/assign│resolve│dismiss` · `GET /admin/moderation-actions` |
| Taxonomy | `GET/POST/PATCH /admin/interests`, `/admin/skills` (approve, reject, merge, aliases) · `GET/POST/PATCH /admin/categories` · `GET/POST/PATCH /admin/intentions` · `PUT /admin/categories/{id}/suggestions` |
| System | `GET /admin/system/health` · `GET /admin/system/activity` (signups, joins, messages/day) · `GET /admin/audit-logs?…` |
| Billing | `GET /admin/subscriptions` · `GET /admin/payments?status=` · `GET/POST/PATCH /admin/plans` · `POST /admin/promotional-access` · `POST /admin/promotional-access/{id}/revoke` · `POST /admin/payments/{id}/refund-record` · `GET /admin/revenue?from=&to=` (§21 metrics) |

## 16. Health
`GET /health/live` (process), `GET /health/ready` (DB, storage). Detailed output only to Admin or an internal network.
