import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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

const { connections, connectionHistory, conversations, conversationMembers, messages, notifications, notificationPreferences, userBlocks, userReports, userProfiles, attendees } = schema;

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

// ---------- Notifications (M11) ----------
type NType = (typeof schema.NOTIFICATION_TYPE)[number];
const PREF: Partial<Record<NType, keyof typeof notificationPreferences.$inferSelect>> = {
  connection_request: "connectionRequests", connection_accepted: "connectionAccepted", message: "messages", event_update: "eventUpdates", billing: "billing",
};

export async function notify(db: Executor, attendeeId: string, type: NType, payload: Record<string, unknown>, opts: { eventId?: string | null; actorProfileId?: string | null; entityId?: string | null } = {}) {
  const key = PREF[type];
  if (key) {
    const [p] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.attendeeId, attendeeId)).limit(1);
    if (p && p[key] === false) return;
  }
  if (type === "message" && opts.entityId) {
    // Coalesce: one unread message notification per conversation.
    const updated = await db.update(notifications).set({ payload, createdAt: new Date(), actorProfileId: opts.actorProfileId ?? null })
      .where(and(eq(notifications.attendeeId, attendeeId), eq(notifications.type, "message"), eq(notifications.entityId, opts.entityId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    if (updated.length) return;
  }
  await db.insert(notifications).values({ attendeeId, type, payload, eventId: opts.eventId ?? null, actorProfileId: opts.actorProfileId ?? null, entityId: opts.entityId ?? null });
}

export async function listNotifications(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const before = ctx.query("before");
  const rows = await ctx.db.select({ n: notifications, actorName: userProfiles.displayName, actorThumb: userProfiles.thumbUrl })
    .from(notifications).leftJoin(userProfiles, eq(userProfiles.id, notifications.actorProfileId))
    .where(and(eq(notifications.attendeeId, me.attendeeId), before ? sql`${notifications.createdAt} < ${new Date(before)}` : sql`true`))
    .orderBy(desc(notifications.createdAt)).limit(30);
  return {
    items: rows.map((r) => ({ id: r.n.id, type: r.n.type, payload: r.n.payload, eventId: r.n.eventId, entityId: r.n.entityId, createdAt: r.n.createdAt, readAt: r.n.readAt,
      actor: r.n.actorProfileId ? { id: r.n.actorProfileId, displayName: r.actorName, thumbnailUrl: r.actorThumb } : null })),
    nextCursor: rows.length === 30 ? rows[29]!.n.createdAt.toISOString() : null,
  };
}

export async function markNotificationRead(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  await ctx.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, ctx.params.id!), eq(notifications.attendeeId, me.attendeeId), isNull(notifications.readAt)));
  return reply(204);
}

export async function markAllNotificationsRead(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  await ctx.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.attendeeId, me.attendeeId), isNull(notifications.readAt)));
  return reply(204);
}

export async function getPreferences(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const [p] = await ctx.db.select().from(notificationPreferences).where(eq(notificationPreferences.attendeeId, me.attendeeId)).limit(1);
  const d = p ?? { connectionRequests: true, connectionAccepted: true, messages: true, eventUpdates: true, billing: true };
  return { connectionRequests: d.connectionRequests, connectionAccepted: d.connectionAccepted, messages: d.messages, eventUpdates: d.eventUpdates, billing: d.billing };
}

export async function putPreferences(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const b = await ctx.json<Record<string, unknown>>();
  const v = (k: string) => (typeof b[k] === "boolean" ? (b[k] as boolean) : true);
  const row = { connectionRequests: v("connectionRequests"), connectionAccepted: v("connectionAccepted"), messages: v("messages"), eventUpdates: v("eventUpdates"), billing: v("billing"), updatedAt: new Date() };
  await ctx.db.insert(notificationPreferences).values({ attendeeId: me.attendeeId, ...row }).onConflictDoUpdate({ target: notificationPreferences.attendeeId, set: row });
  return getPreferences(ctx);
}

