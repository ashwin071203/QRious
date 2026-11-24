# 03 — System Architecture

## 1. Overview

A modular monolith (PRD §10.1): one ASP.NET Core 10 process hosts REST APIs and SignalR hubs, one PostgreSQL database, S3-compatible object storage, and a Next.js frontend serving the public pages, the attendee app, the organizer dashboard and the admin panel.

```
 Browser ──HTTPS──► WEB ORIGIN (Next.js)                      e.g. https://qrious-web.vercel.app (staging, free tier)
                    ├─ pages (SSR public pages, client app)
                    └─ /api/v1/*  ── same-origin proxy ──────► ASP.NET Core 10 API ─┬─► PostgreSQL 16
                                    (adds X-Forwarded-For +                         ├─► S3-compatible storage (photos, banners, logos)
                                     proxy secret header)                           ├─► Email (organizer, Phase 2)
 Browser ──WSS (ticket)──────────────────────────────────────► /hubs/* (SignalR)   ├─► Razorpay test mode (Phase 8B)
                                                                                    └─► Sentry (errors)
```
**Same-site rule (D-10):** the browser only ever talks to the **web origin** for REST, so the session cookie is a host-only first-party cookie on that origin, whatever the provider URL. SignalR connects straight to the API with a 60-second single-use ticket fetched through the same-origin proxy (`POST /api/v1/realtime/ticket`), because free-tier frontend proxies don't forward WebSockets. With a custom domain later, the same design keeps working unchanged.

The future React Native app uses the same `/api/v1` and hubs. For mobile, the attendee session token goes in the platform keychain and is sent as a bearer token; the server-side session model stays the same.

## 2. Repository layout

```
QRious/
├─ backend/
│  ├─ QRious.sln
│  ├─ src/
│  │  ├─ QRious.Api/              # Host: controllers, hubs, auth handlers, middleware, OpenAPI, rate limits
│  │  ├─ QRious.Application/      # Module services, DTOs, validators, authorization rules (feature folders)
│  │  ├─ QRious.Domain/           # Entities, enums, value objects, domain rules (no dependencies)
│  │  └─ QRious.Infrastructure/   # EF Core DbContext, configurations, migrations, R2 storage, email, Razorpay, QR, images
│  └─ tests/
│     ├─ QRious.UnitTests/        # xUnit: domain rules, matching, normalization, pulse suppression
│     ├─ QRious.IntegrationTests/ # xUnit + WebApplicationFactory + Testcontainers PostgreSQL
│     └─ QRious.ArchitectureTests/# Module boundary rules (NetArchTest)
├─ frontend/                      # Next.js App Router, TypeScript
├─ infra/                         # docker-compose (PostgreSQL); Dockerfile in backend/, render.yaml at repo root
├─ docs/
└─ .github/workflows/             # CI: build, test, lint, e2e, images, deploy
```

### Module folders (same names in Domain, Application and Api)
`Identity` (attendee sessions), `Profiles`, `Taxonomy` (interests, skills, categories, intentions), `Organizations` (organizers, orgs, members), `Events` (events, QR, networking settings), `Participation` (+ availability), `Discovery`, `Matching`, `Pulse`, `Connections`, `Messaging`, `Notifications`, `Safety` (blocks, reports, moderation, deletion), `Billing` (plans, subscriptions, payments, entitlements), `Admin`, `Platform` (audit, settings, health).

**Boundary rules** (enforced by architecture tests):
- A module calls another module only through its public service interface in `Application/<Module>/Contracts`.
- Cross-module side effects (for example, "connection accepted → create conversation → notify → update Pulse") go through **in-process domain events** dispatched after commit (an outbox table guarantees delivery and SignalR push).
- Controllers never return EF entities, only audience-specific DTOs (see 07-security).

## 3. Backend technology choices

| Concern | Choice |
|---|---|
| Runtime | .NET 10 LTS, C# 14, nullable enabled, warnings as errors |
| Web | ASP.NET Core controllers, `[ApiController]`, ProblemDetails (RFC 9457) errors |
| Data | EF Core 10 + Npgsql, snake_case naming (EFCore.NamingConventions), UUIDv7 keys, `xmin` concurrency tokens |
| Validation | FluentValidation |
| Organizer/admin auth | ASP.NET Core Identity, cookie scheme `Organizer`, TOTP for admins |
| Attendee auth | Custom `AttendeeSession` authentication handler (opaque token in cookie or bearer, SHA-256 lookup) |
| Authorization | Policy-based: `Attendee`, `EventParticipant`, `OrgMember`, `OrgOwner`, `PlatformAdmin`, plus resource handlers |
| Real-time | SignalR (JSON protocol); Redis backplane only when scaling past one instance |
| Rate limiting | `Microsoft.AspNetCore.RateLimiting` (per IP / per attendee / per organizer partitions) |
| Background jobs | `BackgroundService` workers (status transitions, outbox dispatch, deletion processing, entitlement expiry). Hangfire later if needed |
| Logging | Serilog (JSON to stdout), Sentry sink, request correlation IDs; no PII in logs |
| API docs | OpenAPI document + Swagger UI at `/swagger` (disabled in production unless admin) |
| QR | QRCoder (PNG and SVG, error correction level Q) |
| Images | SkiaSharp (MIT): decode, validate, re-encode to WebP (512/128 px), strip metadata |
| Storage | AWSSDK.S3 against R2 or Supabase Storage; local disk served at `/media` in development |
| Payments | Razorpay behind an `IPaymentGateway` interface (Cashfree can be added later) |

