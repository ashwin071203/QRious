import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError, FieldErrors, forbidden, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { requireAttendee, type AttendeeAuth } from "./identity";
import { isJoinable, loadEvent, loadEvents, publicEventDto, requireJoinableByQr, type EventFull } from "./events-core";
import { intentionsForCategory } from "./taxonomy";

const { events, eventParticipants, eventAvailability, eventParticipantIntentions, eventIntentions, networkingIntentions, connections } = schema;

export const eventHomePath = (eventId: string) => `/app/events/${eventId}/home`;

export async function recordActivity(db: Executor, eventId: string, kind: (typeof schema.ACTIVITY_KIND)[number]) {
  const now = new Date();
  const bucket = new Date(Math.floor(now.getTime() / 300_000) * 300_000);
  await db.execute(sql`INSERT INTO event_activity_counters (event_id, bucket_start, kind, count) VALUES (${eventId}, ${bucket}, ${kind}, 1)
    ON CONFLICT (event_id, bucket_start, kind) DO UPDATE SET count = event_activity_counters.count + 1`);
}

/**
 * Joins an event inside the caller's transaction. Locks the event row so the participant limit holds under
 * concurrency (D-22). Idempotent for active participants. Anonymous browsing never reaches this (BR-02).
 */
export async function joinInTx(tx: Executor, attendeeId: string, eventId: string, qrCodeId: string | null) {
  const locked = await tx.execute<{ id: string; max_participants: number | null; participant_count: number }>(
    sql`SELECT id, max_participants, participant_count FROM events WHERE id = ${eventId} FOR UPDATE`);
  const ev = locked.rows[0];
  if (!ev) throw notFound("Event not found.");
  const full = await loadEvent(tx, eventId);
  if (!full || !isJoinable(full)) throw new AppError(409, "event_not_joinable", "This event isn't accepting new participants.");

  const [existing] = await tx.select().from(eventParticipants).where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.attendeeId, attendeeId))).limit(1);
  if (existing?.status === "active") return { eventId, alreadyJoined: true, redirectTo: eventHomePath(eventId) };
  if (existing?.status === "removed") throw forbidden("The organizer has removed you from this event.", "participant_removed");
  if (ev.max_participants !== null && ev.participant_count >= ev.max_participants)
    throw new AppError(409, "event_full", "This event has reached its participant limit.");

  const now = new Date();
  if (existing) {
    await tx.update(eventParticipants).set({ status: "active", leftAt: null, joinedAt: now, joinedViaQrCodeId: qrCodeId ?? existing.joinedViaQrCodeId })
      .where(eq(eventParticipants.id, existing.id));
  } else {
    const [p] = await tx.insert(eventParticipants).values({ eventId, attendeeId, joinedAt: now, joinedViaQrCodeId: qrCodeId }).returning({ id: eventParticipants.id });
    await tx.insert(eventAvailability).values({ participantId: p!.id });
  }
  await tx.update(events).set({ participantCount: sql`${events.participantCount} + 1`, updatedAt: now }).where(eq(events.id, eventId));
  await recordActivity(tx, eventId, "join");
  const [prof] = (await tx.execute<{ id: string }>(sql`SELECT id FROM user_profiles WHERE attendee_id = ${attendeeId}`)).rows;
  const { participantJoined } = await import("@/server/notifications/rules");
  await participantJoined(tx, eventId, attendeeId, prof?.id ?? null);
  return { eventId, alreadyJoined: false, redirectTo: eventHomePath(eventId) };
}

export async function joinEvent(ctx: Ctx, eventId: string) {
  const me = await requireAttendee(ctx);
  await ctx.limit("join", 20, 3600, `att:${me.attendeeId}`);
  const body = await ctx.json<{ qrCode?: string }>();
  let qrId: string | null = null;
  if (body.qrCode) {
    const { event, qrCodeId } = await requireJoinableByQr(body.qrCode);
    if (event.id !== eventId) throw new AppError(400, "qr_invalid", "This QR code belongs to a different event.");
    qrId = qrCodeId;
  }
  return ctx.db.transaction((tx) => joinInTx(tx, me.attendeeId, eventId, qrId));
}

