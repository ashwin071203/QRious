import "server-only";
import { sql } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { notify, toAttendee, toOrganizer, type Notice } from "./notify";

/**
 * Role-aware notification rules: WHO hears about WHAT. Features call these by intent ("an attendee joined",
 * "a subscription renewed"); recipients are resolved here (participants of an event, members of an organization,
 * excluding whoever did it), and every notice goes through notify().
 */
type Ev = { id: string; name: string; organizationId: string };

export async function participantsOf(db: Executor, eventId: string) {
  return (await db.execute<{ id: string }>(sql`SELECT ep.attendee_id AS id FROM event_participants ep JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active'
    WHERE ep.event_id = ${eventId} AND ep.status = 'active'`)).rows.map((r) => toAttendee(r.id));
}
export async function orgMembers(db: Executor, organizationId: string, except?: string | null) {
  return (await db.execute<{ id: string }>(sql`SELECT m.organizer_user_id AS id FROM organization_members m JOIN organizer_users u ON u.id = m.organizer_user_id AND u.status = 'active'
    WHERE m.organization_id = ${organizationId}`)).rows.filter((r) => r.id !== except).map((r) => toOrganizer(r.id));
}
async function eventById(db: Executor, eventId: string): Promise<Ev | null> {
  const [e] = (await db.execute<{ id: string; name: string; organization_id: string }>(sql`SELECT id, name, organization_id FROM events WHERE id = ${eventId}`)).rows;
  return e ? { id: e.id, name: e.name, organizationId: e.organization_id } : null;
}
const attendeeEventLink = (id: string) => `/app/events/${id}/home`;
const orgEventLink = (id: string) => `/organizer/events/${id}`;

// ---------- Event lifecycle (attendees + organizers) ----------
export type Lifecycle = "published" | "networking_open" | "paused" | "resumed" | "ended" | "unpublished" | "archived";
const ATTENDEE_TEXT: Partial<Record<Lifecycle, (n: string) => [string, string]>> = {
  networking_open: (n) => [`Networking is open at ${n}`, "Discover people, see your matches and start conversations."],
  paused: (n) => [`Networking at ${n} is paused`, "Your existing chats continue."],
  resumed: (n) => [`Networking at ${n} is back on`, "Discover and connect again."],
  ended: (n) => [`${n} has ended`, "Your connections and chats stay with you."],
  unpublished: (n) => [`${n} was cancelled or postponed`, "The organizer unpublished this event. Your connections and chats are unaffected."],
};
const ORG_TEXT: Record<Lifecycle, (n: string) => string> = {
  published: (n) => `${n} is published — its QR code is ready`, networking_open: (n) => `Networking opened at ${n}`, paused: (n) => `Networking paused at ${n}`,
  resumed: (n) => `Networking resumed at ${n}`, ended: (n) => `${n} has ended`, unpublished: (n) => `${n} was unpublished`, archived: (n) => `${n} was archived`,
};

/** actor = organizer who did it (excluded from organizer notices); null for automatic transitions. */
export async function eventLifecycle(db: Executor, eventId: string, what: Lifecycle, actor: string | null = null) {
  const e = await eventById(db, eventId);
  if (!e) return;
  const t = ATTENDEE_TEXT[what];
  if (t) {
    const [title, body] = t(e.name);
    await notify(db, await participantsOf(db, e.id), { type: `event.${what}`, category: "events", title, body, link: attendeeEventLink(e.id), eventId: e.id,
      dedupeKey: `event-status:${e.id}` });
  }
  await notify(db, await orgMembers(db, e.organizationId, actor), { type: `org.event.${what}`, category: "org_events", title: ORG_TEXT[what](e.name),
    link: orgEventLink(e.id), eventId: e.id, dedupeKey: `org-event-status:${e.id}:${what}` });
}

/** Schedule, venue or capacity changes attendees should know about. */
export async function eventChanged(db: Executor, eventId: string, fields: string[]) {
  const e = await eventById(db, eventId);
  if (!e) return;
  const when = fields.some((f) => f === "startsAt" || f === "endsAt" || f === "timeZone");
  const where = fields.some((f) => ["venueName", "venueAddress", "city"].includes(f));
  if (!when && !where) return;
  const what = when && where ? "time and place" : when ? "schedule" : "venue";
  await notify(db, await participantsOf(db, e.id), { type: "event.updated", category: "events", title: `${e.name}: ${what} changed`,
    body: "Open the event for the latest details.", link: attendeeEventLink(e.id), eventId: e.id, dedupeKey: `event-change:${e.id}` });
}

