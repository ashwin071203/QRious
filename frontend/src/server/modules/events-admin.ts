import "server-only";
import QRCode from "qrcode";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@/server/db";
import { AppError, FieldErrors, conflict, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { isUuid, reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { removeMedia, saveBanner } from "@/server/core/media";
import { cleanText, newQrCode, normalizeHttpsUrl } from "@/server/lib/rules";
import { requireOrgMember } from "./organizers";
import { loadEvent, publicEventDto, syncStatuses, type EventFull } from "./events-core";
import { intentionsForCategory } from "./taxonomy";
import { computePulse } from "./pulse";
import { allocateEventAllowance, orgEntitlements, orgHas, requireOrgFeature } from "./entitlements";
import * as rules from "@/server/notifications/rules";

const { organizations, organizationEventCredits, events, eventCategories, eventQrCodes, eventNetworkingSettings, eventSuggestedInterests, eventSuggestedSkills, eventIntentions, eventParticipants,
  interests, skills, userReports } = schema;

export function siteOrigin(ctx: Ctx) {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && !env.includes("localhost")) return env.replace(/\/$/, "");
  const host = ctx.req.headers.get("x-forwarded-host") ?? ctx.req.headers.get("host") ?? "localhost:3000";
  return `${ctx.secure ? "https" : "http"}://${host}`;
}

/** Loads the event and verifies the caller belongs to its organization (BR-21). */
async function ownedEvent(ctx: Ctx, ownerOnly = false) {
  const id = ctx.params.eventId!;
  const [row] = await ctx.db.select({ orgId: events.organizationId }).from(events).where(eq(events.id, id)).limit(1);
  if (!row) throw notFound("Event not found.");
  const m = await requireOrgMember(ctx, row.orgId, ownerOnly);
  const ev = (await loadEvent(ctx.db, id))!;
  return { ...m, event: ev };
}

function isValidTimeZone(tz: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

type EventBody = { name?: string; categoryId?: string; description?: string; venueName?: string; venueAddress?: string; city?: string; timeZone?: string;
  startsAt?: string; endsAt?: string; website?: string; maxParticipants?: number | null };

function eventFields(b: EventBody, errors: FieldErrors, creating: boolean, current?: EventFull) {
  const out: Partial<typeof events.$inferInsert> = {};
  const req = (k: keyof EventBody) => creating || b[k] !== undefined;
  if (req("name")) { const v = cleanText(b.name); if (!v || v.length > 150) errors.add("name", "Enter an event name (up to 150 characters)."); else out.name = v; }
  if (req("venueName")) { const v = cleanText(b.venueName); if (!v || v.length > 150) errors.add("venueName", "Enter the venue (up to 150 characters)."); else out.venueName = v; }
  if (b.description !== undefined) { const v = cleanText(b.description); if (v && v.length > 5000) errors.add("description", "Up to 5000 characters."); out.description = v; }
  if (b.venueAddress !== undefined) { const v = cleanText(b.venueAddress); if (v && v.length > 300) errors.add("venueAddress", "Up to 300 characters."); out.venueAddress = v; }
  if (b.city !== undefined) { const v = cleanText(b.city); if (v && v.length > 100) errors.add("city", "Up to 100 characters."); out.city = v; }
  if (req("timeZone")) { const tz = b.timeZone ?? "Asia/Kolkata"; if (!isValidTimeZone(tz)) errors.add("timeZone", "Unknown time zone."); else out.timeZone = tz; }
  if (req("categoryId")) { if (!isUuid(b.categoryId)) errors.add("categoryId", "Choose a category."); else out.categoryId = b.categoryId; }
  if (b.website !== undefined) { const w = normalizeHttpsUrl(b.website); if (w && typeof w === "object") errors.add("website", w.error); else out.website = w as string | null; }
  if (b.maxParticipants !== undefined) {
    if (b.maxParticipants === null) out.maxParticipants = null;
    else if (!Number.isInteger(b.maxParticipants) || b.maxParticipants < 1 || b.maxParticipants > 100000) errors.add("maxParticipants", "Enter a number between 1 and 100,000, or leave empty.");
    else if (current && b.maxParticipants < current.participantCount) errors.add("maxParticipants", `There are already ${current.participantCount} participants.`);
    else out.maxParticipants = b.maxParticipants;
  }
  const starts = req("startsAt") ? new Date(b.startsAt ?? "") : current?.startsAt;
  const ends = req("endsAt") ? new Date(b.endsAt ?? "") : current?.endsAt;
  if (req("startsAt") && Number.isNaN(starts!.getTime())) errors.add("startsAt", "Enter a valid start date and time.");
  if (req("endsAt") && Number.isNaN(ends!.getTime())) errors.add("endsAt", "Enter a valid end date and time.");
  if (starts && ends && !Number.isNaN(starts.getTime()) && !Number.isNaN(ends.getTime())) {
    if (ends <= starts) errors.add("endsAt", "The end must be after the start.");
    else if (ends.getTime() - starts.getTime() > 60 * 86_400_000) errors.add("endsAt", "Events can last up to 60 days.");
    if (b.startsAt !== undefined) out.startsAt = starts;
    if (b.endsAt !== undefined) out.endsAt = ends;
  }
  return out;
}

export async function listOrgEvents(ctx: Ctx) {
  await requireOrgMember(ctx, ctx.params.orgId!);
  const ids = (await ctx.db.select({ id: events.id }).from(events).where(eq(events.organizationId, ctx.params.orgId!))).map((r) => r.id);
  await syncStatuses(ctx.db, ids);
  const status = ctx.query("status");
  const rows = await ctx.db.select({ e: events, c: eventCategories.name }).from(events).innerJoin(eventCategories, eq(eventCategories.id, events.categoryId))
    .where(and(eq(events.organizationId, ctx.params.orgId!), status && (schema.EVENT_STATUS as readonly string[]).includes(status) ? eq(events.status, status) : sql`true`))
    .orderBy(desc(events.startsAt));
  return rows.map(({ e, c }) => ({ id: e.id, name: e.name, categoryName: c, status: e.status, moderationStatus: e.moderationStatus, startsAt: e.startsAt, endsAt: e.endsAt, timeZone: e.timeZone,
    venueName: e.venueName, city: e.city, participantCount: e.participantCount, bannerUrl: e.bannerUrl }));
}

export async function createEvent(ctx: Ctx) {
  const { organizer } = await requireOrgMember(ctx, ctx.params.orgId!);
  const b = await ctx.json<EventBody>();
  const errors = new FieldErrors();
  const f = eventFields(b, errors, true);
  if (f.categoryId) {
    const [c] = await ctx.db.select({ id: eventCategories.id }).from(eventCategories).where(and(eq(eventCategories.id, f.categoryId), eq(eventCategories.isActive, true))).limit(1);
    if (!c) errors.add("categoryId", "Choose a category.");
  }
  errors.throwIfAny();
  // Validation happens first, and everything below is one transaction: a failed creation consumes no allowance.
  const id = await ctx.db.transaction(async (tx) => {
    const allowance = await allocateEventAllowance(tx, ctx.params.orgId!); // locks the organization row
    const [ev] = await tx.insert(events).values({ ...(f as typeof events.$inferInsert), organizationId: ctx.params.orgId!, createdBy: organizer.userId, status: "draft", allowanceSource: allowance.source }).returning({ id: events.id });
    await tx.update(organizations).set({ eventsCreatedCount: sql`${organizations.eventsCreatedCount} + 1` }).where(eq(organizations.id, ctx.params.orgId!));
    if (allowance.creditId) {
      const used = await tx.update(organizationEventCredits).set({ consumedAt: new Date(), consumedEventId: ev!.id })
        .where(and(eq(organizationEventCredits.id, allowance.creditId), sql`consumed_at IS NULL AND revoked_at IS NULL`)).returning({ id: organizationEventCredits.id });
      if (!used.length) throw conflict("concurrent_change", "Your event credit changed in the meantime. Please try again.");
    }
    await tx.insert(eventNetworkingSettings).values({ eventId: ev!.id, updatedBy: organizer.userId });
    // Event-type defaults: the category's intentions (organizers don't have to configure anything, M17).
    const defaults = await intentionsForCategory(tx, f.categoryId!);
    if (defaults.length) await tx.insert(eventIntentions).values(defaults.map((i, n) => ({ eventId: ev!.id, intentionId: i.id, sortOrder: n })));
    await audit(tx, { actorType: "organizer", actorId: organizer.userId, action: "event.created", targetType: "event", targetId: ev!.id, organizationId: ctx.params.orgId, eventId: ev!.id, data: { allowance: allowance.source } });
    const ent = await orgEntitlements(tx, ctx.params.orgId!);
    await rules.eventCreated(tx, ev!.id, organizer.userId, ent.allowance.eventsCreated, ent.allowance.unlimited, ent.allowance.credits);
    return ev!.id;
  });
  return reply(201, { id });
}

async function eventDetail(ctx: Ctx, ev: EventFull) {
  const [qr] = await ctx.db.select().from(eventQrCodes).where(and(eq(eventQrCodes.eventId, ev.id), eq(eventQrCodes.status, "active"))).limit(1);
  const [si, ss, ei] = await Promise.all([
    ctx.db.select({ id: interests.id, name: interests.name }).from(eventSuggestedInterests).innerJoin(interests, eq(interests.id, eventSuggestedInterests.interestId)).where(eq(eventSuggestedInterests.eventId, ev.id)).orderBy(asc(eventSuggestedInterests.sortOrder)),
    ctx.db.select({ id: skills.id, name: skills.name }).from(eventSuggestedSkills).innerJoin(skills, eq(skills.id, eventSuggestedSkills.skillId)).where(eq(eventSuggestedSkills.eventId, ev.id)).orderBy(asc(eventSuggestedSkills.sortOrder)),
    ctx.db.select({ id: eventIntentions.intentionId }).from(eventIntentions).where(eq(eventIntentions.eventId, ev.id)),
  ]);
  return {
    ...publicEventDto(ev), status: ev.status, moderationStatus: ev.moderationStatus, organizationId: ev.organizationId, categoryId: ev.categoryId,
    maxParticipants: ev.maxParticipants, participantCount: ev.participantCount, qrAccessEnabled: ev.qrAccessEnabled, publishedAt: ev.publishedAt,
    settings: ev.settings,
    qr: qr ? { code: qr.publicCode, url: `${siteOrigin(ctx)}/e/${qr.publicCode}`, createdAt: qr.createdAt } : null,
    suggestions: { interests: si, skills: ss, intentionIds: ei.map((r) => r.id) },
    intentionOptions: (await intentionsForCategory(ctx.db, ev.categoryId)).map((i) => ({ id: i.id, label: i.label, group: i.pulseGroup })),
  };
}

export async function getEvent(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  return eventDetail(ctx, event);
}

export async function updateEvent(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  if (event.status === "archived") throw conflict("event_archived", "Archived events can't be edited.");
  const b = await ctx.json<EventBody>();
  const errors = new FieldErrors();
  const f = eventFields(b, errors, false, event);
  if (f.categoryId && f.categoryId !== event.categoryId) {
    const [c] = await ctx.db.select({ id: eventCategories.id }).from(eventCategories).where(eq(eventCategories.id, f.categoryId)).limit(1);
    if (!c) errors.add("categoryId", "Choose a category.");
  }
  errors.throwIfAny();
  // An ended event can be re-opened by moving its end into the future.
  const patch: Partial<typeof events.$inferInsert> = { ...f, updatedAt: new Date() };
  if (event.status === "ended" && f.endsAt && f.endsAt > new Date()) patch.status = "published";
  await ctx.db.update(events).set(patch).where(eq(events.id, event.id));
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "event.updated", targetType: "event", targetId: event.id, organizationId: event.organizationId, eventId: event.id, data: { fields: Object.keys(f) } });
  const changed = Object.keys(f).filter((k) => {
    const before = (event as Record<string, unknown>)[k], after = (f as Record<string, unknown>)[k];
    return before instanceof Date && after instanceof Date ? before.getTime() !== after.getTime() : before !== after;
  });
  if (event.status !== "draft") await rules.eventChanged(ctx.db, event.id, changed);
  return eventDetail(ctx, (await loadEvent(ctx.db, event.id))!);
}

