# 10 — Engineering Guidelines (PRD §18 "Master Instructions")

These apply to every contributor, human or AI. After approval this file will also be linked from a root `CLAUDE.md`.

## Non-negotiables
1. **Never change approved product behaviour without explicit approval.** The PRD (`docs/PRD.md`) plus approved decisions (`docs/02-decisions-and-conflicts.md`) are the source of truth. If an implementation needs a product change, stop and ask.
2. Preserve the approved flows exactly:
   - The QR landing page shows **exactly two** primary options: Discover People and Create My Profile.
   - Anonymous browsing creates **no** attendee, session or participation.
   - Profile creation is atomic, joins the current event, and redirects to the **event home, never Discover**.
   - One global profile per attendee; event intentions and availability are per participation.
   - Only accepted, unblocked connections can message; organizers never read messages.
3. Every sensitive permission is enforced on the backend. The frontend only hides; it never protects.

## Backend standards
- Feature folders per module; cross-module access only through `Contracts` interfaces or domain events.
- Controllers are thin: validate → call service → map to an audience DTO. Never return EF entities.
- All writes that span tables run in one transaction; side effects go through the outbox.
- UTC everywhere (`DateTimeOffset`/`timestamptz`); convert to the event time zone only in presentation.
- Errors: ProblemDetails with stable `code`. No exception text or stack traces in responses.
- No PII, tokens or message bodies in logs.
- Async all the way; `CancellationToken` on every endpoint and query; `AsNoTracking` for reads.
- Migrations: one per feature, reviewed SQL, backward-compatible with the previous release.

## Frontend standards
- TypeScript strict; no `any` without a comment; generated API types only.
- Server components for public, cacheable pages; client components for the authenticated app.
- Every screen has loading (skeleton), empty, error and offline states.
- Mobile-first (360 px baseline); 44 px touch targets; AA contrast; full keyboard support; reduced motion honoured.
- Design tokens only (no ad-hoc hex values); Lucide icons only; no stock photos for people.
- No secrets or tokens in client code or localStorage.

## Testing requirements
- **Unit:** domain rules, normalization, matching, Pulse suppression, state machines.
- **Integration:** every endpoint against real PostgreSQL (Testcontainers), including the authorization matrix (07 §11).
- **E2E (Playwright, mobile viewport):** Journeys A–E from the PRD.
- A PR can't merge if tests fail, coverage on Application drops below 80%, or a DTO snapshot changes without review.

## Git workflow
- `main` is always deployable; feature branches `phase-N/<topic>`; squash-merge PRs with a description of the requirements covered (IDs from 01).
- Conventional commits (`feat(profiles): …`). Never commit secrets or `.env*` (except `.env.example`).

## Definition of done (per feature)
Requirement IDs referenced · backend authorization enforced and tested · UI states complete · accessibility check passed · docs/OpenAPI updated · deployed to staging · demoed.