export async function leaveEvent(ctx: Ctx, eventId: string) {
  const me = await requireAttendee(ctx);
  await ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.attendeeId, me.attendeeId), eq(eventParticipants.status, "active"))).limit(1);
    if (!p) throw forbidden("You're not part of this event.", "not_participant");
    await tx.update(eventParticipants).set({ status: "left", leftAt: new Date() }).where(eq(eventParticipants.id, p.id));
    await tx.update(events).set({ participantCount: sql`greatest(${events.participantCount} - 1, 0)` }).where(eq(events.id, eventId));
    // Pending requests sent through this event are withdrawn; accepted connections persist (D-05).
    await tx.update(connections).set({ status: "withdrawn", respondedAt: new Date() })
      .where(and(eq(connections.originEventId, eventId), eq(connections.status, "pending"),
        sql`(${connections.requesterAttendeeId} = ${me.attendeeId} OR ${connections.addresseeAttendeeId} = ${me.attendeeId})`));
  });
}

export type Participant = typeof eventParticipants.$inferSelect & { availability: typeof eventAvailability.$inferSelect | null };

export async function getParticipant(db: Executor, eventId: string, attendeeId: string): Promise<Participant | null> {
  const [row] = await db.select({ p: eventParticipants, a: eventAvailability }).from(eventParticipants)
    .leftJoin(eventAvailability, eq(eventAvailability.participantId, eventParticipants.id))
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.attendeeId, attendeeId))).limit(1);
  return row ? { ...row.p, availability: row.a } : null;
}

/** Active participant of a visible event — the base check for every event-scoped member feature. */
export async function requireParticipant(ctx: Ctx, eventId: string): Promise<{ me: AttendeeAuth; event: EventFull; participant: Participant }> {
  const me = await requireAttendee(ctx);
  const [event, participant] = await Promise.all([loadEvent(ctx.db, eventId), getParticipant(ctx.db, eventId, me.attendeeId)]);
  if (!event || event.status === "draft" || event.moderationStatus !== "ok") throw notFound("Event not found.");
  if (!participant || participant.status !== "active") throw forbidden("Join this event to use its networking features.", "not_participant");
  return { me, event, participant };
}

async function myIntentionIds(db: Executor, participantId: string) {
  return (await db.select({ id: eventParticipantIntentions.intentionId }).from(eventParticipantIntentions).where(eq(eventParticipantIntentions.participantId, participantId))).map((r) => r.id);
}

export async function eventIntentionOptions(db: Executor, ev: EventFull) {
  const configured = await db.select({ id: networkingIntentions.id, slug: networkingIntentions.slug, label: networkingIntentions.label, group: networkingIntentions.pulseGroup })
    .from(eventIntentions).innerJoin(networkingIntentions, eq(networkingIntentions.id, eventIntentions.intentionId))
    .where(and(eq(eventIntentions.eventId, ev.id), eq(networkingIntentions.isActive, true))).orderBy(asc(eventIntentions.sortOrder));
  if (configured.length) return configured;
  const defaults = await intentionsForCategory(db, ev.categoryId);
  return defaults.map((i) => ({ id: i.id, slug: i.slug, label: i.label, group: i.pulseGroup }));
}

export function participationDto(p: Participant, intentionIds: string[]) {
  return {
    participantId: p.id, status: p.status, discoveryPaused: p.discoveryPaused,
    availabilityStatus: p.availability?.status ?? "open_to_conversations",
    availabilityVisibility: p.availability?.visibility ?? "members",
    intentionIds, exportConsent: p.exportConsent, joinedAt: p.joinedAt,
  };
}

export async function getMyEvent(ctx: Ctx, eventId: string) {
  const { event, participant } = await requireParticipant(ctx, eventId);
  return {
    event: publicEventDto(event),
    participation: participationDto(participant, await myIntentionIds(ctx.db, participant.id)),
    intentions: await eventIntentionOptions(ctx.db, event),
  };
}

