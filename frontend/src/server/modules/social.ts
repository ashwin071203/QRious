import "server-only";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError, FieldErrors, conflict, forbidden, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { isUuid, reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { cleanText, containsBlockedWord } from "@/server/lib/rules";
import { requireAttendee } from "./identity";
import { getParticipant, recordActivity, requireParticipant, sharedEventIds } from "./participation";
import { isNetworkingOpen, loadEvent, loadEvents } from "./events-core";
import { isBlockedEitherWay } from "./discovery";
import { notify, toAttendee } from "@/server/notifications/notify";
import { connectionMilestone } from "@/server/notifications/rules";

const { connections, connectionHistory, conversations, conversationMembers, messages, notifications, userBlocks, userReports, userProfiles, attendees } = schema;

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

// ---------- Notifications: see server/notifications (one system for attendees and organizers) ----------

export async function unreadCounts(ctx: Ctx) {
  const me = await requireAttendee(ctx, { allowDeactivated: true });
  const [r] = (await ctx.db.execute<{ notifications: number; requests: number; messages: number; conversations: number }>(sql`SELECT
    (SELECT count(*)::int FROM notifications WHERE attendee_id = ${me.attendeeId} AND read_at IS NULL) AS notifications,
    (SELECT count(*)::int FROM connections c WHERE c.addressee_attendee_id = ${me.attendeeId} AND c.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = c.requester_attendee_id AND b.blocked_attendee_id = ${me.attendeeId}) OR (b.blocked_attendee_id = c.requester_attendee_id AND b.blocker_attendee_id = ${me.attendeeId}))) AS requests,
    (SELECT count(m.id)::int FROM conversation_members cm
       JOIN messages m ON m.conversation_id = cm.conversation_id AND m.id > cm.last_read_message_id AND m.id > cm.joined_after_message_id
         AND m.sender_attendee_id <> ${me.attendeeId} AND m.deleted_at IS NULL AND m.kind = 'user'
       WHERE cm.attendee_id = ${me.attendeeId} AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = ${me.attendeeId} AND b.blocked_attendee_id = m.sender_attendee_id)
         OR (b.blocked_attendee_id = ${me.attendeeId} AND b.blocker_attendee_id = m.sender_attendee_id))) AS messages,
    (SELECT count(DISTINCT cm.conversation_id)::int FROM conversation_members cm
       JOIN messages m ON m.conversation_id = cm.conversation_id AND m.id > cm.last_read_message_id AND m.id > cm.joined_after_message_id
         AND m.sender_attendee_id <> ${me.attendeeId} AND m.deleted_at IS NULL AND m.kind = 'user'
       WHERE cm.attendee_id = ${me.attendeeId} AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = ${me.attendeeId} AND b.blocked_attendee_id = m.sender_attendee_id)
         OR (b.blocked_attendee_id = ${me.attendeeId} AND b.blocker_attendee_id = m.sender_attendee_id))) AS conversations`)).rows;
  return r ?? { notifications: 0, requests: 0, messages: 0, conversations: 0 };
}

// ---------- Connections (M09, D-05) ----------
async function profileOf(db: Executor, profileId: string) {
  const [p] = await db.select({ attendeeId: userProfiles.attendeeId, displayName: userProfiles.displayName, status: attendees.status }).from(userProfiles)
    .innerJoin(attendees, eq(attendees.id, userProfiles.attendeeId)).where(eq(userProfiles.id, profileId)).limit(1);
  return p ?? null;
}

async function history(db: Executor, connectionId: string, actor: string, action: string, from: string | null, to: string) {
  await db.insert(connectionHistory).values({ connectionId, actorAttendeeId: actor, action, fromStatus: from, toStatus: to });
}

export async function requestConnection(ctx: Ctx) {
  const { me, event } = await requireParticipant(ctx, ctx.params.eventId!);
  if (!event.settings.connectionsEnabled) throw forbidden("The organizer has turned off connection requests for this event.", "feature_disabled");
  if (!isNetworkingOpen(event)) throw new AppError(409, "networking_closed", "Connection requests are only open while networking is live.");
  const body = await ctx.json<{ profileId?: string; introMessage?: string }>();
  if (!isUuid(body.profileId)) throw notFound("This profile isn't available.");
  const intro = cleanText(body.introMessage);
  const errors = new FieldErrors();
  if (intro && intro.length > 300) errors.add("introMessage", "Keep your intro under 300 characters.");
  if (intro && containsBlockedWord(intro)) errors.add("introMessage", "Please keep your intro respectful.");
  errors.throwIfAny();

  const target = await profileOf(ctx.db, body.profileId);
  if (!target || target.status !== "active" || target.attendeeId === me.attendeeId) throw notFound("This profile isn't available.");
  const tp = await getParticipant(ctx.db, event.id, target.attendeeId);
  if (!tp || tp.status !== "active" || tp.discoveryPaused) throw notFound("This person isn't available at this event.");
  if (await isBlockedEitherWay(ctx.db, me.attendeeId, target.attendeeId)) throw notFound("This profile isn't available.");
  await ctx.limit("connect-hour", 20, 3600, `att:${me.attendeeId}`);
  await ctx.limit("connect-day", 100, 86400, `att:${me.attendeeId}`);

  const [lo, hi] = pair(me.attendeeId, target.attendeeId);
  const [live] = await ctx.db.select().from(connections).where(and(eq(connections.attendeeLowId, lo), eq(connections.attendeeHighId, hi), inArray(connections.status, ["pending", "accepted"]))).limit(1);
  if (live?.status === "accepted") throw conflict("already_connected", "You're already connected.", { connectionId: live.id });
  if (live?.requesterAttendeeId === me.attendeeId) throw conflict("request_pending", "Your request is waiting for a response.", { connectionId: live.id });
  if (live) throw conflict("incoming_request", "They've already sent you a request — accept it to connect.", { connectionId: live.id });
  const [recentDecline] = (await ctx.db.execute(sql`SELECT 1 FROM connections WHERE requester_attendee_id = ${me.attendeeId} AND addressee_attendee_id = ${target.attendeeId}
    AND status = 'declined' AND responded_at > now() - interval '30 days' LIMIT 1`)).rows;
  if (recentDecline) throw conflict("request_cooldown", "You can't send another request to this person yet.");

  try {
    const c = await ctx.db.transaction(async (tx) => {
      const [c] = await tx.insert(connections).values({ requesterAttendeeId: me.attendeeId, addresseeAttendeeId: target.attendeeId, attendeeLowId: lo, attendeeHighId: hi,
        originEventId: event.id, introMessage: intro, requestedAt: new Date() }).returning();
      await history(tx, c!.id, me.attendeeId, "requested", null, "pending");
      const [mine] = await tx.select({ name: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.id, me.profileId)).limit(1);
      await notify(tx, toAttendee(target.attendeeId), { type: "connection.request", category: "connections", title: `${mine?.name ?? "Someone"} wants to connect`,
        body: intro ? `“${intro.slice(0, 120)}” · ${event.name}` : `Met at ${event.name}`, link: "/app/connections", eventId: event.id, actorProfileId: me.profileId,
        actorAttendeeId: me.attendeeId, entityId: c!.id, dedupeKey: `connection:${c!.id}` });
      return c!;
    });
    return reply(201, { id: c.id, status: c.status });
  } catch (e) {
    const { isUniqueViolation } = await import("@/server/core/errors");
    if (isUniqueViolation(e, "ux_connections_live_pair")) throw conflict("request_pending", "There's already a pending request between you.");
    throw e;
  }
}

async function loadConnection(ctx: Ctx, id: string) {
  const [c] = await ctx.db.select().from(connections).where(eq(connections.id, id)).limit(1);
  if (!c) throw notFound("Request not found.");
  return c;
}

export async function respondConnection(ctx: Ctx, action: "accept" | "decline" | "withdraw") {
  const me = await requireAttendee(ctx);
  const c = await loadConnection(ctx, ctx.params.id!);
  const isAddressee = c.addresseeAttendeeId === me.attendeeId;
  const isRequester = c.requesterAttendeeId === me.attendeeId;
  if (!(action === "withdraw" ? isRequester : isAddressee)) throw notFound("Request not found.");
  if (c.status !== "pending") throw conflict("not_pending", "This request is no longer pending.");
  const other = isAddressee ? c.requesterAttendeeId : c.addresseeAttendeeId;
  if (action === "accept" && (await isBlockedEitherWay(ctx.db, me.attendeeId, other))) throw notFound("Request not found.");

  const now = new Date();
  const status = ({ accept: "accepted", decline: "declined", withdraw: "withdrawn" } as const)[action];
  const conversationId = await ctx.db.transaction(async (tx) => {
    const updated = await tx.update(connections).set({ status, respondedAt: now }).where(and(eq(connections.id, c.id), eq(connections.status, "pending"))).returning({ id: connections.id });
    if (!updated.length) throw conflict("not_pending", "This request is no longer pending.");
    await history(tx, c.id, me.attendeeId, status === "accepted" ? "accepted" : status, "pending", status);
    if (action !== "accept") return null;
    await recordActivity(tx, c.originEventId, "connection_accepted");
    const [mine] = await tx.select({ name: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.id, me.profileId)).limit(1);
    await notify(tx, toAttendee(other), { type: "connection.accepted", category: "connections", title: `${mine?.name ?? "Someone"} accepted your request`,
      body: "You can message each other now.", link: `/app/people/${me.profileId}`, eventId: c.originEventId, actorProfileId: me.profileId, actorAttendeeId: me.attendeeId,
      entityId: c.id, dedupeKey: `connection:${c.id}` });
    // The request's own notification is resolved: mark it read for the person who accepted.
    await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.attendeeId, me.attendeeId), eq(notifications.dedupeKey, `connection:${c.id}`), isNull(notifications.readAt)));
    await connectionMilestone(tx, c.originEventId);
    // Conversation is created on acceptance when the origin event allows messaging (D-05).
    const ev = await loadEvent(tx, c.originEventId);
    if (ev?.settings.messagingEnabled) return (await ensureConversation(tx, c.id, me.attendeeId, other, c.originEventId)).id;
    return null;
  });
  return { id: c.id, status, conversationId };
}

