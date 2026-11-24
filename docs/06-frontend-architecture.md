# 06 — Frontend Architecture

## 1. Stack
| Concern | Choice |
|---|---|
| Framework | Next.js (latest stable, App Router), React 19, TypeScript strict |
| Styling | Tailwind CSS v4 with design tokens from PRD §9.2 as CSS variables |
| Components | Own component library on Radix UI primitives (accessible dialogs, menus, tabs, toggles), styled in-house |
| Motion | `motion` (Framer Motion), honouring `prefers-reduced-motion` through `MotionConfig reducedMotion="user"` |
| 3D | `three` + `@react-three/fiber` + `@react-three/drei`, **marketing and organizer-auth hero only**, dynamic import, `ssr:false` (D-07) |
| Icons | `lucide-react` |
| Data | TanStack Query (cache, retries, optimistic updates); typed client generated from OpenAPI (`openapi-typescript` + `openapi-fetch`) |
| Forms | `react-hook-form` + `zod` (schemas mirror server rules; the server stays authoritative) |
| Real-time | `@microsoft/signalr` in one `RealtimeProvider`; events update the Query cache |
| Images | `next/image` (AVIF/WebP), stock photos self-hosted in `/public/images` with an attribution manifest |
| Testing | Vitest + Testing Library (units), Playwright (E2E on mobile and desktop viewports), axe accessibility checks |
| Lint/format | ESLint (next, jsx-a11y), Prettier |

## 2. Route map (App Router)

```
app/
├─ (marketing)/page.tsx                   # QRious home (3D hero), for organizers & attendees
├─ (public)/e/[code]/
│   ├─ page.tsx                           # ★ QR landing — SSR, event details + EXACTLY TWO options
│   ├─ discover/page.tsx                  # Anonymous discovery (or identified per D-14)
│   ├─ discover/[profileId]/page.tsx      # Public profile card + "Create a profile to connect" gate
│   └─ join/page.tsx                      # ★ Create My Profile (or "Continue as…" if session)
├─ (public)/qr/[state]/page.tsx           # invalid / revoked / expired / disabled explanations
├─ (public)/recover/page.tsx              # account recovery: username + recovery code (D-13)
├─ api/v1/[...path]/route.ts              # same-origin proxy to the ASP.NET Core API (D-10)
├─ app/                                    # Attendee app (client data, session required)
│   ├─ events/[eventId]/
│   │   ├─ home/page.tsx                  # ★ Post-creation destination (never Discover)
│   │   ├─ discover/page.tsx, discover/[profileId]/page.tsx
│   │   ├─ matches/page.tsx
│   │   ├─ pulse/page.tsx
│   │   ├─ availability/page.tsx          # Open to Talk + intentions + pause discovery
│   │   └─ layout.tsx                     # Current-event header + bottom nav
│   ├─ messages/page.tsx, messages/[conversationId]/page.tsx
│   ├─ connections/page.tsx               # tabs: Connections · Received · Sent
│   ├─ notifications/page.tsx
│   ├─ events/page.tsx                    # My Events: current / upcoming / previous
│   ├─ profile/page.tsx, profile/edit/page.tsx, profile/preview/page.tsx
│   ├─ settings/{privacy,blocked,notifications,sessions,recovery,account}/page.tsx
│   └─ premium/page.tsx                   # Upgrade to Premium / billing (Phase 8B)
├─ organizer/
│   ├─ (auth)/login, register, verify-email, forgot-password, reset-password
│   ├─ dashboard/page.tsx
│   ├─ events/page.tsx, events/new/page.tsx
│   ├─ events/[eventId]/{overview,edit,preview,qr,participants,networking,pulse,reports}/page.tsx
│   ├─ organization/page.tsx, organization/members/page.tsx
│   └─ billing/page.tsx
└─ admin/{users,organizations,events,reports,taxonomy,categories,system,audit,subscriptions,payments,plans,revenue}/page.tsx
```

### Navigation
- **Attendee (PRD §5):** bottom tab bar on mobile and left rail on desktop. Tabs are **Home · Discover · Event Pulse · Messages · Profile**. Home has shortcut cards for Smart Matches, Connections, Notifications, My Events, Open to Talk, and Privacy & Settings. A persistent **current-event header** (name, status chip, event switcher) appears on every event-scoped screen.
- **Organizer (PRD §6):** violet sidebar with Dashboard · Events · QR Management · Participants · Networking Configuration · Organization Settings (+ Billing & Plans). QR, Participants and Networking open an event picker when no event is selected.
- **Admin:** separate layout and sidebar; requires MFA.

## 3. Critical flow behaviour (preserved from PRD)

**QR landing `/e/[code]`**
1. Server component calls `/public/qr/{code}`. Invalid, revoked, expired or disabled codes render the matching state page with a friendly explanation.
2. Renders hero (banner + gradient overlay), details in event-local time, networking status, and **two equal, prominent buttons**: *Discover People* and *Create My Profile*. No third primary action. The organizer link and "What is QRious?" are secondary text links.
3. A client island calls `/me/session?eventId=` and personalizes the button subtitles only ("Continue as Ashwin" under Create My Profile). The two options are never replaced.

