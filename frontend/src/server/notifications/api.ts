import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { userAgentSummary } from "@/server/lib/rules";
import { requireAttendee } from "@/server/modules/identity";
import { requireAdmin, requireOrganizer } from "@/server/modules/organizers";
import { CATEGORIES, settingsFor, type Category, type RecipientKind } from "./notify";
import { deliverPush, pushConfig } from "./push";
import { announce, eventReminder } from "./rules";

/** The same handlers serve attendees (/me/notifications…) and organizers (/organizer/notifications…). */
const { notifications, notificationSettings, pushSubscriptions, userProfiles } = schema;

type Who = { kind: RecipientKind; id: string; sessionId: string };
async function who(ctx: Ctx, kind: RecipientKind): Promise<Who> {
  if (kind === "attendee") { const a = await requireAttendee(ctx, { allowDeactivated: true }); return { kind, id: a.attendeeId, sessionId: a.sessionId }; }
  const o = await requireOrganizer(ctx);
  return { kind, id: o.userId, sessionId: o.sessionId };
}
const mine = (w: Who) => (w.kind === "attendee" ? eq(notifications.attendeeId, w.id) : eq(notifications.organizerUserId, w.id));

export const list = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  const before = ctx.query("before");
  const unreadOnly = ctx.query("filter") === "unread";
  const rows = await ctx.db.select({ n: notifications, actorName: userProfiles.displayName, actorThumb: userProfiles.thumbUrl })
    .from(notifications).leftJoin(userProfiles, eq(userProfiles.id, notifications.actorProfileId))
    .where(and(mine(w), before ? sql`${notifications.createdAt} < ${new Date(before)}` : sql`true`, unreadOnly ? isNull(notifications.readAt) : sql`true`))
    .orderBy(desc(notifications.createdAt)).limit(30);
  const [{ unread }] = (await ctx.db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(mine(w), isNull(notifications.readAt)))) as [{ unread: number }];
  return {
    unread,
    items: rows.map((r) => ({ id: r.n.id, type: r.n.type, category: r.n.category, title: r.n.title, body: r.n.body, link: r.n.link, eventId: r.n.eventId,
      createdAt: r.n.createdAt, readAt: r.n.readAt, actor: r.n.actorProfileId ? { id: r.n.actorProfileId, displayName: r.actorName, thumbnailUrl: r.actorThumb } : null })),
    nextCursor: rows.length === 30 ? rows[29]!.n.createdAt.toISOString() : null,
  };
};

export const unreadCount = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  const [{ n }] = (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(mine(w), isNull(notifications.readAt)))) as [{ n: number }];
  return { notifications: n };
};

export const markRead = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  await ctx.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, ctx.params.id!), mine(w), isNull(notifications.readAt)));
  return reply(204);
};
export const markAllRead = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  await ctx.db.update(notifications).set({ readAt: new Date() }).where(and(mine(w), isNull(notifications.readAt)));
  return reply(204);
};
export const clearOne = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  await ctx.db.delete(notifications).where(and(eq(notifications.id, ctx.params.id!), mine(w)));
  return reply(204);
};
/** Clears read notifications (or everything with ?all=1). */
export const clearAll = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  await ctx.db.delete(notifications).where(and(mine(w), ctx.query("all") === "1" ? sql`true` : sql`${notifications.readAt} IS NOT NULL`));
  return reply(204);
};

// ---------- Preferences ----------
export const getSettings = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  const prefs = await settingsFor(ctx.db, kind, [w.id]);
  const [{ devices }] = (await ctx.db.select({ devices: sql<number>`count(*)::int` }).from(pushSubscriptions)
    .where(kind === "attendee" ? eq(pushSubscriptions.attendeeId, w.id) : eq(pushSubscriptions.organizerUserId, w.id))) as [{ devices: number }];
  return {
    push: { available: pushConfig().enabled, devices },
    categories: Object.entries(CATEGORIES[kind]).map(([key, c]) => {
      const p = prefs.get(`${w.id}:${key}`);
      return { key, label: c!.label, description: c!.description, locked: !!c!.locked, inApp: c!.locked ? true : p?.inApp ?? c!.inApp, push: p?.push ?? c!.push };
    }),
  };
};

export const putSettings = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  const b = await ctx.json<{ categories?: { key?: string; inApp?: boolean; push?: boolean }[] }>();
  const allowed = CATEGORIES[kind];
  const items = Array.isArray(b.categories) ? b.categories : [];
  for (const it of items) {
    const info = allowed[it.key as Category];
    if (!info || typeof it.inApp !== "boolean" || typeof it.push !== "boolean") throw new AppError(400, "validation_failed", "Unknown notification category.");
    const row = { inApp: info.locked ? true : it.inApp, push: it.push, updatedAt: new Date() };
    await ctx.db.insert(notificationSettings).values({ recipientType: kind, recipientId: w.id, category: it.key!, ...row })
      .onConflictDoUpdate({ target: [notificationSettings.recipientType, notificationSettings.recipientId, notificationSettings.category], set: row });
  }
  return getSettings(kind)(ctx);
};