async function ensureConversation(db: Executor, connectionId: string, a: string, b: string, originEventId: string) {
  const [lo, hi] = pair(a, b);
  const inserted = await db.insert(conversations).values({ connectionId, attendeeLowId: lo, attendeeHighId: hi, originEventId }).onConflictDoNothing().returning();
  const conv = inserted[0] ?? (await db.select().from(conversations).where(and(eq(conversations.attendeeLowId, lo), eq(conversations.attendeeHighId, hi))).limit(1))[0]!;
  if (!inserted.length && conv.connectionId !== connectionId) await db.update(conversations).set({ connectionId }).where(eq(conversations.id, conv.id));
  await db.insert(conversationMembers).values([{ conversationId: conv.id, attendeeId: lo }, { conversationId: conv.id, attendeeId: hi }]).onConflictDoNothing();
  return conv;
}

export async function removeConnection(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const c = await loadConnection(ctx, ctx.params.id!);
  if (c.requesterAttendeeId !== me.attendeeId && c.addresseeAttendeeId !== me.attendeeId) throw notFound("Connection not found.");
  if (c.status !== "accepted") throw conflict("not_connected", "You're not connected.");
  await ctx.db.transaction(async (tx) => {
    await tx.update(connections).set({ status: "removed", removedAt: new Date(), removedBy: me.attendeeId }).where(eq(connections.id, c.id));
    await history(tx, c.id, me.attendeeId, "removed", "accepted", "removed");
  });
  return reply(204);
}

