# 02 — Decision Record: Contradictions, Risks and Product Decisions

**Last updated:** 2026-11-24, after product-owner review.

Status legend:
- ✅ **Approved**: product-owner decision, reflected in the PRD and technical docs.
- 🟦 **Provisional**: technical default adopted so Phase 1 can proceed; nothing user-visible depends on it irreversibly. Awaiting explicit confirmation.
- ⏳ **Open**: not yet decided; not implemented until decided.

| ID | Topic | Status |
|---|---|---|
| D-01 | Payments and subscriptions in the MVP | ✅ Approved with modification |
| D-02 | Revenue dashboard vs "no advanced analytics" | ⏳ Open (needed by Phase 8B) |
| D-03 | Organizer roles vs Business "multiple members" | ⏳ Open (needed by Phase 8) |
| D-04 | Premium priority visibility / "who saved you" | ⏳ Open (needed by Phase 8B) |
| D-05 | Connections across events | ✅ Approved with modification |
| D-06 | Published vs Active, networking window | ✅ Approved |
| D-07 | 3D effects scope | ✅ Approved |
| D-08 | Anonymous profile visibility default | ✅ Approved with consent requirement |
| D-09 | Hosting provider | ✅ Decided: free-first |
| D-10 | Custom domain and cookie architecture | ✅ Decided: no domain now; same-site proxy architecture |
| D-11 | Organizer transactional email | 🟦 Provisional (Phase 2) |
| D-12 | Structured "looking for" skills | 🟦 Provisional |
| D-13 | Session lifetime and account recovery | ✅ Approved (recovery code) |
| D-14 | Returning-attendee behaviour on both options | 🟦 Provisional (Phase 3) |
| D-15 | Pulse visibility and k = 5 suppression | 🟦 Provisional (Phase 6) |
| D-16 | Username format and change rules | 🟦 Provisional |
| D-17 | Image library licence | 🟦 Provisional |
| D-18 | Custom tag moderation | 🟦 Provisional |
| D-19 | Account deletion semantics | 🟦 Provisional (Phase 8) |
| D-20 | Free vs Premium limits | ✅ Business rule approved; ⏳ numeric limits open |
| D-21 | Event date/time model | 🟦 Provisional |
| D-22 | Max participants behaviour | 🟦 Provisional |
| D-23 | Organizer view of participants | 🟦 Provisional (Phase 8) |
| D-24 | Admin authentication (MFA) | 🟦 Provisional (Phase 8) |
| D-25 | Messages navigation | 🟦 Provisional (Phase 7) |
| D-26 | Full schema in Phase 1 | 🟦 Provisional (in effect via Phase 1 authorization) |
| D-27 | Early staging deployment | ✅ Implied by hosting decision |
| D-28 | Product name "QRious" | 🟦 Provisional |

---

## ✅ Approved decisions

### D-01 — Payments (approved with modification)
**Conflict:** PRD §14 excluded payments and subscriptions; §19–§21 required them.
**Decision:**
- Subscription plans, plan features, entitlements and **all billing tables** are part of the initial architecture (Phase 1 schema plus `IEntitlementService`; everyone is on Free/Starter).
- The actual gateway integration is built in **Phase 8B**, starting with **Razorpay test mode**.
- **Live payments are activated only after business verification (KYC) and explicit production approval.**
- PRD §14 is amended accordingly.

### D-05 — Connections across events (approved with modification)
**Decision:**
- Two attendees have **one persistent connection relationship**. No duplicate connection is created when they meet at more events. Enforced by a partial unique index on the normalized pair for `pending`/`accepted`.
- The relationship records `origin_event_id`: the event through which the connection was **originally** established.
- A connection **request** is initiated *through* an event: both must be active participants, and that event's settings must allow connection requests.
- **Conversations** are initiated through an event too. A conversation is created when the first message is sent (or on acceptance, if the origin event allows messaging). It requires an event both attendees participate in where messaging is enabled; that event is recorded as `conversations.origin_event_id`.
- **Accepted connections and existing conversations keep working after the event ends**, and are **never deleted or frozen** by organizer settings. Organizer toggles (`connections_enabled`, `messaging_enabled`) only control whether *new* requests and *new* conversations can be started through their event.
- An existing connection is only ended by the attendees themselves (remove/block) or by platform moderation.

### D-06 — Published vs Active (approved)
| Status | Landing page | Create profile / join | Networking features |
|---|---|---|---|
| Draft | 404 to public; organizer preview | ✗ | ✗ |
| Published | ✓ ("Networking opens …") | ✓ | ✗ until networking opens |
| Active | ✓ | ✓ | ✓ (subject to toggles) |
| Networking Paused | ✓ ("Networking paused") | ✓ | ✗ new activity; existing connections and conversations keep working (D-05) |
| Ended | ✓ ("Event ended") | ✗ | No new requests/conversations through this event; existing ones keep working |
| Archived | QR shows "event archived" | ✗ | ✗; listed under "Previous events" |

- **Published → Active automatically 24 hours before `starts_at`** (or earlier with organizer "Start networking now").
- **Active / Networking Paused → Ended automatically at `ends_at`.**
- Organizers can **pause and resume** networking manually at any time while Active.

### D-07 — 3D effects (approved)
Three.js / React Three Fiber **only** on the marketing homepage and organizer login experience. These are lazy-loaded, use a static fallback, and are disabled under `prefers-reduced-motion`, without WebGL, or on low-memory devices. QR landing, profile creation and all attendee networking pages stay lightweight (Framer Motion only). Budget for `/e/[code]`: LCP < 2.5 s on 4G, route JS < 170 KB gzipped.

