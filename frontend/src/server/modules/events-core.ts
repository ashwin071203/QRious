import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Executor } from "@/server/db";
import { AppError, notFound } from "@/server/core/errors";

const { events, eventCategories, organizations, eventNetworkingSettings, eventQrCodes } = schema;
export const NETWORKING_OPENS_BEFORE_MS = 24 * 3_600_000;

export type EventRow = typeof events.$inferSelect;
export type Settings = typeof eventNetworkingSettings.$inferSelect;
export type EventFull = EventRow & { category: { slug: string; name: string }; organization: { name: string; logoUrl: string | null; status: string }; settings: Settings };

const DEFAULT_SETTINGS = (eventId: string): Settings => ({
  eventId, discoverEnabled: true, anonymousBrowsingEnabled: true, smartMatchingEnabled: true, pulseEnabled: true, connectionsEnabled: true,
  messagingEnabled: true, availabilityEnabled: true, premiumHighlightingEnabled: true, updatedAt: new Date(), updatedBy: null,
});

/**
 * Automatic transitions (D-06), applied lazily whenever events are read (no always-on worker on serverless):
 * Published → Active at start − 24 h; Active / Networking Paused / Published → Ended at the end time.
 */
export async function syncStatuses(db: Executor, ids?: string[]) {
  const now = new Date();
  const scope = ids?.length ? inArray(events.id, ids) : sql`true`;
  await db.update(events).set({ status: "ended", endedAt: now, updatedAt: now })
    .where(and(scope, inArray(events.status, ["published", "active", "networking_paused"]), sql`${events.endsAt} <= ${now}`));
  await db.update(events).set({ status: "active", activatedAt: now, updatedAt: now })
    .where(and(scope, eq(events.status, "published"), sql`${events.startsAt} - interval '24 hours' <= ${now}`, sql`${events.endsAt} > ${now}`));
}

export async function loadEvents(db: Executor, ids: string[]): Promise<EventFull[]> {
  if (!ids.length) return [];
  await syncStatuses(db, ids);
  const rows = await db.select({ e: events, c: { slug: eventCategories.slug, name: eventCategories.name }, o: { name: organizations.name, logoUrl: organizations.logoUrl, status: organizations.status }, s: eventNetworkingSettings })
    .from(events)
    .innerJoin(eventCategories, eq(eventCategories.id, events.categoryId))
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .leftJoin(eventNetworkingSettings, eq(eventNetworkingSettings.eventId, events.id))
    .where(inArray(events.id, ids));
  return rows.map((r) => ({ ...r.e, category: r.c, organization: r.o, settings: r.s ?? DEFAULT_SETTINGS(r.e.id) }));
}

export async function loadEvent(db: Executor, id: string): Promise<EventFull | null> {
  return (await loadEvents(db, [id]))[0] ?? null;
}

export const isPubliclyVisible = (e: EventFull) => e.moderationStatus === "ok" && e.organization.status === "active" && e.status !== "draft";
export const isJoinable = (e: EventFull) => isPubliclyVisible(e) && ["published", "active", "networking_paused"].includes(e.status);
export const isNetworkingOpen = (e: EventFull) => isPubliclyVisible(e) && e.status === "active";

export function networkingStatus(e: EventFull) {
  return ({ active: "open", networking_paused: "paused", ended: "ended", archived: "archived" } as Record<string, string>)[e.status] ?? "not_open";
}

export function publicEventDto(e: EventFull) {
  const open = isNetworkingOpen(e);
  return {
    id: e.id, name: e.name, categorySlug: e.category.slug, categoryName: e.category.name, description: e.description,
    bannerUrl: e.bannerUrl, venueName: e.venueName, venueAddress: e.venueAddress, city: e.city, timeZone: e.timeZone,
    startsAt: e.startsAt, endsAt: e.endsAt, website: e.website,
    organizer: { name: e.organization.name, logoUrl: e.organization.logoUrl },
    networkingStatus: networkingStatus(e),
    networkingOpensAt: new Date(e.startsAt.getTime() - NETWORKING_OPENS_BEFORE_MS),
    joinable: isJoinable(e),
    features: {
      discover: e.settings.discoverEnabled, anonymousBrowsing: e.settings.discoverEnabled && e.settings.anonymousBrowsingEnabled,
      smartMatching: e.settings.smartMatchingEnabled, pulse: e.settings.pulseEnabled, connections: e.settings.connectionsEnabled,
      messaging: e.settings.messagingEnabled, availability: e.settings.availabilityEnabled,
    },
    options: {
      discoverAvailable: open && e.settings.discoverEnabled,
      anonymousBrowsing: open && e.settings.discoverEnabled && e.settings.anonymousBrowsingEnabled,
      createProfileAvailable: isJoinable(e),
    },
  };
}

/** QR resolution (Module 1): valid | revoked | expired | disabled | event_unavailable. Unknown → 404. */
export async function resolveQr(code: string) {
  if (!code || code.length > 16 || !/^[A-Za-z0-9]+$/.test(code)) throw notFound("This QR code isn't recognised.", "qr_invalid");
  const db = getDb();
  const [qr] = await db.select().from(eventQrCodes).where(eq(eventQrCodes.publicCode, code.toUpperCase())).limit(1);
  if (!qr) throw notFound("This QR code isn't recognised.", "qr_invalid");
  const ev = await loadEvent(db, qr.eventId);
  const base = { code: qr.publicCode, qrCodeId: qr.id };
  if (!ev || !isPubliclyVisible(ev)) return { ...base, state: "event_unavailable" as const, event: null, full: null };
  if (qr.status === "revoked") return { ...base, state: "revoked" as const, event: null, full: null };
  if (qr.expiresAt && qr.expiresAt <= new Date()) return { ...base, state: "expired" as const, event: null, full: null };
  if (!ev.qrAccessEnabled) return { ...base, state: "disabled" as const, event: publicEventDto(ev), full: ev };
  if (ev.status === "archived") return { ...base, state: "event_unavailable" as const, event: publicEventDto(ev), full: ev };
  return { ...base, state: "valid" as const, event: publicEventDto(ev), full: ev };
}

export async function requireJoinableByQr(code: unknown) {
  const r = await resolveQr(typeof code === "string" ? code : "");
  if (r.state !== "valid" || !r.full) {
    throw new AppError(409, "event_not_joinable", ({
      revoked: "This QR code has been replaced by the organizer. Please scan the latest event QR code.",
      expired: "This QR code has expired.",
      disabled: "The organizer has turned off QR access for this event.",
    } as Record<string, string>)[r.state] ?? "This event isn't accepting new participants.");
  }
  if (!isJoinable(r.full)) throw new AppError(409, "event_not_joinable", "This event isn't accepting new participants.");
  return { event: r.full, qrCodeId: r.qrCodeId };
}