type PersonRow = { connection_id: string; status: string; intro: string | null; requested_at: Date; responded_at: Date | null; origin_event_id: string;
  profile_id: string; display_name: string; username: string; profession: string | null; thumb_url: string | null; photo_url: string | null; direction: string };

export async function listConnections(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const kind = ctx.query("kind") ?? "accepted"; // accepted | received | sent
  const cond = kind === "received" ? sql`c.status = 'pending' AND c.addressee_attendee_id = ${me.attendeeId}`
    : kind === "sent" ? sql`c.status = 'pending' AND c.requester_attendee_id = ${me.attendeeId}`
    : sql`c.status = 'accepted' AND (c.requester_attendee_id = ${me.attendeeId} OR c.addressee_attendee_id = ${me.attendeeId})`;
  const rows = (await ctx.db.execute<PersonRow>(sql`
    SELECT c.id AS connection_id, c.status, c.intro_message AS intro, c.requested_at, c.responded_at, c.origin_event_id,
      up.id AS profile_id, up.display_name, up.username, up.profession, up.thumb_url, up.photo_url,
      CASE WHEN c.requester_attendee_id = ${me.attendeeId} THEN 'sent' ELSE 'received' END AS direction
    FROM connections c
    JOIN user_profiles up ON up.attendee_id = CASE WHEN c.requester_attendee_id = ${me.attendeeId} THEN c.addressee_attendee_id ELSE c.requester_attendee_id END
    JOIN attendees a ON a.id = up.attendee_id AND a.status = 'active'
    WHERE ${cond} AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = ${me.attendeeId} AND b.blocked_attendee_id = up.attendee_id)
      OR (b.blocked_attendee_id = ${me.attendeeId} AND b.blocker_attendee_id = up.attendee_id))
    ORDER BY coalesce(c.responded_at, c.requested_at) DESC LIMIT 300`)).rows;
  const evs = new Map((await loadEvents(ctx.db, [...new Set(rows.map((r) => r.origin_event_id))])).map((e) => [e.id, e.name]));
  return rows.map((r) => ({
    id: r.connection_id, status: r.status, direction: r.direction, introMessage: r.intro, requestedAt: r.requested_at, respondedAt: r.responded_at,
    originEvent: { id: r.origin_event_id, name: evs.get(r.origin_event_id) ?? "Event" },
    profile: { id: r.profile_id, displayName: r.display_name, username: r.username, profession: r.profession, photo: r.photo_url ? { url: r.photo_url, thumbnailUrl: r.thumb_url ?? r.photo_url } : null },
  }));
}

// ---------- Messaging (M10): direct conversations and groups ----------
type Conversation = typeof conversations.$inferSelect;
type Member = typeof conversationMembers.$inferSelect;
const blockedSql = (me: string, other: SQL) => sql`EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = ${me} AND b.blocked_attendee_id = ${other}) OR (b.blocked_attendee_id = ${me} AND b.blocker_attendee_id = ${other}))`;

/** Everyone the attendee has a block with, in either direction. */
export async function blockedWith(db: Executor, me: string): Promise<Set<string>> {
  const rows = (await db.execute<{ id: string }>(sql`SELECT blocked_attendee_id AS id FROM user_blocks WHERE blocker_attendee_id = ${me}
    UNION SELECT blocker_attendee_id AS id FROM user_blocks WHERE blocked_attendee_id = ${me}`)).rows;
  return new Set(rows.map((r) => r.id));
}

/** Loads a conversation the caller belongs to. Direct chats with a block are hidden entirely (404). */
export async function conversationFor(ctx: Ctx, id: string, me: string): Promise<{ conv: Conversation; member: Member; other: string | null }> {
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv) throw notFound("Conversation not found.");
  const [member] = await ctx.db.select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.attendeeId, me))).limit(1);
  if (!member) throw notFound("Conversation not found.");
  if (conv.kind === "group") return { conv, member, other: null };
  const other = conv.attendeeLowId === me ? conv.attendeeHighId! : conv.attendeeLowId!;
  if (await isBlockedEitherWay(ctx.db, me, other)) throw notFound("Conversation not found.");
  return { conv, member, other };
}

async function canSend(db: Executor, a: string, b: string) {
  const [lo, hi] = pair(a, b);
  const [c] = await db.select({ id: connections.id }).from(connections).where(and(eq(connections.attendeeLowId, lo), eq(connections.attendeeHighId, hi), eq(connections.status, "accepted"))).limit(1);
  if (!c) return false;
  const st = await db.select({ id: attendees.id, status: attendees.status }).from(attendees).where(inArray(attendees.id, [a, b]));
  return st.length === 2 && st.every((s) => s.status === "active");
}

