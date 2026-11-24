import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { Client, createAttendee, resetDb, setupEvent, uniq } from "@/server/test/harness";
import { verifyWebhookSignature } from "@/server/modules/billing";
import { createHmac } from "node:crypto";
import { totp } from "@/server/lib/totp";

const db = () => getDb();
const count = async (q: ReturnType<typeof sql>) => Number(((await db().execute<{ n: number }>(q)).rows[0] as { n: number }).n);

beforeAll(async () => {
  await resetDb();
});

describe("QR entry & onboarding (M01, M02, PRD §3)", () => {
  it("resolves QR, creates profile atomically, sets HttpOnly cookie, recovery code, redirects to event home (not Discover)", async () => {
    const { qr, eventId } = await setupEvent();
    const anon = new Client();
    const landing = await anon.get(`/public/qr/${qr}`);
    expect(landing.status).toBe(200);
    expect(landing.body.state).toBe("valid");
    expect(landing.body.event.options).toEqual({ discoverAvailable: true, anonymousBrowsing: true, createProfileAvailable: true });

    const a = await createAttendee(qr);
    expect(a.body.redirectTo).toBe(`/app/events/${eventId}/home`);
    expect(a.body.redirectTo).not.toContain("discover");
    expect(a.recoveryCode).toMatch(/^QRS(-[0-9A-Z]{4}){6}$/);
    const me = await a.client.get(`/me/session?eventId=${eventId}`);
    expect(me.body).toMatchObject({ authenticated: true, isParticipant: true });
    expect(await count(sql`SELECT count(*)::int AS n FROM attendee_recovery_codes WHERE status = 'active'`)).toBeGreaterThan(0);
  });

  it("cookie flags are host-only HttpOnly SameSite=Lax", async () => {
    const { qr } = await setupEvent();
    const c = new Client();
    const r = await c.req("POST", "/onboarding/profile", { qrCode: qr, displayName: "X", username: uniq("ck"), interests: [{ name: "Jazz" }], skills: [{ name: "Drums" }], isPublic: false }, { "idempotency-key": crypto.randomUUID() });
    const cookie = r.setCookies.find((x) => x.startsWith("qr_s="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("anonymous browsing never creates identity, session or participation (BR-02)", async () => {
    const { qr } = await setupEvent();
    const before = await count(sql`SELECT count(*)::int AS n FROM attendee_sessions`);
    const anon = new Client();
    for (const p of [`/public/qr/${qr}`, "/taxonomy/interests?q=in", "/onboarding/username-availability?u=someone", "/me/session", `/public/events/${qr}/people`]) {
      const r = await anon.get(p);
      expect(r.status).toBe(200);
      expect(r.setCookies.length).toBe(0);
    }
    expect(await count(sql`SELECT count(*)::int AS n FROM attendee_sessions`)).toBe(before);
    const restricted = await anon.post(`/events/00000000-0000-4000-8000-000000000000/connections`, { profileId: "00000000-0000-4000-8000-000000000000" });
    expect(restricted.status).toBe(401);
    expect(restricted.body.code).toBe("profile_required");
  });

  it("enforces mandatory fields, consent, case-insensitive unique usernames", async () => {
    const { qr } = await setupEvent();
    const bad = await new Client().req("POST", "/onboarding/profile", { qrCode: qr, displayName: "", username: "ok_name", interests: [], skills: [], isPublic: true }, { "idempotency-key": crypto.randomUUID() });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.errors)).toEqual(expect.arrayContaining(["displayName", "interests", "skills", "anonymousVisibilityConsent"]));
    const name = uniq("Case");
    await createAttendee(qr, { username: name });
    const dup = await new Client().req("POST", "/onboarding/profile", { qrCode: qr, displayName: "Y", username: name.toUpperCase(), interests: [{ name: "Jazz" }], skills: [{ name: "Drums" }], isPublic: false }, { "idempotency-key": crypto.randomUUID() });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("username_taken");
    expect(dup.body.suggestions.length).toBeGreaterThan(0);
  });

  it("concurrent same-username requests create exactly one profile; failures leave no partial rows", async () => {
    const { qr } = await setupEvent();
    const name = uniq("race");
    const results = await Promise.all(Array.from({ length: 6 }, () => new Client().req("POST", "/onboarding/profile",
      { qrCode: qr, displayName: "R", username: name, interests: [{ name: "Jazz" }], skills: [{ name: "Drums" }], isPublic: false }, { "idempotency-key": crypto.randomUUID() })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    const partial = uniq("partial");
    const fail = await new Client().req("POST", "/onboarding/profile", { qrCode: qr, displayName: "P", username: partial, interests: [{ name: "x" }], skills: [{ name: "Drums" }], isPublic: false }, { "idempotency-key": crypto.randomUUID() });
    expect(fail.status).toBe(400);
    expect(await count(sql`SELECT count(*)::int AS n FROM user_profiles WHERE username_normalized = ${partial}`)).toBe(0);
  });

  it("idempotent retry returns the same profile, signs the retrying browser in, never re-shows the recovery code", async () => {
    const { qr } = await setupEvent();
    const key = crypto.randomUUID();
    const body = { qrCode: qr, displayName: "Retry", username: uniq("retry"), interests: [{ name: "Jazz" }], skills: [{ name: "Drums" }], isPublic: false };
    const first = await new Client().req("POST", "/onboarding/profile", body, { "idempotency-key": key });
    const retry = new Client();
    const second = await retry.req("POST", "/onboarding/profile", body, { "idempotency-key": key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.profile.id).toBe(first.body.profile.id);
    expect(second.body.recoveryCode).toBeNull();
    expect((await retry.get("/me/session")).body.authenticated).toBe(true);
    const reused = await new Client().req("POST", "/onboarding/profile", { ...body, displayName: "Different" }, { "idempotency-key": key });
    expect(reused.status).toBe(422);
  });

  it("returning attendee joins a second event with the same global profile; existing session can't create a second identity", async () => {
    const e1 = await setupEvent();
    const e2 = await setupEvent({ startsInHours: 72 });
    const a = await createAttendee(e1.qr);
    const again = await a.client.req("POST", "/onboarding/profile", { qrCode: e2.qr, displayName: "Z", username: uniq("z"), interests: [{ name: "Jazz" }], skills: [{ name: "Drums" }], isPublic: false }, { "idempotency-key": crypto.randomUUID() });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("existing_identity");
    const join = await a.client.post(`/events/${e2.eventId}/participation`, { qrCode: e2.qr });
    expect(join.status).toBe(200);
    expect((await a.client.post(`/events/${e2.eventId}/participation`, { qrCode: e2.qr })).body.alreadyJoined).toBe(true);
    const mine = await a.client.get("/me/events");
    expect(mine.body).toHaveLength(2);
    const upcoming = await a.client.get("/me/events?scope=upcoming");
    expect(upcoming.body[0].event.networkingStatus).toBe("not_open");
  });

  it("full events, revoked and invalid QR codes", async () => {
    const { qr, org, eventId } = await setupEvent({ maxParticipants: 1 });
    await createAttendee(qr);
    const full = await new Client().req("POST", "/onboarding/profile", { qrCode: qr, displayName: "F", username: uniq("full"), interests: [{ name: "Jazz" }], skills: [{ name: "Drums" }], isPublic: false }, { "idempotency-key": crypto.randomUUID() });
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("event_full");
    expect((await new Client().get("/public/qr/ZZZZZZZZZZZZ")).status).toBe(404);
    const regen = await org.post(`/organizer/events/${eventId}/qr/regenerate`);
    expect(regen.body.qr.code).not.toBe(qr);
    expect((await new Client().get(`/public/qr/${qr}`)).body.state).toBe("revoked");
    await org.put(`/organizer/events/${eventId}/qr/access`, { enabled: false });
    expect((await new Client().get(`/public/qr/${regen.body.qr.code}`)).body.state).toBe("disabled");
  });
});

describe("Sessions & recovery (D-13)", () => {
  it("recovery: username + code, rotates the code, revokes other sessions, lockout after 5 failures", async () => {
    const { qr } = await setupEvent();
    const a = await createAttendee(qr);
    const device2 = new Client();
    const r = await device2.post("/recovery", { username: `@${a.username.toUpperCase()}`, recoveryCode: a.recoveryCode.toLowerCase().replace(/-/g, " ") });
    expect(r.status).toBe(200);
    expect(r.body.newRecoveryCode).not.toBe(a.recoveryCode);
    expect((await device2.get("/me/profile")).status).toBe(200);
    expect((await a.client.get("/me/profile")).status).toBe(401);
    expect((await new Client().post("/recovery", { username: a.username, recoveryCode: a.recoveryCode })).status).toBe(401);

    const b = await createAttendee(qr);
    for (let i = 0; i < 5; i++) await new Client().post("/recovery", { username: b.username, recoveryCode: "QRS-0000-0000-0000-0000-0000-0000" });
    expect((await new Client().post("/recovery", { username: b.username, recoveryCode: b.recoveryCode })).status).toBe(401);
    const unknown = await new Client().post("/recovery", { username: "nobody_here_zz", recoveryCode: b.recoveryCode });
    expect(unknown.body.detail).toBe((await new Client().post("/recovery", { username: b.username, recoveryCode: "" })).body.detail);
  });

  it("idle and absolute expiry; 24h rotation with grace; replay after grace revokes", async () => {
    const { qr } = await setupEvent();
    const a = await createAttendee(qr);
    const token = a.client.cookies.get("qr_s")!;
    await db().execute(sql`UPDATE attendee_sessions SET token_issued_at = now() - interval '25 hours' WHERE revoked_at IS NULL AND attendee_id = (SELECT attendee_id FROM user_profiles WHERE id = ${a.profileId})`);
    const rotated = await a.client.get("/me/profile");
    expect(rotated.status).toBe(200);
    const newToken = a.client.cookies.get("qr_s")!;
    expect(newToken).not.toBe(token);
    const old = new Client(); old.cookies.set("qr_s", token);
    expect((await old.get("/me/profile")).status).toBe(200);
    await db().execute(sql`UPDATE attendee_sessions SET previous_token_valid_until = now() - interval '1 minute' WHERE attendee_id = (SELECT attendee_id FROM user_profiles WHERE id = ${a.profileId})`);
    expect((await old.get("/me/profile")).status).toBe(401);
    expect((await a.client.get("/me/profile")).status).toBe(401);

    const b = await createAttendee(qr);
    await db().execute(sql`UPDATE attendee_sessions SET expires_at = now() - interval '1 minute' WHERE attendee_id = (SELECT attendee_id FROM user_profiles WHERE id = ${b.profileId})`);
    expect((await b.client.get("/me/profile")).status).toBe(401);
    const c = await createAttendee(qr);
    const s = (await db().execute<{ idle: number; abs: number }>(sql`SELECT round(extract(epoch FROM expires_at - created_at)/86400)::int AS idle, round(extract(epoch FROM absolute_expires_at - created_at)/86400)::int AS abs FROM attendee_sessions WHERE attendee_id = (SELECT attendee_id FROM user_profiles WHERE id = ${c.profileId})`)).rows[0]!;
    expect(s).toMatchObject({ idle: 30, abs: 180 });
  });

  it("CSRF: writes without the app header or from another origin are rejected", async () => {
    const { qr } = await setupEvent();
    const a = await createAttendee(qr);
    expect((await a.client.req("POST", "/me/session/logout", {}, { "x-qrious-client": "" })).status).toBe(403);
    expect((await a.client.req("POST", "/me/session/logout", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await a.client.get("/me/profile")).status).toBe(200);
  });
});

describe("Discovery, privacy, matching, pulse (M05–M08)", () => {
  it("anonymous discovery shows only opted-in public fields; members see more; blocked users vanish", async () => {
    const { qr, eventId } = await setupEvent();
    const pub = await createAttendee(qr, { company: "Acme", lookingForText: "A drummer", socialLinks: [{ platform: "instagram", url: "instagram.com/pub", visibility: "members" }, { platform: "website", url: "site.example.com", visibility: "public" }] });
    const priv = await createAttendee(qr, { isPublic: false, anonymousVisibilityConsent: false });
    const anonList = await new Client().get(`/public/events/${qr}/people`);
    const ids = anonList.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(pub.profileId);
    expect(ids).not.toContain(priv.profileId);
    const card = anonList.body.items.find((i: { id: string }) => i.id === pub.profileId);
    expect(card.company).toBeNull();
    expect(card.lookingForText).toBeUndefined();
    expect(card.socialLinks).toEqual([{ platform: "website", url: "https://site.example.com/" }]);
    expect(anonList.body.total).toBeUndefined();

    const viewer = await createAttendee(qr, { interests: [{ name: "Indie" }] });
    const member = await viewer.client.get(`/events/${eventId}/people`);
    const seen = member.body.items.find((i: { id: string }) => i.id === pub.profileId);
    expect(seen.company).toBe("Acme");
    expect(seen.lookingForText).toBe("A drummer");
    expect(seen.commonInterests).toContain("Indie");
    expect(seen.socialLinks.length).toBe(2);
    expect(member.body.items.map((i: { id: string }) => i.id)).toContain(priv.profileId); // private only hides from anonymous

    expect((await pub.client.put(`/me/blocks/${viewer.profileId}`)).status).toBe(204);
    const after = await viewer.client.get(`/events/${eventId}/people`);
    expect(after.body.items.map((i: { id: string }) => i.id)).not.toContain(pub.profileId);
    expect((await viewer.client.get(`/events/${eventId}/people/${pub.profileId}`)).status).toBe(404);
  });

  it("paused participants are hidden; non-participants get 403; organizer toggles are enforced", async () => {
    const { qr, eventId, org } = await setupEvent();
    const a = await createAttendee(qr);
    const b = await createAttendee(qr);
    await a.client.patch(`/events/${eventId}/me`, { discoveryPaused: true });
    expect((await b.client.get(`/events/${eventId}/people`)).body.items.map((i: { id: string }) => i.id)).not.toContain(a.profileId);
    const other = await setupEvent();
    expect((await b.client.get(`/events/${other.eventId}/people`)).status).toBe(403);
    await org.put(`/organizer/events/${eventId}/networking-settings`, { discoverEnabled: false, anonymousBrowsingEnabled: false });
    expect((await b.client.get(`/events/${eventId}/people`)).body.code).toBe("feature_disabled");
    expect((await new Client().get(`/public/events/${qr}/people`)).status).toBe(403);
  });

  it("smart matching ranks complementary skills with explanations and respects dismissals", async () => {
    const { qr, eventId } = await setupEvent();
    const producer = await createAttendee(qr, { skills: [{ name: "Music production" }], lookingForSkills: [{ name: "Singing" }], interests: [{ name: "Indie" }] });
    const singer = await createAttendee(qr, { skills: [{ name: "Singing" }], interests: [{ name: "Indie" }] });
    await createAttendee(qr, { skills: [{ name: "Cricket" }].map(() => ({ name: "Finance" })), interests: [{ name: "Cricket" }] });
    const m = await producer.client.get(`/events/${eventId}/matches`);
    expect(m.status).toBe(200);
    expect(m.body.items[0].profile.id).toBe(singer.profileId);
    expect(m.body.items[0].reasons.join(" ")).toMatch(/Singing/);
    await producer.client.post(`/events/${eventId}/matches/${singer.profileId}/dismiss`);
    expect((await producer.client.get(`/events/${eventId}/matches`)).body.items.map((i: { profile: { id: string } }) => i.profile.id)).not.toContain(singer.profileId);
  });

  it("event pulse suppresses small groups (k=5) and updates with availability", async () => {
    const { qr, eventId } = await setupEvent();
    const people = [];
    for (let i = 0; i < 6; i++) people.push(await createAttendee(qr));
    const small = await people[0]!.client.get(`/events/${eventId}/pulse`);
    expect(small.body.totals.participants).toBe(6);
    expect(small.body.totals.lookingForCollaborators).toBeNull();
    for (const p of people.slice(0, 5)) await p.client.patch(`/events/${eventId}/me`, { availabilityStatus: "looking_for_collaborators" });
    const big = await people[0]!.client.get(`/events/${eventId}/pulse`);
    expect(big.body.totals.lookingForCollaborators).toBe(5);
    expect(big.body.topInterests.map((t: { name: string }) => t.name)).toContain("Indie");
  });
});

describe("Connections & messaging (M09, M10, D-05)", () => {
  it("request → notify → accept → conversation → message → unread → read; persists after event end and organizer toggles", async () => {
    const { qr, eventId, org } = await setupEvent();
    const a = await createAttendee(qr);
    const b = await createAttendee(qr);
    const req = await a.client.post(`/events/${eventId}/connections`, { profileId: b.profileId, introMessage: "Hi! Loved your set." });
    expect(req.status).toBe(201);
    expect((await a.client.post(`/events/${eventId}/connections`, { profileId: b.profileId })).body.code).toBe("request_pending");
    expect((await b.client.post(`/events/${eventId}/connections`, { profileId: a.profileId })).body.code).toBe("incoming_request");
    expect((await b.client.get("/me/unread-counts")).body.requests).toBe(1);
    expect((await b.client.get("/me/notifications")).body.items[0].type).toBe("connection_request");
    expect((await a.client.post(`/connections/${req.body.id}/accept`)).status).toBe(404); // only addressee
    const acc = await b.client.post(`/connections/${req.body.id}/accept`);
    expect(acc.body.conversationId).toBeTruthy();
    const conv = acc.body.conversationId;
    const sent = await a.client.post(`/conversations/${conv}/messages`, { body: "Hey there", clientMessageId: crypto.randomUUID() });
    expect(sent.status).toBe(201);
    const dupId = crypto.randomUUID();
    await a.client.post(`/conversations/${conv}/messages`, { body: "Once", clientMessageId: dupId });
    await a.client.post(`/conversations/${conv}/messages`, { body: "Once", clientMessageId: dupId });
    expect((await b.client.get("/me/unread-counts")).body.messages).toBe(2);
    const thread = await b.client.get(`/conversations/${conv}/messages`);
    expect(thread.body.messages.map((m: { body: string }) => m.body)).toEqual(["Hey there", "Once"]);
    await b.client.post(`/conversations/${conv}/read`, { lastReadMessageId: thread.body.messages.at(-1).id });
    expect((await b.client.get("/me/unread-counts")).body.messages).toBe(0);

    // A third person can't read it
    const c = await createAttendee(qr);
    expect((await c.client.get(`/conversations/${conv}/messages`)).status).toBe(404);
    expect((await c.client.post(`/conversations/${conv}/messages`, { body: "x", clientMessageId: crypto.randomUUID() })).status).toBe(404);

    // Organizer disables messaging + ends event: existing conversation keeps working (D-05)
    await org.put(`/organizer/events/${eventId}/networking-settings`, { messagingEnabled: false, connectionsEnabled: false });
    await org.post(`/organizer/events/${eventId}/end`);
    expect((await a.client.post(`/conversations/${conv}/messages`, { body: "Still here", clientMessageId: crypto.randomUUID() })).status).toBe(201);
    // but no new requests through this event
    expect((await c.client.post(`/events/${eventId}/connections`, { profileId: a.profileId })).status).toBe(403);
  });

  it("one persistent relationship per pair across events; removal stops messaging; blocks stop everything", async () => {
    const e1 = await setupEvent();
    const e2 = await setupEvent();
    const a = await createAttendee(e1.qr);
    const b = await createAttendee(e1.qr);
    await a.client.post(`/events/${e2.eventId}/participation`, { qrCode: e2.qr });
    await b.client.post(`/events/${e2.eventId}/participation`, { qrCode: e2.qr });
    const req = await a.client.post(`/events/${e1.eventId}/connections`, { profileId: b.profileId });
    const acc = await b.client.post(`/connections/${req.body.id}/accept`);
    const again = await a.client.post(`/events/${e2.eventId}/connections`, { profileId: b.profileId });
    expect(again.body.code).toBe("already_connected");
    expect(await count(sql`SELECT count(*)::int AS n FROM connections WHERE status = 'accepted' AND id = ${req.body.id}`)).toBe(1);
    expect((await a.client.get("/me/connections")).body[0].originEvent.id).toBe(e1.eventId);

    await a.client.del(`/connections/${req.body.id}`);
    expect((await b.client.post(`/conversations/${acc.body.conversationId}/messages`, { body: "hi", clientMessageId: crypto.randomUUID() })).status).toBe(403);

    const r2 = await b.client.post(`/events/${e2.eventId}/connections`, { profileId: a.profileId });
    expect(r2.status).toBe(201);
    await a.client.put(`/me/blocks/${b.profileId}`);
    expect((await a.client.post(`/connections/${r2.body.id}/accept`)).status).toBe(409);
    expect((await b.client.get(`/conversations/${acc.body.conversationId}/messages`)).status).toBe(404);
    expect((await b.client.post(`/events/${e2.eventId}/connections`, { profileId: a.profileId })).status).toBe(404);
  });

  it("conversation can be started later through a shared event with messaging on", async () => {
    const { qr, eventId, org } = await setupEvent();
    await org.put(`/organizer/events/${eventId}/networking-settings`, { messagingEnabled: false });
    const a = await createAttendee(qr);
    const b = await createAttendee(qr);
    const req = await a.client.post(`/events/${eventId}/connections`, { profileId: b.profileId });
    const acc = await b.client.post(`/connections/${req.body.id}/accept`);
    expect(acc.body.conversationId).toBeNull();
    expect((await a.client.post("/conversations", { profileId: b.profileId })).status).toBe(403);
    await org.put(`/organizer/events/${eventId}/networking-settings`, { messagingEnabled: true });
    const start = await a.client.post("/conversations", { profileId: b.profileId, eventId });
    expect(start.status).toBe(201);
    expect((await b.client.post("/conversations", { profileId: a.profileId })).body.id).toBe(start.body.id);
  });
});

describe("Organizers, lifecycle, participants, admin (M13–M17, §7)", () => {
  it("organizations are isolated between organizers", async () => {
    const one = await setupEvent();
    const two = await setupEvent();
    expect((await two.org.get(`/organizer/events/${one.eventId}`)).status).toBe(404);
    expect((await two.org.patch(`/organizer/events/${one.eventId}`, { name: "Hijack" })).status).toBe(404);
    expect((await two.org.get(`/organizations/${one.orgId}/dashboard`)).status).toBe(404);
    expect((await new Client().get(`/organizer/events/${one.eventId}`)).status).toBe(401);
  });

  it("lifecycle: draft→published (opens 24h before start) → active → paused → resumed → ended → archived", async () => {
    const { org, eventId, qr } = await setupEvent({ startsInHours: 48 });
    let e = await org.get(`/organizer/events/${eventId}`);
    expect(e.body.status).toBe("published");
    const a = await createAttendee(qr);
    expect((await a.client.get(`/events/${eventId}/people`)).body.code).toBe("networking_closed");
    await org.patch(`/organizer/events/${eventId}`, { startsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(), endsAt: new Date(Date.now() + 8 * 3_600_000).toISOString() });
    e = await org.get(`/organizer/events/${eventId}`);
    expect(e.body.status).toBe("active");
    expect((await org.post(`/organizer/events/${eventId}/pause`)).body.status).toBe("networking_paused");
    expect((await new Client().get(`/public/qr/${qr}`)).body.event.networkingStatus).toBe("paused");
    expect((await org.post(`/organizer/events/${eventId}/resume`)).body.status).toBe("active");
    expect((await org.post(`/organizer/events/${eventId}/archive`)).status).toBe(409);
    expect((await org.post(`/organizer/events/${eventId}/end`)).body.status).toBe("ended");
    expect((await org.post(`/organizer/events/${eventId}/archive`)).body.status).toBe("archived");
    expect((await new Client().get(`/public/qr/${qr}`)).body.state).toBe("event_unavailable");
    // automatic end
    const late = await setupEvent({ startsInHours: -5, durationHours: 6 });
    await db().execute(sql`UPDATE events SET ends_at = now() - interval '1 minute', starts_at = now() - interval '3 hours' WHERE id = ${late.eventId}`);
    expect((await late.org.get(`/organizer/events/${late.eventId}`)).body.status).toBe("ended");
  });

  it("participant removal, restore and organizer only sees member-level fields", async () => {
    const { org, eventId, qr } = await setupEvent();
    const a = await createAttendee(qr, { company: "Secret Co", lookingForText: "private-ish" });
    const list = await org.get(`/organizer/events/${eventId}/participants`);
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("Secret Co");
    const pid = list.body.items[0].id;
    expect((await org.post(`/organizer/events/${eventId}/participants/${pid}/remove`, { reason: "Spam" })).status).toBe(204);
    expect((await a.client.get(`/events/${eventId}/people`)).status).toBe(403);
    expect((await a.client.post(`/events/${eventId}/participation`, { qrCode: qr })).body.code).toBe("participant_removed");
    await org.post(`/organizer/events/${eventId}/participants/${pid}/restore`);
    expect((await a.client.post(`/events/${eventId}/participation`, { qrCode: qr })).status).toBe(200);
  });

  it("admin bootstrap, suspension, report handling, promotional premium", async () => {
    process.env.QRIOUS_ADMIN_BOOTSTRAP_TOKEN = "bootstrap-token-for-tests-0123456789";
    const { qr, eventId } = await setupEvent();
    const adminClient = new Client();
    const adminEmail = `${uniq("admin")}@example.com`;
    await adminClient.post("/organizer/auth/register", { email: adminEmail, password: "a very long admin password", displayName: "Admin" });
    expect((await adminClient.post("/organizer/auth/bootstrap-admin", { token: "wrong" })).status).toBe(403);
    expect((await adminClient.post("/organizer/auth/bootstrap-admin", { token: process.env.QRIOUS_ADMIN_BOOTSTRAP_TOKEN })).status).toBe(200);
    expect((await adminClient.post("/organizer/auth/bootstrap-admin", { token: process.env.QRIOUS_ADMIN_BOOTSTRAP_TOKEN })).body.code).toBe("admin_exists");

    // D-24: admin endpoints require TOTP enrollment, then a verified code per session
    expect((await adminClient.get("/admin/reports")).body.code).toBe("mfa_enrollment_required");
    expect((await adminClient.post("/organizer/auth/mfa/verify", { code: "123456" })).status).toBe(409);
    const setup = await adminClient.post("/organizer/auth/mfa/setup");
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await adminClient.post("/organizer/auth/mfa/enable", { code: "000000" })).status).toBe(400);
    const now = Date.now();
    expect((await adminClient.post("/organizer/auth/mfa/enable", { code: totp(setup.body.secret, now) })).status).toBe(200);
    expect((await adminClient.post("/organizer/auth/mfa/setup")).body.code).toBe("mfa_already_enabled");
    expect((await adminClient.get("/admin/reports")).status).toBe(200);
    expect((await adminClient.get("/organizer/me")).body.user).toMatchObject({ isAdmin: true, mfaEnrolled: true, mfaVerified: true });
    // A new admin session must verify again; the code already used is rejected (replay)
    const second = new Client();
    expect((await second.post("/organizer/auth/login", { email: adminEmail, password: "a very long admin password" })).status).toBe(200);
    expect((await second.get("/admin/reports")).body.code).toBe("mfa_required");
    expect((await second.post("/organizer/auth/mfa/verify", { code: totp(setup.body.secret, now) })).status).toBe(400);
    expect((await second.post("/organizer/auth/mfa/verify", { code: totp(setup.body.secret, now + 30_000) })).status).toBe(200);
    expect((await second.get("/admin/reports")).status).toBe(200);
    const [{ totp_secret_enc }] = (await db().execute<{ totp_secret_enc: string }>(sql`SELECT totp_secret_enc FROM organizer_users WHERE email_normalized = ${adminEmail.toLowerCase()}`)).rows;
    expect(totp_secret_enc).not.toContain(setup.body.secret); // encrypted at rest

    const a = await createAttendee(qr);
    const b = await createAttendee(qr);
    const rep = await b.client.post("/reports", { profileId: a.profileId, eventId, reason: "spam", details: "Spamming everyone" });
    expect(rep.status).toBe(201);
    const reports = await adminClient.get("/admin/reports");
    expect(reports.body[0].id).toBe(rep.body.id);
    await adminClient.post(`/admin/reports/${rep.body.id}/action`, { note: "Confirmed", suspendUser: true });
    expect((await a.client.get("/me/profile")).status).toBe(401);

    const grant = await adminClient.post("/admin/promotional-access", { username: b.username, planCode: "attendee_premium_monthly", days: 30, reason: "Beta tester" });
    expect(grant.status).toBe(201);
    const ent = await b.client.get("/entitlements");
    expect(ent.body.planCode).toBe("attendee_premium");
    expect(ent.body.features.find((f: { featureKey: string }) => f.featureKey === "attendee.matching.detailed").enabled).toBe(true);
    const nonAdmin = await setupEvent();
    expect((await nonAdmin.org.get("/admin/reports")).status).toBe(403);
  });

  it("organizer login lockout and recovery with code", async () => {
    const c = new Client();
    const email = `${uniq("lock")}@example.com`;
    const reg = await c.post("/organizer/auth/register", { email, password: "first long password!", displayName: "Lock" });
    for (let i = 0; i < 5; i++) await new Client().post("/organizer/auth/login", { email, password: "wrong password here" });
    expect((await new Client().post("/organizer/auth/login", { email, password: "first long password!" })).status).toBe(423);
    const rec = await new Client().post("/organizer/auth/recover", { email, recoveryCode: reg.body.recoveryCode, newPassword: "second long password!" });
    expect(rec.status).toBe(200);
    expect((await c.get("/organizer/me")).body.authenticated).toBe(false); // old session revoked
    expect((await new Client().post("/organizer/auth/login", { email, password: "second long password!" })).status).toBe(200);
  });
});

describe("Account deletion & billing", () => {
  it("deletion hides the attendee, can be cancelled, and maintenance anonymizes after the grace period", async () => {
    const { qr, eventId } = await setupEvent();
    const a = await createAttendee(qr);
    const b = await createAttendee(qr);
    await a.client.post("/me/deletion-request");
    expect((await b.client.get(`/events/${eventId}/people`)).body.items.map((i: { id: string }) => i.id)).not.toContain(a.profileId);
    expect((await a.client.get("/me/profile")).status).toBe(403);
    await a.client.del("/me/deletion-request");
    expect((await a.client.get("/me/profile")).status).toBe(200);
    await a.client.post("/me/deletion-request");
    await db().execute(sql`UPDATE account_deletion_requests SET scheduled_for = now() - interval '1 minute'`);
    const { runMaintenance } = await import("@/server/modules/admin");
    await runMaintenance(db());
    const [row] = (await db().execute<{ display_name: string; status: string }>(sql`SELECT up.display_name, a.status FROM user_profiles up JOIN attendees a ON a.id = up.attendee_id WHERE up.id = ${a.profileId}`)).rows;
    expect(row).toMatchObject({ display_name: "Deleted user", status: "deleted" });
    const avail = await new Client().get(`/onboarding/username-availability?u=${a.username}`);
    expect(avail.body.available).toBe(false); // held 30 days
  });

  it("webhook signature verification and payments-disabled checkout", async () => {
    const body = JSON.stringify({ event: "payment.captured" });
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig, "whsec")).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, "whsec")).toBe(false);
    expect(verifyWebhookSignature(body, null, "whsec")).toBe(false);
    const { qr } = await setupEvent();
    const a = await createAttendee(qr);
    const r = await a.client.post("/subscriptions/checkout", { planCode: "attendee_premium_monthly" });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("payments_unavailable");
    expect((await new Client().post("/payments/webhook/razorpay", {}, { "x-razorpay-signature": "bad" })).status).toBe(401);
  });
});