export async function eventReminder(db: Executor, eventId: string, window: "24h" | "1h") {
  const e = await eventById(db, eventId);
  if (!e) return;
  const title = window === "1h" ? `${e.name} starts within the hour` : `${e.name} is tomorrow`;
  await notify(db, await participantsOf(db, e.id), { type: `event.reminder_${window}`, category: "events", title, body: "Set your Open to Talk status so the right people find you.",
    link: attendeeEventLink(e.id), eventId: e.id, dedupeKey: `reminder-${window}:${e.id}`, mode: "once" });
  if (window === "24h") await notify(db, await orgMembers(db, e.organizationId), { type: "org.event.reminder_24h", category: "org_events", title: `${e.name} starts in about 24 hours`,
    body: "Networking opens now. Check your QR code and printouts.", link: `/organizer/qr?event=${e.id}`, eventId: e.id, dedupeKey: `org-reminder-24h:${e.id}`, mode: "once" });
}

export async function participantRemoved(db: Executor, eventId: string, attendeeId: string) {
  const e = await eventById(db, eventId);
  if (!e) return;
  await notify(db, toAttendee(attendeeId), { type: "event.removed", category: "events", title: `You were removed from ${e.name}`, body: "The organizer removed you from this event.",
    link: "/app/events", eventId: e.id });
}

// ---------- Participation (organizers + Smart Match for attendees) ----------
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export async function participantJoined(db: Executor, eventId: string, attendeeId: string, profileId: string | null) {
  const e = await eventById(db, eventId);
  if (!e) return;
  const [c] = (await db.execute<{ hour: number; total: number }>(sql`SELECT
    (SELECT count(*)::int FROM event_participants WHERE event_id = ${e.id} AND status = 'active' AND joined_at > date_trunc('hour', now())) AS hour,
    (SELECT participant_count FROM events WHERE id = ${e.id}) AS total`)).rows;
  const hour = c?.hour ?? 1, total = c?.total ?? 0;
  const members = await orgMembers(db, e.organizationId);
  // Coalesced per event per hour: "5 people joined X this hour".
  await notify(db, members, { type: "org.participant_joined", category: "org_participants", title: hour > 1 ? `${hour} people joined ${e.name} this hour` : `New attendee at ${e.name}`,
    body: `${total} participant${total === 1 ? "" : "s"} in total.`, link: `/organizer/participants?event=${e.id}`, eventId: e.id,
    dedupeKey: `joins:${e.id}:${new Date().toISOString().slice(0, 13)}` });
  const m = MILESTONES.filter((x) => x <= total).at(-1);
  if (m) await notify(db, members, { type: "org.milestone.participants", category: "org_engagement", title: `${e.name} reached ${m} participants`, link: orgEventLink(e.id),
    eventId: e.id, dedupeKey: `milestone-participants:${e.id}:${m}`, mode: "once" });
  if (profileId) await smartMatchSuggestions(db, e, attendeeId, profileId);
}

/**
 * Smart Match: tell existing participants that someone relevant joined — 2+ shared interests, or they offer a skill
 * the participant is looking for. Only when Discover and Smart Matching are on, the newcomer is discoverable, and
 * never across blocks (notify() filters those). Coalesced to one notice per person per event per day.
 */
async function smartMatchSuggestions(db: Executor, e: Ev, attendeeId: string, profileId: string) {
  const rows = (await db.execute<{ id: string }>(sql`
    SELECT ep.attendee_id AS id FROM event_participants ep
    JOIN event_networking_settings s ON s.event_id = ep.event_id AND s.discover_enabled AND s.smart_matching_enabled
    JOIN event_participants me ON me.event_id = ep.event_id AND me.attendee_id = ${attendeeId} AND me.status = 'active' AND me.discovery_paused = false
    JOIN user_profiles up ON up.attendee_id = ep.attendee_id
    WHERE ep.event_id = ${e.id} AND ep.status = 'active' AND ep.attendee_id <> ${attendeeId}
      AND ((SELECT count(*) FROM profile_interests a JOIN profile_interests b ON b.interest_id = a.interest_id WHERE a.profile_id = up.id AND b.profile_id = ${profileId}) >= 2
        OR EXISTS (SELECT 1 FROM profile_looking_for_skills l JOIN profile_skills s2 ON s2.skill_id = l.skill_id WHERE l.profile_id = up.id AND s2.profile_id = ${profileId}))
    LIMIT 500`)).rows;
  if (!rows.length) return;
  await notify(db, rows.map((r) => toAttendee(r.id)), { type: "match.new_people", category: "matches", title: `New people who match you joined ${e.name}`,
    body: "See your Smart Matches.", link: `/app/events/${e.id}/matches`, eventId: e.id, actorAttendeeId: attendeeId,
    dedupeKey: `matches:${e.id}:${new Date().toISOString().slice(0, 10)}` });
}