export async function unreadCounts(ctx: Ctx) {
  const me = await requireAttendee(ctx, { allowDeactivated: true });
  const [r] = (await ctx.db.execute<{ notifications: number; requests: number; messages: number }>(sql`SELECT
    (SELECT count(*)::int FROM notifications WHERE attendee_id = ${me.attendeeId} AND read_at IS NULL) AS notifications,
    (SELECT count(*)::int FROM connections c WHERE c.addressee_attendee_id = ${me.attendeeId} AND c.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = c.requester_attendee_id AND b.blocked_attendee_id = ${me.attendeeId}) OR (b.blocked_attendee_id = c.requester_attendee_id AND b.blocker_attendee_id = ${me.attendeeId}))) AS requests,
    (SELECT coalesce(sum(x.n), 0)::int FROM (SELECT count(m.id) AS n FROM conversation_members cm JOIN conversations cv ON cv.id = cm.conversation_id
       JOIN messages m ON m.conversation_id = cm.conversation_id AND m.id > cm.last_read_message_id AND m.sender_attendee_id <> ${me.attendeeId} AND m.deleted_at IS NULL
       WHERE cm.attendee_id = ${me.attendeeId} AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = ${me.attendeeId} AND b.blocked_attendee_id IN (cv.attendee_low_id, cv.attendee_high_id))
         OR (b.blocked_attendee_id = ${me.attendeeId} AND b.blocker_attendee_id IN (cv.attendee_low_id, cv.attendee_high_id)))
       GROUP BY cm.conversation_id) x) AS messages`)).rows;
  return r ?? { notifications: 0, requests: 0, messages: 0 };
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
      await notify(tx, target.attendeeId, "connection_request", { message: `${mine?.name ?? "Someone"} wants to connect`, intro, eventName: event.name }, { eventId: event.id, actorProfileId: me.profileId, entityId: c!.id });
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
    await notify(tx, other, "connection_accepted", { message: `${mine?.name ?? "Someone"} accepted your request` }, { eventId: c.originEventId, actorProfileId: me.profileId, entityId: c.id });
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

// ---------- Messaging (M10) ----------
async function conversationFor(ctx: Ctx, id: string, me: string) {
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv || (conv.attendeeLowId !== me && conv.attendeeHighId !== me)) throw notFound("Conversation not found.");
  const other = conv.attendeeLowId === me ? conv.attendeeHighId : conv.attendeeLowId;
  if (await isBlockedEitherWay(ctx.db, me, other)) throw notFound("Conversation not found.");
  return { conv, other };
}

async function canSend(db: Executor, a: string, b: string) {
  const [lo, hi] = pair(a, b);
  const [c] = await db.select({ id: connections.id }).from(connections).where(and(eq(connections.attendeeLowId, lo), eq(connections.attendeeHighId, hi), eq(connections.status, "accepted"))).limit(1);
  if (!c) return false;
  const st = await db.select({ id: attendees.id, status: attendees.status }).from(attendees).where(inArray(attendees.id, [a, b]));
  return st.length === 2 && st.every((s) => s.status === "active");
}

export async function listConversations(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const rows = (await ctx.db.execute<{ id: string; origin_event_id: string; last_message_at: Date | null; other: string; profile_id: string; display_name: string; username: string;
    thumb_url: string | null; last_body: string | null; last_sender: string | null; unread: number; accepted: boolean; other_status: string }>(sql`
    SELECT cv.id, cv.origin_event_id, cv.last_message_at, o.attendee_id AS other, up.id AS profile_id, up.display_name, up.username, up.thumb_url,
      lm.body AS last_body, lm.sender_attendee_id AS last_sender, a.status AS other_status,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = cv.id AND m.id > cm.last_read_message_id AND m.sender_attendee_id <> ${me.attendeeId} AND m.deleted_at IS NULL) AS unread,
      EXISTS (SELECT 1 FROM connections c WHERE c.attendee_low_id = cv.attendee_low_id AND c.attendee_high_id = cv.attendee_high_id AND c.status = 'accepted') AS accepted
    FROM conversation_members cm JOIN conversations cv ON cv.id = cm.conversation_id
    JOIN conversation_members o ON o.conversation_id = cv.id AND o.attendee_id <> ${me.attendeeId}
    JOIN user_profiles up ON up.attendee_id = o.attendee_id JOIN attendees a ON a.id = o.attendee_id
    LEFT JOIN messages lm ON lm.id = cv.last_message_id
    WHERE cm.attendee_id = ${me.attendeeId}
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_attendee_id = ${me.attendeeId} AND b.blocked_attendee_id = o.attendee_id) OR (b.blocked_attendee_id = ${me.attendeeId} AND b.blocker_attendee_id = o.attendee_id))
    ORDER BY coalesce(cv.last_message_at, cv.created_at) DESC LIMIT 200`)).rows;
  const evs = new Map((await loadEvents(ctx.db, [...new Set(rows.map((r) => r.origin_event_id))])).map((e) => [e.id, e.name]));
  return rows.map((r) => ({
    id: r.id, lastMessageAt: r.last_message_at, unreadCount: r.unread, canSend: r.accepted && r.other_status === "active",
    lastMessage: r.last_body ? { body: r.last_body.slice(0, 120), mine: r.last_sender === me.attendeeId } : null,
    originEvent: { id: r.origin_event_id, name: evs.get(r.origin_event_id) ?? "Event" },
    other: { profileId: r.profile_id, displayName: r.other_status === "deleted" ? "Deleted user" : r.display_name, username: r.username, thumbnailUrl: r.thumb_url },
  }));
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

export async function getMessages(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { conv, other } = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  const after = Number(ctx.query("after") ?? 0);
  const before = Number(ctx.query("before") ?? 0);
  const cond = after > 0 ? sql`m.id > ${after}` : before > 0 ? sql`m.id < ${before}` : sql`true`;
  const rows = (await ctx.db.execute<{ id: number; sender: string; body: string; created_at: Date; deleted_at: Date | null; client_message_id: string }>(sql`
    SELECT m.id, m.sender_attendee_id AS sender, m.body, m.created_at, m.deleted_at, m.client_message_id FROM messages m
    WHERE m.conversation_id = ${conv.id} AND ${cond} ORDER BY m.id ${after > 0 ? sql`ASC` : sql`DESC`} LIMIT 50`)).rows;
  const list = after > 0 ? rows : rows.reverse();
  const members = await ctx.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, conv.id));
  const otherMember = members.find((m) => m.attendeeId === other);
  const [op] = await ctx.db.select({ id: userProfiles.id, displayName: userProfiles.displayName, username: userProfiles.username, thumb: userProfiles.thumbUrl, status: attendees.status })
    .from(userProfiles).innerJoin(attendees, eq(attendees.id, userProfiles.attendeeId)).where(eq(userProfiles.attendeeId, other)).limit(1);
  const ev = await loadEvent(ctx.db, conv.originEventId);
  return {
    conversation: { id: conv.id, originEvent: { id: conv.originEventId, name: ev?.name ?? "Event" } },
    other: { profileId: op?.id, displayName: op?.status === "deleted" ? "Deleted user" : op?.displayName, username: op?.username, thumbnailUrl: op?.thumb },
    canSend: await canSend(ctx.db, me.attendeeId, other),
    otherLastReadMessageId: otherMember?.lastReadMessageId ?? 0,
    otherTyping: !!otherMember?.typingAt && Date.now() - otherMember.typingAt.getTime() < 6000,
    messages: list.map((m) => ({ id: Number(m.id), mine: m.sender === me.attendeeId, body: m.deleted_at ? "This message was removed." : m.body, removed: !!m.deleted_at, createdAt: m.created_at, clientMessageId: m.client_message_id })),
    hasMore: after === 0 && rows.length === 50,
  };
}

