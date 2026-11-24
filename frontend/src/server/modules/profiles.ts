import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError, FieldErrors, conflict, isUniqueViolation, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { isUuid, reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { removeMedia, saveSquareImage } from "@/server/core/media";
import {
  USERNAME_CHANGE_COOLDOWN_MS, USERNAME_HOLD_MS, cleanText, normalizeLink, normalizeUsername, usernameCandidates, validateUsername,
} from "@/server/lib/rules";
import { createSession, issueRecoveryCode, maybeAttendee, requireAttendee, revokeAllSessions, writeAttendeeCookie } from "./identity";
import { requireJoinableByQr } from "./events-core";
import { joinInTx } from "./participation";
import { resolveTags, type TagInput } from "./taxonomy";

const { attendees, userProfiles, profileInterests, profileSkills, profileLookingForSkills, socialLinks, interests, skills, usernameHistory,
  idempotencyKeys, notificationPreferences, attendeeSessions, accountDeletionRequests } = schema;

// ---------- Shared validation ----------
type LinkInput = { platform?: string; url?: string; visibility?: string };
const VIS = schema.VISIBILITY as readonly string[];

function text(errors: FieldErrors, field: string, value: unknown, max: number, label: string, required = false) {
  if (value !== undefined && value !== null && typeof value !== "string") return errors.add(field, `${label} must be text.`);
  const v = cleanText(value);
  if (!v) { if (required) errors.add(field, `${label} is required.`); return; }
  if (v.length > max) errors.add(field, `${label} must be at most ${max} characters.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v)) errors.add(field, `${label} contains invalid characters.`);
}

function tagList(errors: FieldErrors, field: string, list: unknown, minN: number, maxN: number, label: string): TagInput[] {
  if (list !== undefined && !Array.isArray(list)) { errors.add(field, "Must be a list."); return []; }
  const arr = (list ?? []) as TagInput[];
  if (arr.length < minN) errors.add(field, `Choose at least one ${label}.`);
  if (arr.length > maxN) errors.add(field, `Choose at most ${maxN}.`);
  for (const t of arr) {
    if (!t || typeof t !== "object" || (!(t.id && isUuid(t.id)) && !(typeof t.name === "string" && t.name.trim()))) errors.add(field, "Each item needs an id or a name.");
  }
  return arr.map((t) => (t.id ? { id: t.id } : { name: t.name }));
}

function links(errors: FieldErrors, list: unknown) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) { errors.add("socialLinks", "Must be a list."); return []; }
  if (list.length > 10) errors.add("socialLinks", "Add at most 10 links.");
  const out: { platform: string; url: string; visibility: string; sortOrder: number }[] = [];
  for (const raw of (list as LinkInput[]).slice(0, 10)) {
    const platform = String(raw?.platform ?? "").toLowerCase();
    if (!(schema.SOCIAL_PLATFORMS as readonly string[]).includes(platform)) { errors.add("socialLinks", `Unknown platform "${raw?.platform}".`); continue; }
    const visibility = raw.visibility ?? "members";
    if (!VIS.includes(visibility)) { errors.add("socialLinks", "Visibility must be public, members or connections."); continue; }
    const r = normalizeLink(platform, String(raw.url ?? ""));
    if ("error" in r) { errors.add("socialLinks", r.error); continue; }
    if (out.some((l) => l.url.toLowerCase() === r.url.toLowerCase())) continue;
    out.push({ platform, url: r.url, visibility, sortOrder: out.length });
  }
  return out;
}

// ---------- Usernames ----------
async function usernameAvailable(db: Executor, u: string, attendeeId: string | null) {
  const [owner] = await db.select({ a: userProfiles.attendeeId }).from(userProfiles).where(eq(userProfiles.usernameNormalized, u)).limit(1);
  if (owner) return owner.a === attendeeId;
  const held = await db.select({ a: userProfiles.attendeeId }).from(usernameHistory).innerJoin(userProfiles, eq(userProfiles.id, usernameHistory.profileId))
    .where(and(eq(usernameHistory.usernameNormalized, u), sql`${usernameHistory.reservedUntil} > now()`));
  return held.every((h) => h.a === attendeeId);
}

export async function suggestUsernames(db: Executor, u: string) {
  const cands = usernameCandidates(u);
  const taken = new Set((await db.select({ u: userProfiles.usernameNormalized }).from(userProfiles).where(inArray(userProfiles.usernameNormalized, cands))).map((r) => r.u));
  return cands.filter((c) => !taken.has(c)).slice(0, 3);
}

export async function usernameAvailability(ctx: Ctx) {
  await ctx.limit("username", 300, 60);
  const me = await maybeAttendee(ctx);
  const n = normalizeUsername(ctx.query("u"));
  const err = validateUsername(n);
  if (err) return { available: false, normalized: n, reason: err, suggestions: [] };
  if (await usernameAvailable(ctx.db, n!, me?.attendeeId ?? null)) return { available: true, normalized: n, reason: null, suggestions: [] };
  return { available: false, normalized: n, reason: "That username is already taken.", suggestions: await suggestUsernames(ctx.db, n!) };
}

// ---------- Onboarding (PRD §3.3, §12.6) ----------
type CreateBody = {
  qrCode?: string; displayName?: string; username?: string; interests?: TagInput[]; skills?: TagInput[]; isPublic?: boolean;
  anonymousVisibilityConsent?: boolean; bio?: string; profession?: string; company?: string; location?: string; lookingForText?: string;
  canOfferText?: string; lookingForSkills?: TagInput[]; socialLinks?: LinkInput[];
};
const SCOPE = "onboarding.create_profile";

/**
 * Atomic Create My Profile: attendee, global profile, interests, skills, participation, session and recovery code are
 * created in ONE transaction or not at all. Idempotency-Key makes retries safe (PRD §12.5).
 */
export async function createProfile(ctx: Ctx) {
  if (await maybeAttendee(ctx)) {
    const me = (await maybeAttendee(ctx))!;
    throw conflict("existing_identity", "You already have a QRious profile on this device.", { profile: await profileSummary(ctx.db, me.attendeeId) });
  }
  const key = ctx.req.headers.get("idempotency-key");
  if (!isUuid(key)) throw new AppError(400, "idempotency_key_required", "An Idempotency-Key header (UUID) is required.");
  const body = await ctx.json<CreateBody>();
  const requestHash = createHash("sha256").update(JSON.stringify(body)).digest();

  const replay = await tryReplay(ctx, key, requestHash);
  if (replay) return replay;

  const errors = new FieldErrors();
  text(errors, "displayName", body.displayName, 60, "Display name", true);
  const username = normalizeUsername(body.username);
  const uErr = validateUsername(username);
  if (uErr) errors.add("username", uErr);
  const ints = tagList(errors, "interests", body.interests, 1, 20, "interest");
  const sks = tagList(errors, "skills", body.skills, 1, 20, "skill");
  const lfs = tagList(errors, "lookingForSkills", body.lookingForSkills, 0, 10, "skill");
  text(errors, "bio", body.bio, 500, "Bio");
  text(errors, "profession", body.profession, 100, "Profession");
  text(errors, "company", body.company, 100, "Company or college");
  text(errors, "location", body.location, 100, "Location");
  text(errors, "lookingForText", body.lookingForText, 500, "What you're looking for");
  text(errors, "canOfferText", body.canOfferText, 500, "What you can offer");
  const isPublic = body.isPublic !== false;
  if (isPublic && body.anonymousVisibilityConsent !== true)
    errors.add("anonymousVisibilityConsent", "Please confirm you understand who can see your profile, or turn visibility off.");
  const parsedLinks = links(errors, body.socialLinks);
  if (!body.qrCode) errors.add("qrCode", "Open this page from an event QR code.");
  errors.throwIfAny();
  // Venue Wi-Fi puts hundreds of attendees behind one IP, so the per-IP limit must stay generous.
  await ctx.limit("profile-create", 60, 600);

  const { event, qrCodeId } = await requireJoinableByQr(body.qrCode);

  try {
    const result = await ctx.db.transaction(async (tx) => {
      const now = new Date();
      // Claim the idempotency key first: a concurrent duplicate blocks here until we commit, then replays.
      await tx.insert(idempotencyKeys).values({ scope: SCOPE, key, requestHash, responseStatus: 201, responseBody: {}, expiresAt: new Date(now.getTime() + 86_400_000) });
      const [att] = await tx.insert(attendees).values({ lastActiveAt: now }).returning({ id: attendees.id });
      const attendeeId = att!.id;
      const profession = cleanText(body.profession);
      const [profile] = await tx.insert(userProfiles).values({
        attendeeId, displayName: cleanText(body.displayName)!, username: username!, usernameNormalized: username!,
        bio: cleanText(body.bio), profession, professionNormalized: profession?.toLowerCase() ?? null,
        company: cleanText(body.company), location: cleanText(body.location), lookingForText: cleanText(body.lookingForText),
        canOfferText: cleanText(body.canOfferText), isPublic, anonymousVisibilityConsentedAt: isPublic ? now : null,
      }).returning({ id: userProfiles.id, displayName: userProfiles.displayName, username: userProfiles.username });
      const profileId = profile!.id;
      if (parsedLinks.length) await tx.insert(socialLinks).values(parsedLinks.map((l) => ({ ...l, profileId })));
      await tx.insert(notificationPreferences).values({ attendeeId });

      const iIds = await resolveTags(tx, "interest", ints, attendeeId, "interests");
      const sIds = await resolveTags(tx, "skill", sks, attendeeId, "skills");
      const lIds = await resolveTags(tx, "skill", lfs, attendeeId, "lookingForSkills");
      await tx.insert(profileInterests).values(iIds.map((interestId) => ({ profileId, interestId })));
      await tx.insert(profileSkills).values(sIds.map((skillId) => ({ profileId, skillId })));
      if (lIds.length) await tx.insert(profileLookingForSkills).values(lIds.map((skillId) => ({ profileId, skillId })));

      const join = await joinInTx(tx, attendeeId, event.id, qrCodeId);
      const session = await createSession(tx, attendeeId, ctx.userAgent);
      const recoveryCode = await issueRecoveryCode(tx, attendeeId, null);
      await audit(tx, { actorType: "attendee", actorId: attendeeId, action: "attendee.profile_created", targetType: "profile", targetId: profileId, eventId: event.id, ip: ctx.ip });

      const response = { profile: { id: profileId, displayName: profile!.displayName, username: profile!.username, photo: null }, eventId: event.id, redirectTo: join.redirectTo };
      // The stored snapshot never contains the raw recovery code.
      await tx.update(idempotencyKeys).set({ attendeeId, sessionId: session.sessionId, responseBody: response })
        .where(and(eq(idempotencyKeys.scope, SCOPE), eq(idempotencyKeys.key, key)));
      return { response: { ...response, recoveryCode }, session };
    });
    writeAttendeeCookie(ctx, result.session.token, result.session.expiresAt);
    return reply(201, result.response);
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await tryReplay(ctx, key, requestHash);
      if (again) return again;
      if (isUniqueViolation(e, "ux_user_profiles_username"))
        throw conflict("username_taken", "That username is already taken.", { suggestions: await suggestUsernames(ctx.db, username!) });
    }
    throw e;
  }
}

async function tryReplay(ctx: Ctx, key: string, requestHash: Buffer) {
  const [rec] = await ctx.db.select().from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, SCOPE), eq(idempotencyKeys.key, key), sql`${idempotencyKeys.expiresAt} > now()`)).limit(1);
  if (!rec) return null;
  if (!rec.requestHash.equals(requestHash)) throw new AppError(422, "idempotency_key_reused", "This request key was already used for a different request.");
  if (!rec.sessionId) return null;
  // Original response may have been lost: within 15 minutes, re-issue a cookie for the same session (raw token is unrecoverable).
  const [s] = await ctx.db.select().from(attendeeSessions).where(eq(attendeeSessions.id, rec.sessionId)).limit(1);
  if (s && !s.revokedAt && s.expiresAt > new Date() && Date.now() - rec.createdAt.getTime() < 15 * 60_000) {
    const { newToken } = await import("@/server/lib/rules");
    const t = newToken();
    await ctx.db.update(attendeeSessions).set({ previousTokenHash: s.tokenHash, previousTokenValidUntil: new Date(Date.now() + 120_000), tokenHash: t.hash, tokenIssuedAt: new Date() })
      .where(eq(attendeeSessions.id, s.id));
    writeAttendeeCookie(ctx, t.token, s.expiresAt);
    return reply(200, { ...(rec.responseBody as object), recoveryCode: null });
  }
  throw conflict("existing_identity", "This profile was already created. Use your recovery code to sign in on this device.");
}

// ---------- Own profile ----------
export async function profileSummary(db: Executor, attendeeId: string) {
  const [p] = await db.select().from(userProfiles).where(eq(userProfiles.attendeeId, attendeeId)).limit(1);
  return p ? { id: p.id, displayName: p.displayName, username: p.username, photo: p.photoUrl ? { url: p.photoUrl, thumbnailUrl: p.thumbUrl ?? p.photoUrl } : null } : null;
}

export async function profileTags(db: Executor, profileIds: string[]) {
  if (!profileIds.length) return { interests: new Map<string, Tag[]>(), skills: new Map<string, Tag[]>(), lookingFor: new Map<string, Tag[]>() };
  const [i, s, l] = await Promise.all([
    db.select({ pid: profileInterests.profileId, id: interests.id, name: interests.name, status: interests.status }).from(profileInterests)
      .innerJoin(interests, eq(interests.id, profileInterests.interestId)).where(inArray(profileInterests.profileId, profileIds)).orderBy(asc(profileInterests.createdAt)),
    db.select({ pid: profileSkills.profileId, id: skills.id, name: skills.name, status: skills.status }).from(profileSkills)
      .innerJoin(skills, eq(skills.id, profileSkills.skillId)).where(inArray(profileSkills.profileId, profileIds)).orderBy(asc(profileSkills.createdAt)),
    db.select({ pid: profileLookingForSkills.profileId, id: skills.id, name: skills.name, status: skills.status }).from(profileLookingForSkills)
      .innerJoin(skills, eq(skills.id, profileLookingForSkills.skillId)).where(inArray(profileLookingForSkills.profileId, profileIds)),
  ]);
  const group = (rows: { pid: string; id: string; name: string; status: string }[]) => {
    const m = new Map<string, Tag[]>();
    for (const r of rows) {
      if (r.status === "rejected") continue;
      (m.get(r.pid) ?? m.set(r.pid, []).get(r.pid)!).push({ id: r.id, name: r.name, pending: r.status === "pending" });
    }
    return m;
  };
  return { interests: group(i), skills: group(s), lookingFor: group(l) };
}
export type Tag = { id: string; name: string; pending: boolean };

export async function ownProfile(db: Executor, attendeeId: string) {
  const [p] = await db.select().from(userProfiles).where(eq(userProfiles.attendeeId, attendeeId)).limit(1);
  if (!p) throw notFound("Profile not found.");
  const tags = await profileTags(db, [p.id]);
  const ls = await db.select().from(socialLinks).where(eq(socialLinks.profileId, p.id)).orderBy(asc(socialLinks.sortOrder));
  return {
    id: p.id, displayName: p.displayName, username: p.username, bio: p.bio, profession: p.profession, company: p.company, location: p.location,
    lookingForText: p.lookingForText, canOfferText: p.canOfferText,
    photo: p.photoUrl ? { url: p.photoUrl, thumbnailUrl: p.thumbUrl ?? p.photoUrl } : null,
    interests: tags.interests.get(p.id) ?? [], skills: tags.skills.get(p.id) ?? [], lookingForSkills: tags.lookingFor.get(p.id) ?? [],
    socialLinks: ls.map((l) => ({ id: l.id, platform: l.platform, url: l.url, visibility: l.visibility })),
    privacy: { isPublic: p.isPublic, anonymousVisibilityConsentedAt: p.anonymousVisibilityConsentedAt, companyVisibility: p.companyVisibility, locationVisibility: p.locationVisibility },
    usernameChangeAvailableAt: p.usernameChangedAt ? new Date(p.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS) : null,
    createdAt: p.createdAt,
  };
}

export async function updateProfile(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  await ctx.limit("profile-write", 60, 60, `att:${me.attendeeId}`);
  const b = await ctx.json<Record<string, string | undefined>>();
  const errors = new FieldErrors();
  if (b.displayName !== undefined) text(errors, "displayName", b.displayName, 60, "Display name", true);
  let newUsername: string | null = null;
  if (b.username !== undefined) {
    newUsername = normalizeUsername(b.username);
    const e = validateUsername(newUsername);
    if (e) errors.add("username", e);
  }
  for (const [f, max, label] of [["bio", 500, "Bio"], ["profession", 100, "Profession"], ["company", 100, "Company or college"], ["location", 100, "Location"],
    ["lookingForText", 500, "What you're looking for"], ["canOfferText", 500, "What you can offer"]] as const) text(errors, f, b[f], max, label);
  errors.throwIfAny();

  const db = ctx.db;
  const [p] = await db.select().from(userProfiles).where(eq(userProfiles.attendeeId, me.attendeeId)).limit(1);
  if (!p) throw notFound("Profile not found.");
  const now = new Date();
  const patch: Partial<typeof userProfiles.$inferInsert> = { updatedAt: now };
  if (b.displayName !== undefined) patch.displayName = cleanText(b.displayName)!;
  if (b.bio !== undefined) patch.bio = cleanText(b.bio);
  if (b.profession !== undefined) { patch.profession = cleanText(b.profession); patch.professionNormalized = patch.profession?.toLowerCase() ?? null; }
  if (b.company !== undefined) patch.company = cleanText(b.company);
  if (b.location !== undefined) patch.location = cleanText(b.location);
  if (b.lookingForText !== undefined) patch.lookingForText = cleanText(b.lookingForText);
  if (b.canOfferText !== undefined) patch.canOfferText = cleanText(b.canOfferText);

  try {
    await db.transaction(async (tx) => {
      if (newUsername && newUsername !== p.usernameNormalized) {
        if (p.usernameChangedAt && now.getTime() - p.usernameChangedAt.getTime() < USERNAME_CHANGE_COOLDOWN_MS)
          throw conflict("username_change_too_soon", "You can change your username once every 30 days.", { availableAt: new Date(p.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS) });
        if (!(await usernameAvailable(tx, newUsername, me.attendeeId)))
          throw conflict("username_taken", "That username is already taken.", { suggestions: await suggestUsernames(tx, newUsername) });
        await tx.insert(usernameHistory).values({ profileId: p.id, usernameNormalized: p.usernameNormalized, changedAt: now, reservedUntil: new Date(now.getTime() + USERNAME_HOLD_MS) });
        Object.assign(patch, { username: newUsername, usernameNormalized: newUsername, usernameChangedAt: now });
        await audit(tx, { actorType: "attendee", actorId: me.attendeeId, action: "profile.username_changed", targetType: "profile", targetId: p.id, data: { from: p.usernameNormalized, to: newUsername } });
      }
      await tx.update(userProfiles).set(patch).where(eq(userProfiles.id, p.id));
    });
  } catch (e) {
    if (isUniqueViolation(e, "ux_user_profiles_username")) throw conflict("username_taken", "That username is already taken.");
    throw e;
  }
  return ownProfile(db, me.attendeeId);
}

export async function replaceTags(ctx: Ctx, which: "interests" | "skills" | "looking-for-skills") {
  const me = await requireAttendee(ctx);
  await ctx.limit("profile-write", 60, 60, `att:${me.attendeeId}`);
  const body = await ctx.json<{ items?: TagInput[] }>();
  const errors = new FieldErrors();
  const field = which === "looking-for-skills" ? "lookingForSkills" : which;
  const items = tagList(errors, field, body.items ?? [], which === "looking-for-skills" ? 0 : 1, which === "looking-for-skills" ? 10 : 20, which === "interests" ? "interest" : "skill");
  errors.throwIfAny();
  await ctx.db.transaction(async (tx) => {
    const [p] = await tx.select({ id: userProfiles.id }).from(userProfiles).where(eq(userProfiles.attendeeId, me.attendeeId)).limit(1);
    if (!p) throw notFound("Profile not found.");
    const ids = await resolveTags(tx, which === "interests" ? "interest" : "skill", items, me.attendeeId, field);
    if (which === "interests") {
      await tx.delete(profileInterests).where(and(eq(profileInterests.profileId, p.id), sql`${profileInterests.interestId} NOT IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
      await tx.insert(profileInterests).values(ids.map((interestId) => ({ profileId: p.id, interestId }))).onConflictDoNothing();
    } else if (which === "skills") {
      await tx.delete(profileSkills).where(and(eq(profileSkills.profileId, p.id), sql`${profileSkills.skillId} NOT IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
      await tx.insert(profileSkills).values(ids.map((skillId) => ({ profileId: p.id, skillId }))).onConflictDoNothing();
    } else {
      await tx.delete(profileLookingForSkills).where(eq(profileLookingForSkills.profileId, p.id));
      if (ids.length) await tx.insert(profileLookingForSkills).values(ids.map((skillId) => ({ profileId: p.id, skillId })));
    }
    await tx.update(userProfiles).set({ updatedAt: new Date() }).where(eq(userProfiles.id, p.id));
  });
  return ownProfile(ctx.db, me.attendeeId);
}

export async function replaceSocialLinks(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const body = await ctx.json<{ links?: LinkInput[] }>();
  const errors = new FieldErrors();
  const parsed = links(errors, body.links ?? []);
  errors.throwIfAny();
  await ctx.db.transaction(async (tx) => {
    const [p] = await tx.select({ id: userProfiles.id }).from(userProfiles).where(eq(userProfiles.attendeeId, me.attendeeId)).limit(1);
    if (!p) throw notFound("Profile not found.");
    await tx.delete(socialLinks).where(eq(socialLinks.profileId, p.id));
    if (parsed.length) await tx.insert(socialLinks).values(parsed.map((l) => ({ ...l, profileId: p.id })));
  });
  return ownProfile(ctx.db, me.attendeeId);
}

/** Anonymous visibility can be turned off anytime; turning it on requires explicit consent (D-08). */
export async function updatePrivacy(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const b = await ctx.json<{ isPublic?: boolean; anonymousVisibilityConsent?: boolean; companyVisibility?: string; locationVisibility?: string }>();
  const errors = new FieldErrors();
  if (b.companyVisibility !== undefined && !VIS.includes(b.companyVisibility)) errors.add("companyVisibility", "Choose public, members or connections.");
  if (b.locationVisibility !== undefined && !VIS.includes(b.locationVisibility)) errors.add("locationVisibility", "Choose public, members or connections.");
  errors.throwIfAny();
  const [p] = await ctx.db.select().from(userProfiles).where(eq(userProfiles.attendeeId, me.attendeeId)).limit(1);
  if (!p) throw notFound("Profile not found.");
  const patch: Partial<typeof userProfiles.$inferInsert> = { updatedAt: new Date() };
  if (typeof b.isPublic === "boolean" && b.isPublic !== p.isPublic) {
    if (b.isPublic && b.anonymousVisibilityConsent !== true)
      throw new AppError(400, "consent_required", "Please confirm you understand that visitors without a profile will be able to see your public profile.");
    patch.isPublic = b.isPublic;
    if (b.isPublic) patch.anonymousVisibilityConsentedAt = new Date();
    await audit(ctx.db, { actorType: "attendee", actorId: me.attendeeId, action: b.isPublic ? "privacy.anonymous_visibility_on" : "privacy.anonymous_visibility_off", targetType: "profile", targetId: p.id });
  }
  if (b.companyVisibility) patch.companyVisibility = b.companyVisibility;
  if (b.locationVisibility) patch.locationVisibility = b.locationVisibility;
  await ctx.db.update(userProfiles).set(patch).where(eq(userProfiles.id, p.id));
  return (await ownProfile(ctx.db, me.attendeeId)).privacy;
}

export async function uploadPhoto(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  await ctx.limit("photo", 10, 3600, `att:${me.attendeeId}`);
  const form = await ctx.req.formData().catch(() => null);
  const saved = await saveSquareImage((form?.get("file") as Blob | null) ?? null, "profiles", [512, 128]);
  const [p] = await ctx.db.select().from(userProfiles).where(eq(userProfiles.attendeeId, me.attendeeId)).limit(1);
  if (!p) throw notFound("Profile not found.");
  await ctx.db.update(userProfiles).set({ photoUrl: saved[512]!.url, thumbUrl: saved[128]!.url, photoKey: saved[512]!.key, photoUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(userProfiles.id, p.id));
  await removeMedia([p.photoUrl, p.thumbUrl]);
  return { url: saved[512]!.url, thumbnailUrl: saved[128]!.url };
}

export async function removePhoto(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const [p] = await ctx.db.select().from(userProfiles).where(eq(userProfiles.attendeeId, me.attendeeId)).limit(1);
  if (!p?.photoUrl) return reply(204);
  await ctx.db.update(userProfiles).set({ photoUrl: null, thumbUrl: null, photoKey: null, photoUpdatedAt: new Date() }).where(eq(userProfiles.id, p.id));
  await removeMedia([p.photoUrl, p.thumbUrl]);
  return reply(204);
}

// ---------- Account deletion (D-19) ----------
export const DELETION_GRACE_MS = 14 * 86_400_000;

export async function requestDeletion(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const now = new Date();
  await ctx.db.transaction(async (tx) => {
    await tx.update(attendees).set({ status: "deactivated", deactivatedAt: now }).where(eq(attendees.id, me.attendeeId));
    await tx.insert(accountDeletionRequests).values({ attendeeId: me.attendeeId, requestedAt: now, scheduledFor: new Date(now.getTime() + DELETION_GRACE_MS) });
    await revokeAllSessions(tx, me.attendeeId, "deletion", me.sessionId);
    await audit(tx, { actorType: "attendee", actorId: me.attendeeId, action: "attendee.deletion_requested", targetType: "attendee", targetId: me.attendeeId });
  });
  return { scheduledFor: new Date(now.getTime() + DELETION_GRACE_MS) };
}

export async function cancelDeletion(ctx: Ctx) {
  const me = await requireAttendee(ctx, { allowDeactivated: true });
  await ctx.db.transaction(async (tx) => {
    const r = await tx.update(accountDeletionRequests).set({ cancelledAt: new Date() })
      .where(and(eq(accountDeletionRequests.attendeeId, me.attendeeId), sql`completed_at IS NULL AND cancelled_at IS NULL`)).returning({ id: accountDeletionRequests.id });
    if (!r.length) throw notFound("There's no pending deletion.");
    await tx.update(attendees).set({ status: "active", deactivatedAt: null }).where(and(eq(attendees.id, me.attendeeId), eq(attendees.status, "deactivated")));
  });
  return reply(204);
}

export async function deletionStatus(ctx: Ctx) {
  const me = await requireAttendee(ctx, { allowDeactivated: true });
  const [r] = await ctx.db.select().from(accountDeletionRequests)
    .where(and(eq(accountDeletionRequests.attendeeId, me.attendeeId), sql`completed_at IS NULL AND cancelled_at IS NULL`)).limit(1);
  return { pending: !!r, scheduledFor: r?.scheduledFor ?? null };
}
