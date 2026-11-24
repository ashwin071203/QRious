import "server-only";
import { sql } from "drizzle-orm";
import { schema } from "@/server/db";
import { AppError, forbidden, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { reply } from "@/server/core/http";
import { requireParticipant } from "./participation";
import { notBlocked } from "./discovery";
import { profileTags } from "./profiles";
import { hasFeature } from "./billing";

const OPEN = new Set(["available_now", "open_to_conversations", "meet_new_people", "looking_for_collaborators", "quick_conversations"]);

export type MatchInput = {
  interests: Set<string>; skills: Set<string>; lookingFor: Set<string>; intentions: Set<string>; profession: string | null;
  canOfferText: string | null; availability: string | null;
};

/**
 * Transparent rule-based score 0–100 (docs/03 §6, PRD M06). Pure function — unit tested.
 * Weights: looking-for↔offers 30, reverse fit 15, shared interests 25, shared intentions 15, profession 5, availability 5, event relevance 5.
 */
export function scoreMatch(me: MatchInput, them: MatchInput, eventTags: Set<string>, names: Map<string, string>) {
  const inter = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x));
  const reasons: { signal: string; points: number; text: string }[] = [];

  const offers = inter(me.lookingFor, them.skills);
  const offerText = them.canOfferText?.toLowerCase() ?? "";
  const textHits = [...me.lookingFor].filter((id) => !them.skills.has(id) && offerText.includes((names.get(id) ?? "").toLowerCase()) && (names.get(id) ?? "").length > 2);
  const lf = me.lookingFor.size ? Math.min(1, (offers.length + textHits.length * 0.5) / Math.min(me.lookingFor.size, 3)) : 0;
  if (lf > 0) reasons.push({ signal: "looking_for", points: 30 * lf, text: `You're looking for ${[...offers, ...textHits].map((i) => names.get(i)).filter(Boolean).slice(0, 2).join(" & ")} — they have it` });

  const reverse = inter(them.lookingFor, me.skills);
  const rv = them.lookingFor.size ? Math.min(1, reverse.length / Math.min(them.lookingFor.size, 3)) : 0;
  if (rv > 0) reasons.push({ signal: "reverse_fit", points: 15 * rv, text: `They're looking for ${reverse.map((i) => names.get(i)).slice(0, 2).join(" & ")}, which you offer` });

  const shared = inter(me.interests, them.interests);
  const si = me.interests.size && them.interests.size ? shared.length / Math.min(me.interests.size, them.interests.size) : 0;
  if (shared.length) reasons.push({ signal: "shared_interests", points: 25 * si, text: `${shared.length} shared interest${shared.length > 1 ? "s" : ""}: ${shared.map((i) => names.get(i)).slice(0, 3).join(", ")}` });

  const intents = inter(me.intentions, them.intentions);
  const it = me.intentions.size && them.intentions.size ? intents.length / Math.min(me.intentions.size, them.intentions.size) : 0;
  if (intents.length) reasons.push({ signal: "intentions", points: 15 * it, text: `Same goal here: ${intents.map((i) => names.get(i)).slice(0, 2).join(", ")}` });

  if (me.profession && them.profession && me.profession.trim().toLowerCase() === them.profession.trim().toLowerCase())
    reasons.push({ signal: "profession", points: 5, text: `Both ${them.profession}` });

  if (them.availability && OPEN.has(them.availability)) reasons.push({ signal: "availability", points: 5, text: "Open to talk right now" });

  const rel = [...them.interests, ...them.skills].filter((x) => eventTags.has(x)).length;
  if (rel) reasons.push({ signal: "event_relevance", points: Math.min(5, rel * 1.5), text: "Into what this event is about" });

  const score = Math.round(Math.min(100, reasons.reduce((s, r) => s + r.points, 0)));
  reasons.sort((a, b) => b.points - a.points);
  return { score, reasons };
}