## 4. Key flows

### 4.1 Atomic profile creation (BR-07, PRD §12.6)
`POST /api/v1/onboarding/profile` with `Idempotency-Key` header (UUID generated when the form opens and kept in `sessionStorage`).

1. If a valid attendee session cookie exists → `409 existing_identity` (the frontend shows "Continue as…", D-14).
2. Look up the idempotency key: if it's already completed with the same request hash, return the stored response and **re-issue the cookie for the stored session** (handles retries after network loss).
3. Validate (FluentValidation): required fields, username format, 1–20 interests, 1–20 skills, URLs.
4. Resolve the QR code → event; check it's joinable (status, QR enabled, not full).
5. `BEGIN` (Serializable not required; constraints do the work):
   - insert `attendees`, `user_profiles` (unique `username_normalized`), `profile_interests`, `profile_skills` (custom tags are upserted by normalized name), `social_links`
   - lock the event row (`SELECT … FOR UPDATE`) → check `max_participants` → insert `event_participants` + `event_availability` (default status, from the event intentions)
   - generate a 32-byte token → insert `attendee_sessions` (hash)
   - generate the **recovery code** → insert `attendee_recovery_codes` (salted HMAC hash only, D-13)
   - insert the idempotency record (response snapshot **without** the raw recovery code)
   - `COMMIT`
6. Unique violation on username → `409 username_taken` with suggestions. Any other failure rolls everything back, so there's never a partial account.
7. Set the cookie and respond `201 { redirectTo: "/app/events/{eventId}/home", recoveryCode }` (never Discover, BR-08). The frontend shows the recovery code **once** in a "Save your recovery code" step and then navigates to `redirectTo`. An idempotent replay does **not** return the code again; the user can regenerate it from Settings.

### 4.1b Account recovery (D-13)
`POST /api/v1/recovery` `{ username, recoveryCode }` → look up the profile by normalized username → load the active recovery-code row → if the attempt lock is set, return the generic error → constant-time compare of `HMAC(pepper, salt‖code)` → on failure increment the counter (lock 1 h after 5 failures) and return the generic `recovery_failed` → on success, in one transaction: revoke all sessions, create a new session, rotate the recovery code, record a notification → set the cookie → `200 { newRecoveryCode, redirectTo: "/app" }`.

The profile photo is uploaded **after** creation through `PUT /me/profile/photo`. The frontend does this right after step 7, before the redirect, using the preview the user already chose. This keeps the transaction free of slow object-storage I/O. A failed photo upload shows a non-blocking "Retry" on the home page, and the profile is still valid because the photo is optional.

### 4.2 Returning attendee
`GET /api/v1/me/session` returns `{ authenticated, profileSummary, participation(eventId)? }`. The landing page calls it client-side after the SSR render (so public HTML stays cacheable), then adjusts the two options per D-14. `POST /api/v1/events/{eventId}/participation` joins an event.

### 4.3 Real-time
Connection: the client calls `POST /api/v1/realtime/ticket` (same-origin, cookie-authenticated) → `{ hubUrl, ticket }` (random 32 bytes, hash stored in memory cache, single-use, 60 s TTL, bound to the attendee or organizer session). It then connects to `hubUrl?access_token=ticket` over WebSockets (fallback: SSE/long polling). The hub authentication handler consumes the ticket. Sessions revoked later are re-checked every 5 minutes on open connections, which are aborted if invalid.

Hubs:
- `/hubs/attendee` (attendee auth): groups `att:{attendeeId}` (messages, notifications, connection updates) and `evt:{eventId}` (Pulse, availability; joined only after a server-side participant check).
- `/hubs/organizer` (organizer auth): group `org-evt:{eventId}` (Pulse, participant counts) after an ownership check.

Server → client messages: `messageReceived`, `messageRead`, `typing`, `notification`, `connectionChanged`, `pulseUpdated`, `availabilityChanged` (aggregate only).
Client → server: `SendTyping(conversationId)`, `MarkRead(conversationId, messageId)`. **Sending messages goes through REST** (`POST /conversations/{id}/messages`) for idempotency and validation, then the server fans out over SignalR.
Pulse broadcasts are **debounced** per event (at most one every 3 s) and carry the same k-anonymized aggregate that the REST endpoint returns.

