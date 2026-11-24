# 07 — Security & Authorization Plan

## 1. Threat model (top risks)
| Threat | Asset | Primary controls |
|---|---|---|
| Session theft or forgery | Attendee identity | 256-bit random tokens, hash-only storage, HttpOnly/Secure host-only cookies, 30 d idle / 180 d absolute, 24 h rotation, revocation, no tokens in URLs or localStorage |
| Recovery-code guessing or theft | Attendee identity | 120-bit codes, peppered HMAC hashes, username + code required, rate limits, lockout, rotation after use, all sessions revoked on recovery |
| Username impersonation | Trust | Username is never an authenticator (BR-06); verified identity is out of MVP scope; 30-day handle hold |
| Profile scraping / enumeration | Attendee privacy | Event-scoped discovery, cursor pagination, no anonymous totals, per-IP limits, random profile IDs, edge bot protection |
| Broken object-level authorization (IDOR) | Messages, profiles, events | Resource-based authorization handlers on every endpoint; queries always filtered by caller scope |
| Private-field leakage | Attendee privacy | Audience-specific DTO projections; no entity serialization; contract tests per audience |
| Harassment/spam | Attendees | Blocks enforced server-side, connection gating, rate limits, reports, moderation |
| Cross-tenant organizer access | Organizer data | `organization_id` ownership checks; integration tests for every organizer endpoint |
| Malicious uploads | Server and users | Decode-and-re-encode, size and pixel limits, random keys, no SVG uploads |
| CSRF | All cookie-authenticated writes | SameSite=Lax + Origin allow-list + custom header requirement |
| XSS | Sessions, UI | React escaping, no `dangerouslySetInnerHTML` for user content, strict CSP, HttpOnly cookies |
| Payment fraud / forged success | Revenue | Webhook HMAC verification, server-side status only, idempotent processing |
| Admin compromise | Everything | MFA, separate role, audit logs, short admin session |

## 2. Authentication