/** Deletes a draft that was never published (no QR code, no participants). Allowance is NOT restored. */
export async function deleteEvent(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  if (event.status !== "draft" || event.publishedAt || event.participantCount > 0)
    throw conflict("event_not_deletable", "Only drafts that were never published can be deleted. Archive other events instead.");
  await ctx.db.transaction(async (tx) => {
    const r = await tx.delete(events).where(and(eq(events.id, event.id), eq(events.status, "draft"), sql`published_at IS NULL`)).returning({ id: events.id });
    if (!r.length) throw conflict("concurrent_change", "The event changed in the meantime. Refresh and try again.");
    await audit(tx, { actorType: "organizer", actorId: organizer.userId, action: "event.deleted", targetType: "event", targetId: event.id, organizationId: event.organizationId, data: { name: event.name } });
  });
  return reply(204);
}

export async function uploadBanner(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  await requireOrgFeature(ctx.db, event.organizationId, "org.branding");
  const form = await ctx.req.formData().catch(() => null);
  const saved = await saveBanner((form?.get("file") as Blob | null) ?? null);
  await ctx.db.update(events).set({ bannerUrl: saved.url, bannerKey: saved.key, updatedAt: new Date() }).where(eq(events.id, event.id));
  await removeMedia([event.bannerUrl]);
  return { bannerUrl: saved.url };
}