### 4.4 Event status automation
An `EventLifecycleWorker` runs every minute: Published → Active at `starts_at − 24h` (D-06); Active/Networking Paused → Ended at `ends_at`. Organizers can pause and resume at any time while Active. Every transition writes an audit entry and sends an event-update notification to participants.

### 4.4b Connections and conversations (D-05)
- **Request** `POST /events/{eventId}/connections`: requires both to be active participants of `eventId`, `connections_enabled`, and networking open. If the pair already has an accepted connection → `409 already_connected` (the UI shows "Connected"). If a pending request exists in the other direction → the UI offers "Accept".
- **Accept:** status → accepted; `origin_event_id` stays the request's event. If that event currently allows messaging, the conversation is created at once (`conversations.origin_event_id = origin event`).
- **Start conversation later** `POST /conversations` `{ profileId, eventId }`: needs an accepted connection, no block, and `eventId` an event both attendees participate in with messaging enabled and networking open. Idempotent: returns the pair's existing conversation if there is one.
- **Existing conversations** are unaffected by event end, pause, archive or organizer toggles (send checks are membership, accepted connection, no block, accounts active).

### 4.5 Billing (Phase 8B, Razorpay **test mode**; live keys only after KYC and production approval, D-01)
Checkout: the backend creates a Razorpay subscription or order, then the frontend opens Razorpay Checkout. A **webhook** (`subscription.activated`, `subscription.charged`, `payment.captured`, `payment.failed`, `subscription.cancelled`, `subscription.halted`, `refund.processed`) is HMAC-verified, stored once (`gateway_event_id` unique), processed in a transaction, and updates `subscriptions`, `payments`, invoices and entitlements. The frontend "success" callback only triggers a status **poll**; it never activates anything (BR-25).

## 5. Entitlements
Essential networking features (D-20) are **never** gated by entitlements: profile, multiple events, Discover, basic Smart Matching, Pulse, Open to Talk, connection requests, messaging, privacy controls. Numeric limits are read from `subscription_features` and are **not enforced until approved** (all limit values are seeded as `null` = unlimited).
`IEntitlementService.Has(subject, featureKey)` and `.Limit(subject, featureKey)` read a cached view built from `user_entitlements` / `organization_entitlements`. Defaults come from the Free/Starter plan. Feature keys, for example: `attendee.saved_profiles.limit`, `attendee.discover.advanced_filters`, `attendee.matching.detailed`, `attendee.profile.badge`, `attendee.saved_by.visibility`, `org.events.active.limit`, `org.participants.limit`, `org.pulse.advanced`, `org.reports.export`, `org.branding`, `org.members`. Entitlements never feed authorization for privacy-protected data (BR-20, BR-24).

## 6. Smart Matching algorithm (v1, rule-based, explainable)
Candidates: active participants of the same event who are discoverable, not blocked in either direction, not dismissed, not already connected, not the viewer, and whose account is active. Score 0–100:

| Signal | Weight | Computation |
|---|---|---|
| Looking-for ↔ offers | 30 | `viewer.looking_for_skills ∩ candidate.skills` (+ keyword hit on candidate `can_offer_text`) |
| Reverse fit | 15 | `candidate.looking_for_skills ∩ viewer.skills` |
| Shared interests | 25 | Overlap coefficient `|A∩B| / min(|A|,|B|)` |
| Shared event intentions | 15 | Overlap of event-specific intentions (for example "Looking for jam partners") |
| Profession similarity | 5 | Same normalized profession, or same profession group |
| Availability | 5 | Candidate is Available Now / Open to Conversations / Looking for Collaborators |
| Event relevance | 5 | Overlap with the event's suggested interests and skills |

The explanation is generated from the contributing signals ("You're looking for a vocalist — Priya sings", "3 shared interests: Indie, Jazz, Production"). Results are cached per viewer and event for 2 minutes, and refresh invalidates the cache. Premium (`attendee.matching.detailed`) shows the per-signal breakdown. Free shows the top reason only (D-20). Computed in SQL plus in-memory scoring; fine for events up to about 10k participants.

## 7. Event Pulse computation
One SQL aggregate per event over `event_participants` ⨝ `event_availability` ⨝ intentions/interests/skills, cached for 5 s in memory. Output: totals, discoverable, per-status counts, per-intention counts (event-type categories come from the event's configured intentions), top 8 interests and skills, and activity over the last 15 minutes (joins, status changes, accepted connections, all as counts). The k = 5 suppression (D-15) is applied **on the server** before caching.

## 8. Non-functional targets
| Metric | Target |
|---|---|
| Landing page LCP (mobile, 4G) | < 2.5 s |
| API p95 (non-search) | < 200 ms |
| Discover p95 | < 400 ms at 5k participants |
| Message delivery (send → recipient) | < 1 s p95 |
| Concurrent users per instance | ~2,000 WebSocket connections on a 1 GB instance |
| Availability | 99.5% (single region, MVP) |
| RPO / RTO | 24 h (daily backup; PITR when the plan allows) / 4 h |
