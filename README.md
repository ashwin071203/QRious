# QRious

**QRious is One event. Many connections.** A QR-based event networking platform: attendees scan the event QR code,
browse public profiles or create a reusable profile, and connect and chat with people at the same event.
Organizers create events, share one QR code, configure networking and manage participants.

- Product spec: [docs/PRD.md](docs/PRD.md) · Planning pack & decisions: [docs/00-README.md](docs/00-README.md)
- Stack (D-29): Next.js 16 full-stack (React 19, Tailwind v4, Motion, React Three Fiber) · TypeScript API route handlers ·
  PostgreSQL (Neon) + Drizzle ORM · Vercel Blob · sharp · Vercel hosting

## Repository

```
frontend/   The application: UI (src/app), API (src/server + src/app/api/v1), migrations (drizzle/), tests
backend/    Phase 1 ASP.NET Core implementation (reference; superseded for deployment by D-29)
infra/      docker-compose for local PostgreSQL
docs/       PRD, decisions, architecture, schema, API, security, deployment, roadmap
```

## Run locally

Prerequisites: Node 24, Docker.

```bash
docker compose -f infra/docker-compose.yml up -d     # PostgreSQL 16
cd frontend
cp .env.example .env.local                           # local defaults
npm install
npm run db:migrate                                   # schema + reference taxonomy (no demo data)
npm run dev                                          # http://localhost:3000
```

Create an organizer account at `/organizer/register`, create and publish an event, then open the QR link it shows.

## Tests

```bash
cd frontend
npm test                    # 71 API/unit tests against real PostgreSQL (needs the docker DB, database qrious_test)
npm run typecheck && npm run lint
npm run build && npm start  # then:
npm run test:e2e            # Playwright full journeys, mobile + desktop
```

Against a deployment: `E2E_BASE_URL=https://qrious-rho.vercel.app npm run test:e2e`. The journeys create their own
organizer, event and attendees (all `…@example.com`); remove them afterwards with a one-off build:
`npx vercel deploy --prod --build-env QRIOUS_PURGE_E2E=1` (see `scripts/purge-e2e.ts`; it only touches E2E accounts).
The admin journey (`e2e/admin.spec.ts`) runs only with `E2E_ADMIN_TOKEN` set, because it consumes the one-time bootstrap.

## Deployment (Vercel)

`npm run vercel-build` runs migrations then `next build`. Required environment variables: `DATABASE_URL` (Neon),
`BLOB_READ_WRITE_TOKEN`, `QRIOUS_RECOVERY_PEPPER`, `QRIOUS_IP_SALT`, `CRON_SECRET`, `QRIOUS_ADMIN_BOOTSTRAP_TOKEN`.
Payments: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. TEST MODE ONLY (D-01): payments switch on only for
`rzp_test_` keys; live keys stay disabled unless `RAZORPAY_ALLOW_LIVE=1` is deliberately set at go-live. Razorpay Subscriptions must be
enabled on the account. Admin → Revenue → Razorpay shows a checklist (never secret values), creates the monthly/yearly plans in
Razorpay test mode (or links Dashboard-made plans after validating period/amount/currency) and shows the webhook URL and events.
Premium is granted only by the HMAC-verified webhook. Each build logs a payment configuration check (`scripts/check-gateway.ts`).

Organizer pricing (D-34): Starter is free with 3 lifetime events per organization; Pro ₹499/month; Business ₹1,499/month;
Single Event ₹199 (one extra event). Pro and Business are Razorpay subscriptions (create their plans in Admin → Revenue like Premium);
Single Event uses Razorpay Orders: the checkout signature is verified, then the payment is fetched (and captured) server-to-server,
and the `payment.captured` / `order.paid` webhooks grant the same credit idempotently. Add `payment.captured`, `payment.failed` and
`order.paid` to the webhook's events.

Live: https://qrious-rho.vercel.app (Neon PostgreSQL, Singapore). First admin: register an organizer, enter the token
from `QRIOUS_ADMIN_BOOTSTRAP_TOKEN` under Organizer → Account, then open `/admin` and enroll an authenticator app (D-24).