// ---------- Activity status ----------
/** "Active" = the app was open within this window (the open app polls every 15 s; activity is recorded at most once a minute). */
export const ACTIVE_WINDOW_MS = 150_000;
export type Presence = { active: boolean; lastSeenAt: string | null };

/**
 * Activity status the viewer may see, keyed by attendee id. Only for accepted connections, never across a block, never for
 * people who hide it, and reciprocal: if the viewer hides their own status they see nobody's. Last-seen is rounded to the minute.
 */
export async function presenceFor(db: Executor, viewer: string, targets: string[]): Promise<Map<string, Presence>> {
  const out = new Map<string, Presence>();
  const ids = [...new Set(targets.filter((t) => t && t !== viewer))];
  if (!ids.length) return out;
  const [me] = await db.select({ show: userProfiles.showActivityStatus }).from(userProfiles).where(eq(userProfiles.attendeeId, viewer)).limit(1);
  if (!me?.show) return out;
  const rows = (await db.execute<{ id: string; last_active_at: Date | null }>(sql`
    SELECT a.id, a.last_active_at FROM attendees a JOIN user_profiles up ON up.attendee_id = a.id
    WHERE a.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND a.status = 'active' AND up.show_activity_status
      AND EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted' AND c.attendee_low_id = least(${viewer}::uuid, a.id) AND c.attendee_high_id = greatest(${viewer}::uuid, a.id))
      AND NOT ${blockedSql(viewer, sql`a.id`)}`)).rows;
  const now = Date.now();
  for (const r of rows) {
    const t = r.last_active_at ? new Date(r.last_active_at).getTime() : null;
    out.set(r.id, { active: t !== null && now - t < ACTIVE_WINDOW_MS, lastSeenAt: t === null ? null : new Date(Math.floor(t / 60_000) * 60_000).toISOString() });
  }
  return out;
}

export async function listConversations(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const direct = (await ctx.db.execute<{ id: string; origin_event_id: string; last_message_at: Date | null; created_at: Date; other: string; profile_id: string; display_name: string; username: string;
    thumb_url: string | null; last_body: string | null; last_sender: string | null; unread: number; accepted: boolean; other_status: string }>(sql`
    SELECT cv.id, cv.origin_event_id, cv.last_message_at, cv.created_at, o.attendee_id AS other, up.id AS profile_id, up.display_name, up.username, up.thumb_url,
      lm.body AS last_body, lm.sender_attendee_id AS last_sender, a.status AS other_status,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = cv.id AND m.id > cm.last_read_message_id AND m.sender_attendee_id <> ${me.attendeeId} AND m.deleted_at IS NULL) AS unread,
      EXISTS (SELECT 1 FROM connections c WHERE c.attendee_low_id = cv.attendee_low_id AND c.attendee_high_id = cv.attendee_high_id AND c.status = 'accepted') AS accepted
    FROM conversation_members cm JOIN conversations cv ON cv.id = cm.conversation_id AND cv.kind = 'direct'
    JOIN conversation_members o ON o.conversation_id = cv.id AND o.attendee_id <> ${me.attendeeId}
    JOIN user_profiles up ON up.attendee_id = o.attendee_id JOIN attendees a ON a.id = o.attendee_id
    LEFT JOIN messages lm ON lm.id = cv.last_message_id
    WHERE cm.attendee_id = ${me.attendeeId} AND NOT ${blockedSql(me.attendeeId, sql`o.attendee_id`)}
    ORDER BY coalesce(cv.last_message_at, cv.created_at) DESC LIMIT 200`)).rows;
  const groups = (await ctx.db.execute<{ id: string; name: string; photo_url: string | null; last_message_at: Date | null; created_at: Date; member_count: number;
    last_body: string | null; last_kind: string | null; last_sender: string | null; last_sender_name: string | null; last_id: number | null; unread: number }>(sql`
    SELECT cv.id, cv.name, cv.photo_url, cv.last_message_at, cv.created_at,
      (SELECT count(*)::int FROM conversation_members x WHERE x.conversation_id = cv.id) AS member_count,
      lm.body AS last_body, lm.kind AS last_kind, lm.sender_attendee_id AS last_sender, lup.display_name AS last_sender_name, lm.id AS last_id,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = cv.id AND m.id > cm.last_read_message_id AND m.id > cm.joined_after_message_id
        AND m.sender_attendee_id <> ${me.attendeeId} AND m.kind = 'user' AND m.deleted_at IS NULL AND NOT ${blockedSql(me.attendeeId, sql`m.sender_attendee_id`)}) AS unread
    FROM conversation_members cm JOIN conversations cv ON cv.id = cm.conversation_id AND cv.kind = 'group'
    LEFT JOIN LATERAL (SELECT m.* FROM messages m WHERE m.conversation_id = cv.id AND m.id > cm.joined_after_message_id AND m.deleted_at IS NULL
      AND NOT ${blockedSql(me.attendeeId, sql`m.sender_attendee_id`)} ORDER BY m.id DESC LIMIT 1) lm ON true
    LEFT JOIN user_profiles lup ON lup.attendee_id = lm.sender_attendee_id
    WHERE cm.attendee_id = ${me.attendeeId} LIMIT 200`)).rows;
  const evs = new Map((await loadEvents(ctx.db, [...new Set(direct.map((r) => r.origin_event_id))])).map((e) => [e.id, e.name]));
  const presence = await presenceFor(ctx.db, me.attendeeId, direct.map((r) => r.other));
  const items = [
    ...direct.map((r) => ({
      kind: "direct" as const, id: r.id, lastMessageAt: r.last_message_at, sortAt: new Date(r.last_message_at ?? r.created_at).getTime(), unreadCount: r.unread, canSend: r.accepted && r.other_status === "active",
      lastMessage: r.last_body ? { body: r.last_body.slice(0, 120), mine: r.last_sender === me.attendeeId, senderName: null, system: false } : null,
      originEvent: { id: r.origin_event_id, name: evs.get(r.origin_event_id) ?? "Event" },
      other: { profileId: r.profile_id, displayName: r.other_status === "deleted" ? "Deleted user" : r.display_name, username: r.username, thumbnailUrl: r.thumb_url },
      presence: presence.get(r.other) ?? null, group: null,
    })),
    ...groups.map((r) => ({
      kind: "group" as const, id: r.id, lastMessageAt: r.last_id ? r.last_message_at : null, sortAt: new Date(r.last_id && r.last_message_at ? r.last_message_at : r.created_at).getTime(), unreadCount: r.unread, canSend: true,
      lastMessage: r.last_body ? { body: r.last_body.slice(0, 120), mine: r.last_sender === me.attendeeId, senderName: r.last_kind === "system" ? null : r.last_sender_name, system: r.last_kind === "system" } : null,
      originEvent: null, other: null, presence: null, group: { name: r.name, photoUrl: r.photo_url, memberCount: r.member_count },
    })),
  ];
  return items.sort((a, b) => b.sortAt - a.sortAt).map((x) => { const rest: Partial<typeof x> = { ...x }; delete rest.sortAt; return rest; });
}

