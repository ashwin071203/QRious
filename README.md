# QRious

**One event. Many connections.** A QR-based event networking platform: attendees scan the event QR code,
browse public profiles or create a reusable profile, and connect with people at the same event.

- Product spec: [docs/PRD.md](docs/PRD.md) · Planning pack: [docs/00-README.md](docs/00-README.md)
- Stack: Next.js 16 (React 19, Tailwind v4, Motion) · ASP.NET Core 10 · EF Core 10 · PostgreSQL 16

## Repository

```
backend/    ASP.NET Core 10 modular monolith (Api, Application, Domain, Infrastructure) + xUnit tests
frontend/   Next.js app: QR landing, onboarding, attendee app, same-origin API proxy, Playwright E2E
infra/      docker-compose for local PostgreSQL
docs/       PRD, decisions, architecture, schema, API, security, deployment, roadmap
render.yaml Render blueprint for the API (free tier staging)
```

## Run locally

Prerequisites: .NET 10 SDK (or newer SDK), Node 24, Docker.

```bash
docker compose -f infra/docker-compose.yml up -d          # PostgreSQL 16

cd backend
dotnet run --project src/QRious.Api --launch-profile http  # http://localhost:5080 — migrates + seeds demo event
# Swagger UI: http://localhost:5080/swagger

cd ../frontend
cp .env.example .env.local
npm install
npm run dev                                               # http://localhost:3000
```

Open **http://localhost:3000/e/DEMO2026QRUS**, the seeded demo event's QR landing page.

## Tests

```bash
cd backend && dotnet test                 # unit + integration (Testcontainers PostgreSQL; Docker required)
cd frontend && npm run typecheck && npm run lint
cd frontend && npm run build && npm start # then, with the API running (RateLimiting__Enabled=false):
cd frontend && npm run test:e2e           # Playwright, mobile + desktop
```

## Security notes

- Attendee sessions: opaque 256-bit tokens, SHA-256 hash stored, HttpOnly first-party cookie via the same-origin proxy,
  30-day idle / 180-day absolute, 24 h rotation. Recovery codes: shown once, peppered HMAC stored.
- Never commit secrets. Configure them as environment variables (see `frontend/.env.example`, `render.yaml`).