export async function connectionMilestone(db: Executor, eventId: string) {
  const e = await eventById(db, eventId);
  if (!e) return;
  const [{ n }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM connections WHERE origin_event_id = ${eventId} AND status = 'accepted'`)).rows as [{ n: number }];
  const m = [1, 10, 25, 50, 100, 250, 500, 1000].filter((x) => x <= n).at(-1);
  if (!m) return;
  await notify(db, await orgMembers(db, e.organizationId), { type: "org.milestone.connections", category: "org_engagement",
    title: m === 1 ? `First connection made at ${e.name}` : `${m} connections made at ${e.name}`, link: `/organizer/events/${e.id}?tab=pulse`, eventId: e.id,
    dedupeKey: `milestone-connections:${e.id}:${m}`, mode: "once" });
}

// ---------- Organizer: events, QR, moderation, allowance, team ----------
export async function eventCreated(db: Executor, eventId: string, actor: string, eventsCreated: number, unlimited: boolean, credits: number) {
  const e = await eventById(db, eventId);
  if (!e) return;
  await notify(db, await orgMembers(db, e.organizationId, actor), { type: "org.event.created", category: "org_events", title: `New event draft: ${e.name}`, link: orgEventLink(e.id), eventId: e.id });
  if (unlimited) return;
  const everyone = await orgMembers(db, e.organizationId);
  if (eventsCreated === 2) await notify(db, everyone, { type: "org.allowance.one_left", category: "org_billing", title: "1 free event left",
    body: "Your organization has used 2 of its 3 lifetime free events.", link: "/organizer/billing", dedupeKey: `allowance-one-left:${e.organizationId}`, mode: "once" });
  if (eventsCreated === 3) await notify(db, everyone, { type: "org.allowance.used", category: "org_billing", title: "All 3 free events used",
    body: "Upgrade to Pro or Business, or buy a Single Event, to create more.", link: "/organizer/billing", dedupeKey: `allowance-used:${e.organizationId}`, mode: "once" });
  if (eventsCreated > 3 && credits === 0) await notify(db, everyone, { type: "org.allowance.credits_used", category: "org_billing", title: "No event credits left",
    body: "Buy a Single Event or upgrade to create more events.", link: "/organizer/billing", dedupeKey: `credits-empty:${e.organizationId}:${eventsCreated}`, mode: "once" });
}

export async function qrChanged(db: Executor, eventId: string, what: "regenerated" | "revoked" | "paused" | "resumed", actor: string) {
  const e = await eventById(db, eventId);
  if (!e) return;
  const title = { regenerated: `QR code replaced for ${e.name}`, revoked: `QR code revoked for ${e.name}`, paused: `QR access paused for ${e.name}`, resumed: `QR access back on for ${e.name}` }[what];
  await notify(db, await orgMembers(db, e.organizationId, actor), { type: `org.qr.${what}`, category: "org_events", title,
    body: what === "regenerated" ? "Old printouts no longer work." : null, link: `/organizer/qr?event=${e.id}`, eventId: e.id });
}

/** Someone scanned a replaced/revoked QR code: the organizer probably has stale printouts. Once per event per day. */
export async function staleQrScanned(db: Executor, eventId: string) {
  const e = await eventById(db, eventId);
  if (!e) return;
  await notify(db, await orgMembers(db, e.organizationId), { type: "org.qr.stale_scan", category: "org_events", title: `Someone scanned an old QR code for ${e.name}`,
    body: "Replace old printouts with the current code.", link: `/organizer/qr?event=${e.id}`, eventId: e.id,
    dedupeKey: `stale-qr:${e.id}:${new Date().toISOString().slice(0, 10)}`, mode: "once" });
}

export async function eventModerated(db: Executor, eventId: string, suspended: boolean) {
  const e = await eventById(db, eventId);
  if (!e) return;
  await notify(db, await orgMembers(db, e.organizationId), { type: suspended ? "org.event.suspended" : "org.event.restored", category: "org_events",
    title: suspended ? `${e.name} was suspended by QRious moderators` : `${e.name} was restored`, body: suspended ? "Contact QRious support if you think this is a mistake." : null,
    link: orgEventLink(e.id), eventId: e.id });
}

export async function memberChanged(db: Executor, organizationId: string, orgName: string, memberId: string, what: "added" | "removed" | "left", actor: string) {
  if (what !== "left") await notify(db, toOrganizer(memberId), { type: `org.member.${what}`, category: "organization",
    title: what === "added" ? `You were added to ${orgName}` : `You were removed from ${orgName}`, link: what === "added" ? "/organizer/dashboard" : "/organizer/account" });
  const others = (await orgMembers(db, organizationId, actor)).filter((r) => r.id !== memberId);
  await notify(db, others, { type: `org.member.${what}`, category: "organization", title: what === "added" ? `A new member joined ${orgName}` : what === "left" ? `A member left ${orgName}` : `A member was removed from ${orgName}`,
    link: "/organizer/organization" });
}

export async function organizationStatus(db: Executor, organizationId: string, suspended: boolean) {
  const [o] = (await db.execute<{ name: string }>(sql`SELECT name FROM organizations WHERE id = ${organizationId}`)).rows;
  await notify(db, await orgMembers(db, organizationId), { type: suspended ? "org.suspended" : "org.restored", category: "organization",
    title: suspended ? `${o?.name ?? "Your organization"} was suspended` : `${o?.name ?? "Your organization"} was restored`,
    body: suspended ? "Contact QRious support." : null, link: "/organizer/organization" });
}

// ---------- Billing (both roles) ----------
export type BillingEvent = "activated" | "renewed" | "payment_failed" | "halted" | "cancelled" | "expired" | "refunded" | "credit_purchased";
const BILLING_TEXT: Record<BillingEvent, (plan: string) => [string, string | null]> = {
  activated: (p) => [`${p} is active`, "Thanks! Your payment was confirmed."],
  renewed: (p) => [`${p} renewed`, "Your payment was received."],
  payment_failed: (p) => [`${p} payment failed`, "Razorpay will retry. Please check your payment method."],
  halted: (p) => [`${p} paused — payments failed`, "Paid features are off until a payment succeeds. Nothing was deleted."],
  cancelled: (p) => [`${p} cancelled`, "Paid features continue until the end of the paid period."],
  expired: (p) => [`${p} has ended`, "You're back on the free plan. Nothing was deleted."],
  refunded: (p) => [`${p} payment refunded`, null],
  credit_purchased: () => ["Single Event purchased", "You can create one more event."],
};
export async function billingEvent(db: Executor, who: { attendeeId?: string | null; organizationId?: string | null }, what: BillingEvent, planName: string, ref: string) {
  const [title, body] = BILLING_TEXT[what](planName);
  if (who.attendeeId) await notify(db, toAttendee(who.attendeeId), { type: `billing.${what}`, category: "billing", title, body, link: "/app/premium", dedupeKey: `billing:${ref}:${what}`, mode: "once" });
  if (who.organizationId) await notify(db, await orgMembers(db, who.organizationId), { type: `org.billing.${what}`, category: "org_billing", title, body, link: "/organizer/billing",
    dedupeKey: `billing:${ref}:${what}`, mode: "once" });
}

// ---------- Security & account ----------
export async function security(db: Executor, who: { attendeeId?: string; organizerUserId?: string }, type: string, title: string, body: string | null, link: string | null) {
  const n: Notice = { type: `security.${type}`, category: "security", title, body, link };
  if (who.attendeeId) await notify(db, toAttendee(who.attendeeId), n);
  if (who.organizerUserId) await notify(db, toOrganizer(who.organizerUserId), n);
}
export async function account(db: Executor, attendeeId: string, type: string, title: string, body: string | null, link: string | null) {
  await notify(db, toAttendee(attendeeId), { type: `account.${type}`, category: "account", title, body, link });
}

// ---------- Announcements (admin) ----------
export async function announce(db: Executor, audience: "attendees" | "organizers" | "all", title: string, body: string | null, link: string | null, ref: string) {
  let count = 0;
  const n: Notice = { type: "announcement", category: "announcements", title, body, link, dedupeKey: `announcement:${ref}`, mode: "once" };
  if (audience !== "organizers") {
    const ids = (await db.execute<{ id: string }>(sql`SELECT id FROM attendees WHERE status = 'active'`)).rows.map((r) => toAttendee(r.id));
    count += await notify(db, ids, n);
  }
  if (audience !== "attendees") {
    const ids = (await db.execute<{ id: string }>(sql`SELECT id FROM organizer_users WHERE status = 'active'`)).rows.map((r) => toOrganizer(r.id));
    count += await notify(db, ids, n);
  }
  return count;
}