**Create My Profile `/e/[code]/join`**
- Session valid → "You're already on QRious" card with avatar and a **Continue as {name}** button → `POST /events/{id}/participation` → `/app/events/{id}/home`.
- No session → a single-page form in three short visual sections (no wizard friction): *Photo (optional)* · *Who you are* (display name, username with live availability check) · *Interests & Skills* (searchable chips, category suggestions first, "Add '{text}'" custom chip). Then a collapsed **"Add more (optional)"** accordion with bio, profession, company/college, location, looking for (text + skills), can offer, social links. Then the **"Show my profile to visitors without a profile"** toggle (D-08).
- Photo: file input (`accept="image/*"`) plus **Take photo** through `capture="user"` on mobile; `getUserMedia` camera modal on desktop where supported. Client-side preview, crop to square, replace and remove; client checks type and size (≤5 MB); the server is authoritative.
- The anonymous-visibility toggle defaults to **ON** with the consent explanation directly beside it: "Visitors without a QRious profile can see your display name, username, photo, bio, profession, interests and skills for events you join. Social links, company and location stay hidden unless you make them public. You can turn this off anytime in Privacy." (D-08)
- Submit → `POST /onboarding/profile` with the Idempotency-Key (stored in sessionStorage so a retry or reload doesn't create a duplicate) → photo upload if chosen (resized in the browser to ≤ 1600 px / ≤ 1 MB) → **"Save your recovery code" screen** (copy, download `.txt`, "I've saved it" confirmation; shown once, D-13) → `router.replace(redirectTo)`, which is **always the event home**, never Discover.

**Recovery `/recover`**: username + recovery code → new session → shows the **new** code once → `/app`.

**API access:** the browser calls `/api/v1/*` on the web origin; `app/api/v1/[...path]/route.ts` proxies to the API (forwarding cookies, `Set-Cookie`, client IP and the proxy secret). SignalR uses a ticket from `/api/v1/realtime/ticket` (Phase 6/7).

**Anonymous gating**
Member-only buttons (Connect, Save, Message, Smart Matches) appear on public cards but open a **"Create your profile to connect"** sheet that links back to `/e/[code]/join`. They never call member APIs.

## 4. State and data
- Server state lives in TanStack Query. Keys are scoped by `eventId` (`['event', id, 'people', filters]`).
- SignalR events patch caches: `messageReceived` adds to `['conversation', id]` and bumps `['conversations']` / `['unread']`; `pulseUpdated` replaces `['event', id, 'pulse']`.
- Optimistic UI for availability changes, connect, accept and send message (with `clientMessageId` for reconciliation).
- No auth tokens in JS. The session is an HttpOnly cookie and fetch uses `credentials: 'include'`. Nothing sensitive goes in localStorage (only UI preferences).
- Middleware: `/app/*` redirects to `/` with a "Scan an event QR to get started" page when there's no session cookie (presence check only; the API is authoritative). `/organizer/*` and `/admin/*` work the same with the organizer cookie.

## 5. Design system (PRD §9)
- **Tokens:** `--bg #100B1D`, `--bg-2 #19112B`, `--card #211735`, `--primary #8B5CF6`, `--accent #A78BFA`, `--accent-light #C4B5FD`, `--pink #E879F9`, `--text #F8F7FC`, `--text-2 #A9A0BA`, `--success #34D399`, `--error #F87171`. Gradient `--grad-primary: linear-gradient(135deg,#8B5CF6,#E879F9)` used for primary actions and heroes only.
- **Type:** Inter (UI) + Space Grotesk (display), via `next/font`.
- **Surfaces:** rounded-2xl cards, 1px `rgba(196,181,253,.12)` borders, soft violet shadows, glass panels (`backdrop-blur` with solid fallback) used selectively.
- **Components:** Button, IconButton, Chip/ChipPicker, Avatar (initials fallback; never stock photos, BR-33), ProfileCard, MatchCard (score ring + reasons), StatusPill (Open to Talk colours), PulseCounter (animated number), PulseBar/Donut, EventHeader, BottomNav, Sheet, Dialog, Toast, Skeleton, EmptyState (illustrated), ChatBubble, TypingDots, QRPreview.
- **Motion:** page transitions (fade/slide 200 ms), card stagger entrance, hover lift, modal spring, counter tween for Pulse, score-ring draw for matches, status-pill morph, message pop-in, typing dots, chip select bounce. Everything is disabled or reduced under reduced motion.
- **Accessibility:** WCAG 2.2 AA contrast (secondary text `#A9A0BA` on `#100B1D` is ≈7.9:1 ✔), visible focus rings (`--accent-light` 2px), 44px touch targets, labelled controls, live regions for new messages, keyboard-complete dialogs.
- **Performance:** landing route has no 3D and no SignalR; the banner is preloaded; fonts subset; images in AVIF/WebP; route-level code splitting; Lighthouse CI budget (D-07).

## 6. Mobile readiness
All API access goes through a `packages/api-client` (generated types), shareable with the future Expo app. UI logic lives in hooks (`useDiscover`, `usePulse`) separate from presentation so it can be reused.