### 2.1 Attendee (passwordless, M02)
- **Token:** 32 bytes from `RandomNumberGenerator`, base64url in the cookie. The DB stores `SHA-256(token)` (unique). Lookup is constant-time by hash equality. Validation results are cached in memory for 60 s, and the cache is evicted on revoke.
- **Same-site arrangement (D-10, no custom domain required):** browsers never call the API host directly for REST. The Next.js web origin forwards `/api/v1/*` to the API through a server-side proxy route. The API's `Set-Cookie` is passed back unchanged and has **no `Domain` attribute**, so the browser stores it as a **host-only first-party cookie of the web origin** (for example `qrious-web.vercel.app`). This works the same on free provider URLs (including Public-Suffix-List hosts like `*.vercel.app`, because the cookie is never shared across hosts) and on a future custom domain.
- **Cookie:** `__Host-qr_s` · `HttpOnly` · `Secure` · `SameSite=Lax` · `Path=/` · no `Domain` · `Max-Age` = time remaining until idle expiry (≤ 30 days). In local development over `http://localhost` the name is `qr_s` with `Secure` off (config `Auth:Cookie:Secure=false`); this config is rejected at startup outside Development.
- **Proxy trust:** the proxy adds `X-QRious-Proxy: <shared secret>` and `X-Forwarded-For` (client IP). The API trusts forwarded client IPs **only** when the secret matches (constant-time compare). Otherwise the socket IP is used for rate limiting. Direct calls without the secret are still authorized normally; the secret only governs IP trust.
- **Lifetimes (D-13):** idle expiry **30 days** (sliding: every authenticated request at least 1 h after the last renewal pushes `expires_at` to now + 30 d, capped at the absolute limit); **absolute lifetime 180 days** from creation, after which recovery (or a new profile) is needed. Revoked on logout, user action (per device or all), recovery, suspension, deletion or admin action. Suspended attendees are rejected at the auth handler.
- **Secure renewal / rotation:** when the token is older than 24 h, the handler issues a new token, keeps the old hash as `previous_token_hash` valid for 2 minutes (so parallel in-flight requests don't log the user out), and sets the new cookie. Reuse of a previous token after its grace window is treated as possible theft: that session is revoked.
- **Mobile (future):** the same token in `Authorization: Bearer`, stored in secure storage; `client_kind = mobile`.
- **Creation:** only by `POST /onboarding/profile` or successful `POST /recovery`, never by browsing (BR-02). The handler never authenticates from a username.

### 2.1b Recovery codes (D-13)
- Generated from 15 random bytes (120 bits) → Crockford base32 → `QRS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. Shown **once** (creation, regeneration, after recovery), never logged, and never included in idempotency snapshots.
- Stored as `HMAC-SHA-256(pepper, salt ‖ normalized code)`. The pepper is a server secret (`Security__RecoveryPepper`), not in the database. Because the code has high entropy, a fast keyed hash is appropriate; the pepper means a database leak alone can't be used to test candidate codes.
- Recovery needs **username + code**; a username alone never recovers an account. Normalization accepts lowercase, missing dashes and the confusable letters `I/L→1`, `O→0`.
- Brute force: per-IP limit 5 attempts/15 min; per-account lock 1 h after 5 consecutive failures; generic error for every failure (no username enumeration); failures audited.
- Success: all sessions revoked → new session → code rotated (old row `used`, new `active`) → notification "Your account was recovered on a new device".

### 2.2 Organizer and admin
- ASP.NET Core Identity: PBKDF2 (Identity v3, 600k iterations), min 12 characters, rejected against the HaveIBeenPwned k-anonymity range API, lockout 5 attempts / 15 min, email confirmation required before publishing events.
- Cookie `__Host-qr_org` (host-only on the web origin through the same proxy as §2.1) · HttpOnly · Secure · SameSite=Lax · 8 h sliding, 7 d with "remember me". Admin cookies last 1 h and admins need **TOTP MFA** (D-24).
- Security stamp validation every 5 min (password change or suspension logs out everywhere).

An attendee session and an organizer session can coexist in one browser. They're separate schemes and identities, and no endpoint accepts both interchangeably.

## 3. Authorization model

### 3.1 Policies
| Policy | Requirement |
|---|---|
| `Attendee` | Valid attendee session; attendee `active` (deactivated accounts may only reach the deletion-cancel screen) |
| `EventParticipant` | `Attendee` + `event_participants(event, me).status = active` + event not suspended |
| `EventFeature:{x}` | Participant + event status allows networking (D-06) + `event_networking_settings.x = true` |
| `OrgMember` / `OrgOwner` | Organizer session + membership/role in the organization that owns the resource |
| `PlatformAdmin` | Organizer session + `PlatformAdmin` role + MFA claim |

### 3.2 Resource rules (checked on the server for every request)
| Action | Rule |
|---|---|
| View public profile (anon) | Event allows anonymous browsing and networking is open; target is an active, non-paused participant **of that event**; `is_public = true` (consented, D-08); attendee active. Only fields/links individually marked `public` are returned; social links, company and location default to `members` |
| View member profile | Both are active participants of the event; target not discovery-paused (unless already connected); no block either way |
| Field-level visibility | `public` fields → anyone allowed above; `members` → identified co-participants; `connections` → accepted connection only; availability uses `event_availability.visibility` |
| Send connection request | `EventFeature:connections`; target active participant; no block either way; no live connection; cooldown; rate limit |
| Accept/decline | Caller is the addressee and the status is pending |
| Start conversation | Accepted connection; no block; the given event is shared by both, with messaging enabled and networking open (D-05) |
| Read/send messages in an existing conversation | Caller ∈ `conversation_members`; connection `accepted`; no block either way; both accounts active. **Independent of event status and organizer toggles** (D-05). Rechecked on **every** send |
| Send connection request | (see above) plus the event's `connections_enabled`; an existing accepted pair can't create a second connection |
| Account recovery | Username + valid recovery code; rate limits and lockout (§2.1b) |
| Join hub group `evt:{id}` | `EventParticipant` (Pulse feature on) |
| Organizer event actions | `OrgMember` of `events.organization_id`; billing/member management requires `OrgOwner` |
| Organizer participant view | Member-level card fields only (D-23); never messages, blocks, saves or connections-only data |
| Reports visible to organizer | Reports with `event_id` = their event; message excerpts only if attached by the reporter |
| Admin | Everything except reading conversations. Admins see a message only when a reporter attached it to a report |

### 3.3 Implementation rules
- Each endpoint declares a policy; resource checks use `IAuthorizationService` with resource handlers or scoped query filters (`WHERE organization_id = @callerOrg`). No endpoint trusts IDs from the client for ownership.
- **DTO projection per audience** (`PublicProfileDto`, `MemberProfileDto`, `ConnectionProfileDto`, `OrganizerParticipantDto`, `OwnProfileDto`). Integration tests snapshot every DTO's field list so adding a private field to a public DTO fails CI.
- Blocks are applied as a reusable query filter (`NotBlocked(viewer)`) used by discovery, matching, profile view, connections, messaging and Pulse membership lists.
- Premium entitlements never appear in authorization checks for other users' data (BR-24).

## 4. CSRF, CORS, headers
- SameSite=Lax cookies; unsafe methods require (a) `Origin` (or `Referer` when Origin is absent) in the allow-list (`App:WebOrigins`, for example the staging web origin) **and** (b) header `X-QRious-Client: web|mobile`. A cross-site form can't set custom headers, and a cross-site fetch with a custom header triggers a CORS preflight, which is refused. Mobile bearer requests carry no cookie and are exempt from the Origin check.
- CORS: REST needs none (same-origin through the proxy). The API enables CORS only for the hub endpoints (`/hubs/*`) for the configured web origins, **without credentials**, because hubs authenticate with tickets.
- Headers: `Strict-Transport-Security: max-age=63072000; includeSubDomains`, CSP on the web (`default-src 'self'; img-src 'self' {storage public URL} data: blob:; connect-src 'self' {API host https+wss} https://*.sentry.io; script-src 'self' 'nonce-…'; frame-ancestors 'none'`; Razorpay hosts are added in Phase 8B), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), geolocation=(), microphone=()`.

## 5. Rate limits (initial; tuned in Phase 9)
| Partition | Limit |
|---|---|
| Anonymous discovery list (per IP) | 30 requests/min, 300/hour |
| Anonymous profile view (per IP) | 60/min |
| QR resolve / landing API (per IP) | 120/min |
| Username availability (per IP) | 30/min |
| Profile creation (per IP) | 5/hour, 20/day |
| Recovery attempts (per IP) | 5/15 min (plus per-account lock) |
| Realtime tickets (per session) | 30/min |
| Join event (per attendee) | 20/hour |
| Connection requests (per attendee) | 20/hour, 100/day |
| Messages (per attendee) | 30/min, 1,000/day |
| Reports (per attendee) | 10/day |
| Photo uploads (per attendee) | 10/hour |
| Organizer login (per IP + per account) | 10/min + Identity lockout |
| Webhook | Not limited by IP; signature required |

The client IP comes from `X-Forwarded-For` only when the request carries a valid proxy secret (§2.1). A future Cloudflare front would use `CF-Connecting-IP`, trusted only from Cloudflare ranges.

## 6. Input and uploads
- FluentValidation on every request; max lengths match DB constraints; URLs must be `https://`, with `javascript:`/`data:` rejected; social URLs validated per platform host.
- Images: content sniffed by decoding with SkiaSharp (not by extension or MIME), formats JPEG/PNG/WebP (HEIC converted to JPEG in the browser before upload), ≤5 MB, ≤4096×4096 and ≤16 MP (decompression-bomb guard), re-encoded to WebP (strips EXIF/GPS), stored under random 128-bit keys. SVG is never accepted from users.
- Custom tags: NFKC normalization, length 2–50, profanity filter, `pending` status (D-18).
- Text output is always escaped; chat messages render as plain text with linkified URLs (`rel="noopener noreferrer nofollow ugc"`).

## 7. Privacy and data protection
- Data minimization: attendees provide no email, phone or real name (display names can be pseudonyms).
- Logs never contain tokens, message bodies, or profile free text. IPs are stored only as salted hashes (rotated monthly) in the audit log.
- Event Pulse: aggregate only, k = 5 suppression on the server (D-15).
- Organizers can never access private messages; admins see message content only when attached to a report by a participant.
- Deletion and anonymization per D-19; data export (DPDP Act / good practice) planned for v1.1. Privacy policy and terms pages are required before production launch (also needed for Razorpay KYC).
- Backups are encrypted at rest by the provider; deleted-account data ages out of backups within the retention window (30 days).

## 8. Payments security
- Razorpay **test-mode** keys only until KYC and explicit production approval (D-01); live keys are configured only in the production environment.
- Razorpay key secret and webhook secret live only in server environment variables.
- Webhook: verify `X-Razorpay-Signature` (HMAC-SHA256 of the raw body) **before** parsing; store the raw event (unique `gateway_event_id`); process in a transaction; replays are no-ops.
- Checkout success callback: verify the payment signature server-side, then *poll* status; activation happens only through verified gateway state (BR-25).
- Amounts come from server-side plan records, never from the client. No card or UPI data touches our servers (BR-28).

## 9. Secrets and infrastructure
- Secrets live in the hosting provider's encrypted env vars; local secrets in `dotnet user-secrets` / `.env.local` (git-ignored). `.env.example` documents names only.
- Least-privilege DB roles: `qrious_app` (DML, no DDL, INSERT/SELECT only on `audit_logs`), `qrious_migrator` (DDL, used only by the release step).
- Dependabot plus `dotnet list package --vulnerable` and `npm audit` in CI; CodeQL on GitHub.
- TLS everywhere (provider-managed certificates on `*.vercel.app` / `*.onrender.com`; the proxy calls the API over HTTPS).
- Secrets required in Phase 1: `Security__RecoveryPepper`, `Security__IpHashSalt`, `Security__ProxySecret` (shared by web and API), DB connection strings, storage keys.

## 10. Audit logging (BR-22)
Logged: organizer login, failed login bursts, event create/publish/unpublish/pause/end/archive, settings changes, QR regenerate/revoke/enable/disable, participant remove/restore, report escalation, member changes, plan changes; every admin action; subscription state changes; session revocations by admin. Append-only, retained 2 years.

## 11. Security testing (Phase 9 plus continuous)
- Authorization matrix tests: for each endpoint × {anon, other attendee, non-participant, blocked user, participant, other org, org member, admin} → expected status.
- Session tests: forged, expired, revoked and suspended tokens; cookie flags; no token in responses or URLs.
- Anonymous tests: browsing creates no rows in `attendees`, `attendee_sessions` or `event_participants` (BR-02).
- DTO leakage snapshot tests; rate-limit tests; upload fuzzing (polyglots, bombs, wrong extensions); webhook replay and tamper tests.
- OWASP ZAP baseline scan against staging before launch.