/** Update my event-specific availability, intentions and discovery state (Module 4/8, BR-11, BR-12). */
export async function updateMyParticipation(ctx: Ctx, eventId: string) {
  const { me, event, participant } = await requireParticipant(ctx, eventId);
  await ctx.limit("participation", 60, 60, `att:${me.attendeeId}`);
  const body = await ctx.json<{ availabilityStatus?: string; availabilityVisibility?: string; discoveryPaused?: boolean; intentionIds?: string[]; exportConsent?: boolean }>();
  const errors = new FieldErrors();
  if (body.availabilityStatus !== undefined && !(schema.AVAILABILITY as readonly string[]).includes(body.availabilityStatus)) errors.add("availabilityStatus", "Unknown status.");
  if (body.availabilityVisibility !== undefined && !(schema.AVAILABILITY_VISIBILITY as readonly string[]).includes(body.availabilityVisibility)) errors.add("availabilityVisibility", "Unknown visibility.");
  if (body.availabilityStatus !== undefined && !event.settings.availabilityEnabled) errors.add("availabilityStatus", "The organizer has turned off availability for this event.");
  let intentionIds: string[] | undefined;
  if (body.intentionIds !== undefined) {
    if (!Array.isArray(body.intentionIds) || body.intentionIds.length > 10) errors.add("intentionIds", "Choose up to 10.");
    else {
      const allowed = new Set((await eventIntentionOptions(ctx.db, event)).map((i) => i.id));
      intentionIds = [...new Set(body.intentionIds)].filter((id) => allowed.has(id));
    }
  }
  errors.throwIfAny();

  const now = new Date();
  await ctx.db.transaction(async (tx) => {
    let paused = body.discoveryPaused ?? participant.discoveryPaused;
    let status = body.availabilityStatus ?? participant.availability?.status ?? "open_to_conversations";
    // "Discovery Paused" status and the pause switch stay consistent.
    if (body.availabilityStatus === "discovery_paused") paused = true;
    else if (body.availabilityStatus !== undefined && body.discoveryPaused === undefined) paused = false;
    if (body.discoveryPaused === false && status === "discovery_paused") status = "open_to_conversations";
    if (body.discoveryPaused === true && body.availabilityStatus === undefined) status = "discovery_paused";

    await tx.update(eventParticipants).set({ discoveryPaused: paused, ...(body.exportConsent !== undefined ? { exportConsent: !!body.exportConsent } : {}) })
      .where(eq(eventParticipants.id, participant.id));
    await tx.insert(eventAvailability).values({ participantId: participant.id, status, visibility: body.availabilityVisibility ?? participant.availability?.visibility ?? "members", updatedAt: now })
      .onConflictDoUpdate({ target: eventAvailability.participantId, set: { status, visibility: body.availabilityVisibility ?? participant.availability?.visibility ?? "members", updatedAt: now } });
    if (intentionIds) {
      await tx.delete(eventParticipantIntentions).where(eq(eventParticipantIntentions.participantId, participant.id));
      if (intentionIds.length) await tx.insert(eventParticipantIntentions).values(intentionIds.map((intentionId) => ({ participantId: participant.id, intentionId })));
    }
    if (status !== participant.availability?.status) await recordActivity(tx, eventId, "status_change");
  });
  return getMyEvent(ctx, eventId);
}

/** My Events — scope: current | upcoming | previous | all (Module 4). */
export async function myEvents(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const scope = ctx.query("scope") ?? "all";
  const parts = await ctx.db.select({ p: eventParticipants, a: eventAvailability }).from(eventParticipants)
    .leftJoin(eventAvailability, eq(eventAvailability.participantId, eventParticipants.id))
    .where(and(eq(eventParticipants.attendeeId, me.attendeeId), eq(eventParticipants.status, "active")));
  const evs = new Map((await loadEvents(ctx.db, parts.map((x) => x.p.eventId))).map((e) => [e.id, e]));
  const now = Date.now();
  const rows = parts.map((x) => ({ p: { ...x.p, availability: x.a }, e: evs.get(x.p.eventId) }))
    .filter((r): r is { p: Participant; e: EventFull } => !!r.e && r.e.moderationStatus === "ok" && r.e.status !== "draft")
    .filter(({ e }) => scope === "current" ? ["active", "networking_paused"].includes(e.status)
      : scope === "upcoming" ? e.status === "published"
      : scope === "previous" ? ["ended", "archived"].includes(e.status) : true)
    .sort((a, b) => Number(["active", "networking_paused"].includes(b.e.status)) - Number(["active", "networking_paused"].includes(a.e.status))
      || Math.abs(a.e.startsAt.getTime() - now) - Math.abs(b.e.startsAt.getTime() - now));
  return rows.map(({ p, e }) => ({ event: publicEventDto(e), participation: participationDto(p, []) }));
}

export async function isActiveParticipant(db: Executor, eventId: string, attendeeId: string) {
  const [p] = await db.select({ id: eventParticipants.id }).from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.attendeeId, attendeeId), eq(eventParticipants.status, "active"))).limit(1);
  return !!p;
}

/** Events that two attendees both actively participate in. */
export async function sharedEventIds(db: Executor, a: string, b: string): Promise<string[]> {
  const rows = await db.execute<{ event_id: string }>(sql`
    SELECT p1.event_id FROM event_participants p1 JOIN event_participants p2 ON p2.event_id = p1.event_id
    WHERE p1.attendee_id = ${a} AND p2.attendee_id = ${b} AND p1.status = 'active' AND p2.status = 'active'`);
  return rows.rows.map((r) => r.event_id);
}

