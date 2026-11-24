import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { Client, createAttendee, resetDb, setupEvent, uniq } from "@/server/test/harness";
import { deliverPush, setPushSender } from "@/server/notifications/push";
import { maybeSweep } from "@/server/notifications/api";
import { syncStatuses } from "@/server/modules/events-core";
import { totp } from "@/server/lib/totp";

/** The notification system: producers across the app, preferences, blocks, dedupe, both roles, push delivery. */
const db = () => getDb();
type Att = Awaited<ReturnType<typeof createAttendee>>;
const pushes: { endpoint: string; message: { title: string; body: string | null; url: string; tag: string; category: string } }[] = [];
const gone = new Set<string>();

async function connect(eventId: string, a: Att, b: Att) {
  const r = await a.client.post(`/events/${eventId}/connections`, { profileId: b.profileId });
  expect((await b.client.post(`/connections/${r.body.id}/accept`)).status).toBe(200);
}
const items = async (c: Client, path = "/me/notifications") => (await c.get(path)).body.items as { id: string; type: string; category: string; title: string; body: string | null; link: string | null; readAt: string | null }[];
const attendeeId = async (profileId: string) => ((await db().execute<{ id: string }>(sql`SELECT attendee_id AS id FROM user_profiles WHERE id = ${profileId}`)).rows[0]!).id;
const subscribe = (c: Client, base: "/me" | "/organizer", tag: string) =>
  c.post(`${base}/push-subscriptions`, { endpoint: `https://push.example.test/${tag}-${randomUUID()}`, keys: { p256dh: "BPk".padEnd(87, "x"), auth: "auth-secret-123456" } });
async function organizer() {
  const c = new Client();
  const email = `${uniq("notiforg")}@example.com`;
  await c.post("/organizer/auth/register", { email, password: "correct horse battery staple", displayName: "Org Two" });
  const [{ id }] = (await db().execute<{ id: string }>(sql`SELECT id FROM organizer_users WHERE email_normalized = ${email}`)).rows as [{ id: string }];
  return { c, email, id };
}

