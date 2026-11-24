import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError, forbidden, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { isUuid } from "@/server/core/http";
import { requireAttendee } from "./identity";
import { isNetworkingOpen, loadEvent, resolveQr, type EventFull } from "./events-core";
import { profileTags, type Tag } from "./profiles";
import { requireParticipant } from "./participation";
import { hasFeature } from "./billing";

const { userProfiles, socialLinks, savedProfiles, eventParticipants, connections } = schema;

export type Audience = "public" | "member" | "connection";

/** SQL: no block in either direction between viewer and the attendee column. */
export const notBlocked = (viewer: string, attendeeCol: SQL | string) => sql`NOT EXISTS (
  SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = ${viewer} AND b.blocked_attendee_id = ${sql.raw(String(attendeeCol))})
  OR (b.blocked_attendee_id = ${viewer} AND b.blocker_attendee_id = ${sql.raw(String(attendeeCol))}))`;

export async function isBlockedEitherWay(db: Executor, a: string, b: string) {
  const r = await db.execute(sql`SELECT 1 FROM user_blocks WHERE (blocker_attendee_id = ${a} AND blocked_attendee_id = ${b}) OR (blocker_attendee_id = ${b} AND blocked_attendee_id = ${a}) LIMIT 1`);
  return r.rows.length > 0;
}

export async function connectionState(db: Executor, viewer: string, other: string) {
  const [lo, hi] = viewer < other ? [viewer, other] : [other, viewer];
  const [c] = await db.select().from(connections)
    .where(and(eq(connections.attendeeLowId, lo), eq(connections.attendeeHighId, hi), inArray(connections.status, ["pending", "accepted"]))).limit(1);
  if (!c) return { state: "none" as const, connectionId: null };
  if (c.status === "accepted") return { state: "connected" as const, connectionId: c.id };
  return { state: c.requesterAttendeeId === viewer ? ("pending_outgoing" as const) : ("pending_incoming" as const), connectionId: c.id };
}

type Row = {
  profile_id: string; attendee_id: string; display_name: string; username: string; bio: string | null; profession: string | null;
  company: string | null; company_visibility: string; location: string | null; location_visibility: string; photo_url: string | null; thumb_url: string | null;
  looking_for_text: string | null; can_offer_text: string | null; availability: string | null; availability_visibility: string | null; is_public: boolean;
};

const canSee = (vis: string, audience: Audience) => vis === "public" || (vis === "members" && audience !== "public") || (vis === "connections" && audience === "connection");

/** Projects a profile for an audience — the ONLY way profiles leave the API for other people (PRD §12.2). */
async function project(db: Executor, rows: Row[], audienceOf: (r: Row) => Audience, viewer: { attendeeId: string; profileId: string } | null) {
  const ids = rows.map((r) => r.profile_id);
  const tags = await profileTags(db, ids.concat(viewer ? [viewer.profileId] : []));
  const links = ids.length ? await db.select().from(socialLinks).where(inArray(socialLinks.profileId, ids)) : [];
  const myInterests = new Set((viewer ? tags.interests.get(viewer.profileId) ?? [] : []).map((t) => t.id));
  const myLookingFor = new Set((viewer ? tags.lookingFor.get(viewer.profileId) ?? [] : []).map((t) => t.id));
  const saved = viewer && ids.length ? new Set((await db.select({ id: savedProfiles.savedProfileId }).from(savedProfiles)
    .where(and(eq(savedProfiles.attendeeId, viewer.attendeeId), inArray(savedProfiles.savedProfileId, ids)))).map((r) => r.id)) : new Set<string>();

  return rows.map((r) => {
    const audience = audienceOf(r);
    const interests: Tag[] = tags.interests.get(r.profile_id) ?? [];
    const skillsT: Tag[] = tags.skills.get(r.profile_id) ?? [];
    const base = {
      id: r.profile_id, displayName: r.display_name, username: r.username, bio: r.bio, profession: r.profession,
      photo: r.photo_url ? { url: r.photo_url, thumbnailUrl: r.thumb_url ?? r.photo_url } : null,
      interests: interests.map(({ id, name }) => ({ id, name })), skills: skillsT.map(({ id, name }) => ({ id, name })),
      company: canSee(r.company_visibility, audience) ? r.company : null,
      location: canSee(r.location_visibility, audience) ? r.location : null,
      socialLinks: links.filter((l) => l.profileId === r.profile_id && canSee(l.visibility, audience)).sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l) => ({ platform: l.platform, url: l.url })),
      audience,
    };
    if (audience === "public") return base;
    const availVisible = r.availability && r.availability_visibility !== "hidden" && (r.availability_visibility === "members" || audience === "connection");
    return {
      ...base,
      lookingForText: r.looking_for_text, canOfferText: r.can_offer_text,
      lookingForSkills: (tags.lookingFor.get(r.profile_id) ?? []).map(({ id, name }) => ({ id, name })),
      availability: availVisible ? r.availability : null,
      commonInterests: interests.filter((t) => myInterests.has(t.id)).map((t) => t.name),
      complementarySkills: skillsT.filter((t) => myLookingFor.has(t.id)).map((t) => t.name),
      saved: saved.has(r.profile_id),
    };
  });
}