/** Smart Matches for identified attendees (M06). Excludes self, blocked, paused, dismissed, connected. */
export async function matches(ctx: Ctx) {
  const { me, event, participant } = await requireParticipant(ctx, ctx.params.eventId!);
  if (!event.settings.smartMatchingEnabled) throw forbidden("The organizer has turned off Smart Matching for this event.", "feature_disabled");
  if (!["active", "networking_paused", "ended"].includes(event.status)) throw new AppError(409, "networking_closed", "Networking hasn't opened yet for this event.");
  await ctx.limit("matches", 60, 60, `att:${me.attendeeId}`);
  const db = ctx.db;

  const cands = (await db.execute<{ attendee_id: string; profile_id: string; participant_id: string; display_name: string; username: string; profession: string | null;
    bio: string | null; can_offer_text: string | null; thumb_url: string | null; photo_url: string | null; availability: string | null; avis: string | null }>(sql`
    SELECT ep.attendee_id, up.id AS profile_id, ep.id AS participant_id, up.display_name, up.username, up.profession, up.bio, up.can_offer_text, up.thumb_url, up.photo_url,
      ea.status AS availability, ea.visibility AS avis
    FROM event_participants ep JOIN attendees a ON a.id = ep.attendee_id AND a.status = 'active'
    JOIN user_profiles up ON up.attendee_id = ep.attendee_id LEFT JOIN event_availability ea ON ea.participant_id = ep.id
    WHERE ep.event_id = ${event.id} AND ep.status = 'active' AND ep.discovery_paused = false AND ep.attendee_id <> ${me.attendeeId}
      AND ${notBlocked(me.attendeeId, "ep.attendee_id")}
      AND NOT EXISTS (SELECT 1 FROM match_dismissals d WHERE d.attendee_id = ${me.attendeeId} AND d.event_id = ${event.id} AND d.dismissed_profile_id = up.id)
      AND NOT EXISTS (SELECT 1 FROM connections c WHERE c.status IN ('pending','accepted')
        AND c.attendee_low_id = least(ep.attendee_id, ${me.attendeeId}::uuid) AND c.attendee_high_id = greatest(ep.attendee_id, ${me.attendeeId}::uuid))
    LIMIT 2000`)).rows;

  const pids = cands.map((c) => c.profile_id);
  const tags = await profileTags(db, pids.concat(me.profileId));
  const intentRows = (await db.execute<{ participant_id: string; intention_id: string; label: string }>(sql`
    SELECT pi.participant_id, pi.intention_id, ni.label FROM event_participant_intentions pi JOIN networking_intentions ni ON ni.id = pi.intention_id
    JOIN event_participants ep ON ep.id = pi.participant_id WHERE ep.event_id = ${event.id}`)).rows;
  const evTags = (await db.execute<{ id: string }>(sql`SELECT interest_id AS id FROM event_suggested_interests WHERE event_id = ${event.id}
    UNION SELECT skill_id FROM event_suggested_skills WHERE event_id = ${event.id}
    UNION SELECT interest_id FROM category_interest_suggestions WHERE category_id = ${event.categoryId}
    UNION SELECT skill_id FROM category_skill_suggestions WHERE category_id = ${event.categoryId}`)).rows;
  const eventTags = new Set(evTags.map((r) => r.id));

  const names = new Map<string, string>();
  for (const m of [tags.interests, tags.skills, tags.lookingFor]) for (const list of m.values()) for (const t of list) names.set(t.id, t.name);
  for (const r of intentRows) names.set(r.intention_id, r.label);
  const intentsOf = (participantId: string) => new Set(intentRows.filter((r) => r.participant_id === participantId).map((r) => r.intention_id));
  const ids = (m: Map<string, { id: string }[]>, pid: string) => new Set((m.get(pid) ?? []).map((t) => t.id));

  const [myProf] = (await db.execute<{ profession: string | null; can_offer_text: string | null }>(sql`SELECT profession, can_offer_text FROM user_profiles WHERE id = ${me.profileId}`)).rows;
  const mine: MatchInput = { interests: ids(tags.interests, me.profileId), skills: ids(tags.skills, me.profileId), lookingFor: ids(tags.lookingFor, me.profileId),
    intentions: intentsOf(participant.id), profession: myProf?.profession ?? null, canOfferText: myProf?.can_offer_text ?? null, availability: participant.availability?.status ?? null };

  const detailed = await hasFeature(db, me.attendeeId, "attendee.matching.detailed");
  const scored = cands.map((c) => {
    const availabilityVisible = c.avis === "members" ? c.availability : null;
    const r = scoreMatch(mine, { interests: ids(tags.interests, c.profile_id), skills: ids(tags.skills, c.profile_id), lookingFor: ids(tags.lookingFor, c.profile_id),
      intentions: intentsOf(c.participant_id), profession: c.profession, canOfferText: c.can_offer_text, availability: availabilityVisible }, eventTags, names);
    return { c, ...r, availabilityVisible };
  }).filter((x) => x.score >= 10).sort((a, b) => b.score - a.score || a.c.display_name.localeCompare(b.c.display_name)).slice(0, 30);

  return {
    detailed,
    profileComplete: mine.lookingFor.size > 0 || mine.intentions.size > 0,
    items: scored.map(({ c, score, reasons, availabilityVisible }) => ({
      profile: { id: c.profile_id, displayName: c.display_name, username: c.username, profession: c.profession, bio: c.bio,
        photo: c.photo_url ? { url: c.photo_url, thumbnailUrl: c.thumb_url ?? c.photo_url } : null, availability: availabilityVisible },
      score,
      reasons: (detailed ? reasons : reasons.slice(0, 2)).map((r) => r.text),
      breakdown: detailed ? reasons.map((r) => ({ signal: r.signal, points: Math.round(r.points) })) : null,
    })),
  };
}

export async function dismissMatch(ctx: Ctx) {
  const { me, event } = await requireParticipant(ctx, ctx.params.eventId!);
  const profileId = ctx.params.profileId!;
  const exists = (await ctx.db.execute(sql`SELECT 1 FROM user_profiles WHERE id = ${profileId}`)).rows.length;
  if (!exists) throw notFound();
  await ctx.db.insert(schema.matchDismissals).values({ attendeeId: me.attendeeId, eventId: event.id, dismissedProfileId: profileId }).onConflictDoNothing();
  return reply(204);
}
