import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";

/**
 * QRious notifications — ONE architecture for every feature and both roles.
 *
 *   notify(db, recipients, notice)
 *
 * Any server code (inside its own transaction) describes WHAT happened; this module decides, per recipient:
 *   - whether they want it (per-category in-app/push settings, role-aware defaults; security can't be muted in-app)
 *   - whether they may get it (no notifications caused by someone they have a block with)
 *   - how it is stored (dedupeKey: "coalesce" keeps one live entry per key — e.g. per conversation — and "once"
 *     makes it idempotent — e.g. reminders, milestones — so retries, cron re-runs and multiple devices never duplicate)
 *   - whether to push it (queued; delivered after the response by ./push, one push per device, tagged so devices
 *     replace rather than stack; skipped for chat while the person is visibly active in the app)
 * New features only call notify(); they never touch tables, preferences or push directly.
 */
const { notificationSettings, attendees } = schema;

export type Category = (typeof schema.NOTIFICATION_CATEGORY)[number];
export type RecipientKind = (typeof schema.RECIPIENT_TYPE)[number];
export type Recipient = { kind: RecipientKind; id: string };
export const toAttendee = (id: string): Recipient => ({ kind: "attendee", id });
export const toOrganizer = (id: string): Recipient => ({ kind: "organizer", id });

type CategoryInfo = { label: string; description: string; inApp: boolean; push: boolean; locked?: boolean };
/** Role-aware categories with their defaults. Shown as the preferences screen; order matters. */
export const CATEGORIES: Record<RecipientKind, Partial<Record<Category, CategoryInfo>>> = {
  attendee: {
    messages: { label: "Messages", description: "New direct messages", inApp: true, push: true },
    groups: { label: "Groups", description: "Group messages, invitations and changes", inApp: true, push: true },
    connections: { label: "Connections", description: "Connection requests and accepted requests", inApp: true, push: true },
    events: { label: "Events", description: "Reminders, schedule changes, networking opening and closing, cancellations", inApp: true, push: true },
    matches: { label: "Smart Match", description: "New people at your events who match your interests and goals", inApp: true, push: false },
    billing: { label: "Premium & payments", description: "Payment confirmations, renewals, failures and expiry", inApp: true, push: true },
    account: { label: "Account", description: "Profile and account changes", inApp: true, push: false },
    security: { label: "Security", description: "Account recovery and sign-in alerts — always shown in the app", inApp: true, push: true, locked: true },
    announcements: { label: "Announcements", description: "Important news from QRious", inApp: true, push: false },
  },
  organizer: {
    org_participants: { label: "Registrations", description: "New attendees joining your events", inApp: true, push: true },
    org_events: { label: "Events & QR codes", description: "Event creation, publishing, networking status, QR changes and issues, moderation", inApp: true, push: true },
    org_engagement: { label: "Engagement", description: "Participation and networking milestones", inApp: true, push: false },
    org_billing: { label: "Billing & plans", description: "Subscription and payment updates, free-event allowance", inApp: true, push: true },
    organization: { label: "Organization", description: "Team members and organization status", inApp: true, push: true },
    security: { label: "Security", description: "Password, sign-in and recovery alerts — always shown in the app", inApp: true, push: true, locked: true },
    announcements: { label: "Announcements", description: "Important news from QRious", inApp: true, push: false },
  },
};

export type Notice = {
  /** Stable machine name, e.g. "message.new", "event.reminder_1h", "org.billing.payment_failed". */
  type: string;
  category: Category;
  title: string;
  body?: string | null;
  /** Relative in-app path opened on click. */
  link?: string | null;
  dedupeKey?: string | null;
  /** coalesce (default when a key is given): replace and mark unread. once: keep the first, never repeat. */
  mode?: "coalesce" | "once";
  eventId?: string | null;
  entityId?: string | null;
  actorProfileId?: string | null;
  /** The attendee who caused it; recipients with a block (either way) never get it. */
  actorAttendeeId?: string | null;
  payload?: Record<string, unknown>;
};

const CHAT: Category[] = ["messages", "groups"];
/** The open app polls every 15 s; someone seen within this window is looking at QRious and gets chat in-app only. */
const ACTIVE_FOR_PUSH_MS = 25_000;