const SELECT = sql`SELECT up.id AS profile_id, up.attendee_id, up.display_name, up.username, up.bio, up.profession, up.company, up.company_visibility,
  up.location, up.location_visibility, up.photo_url, up.thumb_url, up.looking_for_text, up.can_offer_text, up.is_public,
  ea.status AS availability, ea.visibility AS availability_visibility
  FROM event_participants ep
  JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active'
  JOIN user_profiles up ON up.attendee_id = ep.attendee_id
  LEFT JOIN event_availability ea ON ea.participant_id = ep.id`;

function filters(ctx: Ctx): SQL[] {
  const out: SQL[] = [];
  const q = ctx.query("q")?.trim().toLowerCase().replace(/^@/, "");
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    out.push(sql`(lower(up.display_name) LIKE ${like} OR up.username_normalized LIKE ${like})`);
  }
  const ints = ctx.queryAll("interests").filter(isUuid).slice(0, 10);
  if (ints.length) out.push(sql`EXISTS (SELECT 1 FROM profile_interests pi WHERE pi.profile_id = up.id AND pi.interest_id IN (${sql.join(ints.map((i) => sql`${i}`), sql`, `)}))`);
  const sks = ctx.queryAll("skills").filter(isUuid).slice(0, 10);
  if (sks.length) out.push(sql`EXISTS (SELECT 1 FROM profile_skills ps WHERE ps.profile_id = up.id AND ps.skill_id IN (${sql.join(sks.map((i) => sql`${i}`), sql`, `)}))`);
  return out;
}

