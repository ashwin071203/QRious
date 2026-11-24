# QRious — Technical Planning Pack

Status: **Approved for Phase 1** (2026-11-24). Product decisions D-01, D-05, D-06, D-07, D-08, D-13, D-20 and the free-first hosting decision are recorded in 02 and reflected in the PRD (v1.1) and all technical documents.

| # | Document | Contents |
|---|---|---|
| — | [PRD.md](PRD.md) | Product specification (unchanged; source of truth) |
| 01 | [Requirements analysis](01-requirements-analysis.md) | Actors, 18 modules with features, 33 business rules, dependencies |
| 02 | [Decisions & conflicts](02-decisions-and-conflicts.md) | **Needs your answers.** 28 items: contradictions, risks, gaps, each with a recommendation |
| 03 | [System architecture](03-system-architecture.md) | Modular monolith, repo layout, key flows, real-time, matching, Pulse, non-functional targets |
| 04 | [Database schema](04-database-schema.md) | All tables, columns, constraints, indexes, relationships |
| 05 | [API specification](05-api-specification.md) | REST endpoints by module, auth level, SignalR hubs, error codes |
| 06 | [Frontend architecture](06-frontend-architecture.md) | Next.js route map, navigation, critical flows, design system, performance |
| 07 | [Security & authorization](07-security-and-authorization.md) | Threat model, sessions, policies, CSRF/CSP, rate limits, uploads, privacy, payments |
| 08 | [Deployment architecture](08-deployment-architecture.md) | Environments, hosting topology, CI/CD, backups, monitoring, who does what |
| 09 | [Implementation roadmap](09-implementation-roadmap.md) | Phases 1–10 with gates; detailed Phase 1 plan |
| 10 | [Engineering guidelines](10-engineering-guidelines.md) | Coding, testing and workflow rules; non-negotiable flows |

**Stack (per PRD §10.2):** Next.js + React + TypeScript + Tailwind + Framer Motion + Lucide (+ R3F on marketing pages only) · ASP.NET Core 10 + EF Core + SignalR + Identity · PostgreSQL · S3-compatible storage · Razorpay test mode (Phase 8B) · free-first staging: Vercel Hobby + Render Free + Neon Free (08).