export async function removeBanner(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  await ctx.db.update(events).set({ bannerUrl: null, bannerKey: null }).where(eq(events.id, event.id));
  await removeMedia([event.bannerUrl]);
  return reply(204);
}

type Transition = "publish" | "unpublish" | "pause" | "resume" | "start" | "end" | "archive";
const ALLOWED: Record<Transition, string[]> = {
  publish: ["draft"], unpublish: ["published", "active", "networking_paused"], pause: ["active"], resume: ["networking_paused"],
  start: ["published"], end: ["published", "active", "networking_paused"], archive: ["draft", "ended"],
};

/** Lifecycle state machine (M14, D-06). */
export async function transition(ctx: Ctx, action: Transition) {
  const { event, organizer } = await ownedEvent(ctx);
  if (!ALLOWED[action].includes(event.status)) throw conflict("invalid_transition", `You can't ${action} an event that is ${event.status.replace("_", " ")}.`);
  if (event.moderationStatus !== "ok" && ["publish", "resume", "start"].includes(action)) throw conflict("event_suspended", "This event has been suspended by QRious moderators.");
  const now = new Date();
  let status: string = event.status;
  const patch: Partial<typeof events.$inferInsert> = { updatedAt: now };

  if (action === "publish") {
    if (event.endsAt <= now) throw conflict("event_in_past", "Move the end date into the future before publishing.");
    status = "published";
    Object.assign(patch, { status, publishedAt: now });
  }
  if (action === "unpublish") Object.assign(patch, { status: (status = "draft") });
  if (action === "pause") Object.assign(patch, { status: (status = "networking_paused") });
  if (action === "resume") Object.assign(patch, { status: (status = event.endsAt <= now ? "ended" : "active") });
  if (action === "start") Object.assign(patch, { status: (status = "active"), activatedAt: now });
  if (action === "end") Object.assign(patch, { status: (status = "ended"), endedAt: now });
  if (action === "archive") Object.assign(patch, { status: (status = "archived"), archivedAt: now });

  await ctx.db.transaction(async (tx) => {
    const r = await tx.update(events).set(patch).where(and(eq(events.id, event.id), eq(events.status, event.status))).returning({ id: events.id });
    if (!r.length) throw conflict("concurrent_change", "The event changed in the meantime. Refresh and try again.");
    if (action === "publish") {
      const [qr] = await tx.select({ id: eventQrCodes.id }).from(eventQrCodes).where(and(eq(eventQrCodes.eventId, event.id), eq(eventQrCodes.status, "active"))).limit(1);
      if (!qr) await tx.insert(eventQrCodes).values({ eventId: event.id, publicCode: newQrCode(), createdBy: organizer.userId });
      await syncStatuses(tx, [event.id]);
    }
    const what: Record<Transition, rules.Lifecycle> = { publish: "published", start: "networking_open", pause: "paused", resume: "resumed", end: "ended", unpublish: "unpublished", archive: "archived" };
    await rules.eventLifecycle(tx, event.id, what[action], organizer.userId);
    await audit(tx, { actorType: "organizer", actorId: organizer.userId, action: `event.${action}`, targetType: "event", targetId: event.id, organizationId: event.organizationId, eventId: event.id });
  });
  return eventDetail(ctx, (await loadEvent(ctx.db, event.id))!);
}