function memberFilters(ctx: Ctx, advanced: boolean): SQL[] {
  const out = filters(ctx);
  const profession = ctx.query("profession")?.trim().toLowerCase();
  if (profession) out.push(sql`up.profession_normalized LIKE ${`%${profession.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  const intents = ctx.queryAll("intentions").filter(isUuid).slice(0, 10);
  if (intents.length) out.push(sql`EXISTS (SELECT 1 FROM event_participant_intentions pi WHERE pi.participant_id = ep.id AND pi.intention_id IN (${sql.join(intents.map((i) => sql`${i}`), sql`, `)}))`);
  const avail = ctx.queryAll("availability").filter((a) => (schema.AVAILABILITY as readonly string[]).includes(a));
  if (avail.length) out.push(sql`ea.status IN (${sql.join(avail.map((a) => sql`${a}`), sql`, `)}) AND ea.visibility = 'members'`);
  // Premium "advanced filters" (PRD §19.2): company and location — only matched against fields visible to members.
  if (advanced) {
    const company = ctx.query("company")?.trim().toLowerCase();
    if (company) out.push(sql`up.company_visibility <> 'connections' AND lower(up.company) LIKE ${`%${company.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    const location = ctx.query("location")?.trim().toLowerCase();
    if (location) out.push(sql`up.location_visibility <> 'connections' AND lower(up.location) LIKE ${`%${location.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  }
  return out;
}

const PAGE = 24;
function page(ctx: Ctx) {
  const raw = Number(ctx.query("cursor") ?? 0);
  return Number.isInteger(raw) && raw >= 0 && raw <= 5000 ? raw : 0;
}

async function anonymousEvent(code: string): Promise<EventFull> {
  const r = await resolveQr(code);
  if (r.state !== "valid" || !r.full) throw notFound("This event isn't available.", "event_unavailable");
  const ev = r.full;
  if (!isNetworkingOpen(ev)) throw new AppError(409, "networking_closed", ev.status === "published" ? "Networking hasn't opened yet for this event." : "Networking isn't open for this event right now.");
  if (!ev.settings.discoverEnabled || !ev.settings.anonymousBrowsingEnabled)
    throw forbidden("The organizer only allows people with a profile to browse this event.", "anonymous_browsing_disabled");
  return ev;
}

/** Anonymous discovery: opted-in public profiles only, public fields only, no totals, rate limited (BR-13, D-08). */
export async function publicPeople(ctx: Ctx) {
  await ctx.limit("public-browse", 300, 60);
  const ev = await anonymousEvent(ctx.params.code!);
  const offset = page(ctx);
  const where = [sql`ep.event_id = ${ev.id}`, sql`ep.status = 'active'`, sql`ep.discovery_paused = false`, sql`up.is_public = true`, ...filters(ctx)];
  const rows = (await ctx.db.execute<Row>(sql`${SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY ep.joined_at DESC, up.id LIMIT ${PAGE + 1} OFFSET ${offset}`)).rows;
  const items = await project(ctx.db, rows.slice(0, PAGE), () => "public", null);
  return { items, nextCursor: rows.length > PAGE ? String(offset + PAGE) : null };
}

export async function publicPerson(ctx: Ctx) {
  await ctx.limit("public-browse", 300, 60);
  const ev = await anonymousEvent(ctx.params.code!);
  const rows = (await ctx.db.execute<Row>(sql`${SELECT} WHERE ep.event_id = ${ev.id} AND ep.status = 'active' AND ep.discovery_paused = false AND up.is_public = true AND up.id = ${ctx.params.profileId}`)).rows;
  if (!rows.length) throw notFound("This profile isn't available.");
  return (await project(ctx.db, rows, () => "public", null))[0];
}

/** Facets for anonymous filters: only interests/skills used by ≥ 5 public participants (no small groups). */
export async function publicFacets(ctx: Ctx) {
  await ctx.limit("public-browse", 300, 60);
  const ev = await anonymousEvent(ctx.params.code!);
  const q = (t: "interest" | "skill") => sql`SELECT x.id, x.name, count(*)::int AS n FROM event_participants ep
    JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active' JOIN user_profiles up ON up.attendee_id = ep.attendee_id
    JOIN ${sql.raw(t === "interest" ? "profile_interests" : "profile_skills")} pt ON pt.profile_id = up.id
    JOIN ${sql.raw(t === "interest" ? "interests" : "skills")} x ON x.id = pt.${sql.raw(t === "interest" ? "interest_id" : "skill_id")} AND x.status = 'approved'
    WHERE ep.event_id = ${ev.id} AND ep.status = 'active' AND ep.discovery_paused = false AND up.is_public = true
    GROUP BY x.id, x.name HAVING count(*) >= 5 ORDER BY n DESC LIMIT 20`;
  const [i, s] = await Promise.all([ctx.db.execute<{ id: string; name: string }>(q("interest")), ctx.db.execute<{ id: string; name: string }>(q("skill"))]);
  return { interests: i.rows.map(({ id, name }) => ({ id, name })), skills: s.rows.map(({ id, name }) => ({ id, name })) };
}

/** Identified discovery: eligible participants; excludes blocked (both ways), paused and self (Module 5, BR-14). */
export async function memberPeople(ctx: Ctx) {
  const { me, event } = await requireParticipant(ctx, ctx.params.eventId!);
  if (!event.settings.discoverEnabled) throw forbidden("The organizer has turned off Discover for this event.", "feature_disabled");
  if (!["active", "networking_paused", "ended"].includes(event.status)) throw new AppError(409, "networking_closed", "Networking hasn't opened yet for this event.");
  await ctx.limit("member-browse", 240, 60, `att:${me.attendeeId}`);
  const advanced = await hasFeature(ctx.db, me.attendeeId, "attendee.discover.advanced_filters");
  const offset = page(ctx);
  const where = [sql`ep.event_id = ${event.id}`, sql`ep.status = 'active'`, sql`ep.discovery_paused = false`, sql`ep.attendee_id <> ${me.attendeeId}`,
    notBlocked(me.attendeeId, "ep.attendee_id"), ...memberFilters(ctx, advanced)];
  const rows = (await ctx.db.execute<Row>(sql`${SELECT} WHERE ${sql.join(where, sql` AND `)}
    ORDER BY (ea.status IN ('available_now','open_to_conversations','meet_new_people','looking_for_collaborators','quick_conversations')) DESC,
    (SELECT count(*) FROM profile_interests a1 JOIN profile_interests a2 ON a2.interest_id = a1.interest_id WHERE a1.profile_id = up.id AND a2.profile_id = ${me.profileId}) DESC,
    ep.joined_at DESC, up.id LIMIT ${PAGE + 1} OFFSET ${offset}`)).rows;
  const connected = await connectedSet(ctx.db, me.attendeeId, rows.map((r) => r.attendee_id));
  const items = await project(ctx.db, rows.slice(0, PAGE), (r) => (connected.has(r.attendee_id) ? "connection" : "member"), me);
  const states = await Promise.all(rows.slice(0, PAGE).map((r) => connectionState(ctx.db, me.attendeeId, r.attendee_id)));
  return { items: items.map((it, i) => ({ ...it, connectionState: states[i]!.state, connectionId: states[i]!.connectionId })), nextCursor: rows.length > PAGE ? String(offset + PAGE) : null, advancedFilters: advanced };
}

async function connectedSet(db: Executor, viewer: string, others: string[]) {
  if (!others.length) return new Set<string>();
  const rows = await db.execute<{ other: string }>(sql`SELECT CASE WHEN attendee_low_id = ${viewer} THEN attendee_high_id ELSE attendee_low_id END AS other
    FROM connections WHERE status = 'accepted' AND (attendee_low_id = ${viewer} OR attendee_high_id = ${viewer})`);
  const all = new Set(rows.rows.map((r) => r.other));
  return new Set(others.filter((o) => all.has(o)));
}

/** Member-level profile; connections-only fields when connected. Paused profiles remain visible to existing connections. */
export async function memberPerson(ctx: Ctx) {
  const { me, event } = await requireParticipant(ctx, ctx.params.eventId!);
  const rows = (await ctx.db.execute<Row>(sql`${SELECT} WHERE ep.event_id = ${event.id} AND ep.status = 'active' AND up.id = ${ctx.params.profileId}
    AND ${notBlocked(me.attendeeId, "ep.attendee_id")}`)).rows;
  const row = rows[0];
  if (!row) throw notFound("This profile isn't available.");
  const state = await connectionState(ctx.db, me.attendeeId, row.attendee_id);
  const paused = (await ctx.db.select({ p: eventParticipants.discoveryPaused }).from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, event.id), eq(eventParticipants.attendeeId, row.attendee_id))).limit(1))[0]?.p;
  if (paused && state.state !== "connected" && row.attendee_id !== me.attendeeId) throw notFound("This profile isn't available.");
  const [p] = await project(ctx.db, [row], () => (state.state === "connected" ? "connection" : "member"), me);
  return { ...p, connectionState: row.attendee_id === me.attendeeId ? "self" : state.state, connectionId: state.connectionId };
}

/** Connected people's profile outside an event context (e.g. from Messages/Connections). */
export async function connectionProfile(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const [target] = await ctx.db.select({ attendeeId: userProfiles.attendeeId }).from(userProfiles).where(eq(userProfiles.id, ctx.params.profileId!)).limit(1);
  if (!target) throw notFound("This profile isn't available.");
  const state = await connectionState(ctx.db, me.attendeeId, target.attendeeId);
  if (state.state !== "connected" || (await isBlockedEitherWay(ctx.db, me.attendeeId, target.attendeeId))) throw notFound("This profile isn't available.");
  const rows = (await ctx.db.execute<Row>(sql`SELECT up.id AS profile_id, up.attendee_id, up.display_name, up.username, up.bio, up.profession, up.company, up.company_visibility,
    up.location, up.location_visibility, up.photo_url, up.thumb_url, up.looking_for_text, up.can_offer_text, up.is_public, NULL AS availability, NULL AS availability_visibility
    FROM user_profiles up JOIN attendees a ON a.id = up.attendee_id AND a.status = 'active' WHERE up.id = ${ctx.params.profileId}`)).rows;
  if (!rows.length) throw notFound("This profile isn't available.");
  const [p] = await project(ctx.db, rows, () => "connection", me);
  return { ...p, connectionState: "connected", connectionId: state.connectionId };
}

// ---------- Saved profiles ----------
export async function saveProfile(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const body = await ctx.json<{ eventId?: string }>();
  const target = ctx.params.profileId!;
  if (target === me.profileId) throw new AppError(400, "invalid", "You can't save your own profile.");
  const [p] = await ctx.db.select({ a: userProfiles.attendeeId }).from(userProfiles).where(eq(userProfiles.id, target)).limit(1);
  if (!p || (await isBlockedEitherWay(ctx.db, me.attendeeId, p.a))) throw notFound("This profile isn't available.");
  if (body.eventId && isUuid(body.eventId)) {
    // Only save people you can actually see in that event.
    const ev = await loadEvent(ctx.db, body.eventId);
    if (!ev) throw notFound();
  }
  const limit = await featureLimit(ctx.db, me.attendeeId);
  if (limit !== null) {
    const [{ n }] = (await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM saved_profiles WHERE attendee_id = ${me.attendeeId}`)).rows as [{ n: number }];
    if (n >= limit) throw new AppError(409, "entitlement_required", `You can save up to ${limit} profiles on the Free plan.`);
  }
  await ctx.db.insert(savedProfiles).values({ attendeeId: me.attendeeId, savedProfileId: target, eventId: body.eventId && isUuid(body.eventId) ? body.eventId : null }).onConflictDoNothing();
  return { saved: true };
}

async function featureLimit(db: Executor, attendeeId: string) {
  const { entitlementLimit } = await import("./billing");
  return entitlementLimit(db, attendeeId, "attendee.saved_profiles.limit");
}

export async function unsaveProfile(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  await ctx.db.delete(savedProfiles).where(and(eq(savedProfiles.attendeeId, me.attendeeId), eq(savedProfiles.savedProfileId, ctx.params.profileId!)));
  return { saved: false };
}

export async function listSaved(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const rows = (await ctx.db.execute<Row & { event_id: string | null }>(sql`SELECT up.id AS profile_id, up.attendee_id, up.display_name, up.username, up.bio, up.profession,
    up.company, up.company_visibility, up.location, up.location_visibility, up.photo_url, up.thumb_url, up.looking_for_text, up.can_offer_text, up.is_public,
    NULL AS availability, NULL AS availability_visibility, sp.event_id
    FROM saved_profiles sp JOIN user_profiles up ON up.id = sp.saved_profile_id JOIN attendees a ON a.id = up.attendee_id AND a.status = 'active'
    WHERE sp.attendee_id = ${me.attendeeId} AND ${notBlocked(me.attendeeId, "up.attendee_id")} ORDER BY sp.created_at DESC LIMIT 200`)).rows;
  const connected = await connectedSet(ctx.db, me.attendeeId, rows.map((r) => r.attendee_id));
  const items = await project(ctx.db, rows, (r) => (connected.has(r.attendee_id) ? "connection" : "member"), me);
  return items.map((it, i) => ({ ...it, eventId: rows[i]!.event_id }));
}

/** Premium "who saved me" — count for everyone premium; identities only of savers who opted in (D-04 recommendation). */
export async function savedBy(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  if (!(await hasFeature(ctx.db, me.attendeeId, "attendee.saved_by.visibility"))) throw new AppError(403, "entitlement_required", "See who saved you with Premium.");
  const rows = (await ctx.db.execute<{ id: string; display_name: string; username: string; thumb_url: string | null; show: boolean }>(sql`
    SELECT up.id, up.display_name, up.username, up.thumb_url, up.show_saved_me AS show FROM saved_profiles sp
    JOIN user_profiles up ON up.attendee_id = sp.attendee_id JOIN attendees a ON a.id = up.attendee_id AND a.status = 'active'
    WHERE sp.saved_profile_id = ${me.profileId} AND ${notBlocked(me.attendeeId, "sp.attendee_id")}`)).rows;
  return { count: rows.length, people: rows.filter((r) => r.show).map((r) => ({ id: r.id, displayName: r.display_name, username: r.username, thumbnailUrl: r.thumb_url })) };
}

