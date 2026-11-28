# QRious web app

This folder is the whole deployed application: pages, the `/api/v1` API, database migrations and tests.

The engineering handbook (architecture, modules, data model, security, payments, running, testing, deployment and
operations) is in the repository root: [../README.md](../README.md).

Quick start:

```bash
docker compose -f ../infra/docker-compose.yml up -d
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```