/** Start a conversation through an event both attendees share, where messaging is enabled (D-05). Idempotent. */
export async function startConversation(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const body = await ctx.json<{ profileId?: string; eventId?: string }>();
  if (!isUuid(body.profileId)) throw notFound("This profile isn't available.");
  const target = await profileOf(ctx.db, body.profileId);
  if (!target || target.attendeeId === me.attendeeId) throw notFound("This profile isn't available.");
  if (await isBlockedEitherWay(ctx.db, me.attendeeId, target.attendeeId)) throw notFound("This profile isn't available.");
  const [lo, hi] = pair(me.attendeeId, target.attendeeId);
  const [existing] = await ctx.db.select().from(conversations).where(and(eq(conversations.attendeeLowId, lo), eq(conversations.attendeeHighId, hi))).limit(1);
  if (existing) return { id: existing.id };
  const [c] = await ctx.db.select().from(connections).where(and(eq(connections.attendeeLowId, lo), eq(connections.attendeeHighId, hi), eq(connections.status, "accepted"))).limit(1);
  if (!c) throw forbidden("You can message people once they accept your connection request.", "not_connected");
  const shared = await sharedEventIds(ctx.db, me.attendeeId, target.attendeeId);
  const candidates = body.eventId && isUuid(body.eventId) ? shared.filter((e) => e === body.eventId) : shared;
  const evs = await loadEvents(ctx.db, candidates);
  const ev = evs.find((e) => e.settings.messagingEnabled && isNetworkingOpen(e));
  if (!ev) throw forbidden("Messaging isn't available through a shared event right now.", "feature_disabled");
  const conv = await ctx.db.transaction((tx) => ensureConversation(tx, c.id, me.attendeeId, target.attendeeId, ev.id));
  return reply(201, { id: conv.id });
}

type MsgRow = { id: number; sender: string; body: string; kind: string; created_at: Date; deleted_at: Date | null; client_message_id: string;
  profile_id: string | null; display_name: string | null; thumb_url: string | null; sender_status: string | null };

