import "server-only";
import webpush from "web-push";
import { after } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, type Executor } from "@/server/db";
import { onPushQueued } from "./notify";

/**
 * Web Push (VAPID) delivery: browsers and installed apps on Android, desktop and iOS 16.4+ (home-screen apps), including
 * when QRious isn't open. Queued notifications are sent after the HTTP response (next/server `after`), with a sweep as
 * a fallback. Each device gets one push per notification; devices whose session ended get none.
 */
export function pushConfig() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  const subject = (process.env.VAPID_SUBJECT ?? "").trim() || (site.startsWith("https://") ? site : "https://qrious.app");
  return { enabled: !!publicKey && !!privateKey, publicKey, privateKey, subject };
}

type PushMessage = { title: string; body: string | null; url: string; tag: string; id: string; category: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushSender = (sub: Sub, message: PushMessage, urgency: "high" | "normal") => Promise<{ ok: boolean; gone: boolean }>;

const realSender: PushSender = async (sub, message, urgency) => {
  const cfg = pushConfig();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message), {
      TTL: 6 * 3600, urgency, vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey }, timeout: 8000,
    });
    return { ok: true, gone: false };
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    return { ok: false, gone: code === 404 || code === 410 };
  }
};
let sender: PushSender = realSender;
/** Tests replace the network sender. */
export function setPushSender(s: PushSender | null) { sender = s ?? realSender; }

const DEFAULT_LINK: Record<string, string> = { attendee: "/app/notifications", organizer: "/organizer/notifications" };

/** Sends queued pushes. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function deliverPush(db: Executor, limit = 100) {
  const cfg = pushConfig();
  if (!cfg.enabled && sender === realSender) {
    await db.execute(sql`UPDATE notifications SET push_status = 'skipped' WHERE push_status = 'pending'`);
    return { sent: 0, skipped: 0 };
  }
  await db.execute(sql`UPDATE notifications SET push_status = 'skipped' WHERE push_status IN ('pending','sending') AND created_at < now() - interval '2 hours'`);
  const claimed = (await db.execute<{ id: string; attendee_id: string | null; organizer_user_id: string | null; title: string; body: string | null; link: string | null;
    dedupe_key: string | null; category: string }>(sql`
    UPDATE notifications SET push_status = 'sending' WHERE id IN (
      SELECT id FROM notifications WHERE push_status = 'pending' ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, attendee_id, organizer_user_id, title, body, link, dedupe_key, category`)).rows;
  let sent = 0, skipped = 0;
  for (const n of claimed) {
    const subs = n.attendee_id
      ? (await db.execute<Sub>(sql`SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
          JOIN attendee_sessions s ON s.id = ps.attendee_session_id AND s.revoked_at IS NULL AND s.expires_at > now() AND s.absolute_expires_at > now()
          WHERE ps.attendee_id = ${n.attendee_id}`)).rows
      : (await db.execute<Sub>(sql`SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
          JOIN organizer_sessions s ON s.id = ps.organizer_session_id AND s.revoked_at IS NULL AND s.expires_at > now()
          WHERE ps.organizer_user_id = ${n.organizer_user_id}`)).rows;
    const message: PushMessage = { id: n.id, title: n.title, body: n.body, category: n.category,
      url: n.link ?? DEFAULT_LINK[n.attendee_id ? "attendee" : "organizer"]!, tag: n.dedupe_key ?? n.id };
    const urgency = ["messages", "groups", "security"].includes(n.category) ? "high" : "normal";
    let ok = 0;
    for (const s of subs) {
      const r = await sender(s, message, urgency);
      if (r.ok) { ok++; await db.execute(sql`UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0 WHERE id = ${s.id}`); }
      else if (r.gone) await db.execute(sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`);
      else await db.execute(sql`WITH u AS (UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ${s.id} RETURNING id, failure_count)
        DELETE FROM push_subscriptions WHERE id IN (SELECT id FROM u WHERE failure_count >= 10)`);
    }
    await db.execute(sql`UPDATE notifications SET push_status = ${ok ? "sent" : "skipped"} WHERE id = ${n.id} AND push_status = 'sending'`);
    if (ok) sent++; else skipped++;
  }
  return { sent, skipped };
}

/** After the current response, deliver what this request queued (outside a request — tests, cron — the sweep does it). */
function scheduleFlush() {
  try { after(() => deliverPush(getDb()).then(() => undefined, (e) => console.error("[push]", e))); } catch { /* not in a request scope */ }
}
onPushQueued(scheduleFlush);