// ---------- Networking configuration (M17) ----------
const SETTING_KEYS = ["discoverEnabled", "anonymousBrowsingEnabled", "smartMatchingEnabled", "pulseEnabled", "connectionsEnabled", "messagingEnabled", "availabilityEnabled", "premiumHighlightingEnabled"] as const;

export async function updateSettings(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  const b = await ctx.json<Record<string, unknown>>();
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: organizer.userId };
  for (const k of SETTING_KEYS) if (typeof b[k] === "boolean") patch[k] = b[k];
  await ctx.db.insert(eventNetworkingSettings).values({ eventId: event.id, ...patch }).onConflictDoUpdate({ target: eventNetworkingSettings.eventId, set: patch });
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "event.settings_updated", targetType: "event", targetId: event.id, organizationId: event.organizationId, eventId: event.id, data: patch });
  return eventDetail(ctx, (await loadEvent(ctx.db, event.id))!);
}

export async function resetSettings(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(eventNetworkingSettings).where(eq(eventNetworkingSettings.eventId, event.id));
    await tx.insert(eventNetworkingSettings).values({ eventId: event.id, updatedBy: organizer.userId });
    await tx.delete(eventSuggestedInterests).where(eq(eventSuggestedInterests.eventId, event.id));
    await tx.delete(eventSuggestedSkills).where(eq(eventSuggestedSkills.eventId, event.id));
    await tx.delete(eventIntentions).where(eq(eventIntentions.eventId, event.id));
    const defaults = await intentionsForCategory(tx, event.categoryId);
    if (defaults.length) await tx.insert(eventIntentions).values(defaults.map((i, n) => ({ eventId: event.id, intentionId: i.id, sortOrder: n })));
  });
  return eventDetail(ctx, (await loadEvent(ctx.db, event.id))!);
}

