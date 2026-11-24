# 09 — Implementation Roadmap

PRD §13 phases are preserved. Adjustments are sequencing only (D-01, D-26, D-27). **Gate:** each phase ends with all tests green, a staging deploy, a demo checklist, and your sign-off before the next phase.

| Phase | Scope (PRD §13) | Planning additions | Exit criteria (excerpt) |
|---|---|---|---|
| **1 Foundation** | Backend + frontend setup, PostgreSQL, EF Core, migrations, attendee identity, secure sessions, profile management, skills and interests | Full schema migration (D-26); seed taxonomy and categories; atomic create-profile-and-join against a seeded event; design-system foundations; CI; **staging deploy** (D-27) | Profile created atomically; duplicate/retry tests pass; cookie flags verified; username case-insensitive uniqueness; staging reachable over HTTPS |
| **2 Organizer & events** | Organizer registration/login, organization profiles, event creation/editing/publishing, participation | Email provider; event lifecycle worker; plan limits read from entitlements | Org isolation tests; lifecycle transitions; publish validation |
| **3 QR entry & onboarding** | QR generation, landing page, both options, anonymous browsing entry, profile flow, returning attendees | QR state pages; "Continue as" (D-14); camera capture | Landing has exactly two options; creation lands on event home; anonymous creates no rows |
| **4 Discovery** | Public browsing, identified discovery, search, filters, details, privacy enforcement | Trigram search; DTO leakage tests; anti-scraping limits | Authorization matrix for discovery passes |
| **5 Networking** | Smart Matching, Open to Talk, event preferences, explanations, dismissal | Structured looking-for (D-12) | Matching unit tests (worked examples, including the PRD music producer → vocalist case) |
| **6 Event Pulse** | Statistics, live activity, SignalR, trends | k = 5 suppression; organizer hub | Live update < 3 s; small-group suppression tests |
| **7 Connections & messaging** | Requests, accept/decline, history, conversations, real-time messaging, notifications | Outbox; idempotent send; read receipts; typing | Only accepted, unblocked pairs can message; real-time E2E test |
| **8 Organizer & safety** | Participant management, networking config, privacy settings, blocking, reporting, moderation, admin | Admin MFA; taxonomy moderation; deletion worker | Block enforcement across all modules; admin audit |
| **8B Billing** *(new, D-01)* | PRD §19–§21: Razorpay **test mode** (live only after KYC and production approval), checkout, webhooks, invoices, attendee/organizer billing screens, admin revenue dashboard | Promotional access | Webhook idempotency and tamper tests; no activation without a verified webhook |
| **9 Testing & go-live** | Functional, API, security, QR, anonymous, session, real-time tests; backups; production hosting; HTTPS; monitoring | ZAP scan; restore drill; load test (k6: 2k WebSocket connections, 200 req/s discovery); legal pages | PRD §15 acceptance table fully passing on production |
| **10 Mobile** | React Native/Expo, Android, iOS, shared APIs, native QR scanning, push | Bearer-token session variant | — |

---

## Phase 1 — detailed plan (awaiting approval)

**Backend**
1. Solution skeleton (`QRious.Api/Application/Domain/Infrastructure` + three test projects), `net10.0`, central package management, analyzers, `.editorconfig`.
2. `docker-compose.yml`: PostgreSQL 16 (MinIO images are no longer publicly pullable; development media uses local disk).
3. EF Core `QRiousDbContext` with **every table in 04-database-schema.md**, snake_case, constraints, partial unique indexes, and the initial migration plus migration bundle.
4. Seeders: event categories, ~300 interests and ~300 skills grouped, category suggestions, networking intentions per category, one demo organization and event with an active QR (dev and staging only).
5. Attendee session authentication handler (30 d idle / 180 d absolute, 24 h rotation with grace), cookie issuance, logout, session list/revoke; **recovery code** issue/regenerate/recover with rotation (D-13); proxy-secret IP trust; Origin + header CSRF middleware; rate limiter; ProblemDetails; Serilog; health checks; OpenAPI/Swagger.
6. Taxonomy search endpoints with normalization (NFKC, aliases).
7. `POST /onboarding/profile` atomic transaction with idempotency; username availability and suggestions.
8. Profile management endpoints (`/me/profile*`, privacy, social links, photo upload through SkiaSharp → local disk / R2).
9. `IEntitlementService` returning Free/Starter defaults (D-01).
10. Tests: normalization, username rules, atomic rollback (inject a failure at each step → no rows), idempotent retry, concurrent same-username race (exactly one wins), cookie flags, revoked or expired sessions, upload validation, DTO snapshots.