describe("Notifications: one system for attendees and organizers", () => {
  let eventId = "", qr = "", orgId = "";
  let org: Client;
  let A: Att, B: Att;
  beforeAll(async () => {
    await resetDb();
    process.env.VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    setPushSender(async (sub, message) => { if (gone.has(sub.endpoint)) return { ok: false, gone: true }; pushes.push({ endpoint: sub.endpoint, message }); return { ok: true, gone: false }; });
    ({ eventId, qr, org, orgId } = await setupEvent());
    A = await createAttendee(qr, { interests: [{ name: "Indie" }, { name: "Jazz" }], skills: [{ name: "Guitar" }] });
    B = await createAttendee(qr, { interests: [{ name: "Indie" }, { name: "Jazz" }], skills: [{ name: "Drums" }] });
  });
  afterAll(() => { setPushSender(null); delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; });

  it("messages: link to the chat, coalesced per conversation, respect preferences and blocks", async () => {
    await connect(eventId, A, B);
    const conv = (await A.client.post("/conversations", { profileId: B.profileId, eventId })).body.id as string;
    for (const m of ["hi", "are you at the stage?"]) await A.client.post(`/conversations/${conv}/messages`, { body: m, clientMessageId: randomUUID() });
    const n = (await items(B.client)).filter((x) => x.category === "messages");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ type: "message.new", link: `/app/messages/${conv}`, body: "are you at the stage?", readAt: null });
    // Reading the chat marks the notification read
    const t = (await B.client.get(`/conversations/${conv}/messages`)).body;
    await B.client.post(`/conversations/${conv}/read`, { lastReadMessageId: t.messages.at(-1).id });
    expect((await items(B.client)).find((x) => x.category === "messages")!.readAt).not.toBeNull();
    // Muting the category in-app stops new ones
    const s = (await B.client.get("/me/notification-settings")).body;
    expect(s.categories.map((c: { key: string }) => c.key)).toEqual(["messages", "groups", "connections", "events", "matches", "billing", "account", "security", "announcements"]);
    await B.client.put("/me/notification-settings", { categories: [{ key: "messages", inApp: false, push: false }] });
    await A.client.post(`/conversations/${conv}/messages`, { body: "muted?", clientMessageId: randomUUID() });
    expect((await items(B.client)).find((x) => x.category === "messages")!.readAt).not.toBeNull(); // unchanged
    await B.client.put("/me/notification-settings", { categories: [{ key: "messages", inApp: true, push: true }] });
    // Security can't be muted in-app
    const sec = (await B.client.put("/me/notification-settings", { categories: [{ key: "security", inApp: false, push: false }] })).body.categories.find((c: { key: string }) => c.key === "security");
    expect(sec).toMatchObject({ inApp: true, push: false, locked: true });
    // Unknown or organizer-only categories are refused
    expect((await B.client.put("/me/notification-settings", { categories: [{ key: "org_billing", inApp: false, push: false }] })).status).toBe(400);
  });

  it("push: one per device, never for signed-out sessions, removed when the endpoint is gone, skipped while active in chat", async () => {
    const C = await createAttendee(qr);
    await connect(eventId, A, C);
    expect((await subscribe(C.client, "/me", "c-phone")).status).toBe(201);
    expect((await subscribe(C.client, "/me", "c-laptop")).status).toBe(201);
    expect((await new Client().post("/me/push-subscriptions", { endpoint: "https://x.test/a", keys: { p256dh: "a", auth: "b" } })).status).toBe(401);
    expect((await C.client.post("/me/push-subscriptions", { endpoint: "http://insecure.test/x", keys: { p256dh: "a", auth: "b" } })).status).toBe(400);
    // C is away (not active) → a connection's message is pushed to both devices
    await db().execute(sql`UPDATE attendees SET last_active_at = now() - interval '10 minutes' WHERE id = ${await attendeeId(C.profileId)}`);
    const conv = (await A.client.post("/conversations", { profileId: C.profileId, eventId })).body.id as string;
    await deliverPush(db()); // flush earlier notices (e.g. the connection request)
    pushes.length = 0;
    await A.client.post(`/conversations/${conv}/messages`, { body: "ping", clientMessageId: randomUUID() });
    await deliverPush(db());
    expect(pushes.map((p) => p.endpoint.split("/")[3]!.split("-").slice(0, 2).join("-")).sort()).toEqual(["c-laptop", "c-phone"]);
    expect(pushes[0]!.message).toMatchObject({ url: `/app/messages/${conv}`, tag: `conv:${conv}`, category: "messages", body: "ping" });
    // A delivered notification is never pushed twice
    pushes.length = 0;
    await deliverPush(db());
    expect(pushes).toHaveLength(0);
    // Active in the app right now → chat isn't pushed (seen in-app instead)
    await C.client.get("/me/unread-counts");
    await db().execute(sql`UPDATE attendees SET last_active_at = now() WHERE id = ${await attendeeId(C.profileId)}`);
    await A.client.post(`/conversations/${conv}/messages`, { body: "still there?", clientMessageId: randomUUID() });
    await deliverPush(db());
    expect(pushes).toHaveLength(0);
    // Gone endpoints are deleted; signing out stops delivery to that device
    await db().execute(sql`UPDATE attendees SET last_active_at = now() - interval '10 minutes' WHERE id = ${await attendeeId(C.profileId)}`);
    const subs = (await db().execute<{ endpoint: string }>(sql`SELECT endpoint FROM push_subscriptions WHERE attendee_id = ${await attendeeId(C.profileId)}`)).rows;
    gone.add(subs.find((s) => s.endpoint.includes("c-laptop"))!.endpoint);
    await A.client.post(`/conversations/${conv}/messages`, { body: "third", clientMessageId: randomUUID() });
    await deliverPush(db());
    expect(pushes.map((p) => p.endpoint)).toEqual([subs.find((s) => s.endpoint.includes("c-phone"))!.endpoint]);
    expect((await db().execute(sql`SELECT 1 FROM push_subscriptions WHERE endpoint LIKE '%c-laptop%'`)).rows).toHaveLength(0);
    await C.client.post("/session/logout");
    await db().execute(sql`UPDATE attendee_sessions SET revoked_at = now() WHERE attendee_id = ${await attendeeId(C.profileId)}`);
    pushes.length = 0;
    await A.client.post(`/conversations/${conv}/messages`, { body: "after logout", clientMessageId: randomUUID() });
    await deliverPush(db());
    expect(pushes).toHaveLength(0);
  });

  it("organizers: registrations coalesced per hour, team changes, allowance warnings, QR issues; actors aren't notified of their own actions", async () => {
    const two = await organizer();
    // Team member (direct insert keeps this independent of the Business plan tests)
    await db().execute(sql`INSERT INTO organization_members (organization_id, organizer_user_id, role) VALUES (${orgId}, ${two.id}, 'member')`);
    await createAttendee(qr);
    await createAttendee(qr);
    const joins = (await items(two.c, "/organizer/notifications")).filter((n) => n.type === "org.participant_joined");
    expect(joins).toHaveLength(1);
    expect(joins[0]!.title).toMatch(/people joined Test Night this hour/);
    expect(joins[0]!.link).toBe(`/organizer/participants?event=${eventId}`);
    // Event created by the owner → the other member hears about it, the owner doesn't; the 2nd and 3rd free events warn everyone once
    const cats = (await org.get("/public/categories")).body as { id: string }[];
    const start = new Date(Date.now() + 3 * 86_400_000);
    const body = { name: "Second", categoryId: cats[0]!.id, venueName: "Hall", startsAt: start.toISOString(), endsAt: new Date(+start + 7_200_000).toISOString() };
    await org.post(`/organizations/${orgId}/events`, body);
    await org.post(`/organizations/${orgId}/events`, { ...body, name: "Third" });
    const mine = (await items(org, "/organizer/notifications")).map((n) => n.type);
    expect(mine).not.toContain("org.event.created");
    expect(mine).toEqual(expect.arrayContaining(["org.allowance.one_left", "org.allowance.used"]));
    const theirs = (await items(two.c, "/organizer/notifications")).map((n) => n.type);
    expect(theirs.filter((t) => t === "org.event.created")).toHaveLength(2);
    expect(theirs.filter((t) => t === "org.allowance.used")).toHaveLength(1);
    // QR replaced → teammate told; a scan of the old printout → everyone told, once a day
    const oldQr = qr;
    qr = (await org.post(`/organizer/events/${eventId}/qr/regenerate`)).body.qr.code;
    expect((await items(two.c, "/organizer/notifications")).some((n) => n.type === "org.qr.regenerated")).toBe(true);
    for (let i = 0; i < 3; i++) await new Client().get(`/public/qr/${oldQr}`);
    expect((await items(org, "/organizer/notifications")).filter((n) => n.type === "org.qr.stale_scan")).toHaveLength(1);
    // Organizer notifications are private to each organizer
    const stranger = await organizer();
    const target = (await items(two.c, "/organizer/notifications"))[0]!;
    await stranger.c.del(`/organizer/notifications/${target.id}`);
    expect((await items(two.c, "/organizer/notifications")).some((n) => n.id === target.id)).toBe(true);
    expect((await stranger.c.get("/organizer/notifications")).body.items).toHaveLength(0);
    // Read, unread count, clear
    expect((await two.c.get("/organizer/notifications/unread")).body.notifications).toBeGreaterThan(0);
    await two.c.post("/organizer/notifications/read-all");
    expect((await two.c.get("/organizer/notifications/unread")).body.notifications).toBe(0);
    await two.c.del("/organizer/notifications");
    expect((await two.c.get("/organizer/notifications")).body.items).toHaveLength(0);
    // Organizer security alert
    await two.c.post("/organizer/auth/change-password", { currentPassword: "correct horse battery staple", newPassword: "an even longer passphrase 2" });
    expect((await items(two.c, "/organizer/notifications"))[0]).toMatchObject({ type: "security.password_changed", category: "security" });
    // Organizer push devices
    expect((await subscribe(two.c, "/organizer", "org-desktop")).status).toBe(201);
    pushes.length = 0;
    await createAttendee(qr);
    await deliverPush(db());
    expect(pushes.some((p) => p.endpoint.includes("org-desktop") && p.message.url === `/organizer/participants?event=${eventId}`)).toBe(true);
  });

  it("events: pause/resume and schedule changes reach participants; reminders and automatic networking-open are sent once", async () => {
    await org.post(`/organizer/events/${eventId}/pause`);
    expect((await items(A.client))[0]).toMatchObject({ type: "event.paused", category: "events", link: `/app/events/${eventId}/home` });
    await org.post(`/organizer/events/${eventId}/resume`);
    const status = (await items(A.client)).filter((n) => n.type.startsWith("event.") && ["event.paused", "event.resumed"].includes(n.type));
    expect(status).toHaveLength(1); // coalesced: the latest status replaces the previous one
    expect(status[0]!.type).toBe("event.resumed");
    await org.patch(`/organizer/events/${eventId}`, { venueName: "Main Hall" });
    expect((await items(A.client)).some((n) => n.type === "event.updated" && /venue changed/.test(n.title))).toBe(true);

    // A published event starting in 30 minutes → one 1-hour reminder, however often the sweep runs
    const cats = (await org.get("/public/categories")).body as { id: string }[];
    const o3 = await organizer();
    const orgB = (await o3.c.post("/organizations", { name: `Reminders ${uniq()}` })).body.id as string;
    const start = new Date(Date.now() + 30 * 60_000);
    const ev = (await o3.c.post(`/organizations/${orgB}/events`, { name: "Soon", categoryId: cats[0]!.id, venueName: "Hall", startsAt: start.toISOString(), endsAt: new Date(+start + 3_600_000).toISOString() })).body.id;
    const pub = await o3.c.post(`/organizer/events/${ev}/publish`);
    const R = await createAttendee(pub.body.qr.code);
    await maybeSweep(db(), true);
    await maybeSweep(db(), true);
    expect((await items(R.client)).filter((n) => n.type === "event.reminder_1h")).toHaveLength(1);

    // Networking opening automatically (24 h before the start) notifies participants and organizers
    const later = new Date(Date.now() + 3 * 86_400_000);
    const ev2 = (await o3.c.post(`/organizations/${orgB}/events`, { name: "Later", categoryId: cats[0]!.id, venueName: "Hall", startsAt: later.toISOString(), endsAt: new Date(+later + 3_600_000).toISOString() })).body.id;
    const pub2 = await o3.c.post(`/organizer/events/${ev2}/publish`);
    const P = await createAttendee(pub2.body.qr.code);
    await db().execute(sql`UPDATE events SET starts_at = now() + interval '2 hours', ends_at = now() + interval '5 hours' WHERE id = ${ev2}`);
    await syncStatuses(db(), [ev2]);
    expect((await items(P.client)).some((n) => n.type === "event.networking_open")).toBe(true);
    expect((await items(o3.c, "/organizer/notifications")).some((n) => n.type === "org.event.networking_open")).toBe(true);
  });

  it("Smart Match: people with shared interests hear about a matching newcomer; never across a block", async () => {
    await db().execute(sql`DELETE FROM notifications WHERE type = 'match.new_people'`);
    await createAttendee(qr, { interests: [{ name: "Indie" }, { name: "Jazz" }] });
    expect((await items(A.client)).find((n) => n.type === "match.new_people")).toMatchObject({ link: `/app/events/${eventId}/matches`, category: "matches" });
    // Y exists elsewhere; B blocks Y; then Y joins this event: A hears about it, B doesn't
    await db().execute(sql`DELETE FROM notifications WHERE type = 'match.new_people'`);
    const other = await setupEvent();
    const Y = await createAttendee(other.qr, { interests: [{ name: "Indie" }, { name: "Jazz" }] });
    await db().execute(sql`INSERT INTO user_blocks (blocker_attendee_id, blocked_attendee_id) VALUES (${await attendeeId(B.profileId)}, ${await attendeeId(Y.profileId)})`);
    expect((await Y.client.post(`/events/${eventId}/participation`, { qrCode: qr })).status).toBe(200);
    expect((await items(A.client)).some((n) => n.type === "match.new_people")).toBe(true);
    expect((await items(B.client)).some((n) => n.type === "match.new_people")).toBe(false);
  });

  it("admin announcements reach both roles once and require an admin", async () => {
    const adm = await organizer();
    await db().execute(sql`UPDATE organizer_users SET is_admin = true WHERE id = ${adm.id}`);
    const s = await adm.c.post("/organizer/auth/mfa/setup");
    await adm.c.post("/organizer/auth/mfa/enable", { code: totp(s.body.secret) });
    expect((await org.post("/admin/announcements", { audience: "all", title: "Hi" })).status).toBe(403);
    expect((await adm.c.post("/admin/announcements", { audience: "all", title: "" })).status).toBe(400);
    const r = await adm.c.post("/admin/announcements", { audience: "all", title: "New: group chats", body: "Create groups with your connections.", link: "/app/messages" });
    expect(r.status).toBe(201);
    expect(r.body.recipients).toBeGreaterThan(2);
    expect((await items(A.client)).find((n) => n.type === "announcement")).toMatchObject({ title: "New: group chats", link: "/app/messages", category: "announcements" });
    expect((await items(org, "/organizer/notifications")).some((n) => n.type === "announcement")).toBe(true);
    const onlyOrgs = await adm.c.post("/admin/announcements", { audience: "organizers", title: "Organizer news" });
    expect(onlyOrgs.status).toBe(201);
    expect((await items(A.client)).some((n) => n.title === "Organizer news")).toBe(false);
  });

  it("attendee security & account: recovery code change, other devices signed out, clear & unread", async () => {
    await A.client.post("/me/recovery-code/regenerate");
    expect((await items(A.client))[0]).toMatchObject({ type: "security.recovery_code_changed", category: "security", link: "/app/settings" });
    expect((await A.client.get("/me/unread-counts")).body.notifications).toBeGreaterThan(0);
    await A.client.post("/me/notifications/read-all");
    expect((await A.client.get("/me/unread-counts")).body.notifications).toBe(0);
    const first = (await items(A.client))[0]!;
    await A.client.del(`/me/notifications/${first.id}`);
    expect((await items(A.client)).some((n) => n.id === first.id)).toBe(false);
    await A.client.del("/me/notifications"); // clears read ones
    expect((await items(A.client))).toHaveLength(0);
  });
});
