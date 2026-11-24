import "server-only";
import { sql } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { AppError, forbidden } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import type { EventFull } from "./events-core";
import { requireParticipant } from "./participation";

/** Small-group suppression threshold (D-15): counts under K are reported as "fewer than K". */
export const K = 5;
const OPEN = ["available_now", "open_to_conversations", "meet_new_people", "quick_conversations", "looking_for_collaborators"];

export function suppress(n: number): number | null {
  return n >= K ? n : null;
}

/** Aggregates only — never individuals, never conversations (PRD M07). */
export async function computePulse(db: Executor, ev: EventFull) {
  const [totals] = (await db.execute<{ participants: number; discoverable: number; open: number; collab: number }>(sql`
    SELECT count(*)::int AS participants,
      count(*) FILTER (WHERE ep.discovery_paused = false)::int AS discoverable,
      count(*) FILTER (WHERE ea.status IN (${sql.join(OPEN.map((s) => sql`${s}`), sql`, `)}) AND ea.visibility <> 'hidden' AND ep.discovery_paused = false)::int AS open,
      count(*) FILTER (WHERE ea.status = 'looking_for_collaborators' AND ea.visibility <> 'hidden' AND ep.discovery_paused = false)::int AS collab
    FROM event_participants ep JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active'
    LEFT JOIN event_availability ea ON ea.participant_id = ep.id
    WHERE ep.event_id = ${ev.id} AND ep.status = 'active'`)).rows;

  const byStatus = (await db.execute<{ status: string; n: number }>(sql`
    SELECT ea.status, count(*)::int AS n FROM event_participants ep JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active'
    JOIN event_availability ea ON ea.participant_id = ep.id
    WHERE ep.event_id = ${ev.id} AND ep.status = 'active' AND ep.discovery_paused = false AND ea.visibility <> 'hidden' AND ea.status <> 'discovery_paused'
    GROUP BY ea.status HAVING count(*) >= ${K} ORDER BY n DESC`)).rows;

  const byIntention = (await db.execute<{ id: string; label: string; grp: string; n: number }>(sql`
    SELECT ni.id, ni.label, ni.pulse_group AS grp, count(*)::int AS n FROM event_participant_intentions pi
    JOIN networking_intentions ni ON ni.id = pi.intention_id JOIN event_participants ep ON ep.id = pi.participant_id
    JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active'
    WHERE ep.event_id = ${ev.id} AND ep.status = 'active' AND ep.discovery_paused = false
    GROUP BY ni.id, ni.label, ni.pulse_group HAVING count(*) >= ${K} ORDER BY n DESC LIMIT 12`)).rows;

  const top = async (kind: "interest" | "skill") => (await db.execute<{ name: string; n: number }>(sql`
    SELECT x.name, count(*)::int AS n FROM event_participants ep JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active'
    JOIN user_profiles up ON up.attendee_id = ep.attendee_id
    JOIN ${sql.raw(kind === "interest" ? "profile_interests" : "profile_skills")} pt ON pt.profile_id = up.id
    JOIN ${sql.raw(kind === "interest" ? "interests" : "skills")} x ON x.id = pt.${sql.raw(kind === "interest" ? "interest_id" : "skill_id")} AND x.status = 'approved'
    WHERE ep.event_id = ${ev.id} AND ep.status = 'active' AND ep.discovery_paused = false
    GROUP BY x.name HAVING count(*) >= ${K} ORDER BY n DESC, x.name LIMIT 8`)).rows;

  const activity = (await db.execute<{ kind: string; n: number }>(sql`
    SELECT kind, sum(count)::int AS n FROM event_activity_counters WHERE event_id = ${ev.id} AND bucket_start >= now() - interval '60 minutes'
    GROUP BY kind`)).rows;

  const [topInterests, topSkills] = await Promise.all([top("interest"), top("skill")]);
  const t = totals ?? { participants: 0, discoverable: 0, open: 0, collab: 0 };
  return {
    generatedAt: new Date(),
    threshold: K,
    totals: { participants: suppress(t.participants), discoverable: suppress(t.discoverable), openToTalk: suppress(t.open), lookingForCollaborators: suppress(t.collab) },
    byStatus: byStatus.map((r) => ({ status: r.status, count: r.n })),
    byIntention: byIntention.map((r) => ({ id: r.id, label: r.label, group: r.grp, count: r.n })),
    topInterests: topInterests.map((r) => ({ name: r.name, count: r.n })),
    topSkills: topSkills.map((r) => ({ name: r.name, count: r.n })),
    activityLastHour: Object.fromEntries(activity.map((r) => [r.kind, suppress(r.n)])),
  };
}

export async function attendeePulse(ctx: Ctx) {
  const { event, me } = await requireParticipant(ctx, ctx.params.eventId!);
  if (!event.settings.pulseEnabled) throw forbidden("The organizer has turned off Event Pulse for this event.", "feature_disabled");
  if (event.status === "published") throw new AppError(409, "networking_closed", "Event Pulse starts when networking opens.");
  await ctx.limit("pulse", 120, 60, `att:${me.attendeeId}`);
  return computePulse(ctx.db, event);
}

/** Landing headline: rounded, only when ≥ 10 (D-15). */
export async function headline(db: Executor, ev: EventFull) {
  if (!ev.settings.pulseEnabled || ev.participantCount < 10) return null;
  const n = ev.participantCount;
  const rounded = n >= 1000 ? Math.floor(n / 100) * 100 : n >= 100 ? Math.floor(n / 10) * 10 : Math.floor(n / 5) * 5;
  return `${rounded}+ people networking`;
}