export async function updateSuggestions(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  await requireOrgFeature(ctx.db, event.organizationId, "org.networking.advanced");
  const b = await ctx.json<{ interestIds?: string[]; skillIds?: string[]; intentionIds?: string[] }>();
  const clean = (a: unknown, max: number) => (Array.isArray(a) ? [...new Set(a.filter(isUuid))].slice(0, max) : null);
  const iIds = clean(b.interestIds, 40), sIds = clean(b.skillIds, 40), nIds = clean(b.intentionIds, 20);
  await ctx.db.transaction(async (tx) => {
    if (iIds) {
      const ok = iIds.length ? (await tx.select({ id: interests.id }).from(interests).where(and(inArray(interests.id, iIds), eq(interests.status, "approved")))).map((r) => r.id) : [];
      await tx.delete(eventSuggestedInterests).where(eq(eventSuggestedInterests.eventId, event.id));
      if (ok.length) await tx.insert(eventSuggestedInterests).values(iIds.filter((i) => ok.includes(i)).map((interestId, n) => ({ eventId: event.id, interestId, sortOrder: n })));
    }
    if (sIds) {
      const ok = sIds.length ? (await tx.select({ id: skills.id }).from(skills).where(and(inArray(skills.id, sIds), eq(skills.status, "approved")))).map((r) => r.id) : [];
      await tx.delete(eventSuggestedSkills).where(eq(eventSuggestedSkills.eventId, event.id));
      if (ok.length) await tx.insert(eventSuggestedSkills).values(sIds.filter((i) => ok.includes(i)).map((skillId, n) => ({ eventId: event.id, skillId, sortOrder: n })));
    }
    if (nIds) {
      const allowed = (await intentionsForCategory(tx, event.categoryId)).map((i) => i.id);
      const ok = nIds.filter((i) => allowed.includes(i));
      await tx.delete(eventIntentions).where(eq(eventIntentions.eventId, event.id));
      if (ok.length) await tx.insert(eventIntentions).values(ok.map((intentionId, n) => ({ eventId: event.id, intentionId, sortOrder: n })));
      // Participants keep only intentions still offered.
      await tx.execute(sql`DELETE FROM event_participant_intentions pi USING event_participants ep WHERE ep.id = pi.participant_id AND ep.event_id = ${event.id}
        AND NOT EXISTS (SELECT 1 FROM event_intentions ei WHERE ei.event_id = ${event.id} AND ei.intention_id = pi.intention_id)`);
    }
  });
  return eventDetail(ctx, (await loadEvent(ctx.db, event.id))!);
}