export async function getMessages(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { conv, member, other } = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  const after = Number(ctx.query("after") ?? 0);
  const before = Number(ctx.query("before") ?? 0);
  const cond = after > 0 ? sql`m.id > ${after}` : before > 0 ? sql`m.id < ${before}` : sql`true`;
  const isGroup = conv.kind === "group";
  // Group members see messages from after they joined, never messages from people they have a block with.
  const visibility = isGroup ? sql`AND m.id > ${member.joinedAfterMessageId} AND NOT ${blockedSql(me.attendeeId, sql`m.sender_attendee_id`)}` : sql``;
  const rows = (await ctx.db.execute<MsgRow>(sql`
    SELECT m.id, m.sender_attendee_id AS sender, m.body, m.kind, m.created_at, m.deleted_at, m.client_message_id,
      up.id AS profile_id, up.display_name, up.thumb_url, a.status AS sender_status
    FROM messages m LEFT JOIN user_profiles up ON up.attendee_id = m.sender_attendee_id LEFT JOIN attendees a ON a.id = m.sender_attendee_id
    WHERE m.conversation_id = ${conv.id} AND ${cond} ${visibility} ORDER BY m.id ${after > 0 ? sql`ASC` : sql`DESC`} LIMIT 50`)).rows;
  const list = after > 0 ? rows : rows.reverse();
  const dto = (m: MsgRow) => ({
    id: Number(m.id), mine: m.sender === me.attendeeId, kind: m.kind as "user" | "system", body: m.deleted_at ? "This message was removed." : m.body, removed: !!m.deleted_at,
    createdAt: m.created_at, clientMessageId: m.client_message_id,
    sender: isGroup && m.profile_id ? { profileId: m.profile_id, displayName: m.sender_status === "deleted" ? "Deleted user" : m.display_name!, thumbnailUrl: m.thumb_url } : null,
  });
  const members = await ctx.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, conv.id));
  const now = Date.now();

  if (!isGroup) {
    const otherMember = members.find((m) => m.attendeeId === other);
    const [op] = await ctx.db.select({ id: userProfiles.id, displayName: userProfiles.displayName, username: userProfiles.username, thumb: userProfiles.thumbUrl, status: attendees.status })
      .from(userProfiles).innerJoin(attendees, eq(attendees.id, userProfiles.attendeeId)).where(eq(userProfiles.attendeeId, other!)).limit(1);
    const ev = conv.originEventId ? await loadEvent(ctx.db, conv.originEventId) : null;
    return {
      conversation: { id: conv.id, kind: "direct" as const, originEvent: { id: conv.originEventId, name: ev?.name ?? "Event" } },
      other: { profileId: op?.id, displayName: op?.status === "deleted" ? "Deleted user" : op?.displayName, username: op?.username, thumbnailUrl: op?.thumb },
      presence: (await presenceFor(ctx.db, me.attendeeId, [other!])).get(other!) ?? null,
      group: null,
      canSend: await canSend(ctx.db, me.attendeeId, other!),
      otherLastReadMessageId: otherMember?.lastReadMessageId ?? 0,
      otherTyping: !!otherMember?.typingAt && now - otherMember.typingAt.getTime() < 6000,
      typingNames: [] as string[],
      messages: list.map(dto),
      hasMore: after === 0 && rows.length === 50,
    };
  }

  const blocked = await blockedWith(ctx.db, me.attendeeId);
  const visible = members.filter((m) => m.attendeeId === me.attendeeId || !blocked.has(m.attendeeId));
  const profiles = visible.length ? await ctx.db.select({ attendeeId: userProfiles.attendeeId, id: userProfiles.id, displayName: userProfiles.displayName, username: userProfiles.username,
    thumb: userProfiles.thumbUrl, status: attendees.status }).from(userProfiles).innerJoin(attendees, eq(attendees.id, userProfiles.attendeeId))
    .where(inArray(userProfiles.attendeeId, visible.map((m) => m.attendeeId))) : [];
  const byId = new Map(profiles.map((p) => [p.attendeeId, p]));
  const presence = await presenceFor(ctx.db, me.attendeeId, visible.map((m) => m.attendeeId));
  const connected = await acceptedWith(ctx.db, me.attendeeId, visible.map((m) => m.attendeeId));
  const others = visible.filter((m) => m.attendeeId !== me.attendeeId);
  return {
    conversation: { id: conv.id, kind: "group" as const, originEvent: null },
    other: null,
    presence: null,
    group: {
      name: conv.name!, photoUrl: conv.photoUrl, createdAt: conv.createdAt, myRole: member.role as "admin" | "member", memberCount: members.length,
      members: visible.map((m) => {
        const p = byId.get(m.attendeeId);
        return { profileId: p?.id ?? null, displayName: p?.status === "deleted" ? "Deleted user" : p?.displayName ?? "Member", username: p?.username ?? null, thumbnailUrl: p?.thumb ?? null,
          role: m.role as "admin" | "member", isMe: m.attendeeId === me.attendeeId, connected: connected.has(m.attendeeId), presence: presence.get(m.attendeeId) ?? null, joinedAt: m.joinedAt };
      }).sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(b.role === "admin") - Number(a.role === "admin") || a.displayName.localeCompare(b.displayName)),
    },
    canSend: true,
    // Group read receipt: the highest message everyone else has read.
    otherLastReadMessageId: others.length ? Math.min(...others.map((m) => m.lastReadMessageId)) : 0,
    otherTyping: others.some((m) => m.typingAt && now - m.typingAt.getTime() < 6000),
    typingNames: others.filter((m) => m.typingAt && now - m.typingAt.getTime() < 6000).map((m) => byId.get(m.attendeeId)?.displayName ?? "Someone").slice(0, 3),
    messages: list.map(dto),
    hasMore: after === 0 && rows.length === 50,
  };
}

/** Attendees (of `ids`) the viewer has an accepted connection with. */
export async function acceptedWith(db: Executor, me: string, ids: string[]): Promise<Set<string>> {
  const others = [...new Set(ids.filter((i) => i !== me))];
  if (!others.length) return new Set();
  const rows = (await db.execute<{ id: string }>(sql`SELECT CASE WHEN c.attendee_low_id = ${me} THEN c.attendee_high_id ELSE c.attendee_low_id END AS id FROM connections c
    WHERE c.status = 'accepted' AND (c.attendee_low_id = ${me} OR c.attendee_high_id = ${me})
      AND (CASE WHEN c.attendee_low_id = ${me} THEN c.attendee_high_id ELSE c.attendee_low_id END) IN (${sql.join(others.map((i) => sql`${i}::uuid`), sql`, `)})`)).rows;
  return new Set(rows.map((r) => r.id));
}