export async function settingsFor(db: Executor, kind: RecipientKind, ids: string[]) {
  if (!ids.length) return new Map<string, { inApp: boolean; push: boolean }>();
  const rows = await db.select().from(notificationSettings).where(and(eq(notificationSettings.recipientType, kind), inArray(notificationSettings.recipientId, ids)));
  return new Map(rows.map((r) => [`${r.recipientId}:${r.category}`, { inApp: r.inApp, push: r.push }]));
}

let flushHook: (() => void) | null = null;
/** Set by ./push: called once per notify() that queued at least one push. */
export function onPushQueued(fn: () => void) { flushHook = fn; }

/** Records a notification for each recipient according to their settings. Returns how many were stored. */
export async function notify(db: Executor, to: Recipient | Recipient[], n: Notice): Promise<number> {
  const list = (Array.isArray(to) ? to : [to]).filter((r) => r?.id);
  const seen = new Set<string>();
  const recipients = list.filter((r) => { const k = `${r.kind}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!recipients.length) return 0;

  let stored = 0, queued = 0;
  for (const kind of ["attendee", "organizer"] as const) {
    let ids = recipients.filter((r) => r.kind === kind).map((r) => r.id);
    if (!ids.length) continue;
    const info = CATEGORIES[kind][n.category];
    if (!info) continue; // category doesn't exist for this role — role-aware rule
    if (kind === "attendee" && n.actorAttendeeId) {
      const blocked = (await db.execute<{ id: string }>(sql`SELECT blocked_attendee_id AS id FROM user_blocks WHERE blocker_attendee_id = ${n.actorAttendeeId}
        UNION SELECT blocker_attendee_id AS id FROM user_blocks WHERE blocked_attendee_id = ${n.actorAttendeeId}`)).rows.map((r) => r.id);
      ids = ids.filter((id) => id !== n.actorAttendeeId && !blocked.includes(id));
    }
    if (!ids.length) continue;
    const prefs = await settingsFor(db, kind, ids);
    const activeNow = new Set<string>();
    if (kind === "attendee" && CHAT.includes(n.category)) {
      const rows = await db.select({ id: attendees.id, at: attendees.lastActiveAt }).from(attendees).where(inArray(attendees.id, ids));
      for (const r of rows) if (r.at && Date.now() - r.at.getTime() < ACTIVE_FOR_PUSH_MS) activeNow.add(r.id);
    }
    for (const id of ids) {
      const p = prefs.get(`${id}:${n.category}`);
      const inApp = info.locked ? true : p?.inApp ?? info.inApp;
      if (!inApp) continue;
      const pushWanted = p?.push ?? info.push;
      const push = !pushWanted ? "none" : activeNow.has(id) ? "skipped" : "pending";
      const col = kind === "attendee" ? sql`attendee_id` : sql`organizer_user_id`;
      const conflict = !n.dedupeKey ? sql``
        : n.mode === "once" ? sql`ON CONFLICT (${col}, dedupe_key) WHERE ${col} IS NOT NULL AND dedupe_key IS NOT NULL DO NOTHING`
        : sql`ON CONFLICT (${col}, dedupe_key) WHERE ${col} IS NOT NULL AND dedupe_key IS NOT NULL DO UPDATE SET
            type = EXCLUDED.type, title = EXCLUDED.title, body = EXCLUDED.body, link = EXCLUDED.link, payload = EXCLUDED.payload,
            actor_profile_id = EXCLUDED.actor_profile_id, event_id = EXCLUDED.event_id, created_at = now(), read_at = NULL, push_status = EXCLUDED.push_status`;
      const r = await db.execute(sql`INSERT INTO notifications (${col}, type, category, title, body, link, dedupe_key, event_id, entity_id, actor_profile_id, payload, push_status)
        VALUES (${id}, ${n.type}, ${n.category}, ${n.title.slice(0, 200)}, ${n.body?.slice(0, 300) ?? null}, ${n.link ?? null}, ${n.dedupeKey ?? null},
          ${n.eventId ?? null}, ${n.entityId ?? null}, ${n.actorProfileId ?? null}, ${JSON.stringify(n.payload ?? {})}::jsonb, ${push})
        ${conflict} RETURNING id`);
      if (r.rows.length) { stored++; if (push === "pending") queued++; }
    }
  }
  if (queued && flushHook) flushHook();
  return stored;
}