// ---------- QR management (M15) ----------
export async function qrImage(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  const [qr] = await ctx.db.select().from(eventQrCodes).where(and(eq(eventQrCodes.eventId, event.id), eq(eventQrCodes.status, "active"))).limit(1);
  if (!qr) throw notFound("Publish the event to generate its QR code.", "qr_missing");
  const url = `${siteOrigin(ctx)}/e/${qr.publicCode}`;
  const format = ctx.query("format") === "svg" ? "svg" : "png";
  const size = Math.min(Math.max(Number(ctx.query("size") ?? 1024) || 1024, 256), 4096);
  const filename = `qrious-${event.name.replace(/[^\w]+/g, "-").toLowerCase().slice(0, 40)}-qr.${format}`;
  const disposition = ctx.query("download") ? `attachment; filename="${filename}"` : "inline";
  if (format === "svg") {
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "Q", margin: 2, color: { dark: "#100B1D", light: "#FFFFFF" } });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Disposition": disposition, "Cache-Control": "no-store" } });
  }
  const png = await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "Q", margin: 2, width: size, color: { dark: "#100B1D", light: "#FFFFFF" } });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Content-Disposition": disposition, "Cache-Control": "no-store" } });
}

export async function regenerateQr(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  if (event.status === "draft") throw conflict("event_draft", "Publish the event first.");
  if (event.status === "archived") throw conflict("event_archived", "Archived events can't get new QR codes.");
  await ctx.db.transaction(async (tx) => {
    await tx.update(eventQrCodes).set({ status: "revoked", revokedAt: new Date(), revokedBy: organizer.userId }).where(and(eq(eventQrCodes.eventId, event.id), eq(eventQrCodes.status, "active")));
    await tx.insert(eventQrCodes).values({ eventId: event.id, publicCode: newQrCode(), createdBy: organizer.userId });
    await audit(tx, { actorType: "organizer", actorId: organizer.userId, action: "qr.regenerated", targetType: "event", targetId: event.id, organizationId: event.organizationId, eventId: event.id });
    await rules.qrChanged(tx, event.id, "regenerated", organizer.userId);
  });
  return eventDetail(ctx, (await loadEvent(ctx.db, event.id))!);
}

export async function revokeQr(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  await ctx.db.update(eventQrCodes).set({ status: "revoked", revokedAt: new Date(), revokedBy: organizer.userId }).where(and(eq(eventQrCodes.eventId, event.id), eq(eventQrCodes.status, "active")));
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "qr.revoked", targetType: "event", targetId: event.id, organizationId: event.organizationId, eventId: event.id });
  await rules.qrChanged(ctx.db, event.id, "revoked", organizer.userId);
  return eventDetail(ctx, (await loadEvent(ctx.db, event.id))!);
}

export async function setQrAccess(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  const b = await ctx.json<{ enabled?: boolean }>();
  if (typeof b.enabled !== "boolean") throw new AppError(400, "validation_failed", "enabled must be true or false.");
  await ctx.db.update(events).set({ qrAccessEnabled: b.enabled, updatedAt: new Date() }).where(eq(events.id, event.id));
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: b.enabled ? "qr.enabled" : "qr.disabled", targetType: "event", targetId: event.id, organizationId: event.organizationId, eventId: event.id });
  if (b.enabled !== event.qrAccessEnabled) await rules.qrChanged(ctx.db, event.id, b.enabled ? "resumed" : "paused", organizer.userId);
  return eventDetail(ctx, (await loadEvent(ctx.db, event.id))!);
}