**Frontend**
1. Next.js app, Tailwind v4 tokens, fonts, Radix-based primitives, motion config, lint/test setup, generated API client.
2. Design-system pages: buttons, chips, ChipPicker, cards, avatar, form fields, sheet, toast, skeletons, empty states.
3. Same-origin API proxy route (`/api/v1/[...path]`). **Dev entry** at `/e/[code]/join` against the seeded demo event (the full landing page with both options arrives in Phase 3): profile creation form with photo preview/camera, anonymous-visibility consent (D-08), the **one-time recovery-code screen**, an event home, profile view/edit, privacy settings, account recovery page, sessions and recovery-code settings.
4. Vitest and Playwright smoke test: create profile → lands on event home (not Discover) → reload keeps session.

**DevOps**
1. GitHub Actions CI (build/test both apps).
2. Dockerfile; `render.yaml`; Vercel config; **free-tier staging** (Vercel Hobby + Render Free + Neon Free + R2/Supabase storage, 08 §2). Needs your free accounts.

**Phase 1 is done when:** CI is green; staging URL works over HTTPS; you can create a profile on your phone against the demo event, see your profile, edit it, upload a photo, and come back later still signed in.

---

## Phase 1 — status (2026-11-24)

| Item | Status |
|---|---|
| Backend solution, central packages, .NET 10 LTS | ✅ Done |
| Full schema (63 tables, all constraints / partial unique indexes) + initial migration | ✅ Done |
| Seed data: 13 categories, ~190 interests and skills, aliases, category suggestions, intentions, plans/features (limits null, D-20), demo event `DEMO2026QRUS` | ✅ Done |
| Attendee sessions (30 d idle / 180 d absolute, 24 h rotation with grace, reuse detection, revocation, bearer for mobile) | ✅ Done |
| Recovery codes (shown once, peppered HMAC, username + code, lockout, rotation, regenerate) | ✅ Done |
| Atomic create-profile-and-join with idempotency; returning-attendee join | ✅ Done |
| Profile management, interests/skills with normalization + aliases + custom pending tags, social links, privacy with consent (D-08), photo upload (SkiaSharp → WebP) | ✅ Done |
| Event lifecycle worker (D-06), entitlement service (D-01) | ✅ Done |
| CSRF (Origin + header), proxy-secret IP trust, rate limits, ProblemDetails, health checks, Swagger | ✅ Done |
| Frontend: design system, QR landing (two options), Create My Profile, recovery-code screen, event home, My Events, profile view/edit, privacy & sessions & recovery settings, recovery page, same-origin API proxy | ✅ Done |
| Tests: 46 unit, 30 integration (real PostgreSQL), 8 Playwright E2E (mobile + desktop) | ✅ All passing locally |
| CI workflow, Dockerfile, Render blueprint | ✅ Written (CI runs once pushed to GitHub) |
| Free-tier staging deployment | ⏳ Waiting for your free accounts (Render, Neon, R2 or Supabase) and approval to push to GitHub |

Pulled forward from Phase 3 (needed so the QR flow works end to end): QR resolution endpoint and landing page with both options.
Discover People shows an interim "coming soon" page until Phase 4.