export async function sendMessage(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { conv, other } = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  const body = await ctx.json<{ body?: string; clientMessageId?: string }>();
  const text = typeof body.body === "string" ? body.body.normalize("NFC").trim() : "";
  if (!text) throw new AppError(400, "validation_failed", "Write a message.", { body: ["Write a message."] });
  if (text.length > 4000) throw new AppError(400, "validation_failed", "Messages can be up to 4000 characters.", { body: ["Messages can be up to 4000 characters."] });
  if (!isUuid(body.clientMessageId)) throw new AppError(400, "validation_failed", "clientMessageId is required.");
  // Direct: re-checked on every send — accepted connection, no block, both accounts active (BR-19). Not tied to event status (D-05).
  // Group: membership was checked above; the sender's account is active (requireAttendee).
  if (other && !(await canSend(ctx.db, me.attendeeId, other))) throw forbidden("You can't send messages in this conversation.", "not_connected");
  await ctx.limit("messages-min", 30, 60, `att:${me.attendeeId}`);
  await ctx.limit("messages-day", 1000, 86400, `att:${me.attendeeId}`);

  const msg = await ctx.db.transaction(async (tx) => {
    const ins = await tx.insert(messages).values({ conversationId: conv.id, senderAttendeeId: me.attendeeId, clientMessageId: body.clientMessageId!, body: text })
      .onConflictDoNothing().returning();
    const m = ins[0] ?? (await tx.select().from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.clientMessageId, body.clientMessageId!))).limit(1))[0]!;
    if (ins.length) {
      await tx.update(conversations).set({ lastMessageId: m.id, lastMessageAt: m.createdAt }).where(eq(conversations.id, conv.id));
      await tx.update(conversationMembers).set({ lastReadMessageId: m.id, lastReadAt: new Date(), typingAt: null })
        .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.attendeeId, me.attendeeId)));
      const [mine] = await tx.select({ name: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.id, me.profileId)).limit(1);
      if (other) {
        await notify(tx, toAttendee(other), { type: "message.new", category: "messages", title: mine?.name ?? "New message", body: text.slice(0, 140), link: `/app/messages/${conv.id}`,
          actorProfileId: me.profileId, actorAttendeeId: me.attendeeId, entityId: conv.id, dedupeKey: `conv:${conv.id}` });
        if (conv.originEventId) await recordActivity(tx, conv.originEventId, "message_sent");
      } else {
        const blocked = await blockedWith(tx, me.attendeeId);
        const recipients = (await tx.select({ id: conversationMembers.attendeeId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conv.id)))
          .map((r) => r.id).filter((id) => id !== me.attendeeId && !blocked.has(id));
        await notify(tx, recipients.map(toAttendee), { type: "group.message", category: "groups", title: conv.name ?? "Group", body: `${mine?.name ?? "Someone"}: ${text.slice(0, 120)}`,
          link: `/app/messages/${conv.id}`, actorProfileId: me.profileId, actorAttendeeId: me.attendeeId, entityId: conv.id, dedupeKey: `conv:${conv.id}` });
      }
    }
    return m;
  });
  return reply(201, { id: Number(msg.id), mine: true, kind: "user", body: msg.body, createdAt: msg.createdAt, clientMessageId: msg.clientMessageId, removed: false, sender: null });
}

export async function markRead(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { conv } = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  const body = await ctx.json<{ lastReadMessageId?: number }>();
  const id = Number(body.lastReadMessageId ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) return reply(204);
  // Never beyond the conversation's newest message (a client can't mark future messages as read).
  const capped = Math.min(id, conv.lastMessageId ?? 0);
  await ctx.db.update(conversationMembers).set({ lastReadMessageId: sql`greatest(${conversationMembers.lastReadMessageId}, ${capped})`, lastReadAt: new Date() })
    .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.attendeeId, me.attendeeId)));
  await ctx.db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.attendeeId, me.attendeeId), eq(notifications.dedupeKey, `conv:${conv.id}`), isNull(notifications.readAt)));
  return reply(204);
}

export async function typing(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { conv } = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  await ctx.db.update(conversationMembers).set({ typingAt: new Date() }).where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.attendeeId, me.attendeeId)));
  return reply(204);
}

// ---------- Networking analytics (Premium: attendee.analytics) ----------
export async function myAnalytics(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { hasFeature } = await import("./billing");
  if (!(await hasFeature(ctx.db, me.attendeeId, "attendee.analytics"))) throw new AppError(403, "entitlement_required", "Networking analytics are part of Premium.", undefined, { feature: "attendee.analytics" });
  const a = me.attendeeId;
  const [t] = (await ctx.db.execute<Record<string, number>>(sql`SELECT
    (SELECT count(*)::int FROM event_participants WHERE attendee_id = ${a}) AS events_joined,
    (SELECT count(*)::int FROM connections WHERE status = 'accepted' AND (attendee_low_id = ${a} OR attendee_high_id = ${a})) AS connections,
    (SELECT count(*)::int FROM connections WHERE status = 'accepted' AND (attendee_low_id = ${a} OR attendee_high_id = ${a}) AND responded_at > now() - interval '30 days') AS connections_30d,
    (SELECT count(*)::int FROM connections WHERE requester_attendee_id = ${a}) AS requests_sent,
    (SELECT count(*)::int FROM connection_history h JOIN connections c ON c.id = h.connection_id WHERE c.requester_attendee_id = ${a} AND h.action = 'accepted') AS requests_sent_accepted,
    (SELECT count(*)::int FROM connections WHERE addressee_attendee_id = ${a}) AS requests_received,
    (SELECT count(*)::int FROM connection_history h JOIN connections c ON c.id = h.connection_id WHERE c.addressee_attendee_id = ${a} AND h.action = 'accepted') AS requests_received_accepted,
    (SELECT count(*)::int FROM conversation_members WHERE attendee_id = ${a}) AS conversations,
    (SELECT count(*)::int FROM messages WHERE sender_attendee_id = ${a} AND kind = 'user') AS messages_sent,
    (SELECT count(*)::int FROM saved_profiles sp JOIN user_profiles up ON up.id = sp.saved_profile_id WHERE up.attendee_id = ${a}) AS saved_by`)).rows;
  const byEvent = (await ctx.db.execute<{ id: string; name: string; n: number }>(sql`SELECT e.id, e.name, count(*)::int AS n FROM connections c JOIN events e ON e.id = c.origin_event_id
    WHERE c.status = 'accepted' AND (c.attendee_low_id = ${a} OR c.attendee_high_id = ${a}) GROUP BY e.id, e.name ORDER BY n DESC, e.name LIMIT 5`)).rows;
  const rate = (x: number, of: number) => (of ? Math.round((x / of) * 100) : null);
  const r = t ?? {};
  return {
    eventsJoined: r.events_joined ?? 0, connections: r.connections ?? 0, connectionsLast30Days: r.connections_30d ?? 0,
    requestsSent: r.requests_sent ?? 0, requestAcceptanceRate: rate(r.requests_sent_accepted ?? 0, r.requests_sent ?? 0),
    requestsReceived: r.requests_received ?? 0, conversations: r.conversations ?? 0, messagesSent: r.messages_sent ?? 0, savedBy: r.saved_by ?? 0,
    connectionsByEvent: byEvent.map((e) => ({ eventId: e.id, name: e.name, connections: e.n })),
  };
}

