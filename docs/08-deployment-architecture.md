# 08 — Deployment Architecture (free-first)

**Decision (D-09/D-10):** free tiers for development and staging, temporary provider URLs, no custom domain yet. Costs for a public production launch will be presented for approval before any purchase (§7).

## 1. Environments
| Env | Purpose | Where | Data |
|---|---|---|---|
| Local | Development | `docker compose` (PostgreSQL 16) + `dotnet run` (media on local disk) + `next dev` | Seed data (categories, taxonomy, demo organization and event with QR `DEMO2026QRUS`) |
| Staging | Phase demos, phone testing | Free tiers (below), provider URLs | Separate free DB and bucket; resettable |
| Production | Public launch (Phase 9) | **To be proposed with costs for approval** | Managed PostgreSQL with backups |

## 2. Staging topology (free tiers)
```
Browser ─HTTPS─► Vercel Hobby  "qrious-web"  https://qrious-web-<id>.vercel.app
                 ├─ Next.js pages
                 └─ /api/v1/* → Route Handler proxy (adds X-QRious-Proxy secret + X-Forwarded-For)
                                    │ HTTPS
                                    ▼
                 Render Free Web Service "qrious-api" (Docker, ASP.NET Core 10)  https://qrious-api.onrender.com
                 ├─ /api/v1/*   (REST)
                 ├─ /hubs/*     (SignalR — browser connects directly with a ticket over WSS)
                 ├─► Neon Free PostgreSQL 16 (0.5 GB, auto-suspend; doesn't expire)
                 └─► Object storage: Cloudflare R2 free tier (10 GB) — or Supabase Storage free (1 GB, S3-compatible) if you prefer not to add a payment card
```

| Component | Free service | Limits to know |
|---|---|---|
| Web | **Vercel Hobby** | Free, but Hobby terms are for **non-commercial** use, so fine for dev/staging and must change before a paid launch. Function body limit 4.5 MB (photos are resized in the browser to ≤ 1 MB before upload) |
| API | **Render Free web service** | Spins down after 15 min idle (first request ~30–60 s cold start); 750 instance-hours/month; WebSockets supported |
| Database | **Neon Free** | 0.5 GB storage, compute auto-suspends when idle (sub-second resume), point-in-time restore for 24 h. (Render's free Postgres is avoided because it expires after 30 days) |
| Storage | **Cloudflare R2** (10 GB free, needs a card on file) or **Supabase Storage** (1 GB free, no card) | Both are S3-compatible; same code, different config |
| Errors | Sentry Developer (free) | 5k errors/month |
| CI | GitHub Actions | Free minutes for the repo |

Why this split: the web/API split keeps the PRD stack (Next.js + ASP.NET Core) on free tiers, and the same-origin proxy keeps the session cookie first-party with no domain purchase (07 §2.1).

## 3. Cookie configuration (same-site arrangement)
| Setting | Local | Staging/Production |
|---|---|---|
| Browser-visible API base | `http://localhost:3000/api/v1` (Next proxy) | `https://<web-origin>/api/v1` (Next proxy) |
| Session cookie | `qr_s`, HttpOnly, SameSite=Lax, not Secure | `__Host-qr_s`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain |
| Cookie scope | `localhost:3000` | the web origin host only |
| Hub URL | `http://localhost:5080/hubs/...` with a ticket | `wss://qrious-api.onrender.com/hubs/...` with a ticket |
| `App__WebOrigins` | `http://localhost:3000` | `https://<web-origin>` (plus preview URLs if needed) |

A future custom domain needs **no architecture change**: point the web at `qrious.<tld>`, optionally move the API to `api.qrious.<tld>`, and update `App__WebOrigins`.

## 4. Build and release (GitHub Actions)
```
on PR / push:  backend build + unit + integration tests (Testcontainers PostgreSQL)
               frontend typecheck + lint + vitest + build
on main:       Render auto-deploys the API from the Dockerfile (migrations run on startup in staging only,
               guarded by config Database__MigrateOnStartup=true; production uses a release-step migration bundle)
               Vercel auto-deploys the web from /frontend
```
Migrations are forward-only and backward-compatible (expand → migrate → contract).

## 5. Configuration (env vars; values never in git — see `.env.example` files)
| API | Web (server-only unless `NEXT_PUBLIC_`) |
|---|---|
| `ConnectionStrings__Default` | `API_INTERNAL_URL` (proxy target, e.g. `https://qrious-api.onrender.com`) |
| `App__WebOrigins`, `App__PublicWebUrl` | `QRIOUS_PROXY_SECRET` |
| `Auth__Cookie__Secure` (`true` outside local) | `NEXT_PUBLIC_SITE_URL` |
| `Storage__ServiceUrl`, `Storage__Bucket`, `Storage__AccessKey`, `Storage__SecretKey`, `Storage__PublicBaseUrl`, `Storage__Region` | `NEXT_PUBLIC_SENTRY_DSN` (optional) |
| `Security__RecoveryPepper`, `Security__IpHashSalt`, `Security__ProxySecret` | |
| `Database__MigrateOnStartup`, `Database__SeedDemoData` | |
| `Sentry__Dsn` (optional) | |

## 6. Operations on free tiers
- **Backups:** Neon's 24 h point-in-time history, plus a nightly GitHub Actions `pg_dump` artifact (7-day retention) for staging.
- **Monitoring:** Sentry; Render and Vercel logs; `/health/live` and `/health/ready`.
- **Cold starts:** expected on Render Free. The web app shows a "Waking up the networking server…" state when the API is slow, instead of failing.

## 7. Production launch (Phase 9) — options to be costed for approval
Before launch I'll present a short comparison (all-free vs low-cost paid), covering: always-on API (no cold starts), commercial-use-compliant frontend hosting, a database with daily backups, an optional custom domain (~₹600–900/year), and Razorpay live activation after KYC. Nothing is purchased without your approval.

## 8. Responsibilities
| Step | Who |
|---|---|
| Code, Dockerfile, `render.yaml`, Vercel config, CI workflows, deploy and smoke tests | Me |
| Create free accounts: Render, Neon, Cloudflare R2 *or* Supabase (Vercel already exists) | **You** (accounts must be yours) |
| Paste secrets into Render/Vercel dashboards or log in on the CLI | **You**, with exact step-by-step instructions from me |
| Push to GitHub (`ashwin071203/QRious`) | Me, after your OK |
