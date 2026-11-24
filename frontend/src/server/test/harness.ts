import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { dispatch } from "@/server/core/http";
import { routeTable } from "@/server/routes";
import { getDb } from "@/server/db";

export const ORIGIN = "http://localhost:3000";

/** A browser-like client: keeps cookies and sends the same headers the web app sends. */
export class Client {
  cookies = new Map<string, string>();
  constructor(public ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { host: "localhost:3000", origin: ORIGIN, "x-qrious-client": "web", "x-forwarded-for": this.ip, "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0", ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h["content-type"] = "application/json"; }
    const url = new URL(`/api/v1${path}`, ORIGIN);
    const req = new NextRequest(url, { method, headers: h, body: payload });
    const segments = url.pathname.replace(/^\/api\/v1\//, "").split("/").filter(Boolean);
    const res = await dispatch(req, segments, routeTable);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, ...v] = pair!.split("=");
      const value = v.join("=");
      if (/Max-Age=0/i.test(c) || value === "") this.cookies.delete(k!);
      else this.cookies.set(k!, value);
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper returns loosely typed JSON
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers, setCookies: res.headers.getSetCookie() };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req("POST", p, b ?? {}, h);
  put = (p: string, b?: unknown) => this.req("PUT", p, b ?? {});
  patch = (p: string, b?: unknown) => this.req("PATCH", p, b ?? {});
  del = (p: string) => this.req("DELETE", p);
}

let counter = 0;
export const uniq = (stem = "u") => `${stem}${Date.now().toString(36)}${++counter}`;

export async function resetDb() {
  const db = getDb();
  // Safety: never wipe anything but a dedicated test database.
  const [{ name }] = (await db.execute<{ name: string }>(sql`SELECT current_database() AS name`)).rows as [{ name: string }];
  if (!name.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${name}"`);
  // Ordered deletes (not TRUNCATE … CASCADE, which would also wipe the reference taxonomy via created_by FKs).
  await db.execute(sql`TRUNCATE organization_event_credits, subscription_invoices, payments, subscriptions, promotional_access, event_purchases, payment_webhooks,
    user_entitlements, organization_entitlements, rate_limit_counters, idempotency_keys, audit_logs, moderation_actions`);
  await db.execute(sql`DELETE FROM interests WHERE created_by_attendee_id IS NOT NULL OR status <> 'approved'`);
  await db.execute(sql`DELETE FROM skills WHERE created_by_attendee_id IS NOT NULL OR status <> 'approved'`);
  await db.execute(sql`DELETE FROM conversations`);
  await db.execute(sql`DELETE FROM connections`);
  await db.execute(sql`DELETE FROM attendees`);
  await db.execute(sql`DELETE FROM events`);
  await db.execute(sql`DELETE FROM organizations`);
  await db.execute(sql`DELETE FROM organizer_users`);
}

/** Organizer with an organization and a live event (networking open). */
export async function setupEvent(opts: { startsInHours?: number; durationHours?: number; maxParticipants?: number | null; category?: string } = {}) {
  const org = new Client();
  const email = `${uniq("org")}@example.com`;
  const reg = await org.post("/organizer/auth/register", { email, password: "correct horse battery staple", displayName: "Org Person" });
  if (reg.status !== 201) throw new Error(`register failed ${JSON.stringify(reg.body)}`);
  const o = await org.post("/organizations", { name: `Org ${uniq()}` });
  const cats = (await org.get("/public/categories")).body as { id: string; slug: string }[];
  const cat = cats.find((c) => c.slug === (opts.category ?? "concert"))!;
  const start = new Date(Date.now() + (opts.startsInHours ?? -1) * 3_600_000);
  const end = new Date(start.getTime() + (opts.durationHours ?? 6) * 3_600_000);
  const e = await org.post(`/organizations/${o.body.id}/events`, { name: "Test Night", categoryId: cat.id, venueName: "Hall A", startsAt: start.toISOString(), endsAt: end.toISOString(), maxParticipants: opts.maxParticipants ?? null });
  if (e.status !== 201) throw new Error(`event failed ${JSON.stringify(e.body)}`);
  const pub = await org.post(`/organizer/events/${e.body.id}/publish`);
  if (pub.status !== 200) throw new Error(`publish failed ${JSON.stringify(pub.body)}`);
  return { org, orgId: o.body.id as string, eventId: e.body.id as string, qr: pub.body.qr.code as string, categoryId: cat.id, email };
}

export async function createAttendee(qr: string, overrides: Record<string, unknown> = {}, client = new Client()) {
  const username = uniq("att");
  const r = await client.req("POST", "/onboarding/profile", {
    qrCode: qr, displayName: "Test Person", username, interests: [{ name: "Indie" }], skills: [{ name: "Guitar" }],
    isPublic: true, anonymousVisibilityConsent: true, ...overrides,
  }, { "idempotency-key": crypto.randomUUID() });
  if (r.status !== 201) throw new Error(`createAttendee failed ${r.status} ${JSON.stringify(r.body)}`);
  return { client, username: (overrides.username as string) ?? username, profileId: r.body.profile.id as string, recoveryCode: r.body.recoveryCode as string, body: r.body };
}