// ---------- Blocks & reports (M12) ----------
export async function block(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const target = await profileOf(ctx.db, ctx.params.profileId!);
  if (!target || target.attendeeId === me.attendeeId) throw notFound("This profile isn't available.");
  await ctx.db.transaction(async (tx) => {
    await tx.insert(userBlocks).values({ blockerAttendeeId: me.attendeeId, blockedAttendeeId: target.attendeeId }).onConflictDoNothing();
    const [lo, hi] = pair(me.attendeeId, target.attendeeId);
    const live = await tx.update(connections).set({ status: "removed", removedAt: new Date(), removedBy: me.attendeeId })
      .where(and(eq(connections.attendeeLowId, lo), eq(connections.attendeeHighId, hi), inArray(connections.status, ["pending", "accepted"]))).returning({ id: connections.id, from: connections.status });
    for (const l of live) await history(tx, l.id, me.attendeeId, "removed", null, "removed");
  });
  return reply(204);
}

export async function unblock(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const target = await profileOf(ctx.db, ctx.params.profileId!);
  if (target) await ctx.db.delete(userBlocks).where(and(eq(userBlocks.blockerAttendeeId, me.attendeeId), eq(userBlocks.blockedAttendeeId, target.attendeeId)));
  return reply(204);
}

export async function listBlocks(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  return ctx.db.select({ profileId: userProfiles.id, displayName: userProfiles.displayName, username: userProfiles.username, thumbnailUrl: userProfiles.thumbUrl, blockedAt: userBlocks.createdAt })
    .from(userBlocks).innerJoin(userProfiles, eq(userProfiles.attendeeId, userBlocks.blockedAttendeeId))
    .where(eq(userBlocks.blockerAttendeeId, me.attendeeId)).orderBy(desc(userBlocks.createdAt));
}

export async function report(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  await ctx.limit("reports", 10, 86400, `att:${me.attendeeId}`);
  const b = await ctx.json<{ profileId?: string; eventId?: string; messageId?: number; reason?: string; details?: string }>();
  const errors = new FieldErrors();
  if (!(schema.REPORT_REASON as readonly string[]).includes(b.reason ?? "")) errors.add("reason", "Choose a reason.");
  const details = cleanText(b.details);
  if (details && details.length > 1000) errors.add("details", "Keep details under 1000 characters.");
  errors.throwIfAny();
  if (!isUuid(b.profileId)) throw notFound("This profile isn't available.");
  const target = await profileOf(ctx.db, b.profileId);
  if (!target || target.attendeeId === me.attendeeId) throw notFound("This profile isn't available.");
  let excerpt: string | null = null;
  let messageId: number | null = null;
  if (b.messageId) {
    // Only messages from the reporter's own conversation with this person can be attached.
    const [m] = (await ctx.db.execute<{ id: number; body: string }>(sql`SELECT m.id, m.body FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
      WHERE m.id = ${Number(b.messageId)} AND m.sender_attendee_id = ${target.attendeeId} AND m.kind = 'user'
      AND ((cv.kind = 'direct' AND cv.attendee_low_id = least(${me.attendeeId}::uuid, ${target.attendeeId}::uuid) AND cv.attendee_high_id = greatest(${me.attendeeId}::uuid, ${target.attendeeId}::uuid))
        OR (cv.kind = 'group' AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = cv.id AND cm.attendee_id = ${me.attendeeId} AND m.id > cm.joined_after_message_id)))`)).rows;
    if (m) { messageId = Number(m.id); excerpt = m.body.slice(0, 1000); }
  }
  const eventId = b.eventId && isUuid(b.eventId) && (await getParticipant(ctx.db, b.eventId, me.attendeeId)) ? b.eventId : null;
  const [r] = await ctx.db.insert(userReports).values({ reporterAttendeeId: me.attendeeId, reportedAttendeeId: target.attendeeId, eventId, messageId, messageExcerpt: excerpt, reason: b.reason!, details }).returning({ id: userReports.id });
  await audit(ctx.db, { actorType: "attendee", actorId: me.attendeeId, action: "report.created", targetType: "report", targetId: r!.id, eventId });
  return reply(201, { id: r!.id });
}