export async function sendMessage(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { conv, other } = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  const body = await ctx.json<{ body?: string; clientMessageId?: string }>();
  const text = typeof body.body === "string" ? body.body.normalize("NFC").trim() : "";
  if (!text) throw new AppError(400, "validation_failed", "Write a message.", { body: ["Write a message."] });
  if (text.length > 4000) throw new AppError(400, "validation_failed", "Messages can be up to 4000 characters.", { body: ["Messages can be up to 4000 characters."] });
  if (!isUuid(body.clientMessageId)) throw new AppError(400, "validation_failed", "clientMessageId is required.");
  // Re-checked on every send: accepted connection, no block, both accounts active (BR-19). Not tied to event status (D-05).
  if (!(await canSend(ctx.db, me.attendeeId, other))) throw forbidden("You can't send messages in this conversation.", "not_connected");
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
      await notify(tx, other, "message", { message: `New message from ${mine?.name ?? "a connection"}`, preview: text.slice(0, 80) }, { actorProfileId: me.profileId, entityId: conv.id });
      await recordActivity(tx, conv.originEventId, "message_sent");
    }
    return m;
  });
  return reply(201, { id: Number(msg.id), mine: true, body: msg.body, createdAt: msg.createdAt, clientMessageId: msg.clientMessageId, removed: false });
}

export async function markRead(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { conv } = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  const body = await ctx.json<{ lastReadMessageId?: number }>();
  const id = Number(body.lastReadMessageId ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) return reply(204);
  await ctx.db.update(conversationMembers).set({ lastReadMessageId: sql`greatest(${conversationMembers.lastReadMessageId}, ${id})`, lastReadAt: new Date() })
    .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.attendeeId, me.attendeeId)));
  await ctx.db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.attendeeId, me.attendeeId), eq(notifications.type, "message"), eq(notifications.entityId, conv.id), isNull(notifications.readAt)));
  return reply(204);
}

export async function typing(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const { conv } = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  await ctx.db.update(conversationMembers).set({ typingAt: new Date() }).where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.attendeeId, me.attendeeId)));
  return reply(204);
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
      WHERE m.id = ${Number(b.messageId)} AND m.sender_attendee_id = ${target.attendeeId}
      AND cv.attendee_low_id = least(${me.attendeeId}::uuid, ${target.attendeeId}::uuid) AND cv.attendee_high_id = greatest(${me.attendeeId}::uuid, ${target.attendeeId}::uuid)`)).rows;
    if (m) { messageId = Number(m.id); excerpt = m.body.slice(0, 1000); }
  }
  const eventId = b.eventId && isUuid(b.eventId) && (await getParticipant(ctx.db, b.eventId, me.attendeeId)) ? b.eventId : null;
  const [r] = await ctx.db.insert(userReports).values({ reporterAttendeeId: me.attendeeId, reportedAttendeeId: target.attendeeId, eventId, messageId, messageExcerpt: excerpt, reason: b.reason!, details }).returning({ id: userReports.id });
  await audit(ctx.db, { actorType: "attendee", actorId: me.attendeeId, action: "report.created", targetType: "report", targetId: r!.id, eventId });
  return reply(201, { id: r!.id });
}
