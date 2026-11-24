import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { Client, createAttendee, resetDb, setupEvent } from "@/server/test/harness";
import { grantPlan } from "@/server/modules/billing";

/** Activity status, unread counts, group conversations and attendee Premium entitlements. */
const db = () => getDb();
type Att = Awaited<ReturnType<typeof createAttendee>>;

async function connect(eventId: string, a: Att, b: Att) {
  const r = await a.client.post(`/events/${eventId}/connections`, { profileId: b.profileId });
  expect(r.status).toBe(201);
  expect((await b.client.post(`/connections/${r.body.id}/accept`)).status).toBe(200);
}
async function dm(eventId: string, a: Att, b: Att) {
  const r = await a.client.post("/conversations", { profileId: b.profileId, eventId });
  expect([200, 201]).toContain(r.status);
  return r.body.id as string;
}
const send = (c: Client, conv: string, body: string) => c.post(`/conversations/${conv}/messages`, { body, clientMessageId: randomUUID() });
const attendeeOf = async (profileId: string) =>
  ((await db().execute<{ id: string }>(sql`SELECT attendee_id AS id FROM user_profiles WHERE id = ${profileId}`)).rows[0]!).id;

describe("Messaging: activity status, unread counts, groups; Premium entitlements", () => {
  let eventId = "", qr = "";
  let A: Att, B: Att, C: Att, D: Att, E: Att, F: Att;
  beforeAll(async () => {
    await resetDb();
    ({ eventId, qr } = await setupEvent());
    [A, B, C, D, E, F] = await Promise.all([0, 1, 2, 3, 4, 5].map(() => createAttendee(qr)));
    await connect(eventId, A, B);
    await connect(eventId, A, C);
    await connect(eventId, B, C);
    await connect(eventId, A, E);
    await connect(eventId, A, F);
    // D is a stranger to everyone.
  });

  it("activity status: Active / last seen, connections only, private and reciprocal", async () => {
    const conv = await dm(eventId, A, B);
    await B.client.get("/me/unread-counts"); // B is using the app
    const list = (await A.client.get("/conversations")).body as { id: string; presence: { active: boolean; lastSeenAt: string | null } | null }[];
    expect(list.find((c) => c.id === conv)!.presence).toMatchObject({ active: true });
    // B went quiet 10 minutes ago → offline with a minute-rounded last-seen
    await db().execute(sql`UPDATE attendees SET last_active_at = now() - interval '10 minutes' WHERE id = ${await attendeeOf(B.profileId)}`);
    const t = (await A.client.get(`/conversations/${conv}/messages`)).body;
    expect(t.presence.active).toBe(false);
    expect(new Date(t.presence.lastSeenAt).getSeconds()).toBe(0);
    expect(Date.now() - new Date(t.presence.lastSeenAt).getTime()).toBeGreaterThan(9 * 60_000);
    // Activity is recorded on authenticated use (throttled to once a minute)
    await db().execute(sql`UPDATE attendees SET last_active_at = now() - interval '5 minutes' WHERE id = ${await attendeeOf(B.profileId)}`);
    await B.client.get("/me/unread-counts");
    expect((await A.client.get(`/conversations/${conv}/messages`)).body.presence.active).toBe(true);
    // B hides activity → nobody sees it
    expect((await B.client.patch("/me/privacy", { showActivityStatus: false })).body.showActivityStatus).toBe(false);
    expect((await A.client.get(`/conversations/${conv}/messages`)).body.presence).toBeNull();
    // Reciprocal: B can't see others either
    expect((await B.client.get(`/conversations/${conv}/messages`)).body.presence).toBeNull();
    await B.client.patch("/me/privacy", { showActivityStatus: true });
    expect((await B.client.get(`/conversations/${conv}/messages`)).body.presence).not.toBeNull();
    // A block hides it, and the conversation (blocking also ends the connection)
    const G = await createAttendee(qr);
    await connect(eventId, A, G);
    const convG = await dm(eventId, A, G);
    await G.client.get("/me/unread-counts");
    expect((await A.client.get(`/conversations/${convG}/messages`)).body.presence).not.toBeNull();
    await G.client.put(`/me/blocks/${A.profileId}`);
    expect((await A.client.get(`/conversations/${convG}/messages`)).status).toBe(404);
    expect((await A.client.get("/conversations")).body.some((c: { id: string }) => c.id === convG)).toBe(false);
  });

  it("unread counts: per conversation and total, cleared by reading, consistent across devices, can't be over-read", async () => {
    const conv = await dm(eventId, C, A);
    const before = (await A.client.get("/me/unread-counts")).body.messages as number;
    let last = 0;
    for (const m of ["one", "two", "three"]) last = (await send(C.client, conv, m)).body.id;
    const counts = (await A.client.get("/me/unread-counts")).body;
    expect(counts.messages).toBe(before + 3);
    expect(counts.conversations).toBeGreaterThanOrEqual(1);
    expect((await A.client.get("/conversations")).body.find((c: { id: string }) => c.id === conv).unreadCount).toBe(3);
    // A second device (recovery sign-in) sees the same server-side counts
    const device2 = new Client();
    expect((await device2.post("/recovery", { username: A.username, recoveryCode: A.recoveryCode })).status).toBe(200);
    expect((await device2.get("/me/unread-counts")).body.messages).toBe(before + 3);
    // Reading clears them everywhere; marking beyond the newest message is capped
    await device2.post(`/conversations/${conv}/read`, { lastReadMessageId: last + 1_000_000 });
    expect((await device2.get("/conversations")).body.find((c: { id: string }) => c.id === conv).unreadCount).toBe(0);
    expect((await device2.get("/me/unread-counts")).body.messages).toBe(before);
    await send(C.client, conv, "four");
    expect((await device2.get("/conversations")).body.find((c: { id: string }) => c.id === conv).unreadCount).toBe(1);
    A.client = device2; // the recovery revoked A's first session
  });

  it("groups: connections only, no strangers, admins manage, members see activity, unread per group", async () => {
    // A stranger can't be added; neither can someone A isn't connected with
    const bad = await A.client.post("/conversations/groups", { name: "Jam crew", memberProfileIds: [B.profileId, D.profileId] });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.members[0]).toMatch(/can't be added/);
    expect((await A.client.post("/conversations/groups", { name: "", memberProfileIds: [B.profileId] })).status).toBe(400);
    const g = await A.client.post("/conversations/groups", { name: "Jam crew", memberProfileIds: [B.profileId, C.profileId] });
    expect(g.status).toBe(201);
    const gid = g.body.id as string;

    const tb = (await B.client.get(`/conversations/${gid}/messages`)).body;
    expect(tb.group).toMatchObject({ name: "Jam crew", myRole: "member", memberCount: 3 });
    expect(tb.group.members.map((m: { role: string }) => m.role).sort()).toEqual(["admin", "member", "member"]);
    expect(tb.messages[0]).toMatchObject({ kind: "system" });
    expect(tb.messages[0].body).toMatch(/created the group/);
    // Message activity, sender names, unread per group
    const m1 = await send(B.client, gid, "Hey all!");
    expect(m1.status).toBe(201);
    const listC = (await C.client.get("/conversations")).body.find((c: { id: string }) => c.id === gid);
    expect(listC).toMatchObject({ kind: "group", unreadCount: 1, group: { name: "Jam crew", memberCount: 3 }, lastMessage: { body: "Hey all!" } });
    const tc = (await C.client.get(`/conversations/${gid}/messages`)).body;
    expect(tc.messages.at(-1)).toMatchObject({ body: "Hey all!", mine: false, sender: { profileId: B.profileId } });
    await C.client.post(`/conversations/${gid}/read`, { lastReadMessageId: tc.messages.at(-1).id });
    expect((await C.client.get("/conversations")).body.find((c: { id: string }) => c.id === gid).unreadCount).toBe(0);

    // Outsiders can't read, send or manage
    expect((await D.client.get(`/conversations/${gid}/messages`)).status).toBe(404);
    expect((await send(D.client, gid, "let me in")).status).toBe(404);
    expect((await D.client.post(`/conversations/${gid}/members`, { memberProfileIds: [D.profileId] })).status).toBe(404);
    // Members aren't admins
    expect((await B.client.patch(`/conversations/${gid}/group`, { name: "Mine now" })).body.code).toBe("group_admin_required");
    expect((await B.client.post(`/conversations/${gid}/members`, { memberProfileIds: [A.profileId] })).status).toBe(403);
    // Admin renames and sets a photo; members see it
    expect((await A.client.patch(`/conversations/${gid}/group`, { name: "Jam crew 2026" })).body.name).toBe("Jam crew 2026");
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#7c3aed" } }).png().toBuffer();
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "g.png");
    expect((await A.client.req("PUT", `/conversations/${gid}/group/photo`, fd)).body.photoUrl).toBeTruthy();
    expect((await B.client.get(`/conversations/${gid}/messages`)).body.group).toMatchObject({ name: "Jam crew 2026", photoUrl: expect.any(String) });

    // New members only see messages after they joined
    expect((await A.client.post(`/conversations/${gid}/members`, { memberProfileIds: [F.profileId] })).status).toBe(201);
    const tf = (await F.client.get(`/conversations/${gid}/messages`)).body;
    expect(tf.messages.some((m: { body: string }) => m.body === "Hey all!")).toBe(false);
    expect(tf.messages.at(-1).body).toMatch(/added/);
    // Admin can remove; removed members lose access
    expect((await A.client.del(`/conversations/${gid}/members/${F.profileId}`)).status).toBe(204);
    expect((await F.client.get(`/conversations/${gid}/messages`)).status).toBe(404);
    expect((await F.client.get("/conversations")).body.some((c: { id: string }) => c.id === gid)).toBe(false);
    // Candidate list = A's connections not already in the group
    const cands = (await A.client.get(`/conversations/group-candidates?group=${gid}`)).body.map((c: { profileId: string }) => c.profileId);
    expect(cands).toEqual(expect.arrayContaining([E.profileId, F.profileId]));
    expect(cands).not.toContain(B.profileId);
    expect(cands).not.toContain(D.profileId);

    // Reports can attach a group message
    const rep = await C.client.post("/reports", { profileId: B.profileId, messageId: m1.body.id, reason: "spam" });
    expect(rep.status).toBe(201);
    const [r] = (await db().execute<{ message_excerpt: string | null }>(sql`SELECT message_excerpt FROM user_reports WHERE id = ${rep.body.id}`)).rows;
    expect(r!.message_excerpt).toBe("Hey all!");
  });

  it("blocks: blocked people can't be grouped together, and a later block hides their messages", async () => {
    // E blocks C → E can't join a group that contains C
    await E.client.put(`/me/blocks/${C.profileId}`);
    const g = await A.client.post("/conversations/groups", { name: "Mixed", memberProfileIds: [C.profileId, E.profileId] });
    expect(g.status).toBe(400);
    const g2 = await A.client.post("/conversations/groups", { name: "Safe", memberProfileIds: [B.profileId, C.profileId] });
    const gid = g2.body.id as string;
    expect((await A.client.post(`/conversations/${gid}/members`, { memberProfileIds: [E.profileId] })).status).toBe(400);
    await E.client.del(`/me/blocks/${C.profileId}`);

    // B blocks C after both are in the group: B stops seeing C's messages, members and presence; unread ignores them
    await B.client.put(`/me/blocks/${C.profileId}`);
    const before = (await B.client.get("/me/unread-counts")).body.messages as number;
    await send(C.client, gid, "can you see me?");
    await send(A.client, gid, "hello from A");
    const tb = (await B.client.get(`/conversations/${gid}/messages`)).body;
    expect(tb.messages.some((m: { body: string }) => m.body === "can you see me?")).toBe(false);
    expect(tb.messages.some((m: { body: string }) => m.body === "hello from A")).toBe(true);
    expect(tb.group.members.some((m: { profileId: string }) => m.profileId === C.profileId)).toBe(false);
    expect((await B.client.get("/me/unread-counts")).body.messages).toBe(before + 1);
    await B.client.del(`/me/blocks/${C.profileId}`);
  });

  it("groups: leaving promotes an admin; the last person leaving deletes the group", async () => {
    const gid = (await A.client.post("/conversations/groups", { name: "Short lived", memberProfileIds: [B.profileId] })).body.id as string;
    expect((await B.client.put(`/conversations/${gid}/members/${A.profileId}/admin`, { admin: false })).status).toBe(403);
    expect((await A.client.put(`/conversations/${gid}/members/${A.profileId}/admin`, { admin: false })).body.code).toBe("last_admin");
    expect((await A.client.post(`/conversations/${gid}/leave`)).status).toBe(204);
    const tb = (await B.client.get(`/conversations/${gid}/messages`)).body;
    expect(tb.group).toMatchObject({ myRole: "admin", memberCount: 1 });
    expect(tb.messages.at(-1).body).toMatch(/left/);
    expect((await A.client.get(`/conversations/${gid}/messages`)).status).toBe(404);
    expect((await B.client.post(`/conversations/${gid}/leave`)).status).toBe(204);
    const [{ n }] = (await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM conversations WHERE id = ${gid}`)).rows as [{ n: number }];
    expect(n).toBe(0);
  });

  it("Premium (monthly and yearly): badge in Discover and profiles, analytics; free keeps essentials; expiry removes it", async () => {
    // Free: no analytics, no badge, essentials still work
    expect((await B.client.get("/me/analytics")).body.code).toBe("entitlement_required");
    const people = async (viewer: Att) => (await viewer.client.get(`/events/${eventId}/people`)).body.items as { id: string; premium: boolean }[];
    expect((await people(A)).find((p) => p.id === B.profileId)!.premium).toBe(false);
    expect((await send(B.client, await dm(eventId, B, A), "free users can still chat")).status).toBe(201);

    const plans = (await db().execute<{ id: string; code: string }>(sql`SELECT id, code FROM subscription_plans WHERE code IN ('attendee_premium_monthly','attendee_premium_yearly')`)).rows;
    const monthly = plans.find((p) => p.code === "attendee_premium_monthly")!.id, yearly = plans.find((p) => p.code === "attendee_premium_yearly")!.id;
    const until = new Date(Date.now() + 86_400_000);
    await grantPlan(db(), { attendeeId: await attendeeOf(B.profileId) }, monthly, "promo", randomUUID(), until);
    await grantPlan(db(), { attendeeId: await attendeeOf(C.profileId) }, yearly, "promo", randomUUID(), until);
    for (const who of [B, C]) {
      const ent = (await who.client.get("/entitlements")).body;
      const on = ent.features.filter((f: { enabled: boolean }) => f.enabled).map((f: { featureKey: string }) => f.featureKey);
      expect(on).toEqual(expect.arrayContaining(["attendee.discover.advanced_filters", "attendee.matching.detailed", "attendee.profile.badge", "attendee.saved_by.visibility", "attendee.analytics"]));
      const an = await who.client.get("/me/analytics");
      expect(an.status).toBe(200);
      expect(an.body).toMatchObject({ eventsJoined: 1, connections: expect.any(Number), connectionsByEvent: [expect.objectContaining({ eventId })] });
      expect((await who.client.get("/me/saved-by")).status).toBe(200);
    }
    // Badge visible to others in Discover, on the event profile and the connection profile — across all events
    const list = await people(A);
    expect(list.find((p) => p.id === B.profileId)!.premium).toBe(true);
    expect(list.find((p) => p.id === C.profileId)!.premium).toBe(true);
    expect((await A.client.get(`/events/${eventId}/people/${B.profileId}`)).body.premium).toBe(true);
    expect((await A.client.get(`/people/${B.profileId}`)).body.premium).toBe(true);
    const { eventId: second, qr: qr2 } = await setupEvent();
    await B.client.post(`/events/${second}/participation`, {});
    const viewer = await createAttendee(qr2);
    expect(((await viewer.client.get(`/events/${second}/people`)).body.items as { id: string; premium: boolean }[]).find((p) => p.id === B.profileId)?.premium).toBe(true);
    // Organizer can switch highlighting off for an event — the badge disappears there, visibility is unchanged
    const org = (await db().execute<{ id: string }>(sql`SELECT event_id AS id FROM event_networking_settings WHERE event_id = ${eventId}`)).rows[0]!.id;
    await db().execute(sql`UPDATE event_networking_settings SET premium_highlighting_enabled = false WHERE event_id = ${org}`);
    const off = await people(A);
    expect(off.find((p) => p.id === B.profileId)).toMatchObject({ premium: false });
    await db().execute(sql`UPDATE event_networking_settings SET premium_highlighting_enabled = true WHERE event_id = ${org}`);
    // Expiry: entitlements past valid_until stop immediately
    await db().execute(sql`UPDATE user_entitlements SET valid_until = now() - interval '1 minute' WHERE attendee_id = ${await attendeeOf(B.profileId)}`);
    expect((await B.client.get("/me/analytics")).status).toBe(403);
    expect((await people(A)).find((p) => p.id === B.profileId)!.premium).toBe(false);
    expect((await B.client.get("/entitlements")).body.planCode).toBe("attendee_free");
  });
});