// ---------- Participants (M16) — member-level card fields only (D-23) ----------
export async function participants(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  const q = ctx.query("q")?.trim().toLowerCase().replace(/^@/, "");
  const status = ctx.query("status");
  const offset = Math.max(0, Math.min(Number(ctx.query("cursor") ?? 0) || 0, 100000));
  const conds = [sql`ep.event_id = ${event.id}`];
  if (q) conds.push(sql`(lower(up.display_name) LIKE ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} OR up.username_normalized LIKE ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`})`);
  if (status && (schema.PARTICIPANT_STATUS as readonly string[]).includes(status)) conds.push(sql`ep.status = ${status}`);
  const rows = (await ctx.db.execute<{ participant_id: string; status: string; discovery_paused: boolean; joined_at: Date; removal_reason: string | null; display_name: string; username: string;
    profession: string | null; thumb_url: string | null; availability: string | null; account_status: string }>(sql`
    SELECT ep.id AS participant_id, ep.status, ep.discovery_paused, ep.joined_at, ep.removal_reason, up.display_name, up.username, up.profession, up.thumb_url,
      ea.status AS availability, a.status AS account_status
    FROM event_participants ep JOIN user_profiles up ON up.attendee_id = ep.attendee_id JOIN attendees a ON a.id = ep.attendee_id
    LEFT JOIN event_availability ea ON ea.participant_id = ep.id
    WHERE ${sql.join(conds, sql` AND `)} ORDER BY ep.joined_at DESC LIMIT 51 OFFSET ${offset}`)).rows;
  return {
    items: rows.slice(0, 50).map((r) => ({ id: r.participant_id, status: r.status, discoveryPaused: r.discovery_paused, joinedAt: r.joined_at, removalReason: r.removal_reason,
      displayName: r.account_status === "deleted" ? "Deleted user" : r.display_name, username: r.username, profession: r.profession, thumbnailUrl: r.thumb_url,
      availability: r.availability })),
    nextCursor: rows.length > 50 ? String(offset + 50) : null,
  };
}

export async function participantStats(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  const [r] = (await ctx.db.execute<{ active: number; left: number; removed: number; paused: number; today: number }>(sql`
    SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'left')::int AS left,
      count(*) FILTER (WHERE status = 'removed')::int AS removed, count(*) FILTER (WHERE status = 'active' AND discovery_paused)::int AS paused,
      count(*) FILTER (WHERE joined_at > now() - interval '24 hours')::int AS today
    FROM event_participants WHERE event_id = ${event.id}`)).rows;
  // Basic statistics on every plan; the detailed breakdown is Pro (`detailed: false` tells the UI to show the upgrade hint).
  if (!(await orgHas(ctx.db, event.organizationId, "org.participants.detailed_stats")))
    return { detailed: false, active: r!.active, left: r!.left, removed: r!.removed, paused: null, today: null, connections: null, conversations: null };
  const [c] = (await ctx.db.execute<{ connections: number; conversations: number }>(sql`SELECT
    (SELECT count(*)::int FROM connections WHERE origin_event_id = ${event.id} AND status = 'accepted') AS connections,
    (SELECT count(*)::int FROM conversations WHERE origin_event_id = ${event.id}) AS conversations`)).rows;
  return { detailed: true, ...r, ...c };
}

export async function removeParticipant(ctx: Ctx, restore = false) {
  const { event, organizer } = await ownedEvent(ctx);
  const b = await ctx.json<{ reason?: string }>();
  const [p] = await ctx.db.select().from(eventParticipants).where(and(eq(eventParticipants.id, ctx.params.participantId!), eq(eventParticipants.eventId, event.id))).limit(1);
  if (!p) throw notFound("Participant not found.");
  await ctx.db.transaction(async (tx) => {
    if (restore) {
      if (p.status !== "removed") throw conflict("not_removed", "This participant isn't removed.");
      await tx.update(eventParticipants).set({ status: "left", removedAt: null, removedBy: null, removalReason: null }).where(eq(eventParticipants.id, p.id));
    } else {
      if (p.status === "removed") throw conflict("already_removed", "Already removed.");
      const reason = cleanText(b.reason)?.slice(0, 500) ?? null;
      await tx.update(eventParticipants).set({ status: "removed", removedAt: new Date(), removedBy: organizer.userId, removalReason: reason }).where(eq(eventParticipants.id, p.id));
      if (p.status === "active") await tx.update(events).set({ participantCount: sql`greatest(${events.participantCount} - 1, 0)` }).where(eq(events.id, event.id));
      await rules.participantRemoved(tx, event.id, p.attendeeId);
    }
    await audit(tx, { actorType: "organizer", actorId: organizer.userId, action: restore ? "participant.restored" : "participant.removed", targetType: "participant", targetId: p.id, organizationId: event.organizationId, eventId: event.id });
  });
  return reply(204);
}

export async function eventReports(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  const rows = (await ctx.db.execute<{ id: string; reason: string; details: string | null; status: string; escalated: boolean; created_at: Date; reported_name: string; reported_username: string;
    excerpt: string | null; participant_id: string | null }>(sql`
    SELECT r.id, r.reason, r.details, r.status, r.escalated, r.created_at, up.display_name AS reported_name, up.username AS reported_username, r.message_excerpt AS excerpt,
      ep.id AS participant_id
    FROM user_reports r JOIN user_profiles up ON up.attendee_id = r.reported_attendee_id
    LEFT JOIN event_participants ep ON ep.event_id = r.event_id AND ep.attendee_id = r.reported_attendee_id
    WHERE r.event_id = ${event.id} ORDER BY r.created_at DESC LIMIT 200`)).rows;
  return rows.map((r) => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, escalated: r.escalated, createdAt: r.created_at, messageExcerpt: r.excerpt,
    reported: { displayName: r.reported_name, username: r.reported_username, participantId: r.participant_id } }));
}

export async function escalateReport(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  const r = await ctx.db.update(userReports).set({ escalated: true }).where(and(eq(userReports.id, ctx.params.reportId!), eq(userReports.eventId, event.id))).returning({ id: userReports.id });
  if (!r.length) throw notFound("Report not found.");
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "report.escalated", targetType: "report", targetId: r[0]!.id, organizationId: event.organizationId, eventId: event.id });
  return reply(204);
}

/** CSV export of consenting participants only (BR-29, Pro feature). */
export async function exportParticipants(ctx: Ctx) {
  const { event, organizer } = await ownedEvent(ctx);
  await requireOrgFeature(ctx.db, event.organizationId, "org.reports.export");
  const rows = (await ctx.db.execute<{ display_name: string; username: string; profession: string | null; joined_at: Date }>(sql`
    SELECT up.display_name, up.username, up.profession, ep.joined_at FROM event_participants ep JOIN user_profiles up ON up.attendee_id = ep.attendee_id
    JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active' WHERE ep.event_id = ${event.id} AND ep.status = 'active' AND ep.export_consent = true ORDER BY ep.joined_at`)).rows;
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  const csv = ["Display name,Username,Profession,Joined at", ...rows.map((r) => [r.display_name, `@${r.username}`, r.profession, r.joined_at.toISOString()].map(esc).join(","))].join("\r\n");
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "participants.exported", targetType: "event", targetId: event.id, organizationId: event.organizationId, eventId: event.id, data: { rows: rows.length } });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="participants.csv"`, "Cache-Control": "no-store" } });
}

export async function organizerPulse(ctx: Ctx) {
  const { event } = await ownedEvent(ctx);
  const pulse = await computePulse(ctx.db, event);
  // Basic Pulse (totals) on every plan; goal and interest breakdowns are Pro.
  if (await orgHas(ctx.db, event.organizationId, "org.pulse.advanced")) return { ...pulse, advanced: true };
  return { ...pulse, advanced: false, byIntention: [], topInterests: [], topSkills: [] };
}