// ---------- Push subscriptions ----------
export async function pushPublicConfig() {
  const c = pushConfig();
  return { enabled: c.enabled, publicKey: c.enabled ? c.publicKey : null };
}

const ENDPOINT_OK = /^https:\/\/[a-z0-9.-]+(:\d+)?\//i;
export const subscribe = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  if (!pushConfig().enabled) throw new AppError(503, "push_unavailable", "Push notifications aren't available yet.");
  await ctx.limit("push-subscribe", 20, 3600, `${kind}:${w.id}`);
  const b = await ctx.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>();
  const endpoint = typeof b.endpoint === "string" ? b.endpoint.trim() : "";
  const p256dh = b.keys?.p256dh, auth = b.keys?.auth;
  if (!ENDPOINT_OK.test(endpoint) || endpoint.length > 1000 || typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100)
    throw new AppError(400, "validation_failed", "Invalid push subscription.");
  // One device = one endpoint: re-subscribing moves it to the current account/session (e.g. a shared browser).
  const row = kind === "attendee"
    ? { recipientType: kind, attendeeId: w.id, attendeeSessionId: w.sessionId, organizerUserId: null, organizerSessionId: null }
    : { recipientType: kind, organizerUserId: w.id, organizerSessionId: w.sessionId, attendeeId: null, attendeeSessionId: null };
  await ctx.db.insert(pushSubscriptions).values({ ...row, endpoint, p256dh, auth, userAgentSummary: userAgentSummary(ctx.userAgent) })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { ...row, p256dh, auth, failureCount: 0, userAgentSummary: userAgentSummary(ctx.userAgent) } });
  return reply(201, { ok: true });
};

export const unsubscribe = (kind: RecipientKind) => async (ctx: Ctx) => {
  const w = await who(ctx, kind);
  const b = await ctx.json<{ endpoint?: string }>();
  if (typeof b.endpoint === "string")
    await ctx.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, b.endpoint),
      kind === "attendee" ? eq(pushSubscriptions.attendeeId, w.id) : eq(pushSubscriptions.organizerUserId, w.id)));
  return reply(204);
};

// ---------- Admin announcements ----------
export async function adminAnnouncement(ctx: Ctx) {
  const admin = await requireAdmin(ctx);
  await ctx.limit("admin-announce", 10, 86400, admin.userId);
  const b = await ctx.json<{ audience?: string; title?: string; body?: string; link?: string }>();
  const audience = b.audience === "attendees" || b.audience === "organizers" ? b.audience : b.audience === "all" ? "all" : null;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const body = typeof b.body === "string" ? b.body.trim() || null : null;
  const link = typeof b.link === "string" && /^\/[a-z0-9/_?=&.-]*$/i.test(b.link.trim()) ? b.link.trim() : null;
  const errors: Record<string, string[]> = {};
  if (!audience) errors.audience = ["Choose who receives it."];
  if (!title || title.length > 120) errors.title = ["Enter a title (up to 120 characters)."];
  if (body && body.length > 300) errors.body = ["Up to 300 characters."];
  if (Object.keys(errors).length) throw new AppError(400, "validation_failed", "One or more fields are invalid.", errors);
  const ref = randomUUID();
  const count = await ctx.db.transaction(async (tx) => {
    const n = await announce(tx, audience!, title, body, link, ref);
    await audit(tx, { actorType: "admin", actorId: admin.userId, action: "admin.announcement", data: { audience, title, recipients: n } });
    return n;
  });
  return reply(201, { recipients: count });
}

// ---------- Scheduled work (reminders, status changes, push), throttled and safe to call often ----------
let lastLocalSweep = 0;
/** Runs at most once a minute across all instances (DB-claimed), triggered after API traffic and by the daily cron. */
export async function maybeSweep(db: Executor, force = false) {
  if (!force && Date.now() - lastLocalSweep < 30_000) return false;
  lastLocalSweep = Date.now();
  if (!force) {
    const claimed = await db.execute(sql`INSERT INTO platform_settings (key, value, updated_at) VALUES ('notifications.sweep', '{}'::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET updated_at = now() WHERE platform_settings.updated_at < now() - interval '60 seconds' RETURNING key`);
    if (!claimed.rows.length) return false;
  }
  await sweep(db);
  return true;
}

export async function sweep(db: Executor) {
  const { syncStatuses } = await import("@/server/modules/events-core");
  await syncStatuses(db); // emits networking-open / ended notifications for automatic transitions
  for (const [window, interval] of [["24h", "24 hours"], ["1h", "1 hour"]] as const) {
    const due = (await db.execute<{ id: string }>(sql`SELECT e.id FROM events e WHERE e.status IN ('published','active') AND e.moderation_status = 'ok'
      AND e.starts_at > now() AND e.starts_at <= now() + ${interval}::interval
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.dedupe_key = ${`reminder-${window}:`} || e.id::text) LIMIT 50`)).rows;
    for (const e of due) await db.transaction((tx) => eventReminder(tx, e.id, window));
  }
  await deliverPush(db, 200);
}