### D-08 — Anonymous profile visibility (approved with consent requirement)
- The "Visible to visitors without a profile" toggle **defaults to ON** during profile creation.
- Next to the toggle, a **clear consent explanation** states exactly what visitors without accounts can see (display name, username, photo, short bio, profession, interests, skills, and anything else the attendee marks Public).
- A **prominent setting** (Profile → Privacy, also linked from the profile screen) lets the attendee turn anonymous visibility off at any time, taking effect immediately.
- **Private fields, contact information and social links are never shown to anonymous visitors** unless the attendee separately marks that specific item Public. Defaults: company, location and social links → *Members*. There are no contact fields (email/phone) on attendee profiles in the MVP.
- Consent is recorded (`anonymous_visibility_consented_at`).
- Existing anti-scraping mitigations apply (event-scoped only, cursor pagination, no anonymous totals, rate limits).

### D-09 / D-10 — Hosting and cookie architecture (decided: free-first)
- **Free tiers** for development and staging; **no custom domain now**; temporary provider URLs.
- **Correction to the earlier recommendation:** a custom domain is *not* required for secure cookies. What matters is that the browser sees the session cookie as **first-party**. That's achieved with a **same-origin arrangement**: the browser talks only to the frontend origin, and the frontend proxies `/api/*` to the backend. The API sets a host-only `__Host-qr_s` cookie that applies to the frontend origin. See [07 §2.1](07-security-and-authorization.md) and [08](08-deployment-architecture.md).
- Real-time (SignalR) connects directly to the backend over WebSockets with a **short-lived, single-use connection ticket** obtained through the same-origin API, so no cross-site cookie is needed.
- Before public production launch, domain and hosting costs will be **presented for approval**.

### D-13 — Session lifetime and account recovery (approved)
- **Sessions:** 30-day idle expiration (sliding), **180-day absolute lifetime**, secure renewal (token rotated at most every 24 h with a 2-minute grace window for in-flight requests), revocation (logout, per-device, all devices, admin, suspension).
- **Recovery code:** generated at profile creation and **displayed once**. The attendee is prompted to save, copy or download it. 120 bits of entropy, formatted `QRS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (Crockford base32).
- **Only a hash is stored** (HMAC-SHA-256 with a server-side pepper, plus a per-code salt). The raw code is never stored or logged.
- **Recovery** requires **username + recovery code** together; a username alone never recovers an account. Failed attempts are rate-limited per IP and locked per account (5 failures / hour). The same generic error is returned for unknown usernames and wrong codes.
- On successful recovery: a new session is issued, **all other sessions are revoked** (assume a lost or compromised device), the **recovery code is rotated** and the new code is shown once, and an in-app notification is recorded.
- The attendee can also regenerate the code from Settings → Account recovery (old code invalidated immediately).

### D-20 — Free vs Premium (business rule approved; numbers open)
**Approved rule:** the essential networking experience stays **free**. Free attendees always have profile creation, multiple event participation, Discover, basic Smart Matching, Event Pulse, Open to Talk, connection requests, private messaging, and privacy controls. Premium adds advanced features and convenience only, and never overrides another user's privacy or safety settings.
**Open:** numeric limits. The proposed values below are *not* final; the entitlement system reads them from `subscription_features` so they can be set without code changes. Until approved, **no limits are enforced** on essential features.

| Proposed (for review) | Free | Premium |
|---|---|---|
| Saved profiles | 25 | Unlimited |
| Discover filters | Interests, skills, availability, name search | + profession, intentions, company, location, "open now" |
| Smart Matching | Ranked matches with top reason | + detailed per-signal compatibility |
| Organizer Starter / Pro / Business: concurrent events | 1 / 10 / unlimited | — |
| Organizer participants per event | 300 / 2,000 / 10,000 | — |

---

## 🟦 Provisional technical defaults (summary)
- **D-11:** Resend free tier for organizer verification and reset email (Phase 2).
- **D-12:** optional "Looking for (skills)" chips plus free text; "can offer" from skills plus text.
- **D-14:** "Continue as {name}" on Create My Profile; Discover with a session shows identified mode only if already a participant.
- **D-15:** Pulse for participants and organizers; k = 5.
- **D-16:** username 3–30 chars `[a-z0-9_.]`, case-insensitive unique, 30-day change cooldown and 30-day hold, reserved words.
- **D-17:** SkiaSharp (MIT). ImageSharp was replaced because its current releases require a licence key for Release builds.
- **D-18:** custom tags normalized; usable immediately on own profile; suggested to others after admin approval.
- **D-19:** 14-day grace then anonymization.
- **D-21:** `starts_at` / `ends_at` UTC plus IANA time zone.
- **D-22:** joining refused when full.
- **D-23:** organizers see member-level card fields only.
- **D-24:** admins need TOTP MFA.
- **D-25:** Messages tab lists all conversations with an origin-event label.
- **D-26:** full schema in Phase 1.
- **D-28:** product name "QRious".

## ⏳ Open items (full analysis unchanged from the original review)
- **D-02:** build the §21 revenue dashboard as fixed aggregates; Pro/Business "analytics" as basic first versions.
- **D-03:** two fixed organization roles, Owner and Member.
- **D-04:** premium highlighting only in identified Discover with an organizer toggle; "who saved you" shows only savers who opt in (default off), otherwise a count.

## Product change log (PRD amendments made from these decisions)
| Decision | PRD section changed |
|---|---|
| D-01 | §14 (payments/subscription removed from exclusions, with test-mode and live-activation note); §13 roadmap (Phase 8B) |
| D-05 | M09 rules, M10 security, M17 note, §11.2 |
| D-06 | M14 status table (automatic transitions) |
| D-07 | Closing UI direction paragraph (3D scope) |
| D-08 | §3.2 Option 2 (consent and default) |
| D-13 | §3.4 last line, M02 features, §12.1 |
| D-20 | §19.2 (essential features stay free) |
