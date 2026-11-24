# 01 — Requirements Analysis

**Source:** `docs/PRD.md` v1.0 (read in full, §1–§21 plus the closing UI direction paragraph)
**Purpose:** Break the PRD down into modules, features and business rules so every later design decision can be traced back to a requirement. Nothing here changes product scope; conflicts are raised separately in [02-decisions-and-conflicts.md](02-decisions-and-conflicts.md).

ID conventions: `M##` module, `F-M##-##` feature, `BR-##` business rule, `NN-##` non-negotiable principle (PRD §16).

---

## 1. Actors

| Actor | Authentication | Scope |
|---|---|---|
| Anonymous visitor | None | Event landing page and opted-in public profiles of one event (when the organizer allows anonymous browsing) |
| Identified attendee | Passwordless browser session (HttpOnly cookie) | One global profile, many event participations |
| Organizer (organization owner/member) | ASP.NET Core Identity (email and password) | Their own organization's events only |
| Platform administrator | ASP.NET Core Identity with the `PlatformAdmin` role, plus MFA (proposed) | Whole platform, excluding private message content |
| Payment gateway (system actor) | Webhook HMAC signature | Billing state transitions only |

---

## 2. Module inventory (18 modules + admin + revenue dashboard)

### M01 — QR Entry
| ID | Feature |
|---|---|
| F-M01-01 | The QR code encodes a secure public event URL with no database IDs or credentials |
| F-M01-02 | Works with any standard scanner (Lens, camera); no app install needed |
| F-M01-03 | Resolves to the correct event landing page |
| F-M01-04 | Landing shows name, banner, category, date/time (in the event's local time), venue, description, organizer, networking status |
| F-M01-05 | Exactly two primary options: **Discover People** and **Create My Profile** |
| F-M01-06 | Distinct states for invalid, expired, disabled and revoked QR codes |
| F-M01-07 | Organizer can revoke QR access |

### M02 — Passwordless Attendee Identity
| ID | Feature |
|---|---|
| F-M02-01 | Internal attendee ID, never used as a public identifier |
| F-M02-02 | Secure browser session: random token, only the hash stored, Secure/HttpOnly/SameSite cookie |
| F-M02-03 | Recognize returning attendees by valid session |
| F-M02-04 | One identity reused across events |
| F-M02-05 | Session validation, expiration and revocation |
| F-M02-06 | Duplicate creation prevented (idempotency plus DB constraints) |
| F-M02-07 | Recovery code: shown once, hash stored, username + code recovery, rotation (D-13) |
| — | **Excluded:** email/password, Gmail/social login, OTP, mandatory email verification, forgot-password |

### M03 — User Profiles & Settings
Profile photo (upload, camera capture, preview, replace, remove, type/size validation, secure storage); edit display name, username, bio, profession/role, company/college, location; manage interests and skills; networking preferences; social and portfolio links; preview profile; profile visibility; account settings. One global profile; event-specific intentions and availability stored separately.

### M04 — Event Participation
Auto-join on profile creation; join additional events; current, upcoming and previous events; leave event; pause/resume discovery per event; event-specific preferences and availability; participation status. Anonymous browsing never creates participation. Joining does not prove physical attendance.

### M05 — Discover
Eligible profiles; search by display name and username; filter by interests, skills, profession and intentions; photos and short bios; common-interest and complementary-skill highlights; availability; detail view.
- **Anonymous discovery:** opted-in public profiles only, no member actions, no personalization, no private fields, no contact details unless explicitly public.
- **Identified discovery:** eligible participants of the selected event; respects event privacy; excludes blocked and discovery-paused profiles.

### M06 — Smart Matching
Rule-based and transparent (no AI). Signals: shared interests, complementary skills, similar profession, collaboration preferences, networking intentions, event relevance, looking-for versus can-offer. Features: recommendations, relevance score, explanation, highlights, refresh, dismiss, and dismissed profiles not shown again. Identified attendees only.

### M07 — Event Pulse
Totals: participants, discoverable, open to conversations, looking for collaborators; popular interests and skills; current activity; live updates on availability change; event-type-specific activity categories. Aggregated only, and small groups must be suppressed.

### M08 — Open to Talk
Statuses: Available Now, Open to Conversations, Looking to Meet New People, Looking for Collaborators, Interested in Quick Conversations, Temporarily Unavailable, Discovery Paused. Change any time, stored per event, shown on eligible cards, updates Pulse, respects privacy.

### M09 — Connections
Send (with optional intro), receive, accept, decline, withdraw; sent/received/accepted lists; remove; block; report. Rules: no duplicate pending requests, no requests involving blocked users, requests are event-scoped, only accepted connections can message, rate limits apply.

### M10 — Private Messaging
1:1 messages; real-time delivery (SignalR); persistent storage (PostgreSQL); conversation list; last-message preview; timestamps; unread counts; read status; typing indicator; block; report. Server verifies membership, connection and block status. Organizers have no access. **Excluded:** voice, video, group chat, attachments.

### M11 — Notifications
Connection request, request accepted, new message, event updates; in-app list; unread count; mark one or all read; preferences. No push or email in the MVP.

### M12 — Privacy & Safety
Public profile visibility, event discovery visibility, availability visibility, social link visibility, blocked list, report profile or behaviour, account deletion request, moderation review, rate limiting, anti-scraping, image validation, moderation audit records.

### M13 — Organizer Accounts
Registration, login, logout; organization profile (name, description, logo, contact); owned events; dashboard; simple owner role.

### M14 — Event Management
Required: name, category, date, start time, end time, venue. Optional: description, banner, organization details, website, max participants. Actions: create, save draft, edit, preview, publish, unpublish, pause/resume networking, end, archive. Statuses: Draft, Published, Active, Networking Paused, Ended, Archived.

### M15 — QR Management
Generate, preview, download image, copy/share URL, regenerate, revoke old, enable/disable QR access. One standard QR code per event in the MVP.

### M16 — Participant Management
View, search and filter (permitted fields only); participation status; remove; basic stats; review relevant reports; manage access. No access to private messages or private profile fields.

### M17 — Networking Configuration
Toggles: Discover, anonymous browsing, Smart Matching, Event Pulse, connection requests, messaging, availability. Choose suggested interests, skills and intentions. Event-type defaults so nothing must be configured manually.

### M18 — Subscription & Billing (PRD §19–§20)
Attendee plans (Free ₹0; Premium ₹99/month or ₹799/year). Organizer plans (Starter free; Pro ₹499/month; Business ₹1,499/month; per-event package ₹199–₹499). Razorpay or Cashfree; webhook-verified activation; renewals, failures, cancellation, refunds, billing history, invoices, promotional access, admin revenue tools.

### Admin Panel (PRD §7) and Revenue Dashboard (PRD §21)
Users (search, suspend, restore), organizations, events (view, suspend), reports, interests/skills/event categories, system activity, health and logs. Revenue: total, MRR, ARR, premium attendees, paid organizations, active and cancelled subscriptions, failed payments, conversion, monthly trend, popular plans. Figures come from verified payments, net of refunds, with taxes and fees accounted for.

---

## 3. Business rules (consolidated)

| ID | Rule | Source |
|---|---|---|
| BR-01 | The landing page always shows exactly two independent options, including for returning attendees | §3.2, §3.4, NN-03 |
| BR-02 | Anonymous browsing never creates an attendee, a session or a participation | §3.2, M04, NN-16 |
| BR-03 | Anonymous users who attempt a restricted action see an explanation that a profile is required | §3.2 |
| BR-04 | Mandatory fields: display name, username, ≥1 interest, ≥1 skill. Everything else is optional | §3.2, NN-05/06 |
| BR-05 | Username is globally unique and case-insensitive; display names can repeat | §3.2, NN-07/08 |
| BR-06 | A username is never proof of identity, and knowing a username does not expose a profile | §3.2, §3.4, §12.1 |
| BR-07 | Profile creation is atomic: identity, profile, interests, skills, participation, session | §3.3, §12.6 |
| BR-08 | After creation, redirect to the **event networking home**, never to Discover | §3.3, NN-10 |
| BR-09 | Profile creation joins the event whose landing page was used | §3.3, NN-09 |
| BR-10 | Returning attendees with a valid session reuse their profile, with no duplicate | §3.4, NN-02 |
| BR-11 | Event-specific intentions and availability are stored apart from the global profile | M03, NN-11 |
| BR-12 | Users control their own discovery visibility and availability | NN-12 |
| BR-13 | Anonymous discovery: opted-in public profiles only, with public fields only | M05 |
| BR-14 | Identified discovery excludes blocked users (both directions) and discovery-paused participants | M05 |
| BR-15 | Dismissed matches are not shown again | M06 |
| BR-16 | Pulse shows aggregates only and suppresses small groups | M07 |
| BR-17 | No duplicate pending connection requests; no requests between blocked users | M09 |
| BR-18 | Connection requests are event-scoped | M09, §11.2 |
| BR-19 | Only accepted connections can message; membership, connection and block status are checked on every send and read | M10, §12.3 |
| BR-20 | Organizers never read private messages or private profile fields, and no plan changes this | M10, M16, §19.6 |
| BR-21 | Organizers manage only their own organization's events | M14, §12.4 |
| BR-22 | Sensitive organizer actions are audit-logged | §12.4 |
| BR-23 | Timestamps are stored in UTC and shown in the event's local time | §12.5 |
| BR-24 | Premium never overrides another user's privacy, blocks or discovery settings | §19.2 |
| BR-25 | Premium activates only after a verified gateway webhook, never on a frontend report | §19.5 |
| BR-26 | Webhooks are idempotent; gateway transaction IDs are unique; retries never duplicate subscriptions | §19.6, §20.1 |
| BR-27 | Expired subscriptions revert to Free; cancellation never deletes profiles or messages; refunds update entitlements | §19.6 |
| BR-28 | No card numbers, UPI PINs or payment credentials are ever stored | §20.1 |
| BR-29 | Participant report exports require attendee consent | §19.3 |
| BR-30 | Revenue figures use verified payments only, excluding refunds, with tax and fees separated | §21 |
| BR-31 | The whole experience works in a mobile browser without installing an app | NN-18 |
| BR-32 | Animations respect `prefers-reduced-motion` | §9.5 |
| BR-33 | Profile photos come from user uploads only, never stock imagery | §9.3 |
| BR-34 | One persistent connection per pair, with origin event recorded; accepted connections and conversations survive event end and organizer toggles, which only govern *new* requests/conversations | D-05 |
| BR-35 | Networking opens automatically 24 h before start and closes at end; manual pause/resume | D-06 |
| BR-36 | Anonymous visibility defaults ON with an explicit consent explanation; it can be turned off anytime; contact info and social links are never public unless individually authorized | D-08 |
| BR-37 | Recovery code shown once, hash-only storage, username + code required, rotated after recovery; sessions 30 d idle / 180 d absolute | D-13 |
| BR-38 | Essential networking stays free; numeric premium limits are not enforced until approved | D-20 |
| BR-39 | Payments run in Razorpay test mode until business verification and production approval | D-01 |

---

## 4. Technical dependencies

| Dependency | Needed for | Status / notes |
|---|---|---|
| .NET 10 LTS (ASP.NET Core, EF Core 10, Identity, SignalR) | Backend | SDK 11.0.100 installed locally and can target `net10.0` |
| PostgreSQL 16+ | Persistence | Docker locally; managed in production |
| Next.js (App Router), React 19, TypeScript, Tailwind CSS v4 | Frontend | Node 24 installed |
| Framer Motion (`motion`), Lucide, Three.js / React Three Fiber | UI | R3F confined to marketing surfaces (see D-07) |
| `@microsoft/signalr` client | Real-time | — |
| S3-compatible object storage | Photos, banners, logos | Cloudflare R2 or Supabase Storage (S3 API); local disk in development |
| Image processing (SkiaSharp, MIT) | Validate, re-encode, strip EXIF | Chosen over ImageSharp, whose 3.2+ releases require a licence key for Release builds (D-17) |
| QR generation (QRCoder) | M15 | MIT licence |
| Transactional email provider | Organizer email verification and password reset | **Not in PRD**; needed for conventional organizer auth (D-11) |
| Payment gateway (Razorpay recommended) | M18 | Needs a business KYC account from you (D-01) |
| Error monitoring (Sentry) and uptime monitor | §12.5 | Free tiers are enough |
| Hosting, domain, DNS/TLS | §15 deployment criterion | Needs your accounts (D-09, D-10) |
| Royalty-free photography (Unsplash/Pexels) | §9.3 | Self-hosted, optimized to WebP/AVIF, attribution recorded |
