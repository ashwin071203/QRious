import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, schema, type Executor } from "@/server/db";
import { config } from "./config";
import { AppError } from "./errors";

// ---------- Audit (PRD §12.4) ----------
export async function audit(
  db: Executor,
  entry: { actorType: (typeof schema.ACTOR_TYPE)[number]; actorId?: string | null; action: string; targetType?: string; targetId?: string | null;
    organizationId?: string | null; eventId?: string | null; data?: Record<string, unknown>; ip?: string },
) {
  const month = new Date().toISOString().slice(0, 7);
  await db.insert(schema.auditLogs).values({
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    organizationId: entry.organizationId ?? null,
    eventId: entry.eventId ?? null,
    ipHash: entry.ip ? createHmac("sha256", config.ipSalt + month).update(entry.ip).digest() : null,
    data: entry.data ?? {},
  });
}

// ---------- Rate limiting (07 §5) — Postgres fixed windows work across serverless instances ----------
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  if (!config.rateLimitEnabled) return;
  const db = getDb();
  const windowStart = new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000);
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit_counters (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
    RETURNING count`);
  const count = Number(rows.rows[0]?.count ?? 1);
  if (Math.random() < 0.01) {
    await db.execute(sql`DELETE FROM rate_limit_counters WHERE window_start < now() - interval '2 days'`);
  }
  if (count > limit) {
    const retryAfter = Math.ceil((windowStart.getTime() + windowSec * 1000 - Date.now()) / 1000);
    throw new AppError(429, "rate_limited", "You're doing that too often. Please wait a moment and try again.", undefined, { retryAfter });
  }
}
