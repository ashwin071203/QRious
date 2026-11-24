import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError, conflict, forbidden, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { isUuid, reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { removeMedia, saveSquareImage } from "@/server/core/media";
import { cleanText } from "@/server/lib/rules";
import { requireAttendee } from "./identity";
import { acceptedWith, blockedWith, conversationFor } from "./social";
import { notify, toAttendee } from "@/server/notifications/notify";

/**
 * Group conversations (connections-only). Rules, all enforced here:
 *  - Only the adder's ACCEPTED connections can be added; strangers can't.
 *  - Nobody is added into a group where they have a block (either way) with an existing member, and two people with a
 *    block between them are never put in the same group. A block made later hides each other's messages and presence.
 *  - Admins rename, change the photo, add/remove members and promote admins. Anyone can leave; the last admin leaving
 *    promotes the longest-standing member; an empty group is deleted.
 *  - New members only see messages from after they joined.
 */
const { conversations, conversationMembers, messages, userProfiles, attendees } = schema;
export const MAX_GROUP_MEMBERS = 50;

type Candidate = { attendeeId: string; profileId: string; displayName: string };

async function myName(db: Executor, profileId: string) {
  const [p] = await db.select({ name: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.id, profileId)).limit(1);
  return p?.name ?? "Someone";
}

function groupName(raw: unknown) {
  const name = cleanText(raw as string);
  if (!name || name.length > 60) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { name: ["Give the group a name (up to 60 characters)."] });
  return name;
}

/** Resolves profile ids to people the actor may add: accepted connections, active accounts, no block with anyone in the group. */
async function eligible(db: Executor, actor: string, profileIds: unknown, existing: string[]): Promise<Candidate[]> {
  const ids = Array.isArray(profileIds) ? [...new Set(profileIds.filter(isUuid))] : [];
  if (!ids.length) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { members: ["Choose at least one connection."] });
  const people = await db.select({ attendeeId: userProfiles.attendeeId, profileId: userProfiles.id, displayName: userProfiles.displayName, status: attendees.status })
    .from(userProfiles).innerJoin(attendees, eq(attendees.id, userProfiles.attendeeId)).where(inArray(userProfiles.id, ids));
  const connected = await acceptedWith(db, actor, people.map((p) => p.attendeeId));
  const bad: string[] = [];
  const ok: Candidate[] = [];
  for (const id of ids) {
    const p = people.find((x) => x.profileId === id);
    // Same message whatever the reason, so the check reveals nothing about anyone's blocks or account.
    if (!p || p.status !== "active" || p.attendeeId === actor || !connected.has(p.attendeeId)) { bad.push(p?.displayName ?? "Someone"); continue; }
    if (existing.includes(p.attendeeId)) continue;
    ok.push(p);
  }
  const everyone = [...new Set([...existing, ...ok.map((c) => c.attendeeId)])];
  if (everyone.length > 1) {
    const pairs = (await db.execute<{ a: string; b: string }>(sql`SELECT blocker_attendee_id AS a, blocked_attendee_id AS b FROM user_blocks
      WHERE blocker_attendee_id IN (${sql.join(everyone.map((i) => sql`${i}::uuid`), sql`, `)}) AND blocked_attendee_id IN (${sql.join(everyone.map((i) => sql`${i}::uuid`), sql`, `)})`)).rows;
    const newIds = new Set(ok.map((c) => c.attendeeId));
    for (const r of pairs) for (const x of [r.a, r.b]) if (newIds.has(x)) { const c = ok.find((k) => k.attendeeId === x)!; if (!bad.includes(c.displayName)) bad.push(c.displayName); }
  }
  if (bad.length) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { members: [`${bad.join(", ")} can't be added to this group. You can add accepted connections only.`] });
  return ok;
}

async function systemMessage(tx: Executor, conversationId: string, actor: string, body: string) {
  const [m] = await tx.insert(messages).values({ conversationId, senderAttendeeId: actor, clientMessageId: randomUUID(), kind: "system", body }).returning();
  await tx.update(conversations).set({ lastMessageId: m!.id, lastMessageAt: m!.createdAt }).where(eq(conversations.id, conversationId));
  return m!;
}

async function requireGroup(ctx: Ctx, adminOnly = false) {
  const me = await requireAttendee(ctx);
  const access = await conversationFor(ctx, ctx.params.id!, me.attendeeId);
  if (access.conv.kind !== "group") throw notFound("Group not found.");
  if (adminOnly && access.member.role !== "admin") throw forbidden("Only group admins can do this.", "group_admin_required");
  return { me, ...access };
}

export async function createGroup(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  await ctx.limit("group-create", 20, 86400, `att:${me.attendeeId}`);
  const b = await ctx.json<{ name?: string; memberProfileIds?: string[] }>();
  const name = groupName(b.name);
  const added = await eligible(ctx.db, me.attendeeId, b.memberProfileIds, [me.attendeeId]);
  if (added.length + 1 > MAX_GROUP_MEMBERS) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { members: [`Groups can have up to ${MAX_GROUP_MEMBERS} people.`] });
  const mine = await myName(ctx.db, me.profileId);
  const id = await ctx.db.transaction(async (tx) => {
    const [conv] = await tx.insert(conversations).values({ kind: "group", name, createdBy: me.attendeeId }).returning();
    await tx.insert(conversationMembers).values([
      { conversationId: conv!.id, attendeeId: me.attendeeId, role: "admin" },
      ...added.map((a) => ({ conversationId: conv!.id, attendeeId: a.attendeeId, role: "member" })),
    ]);
    const m = await systemMessage(tx, conv!.id, me.attendeeId, `${mine} created the group “${name}”`);
    await tx.update(conversationMembers).set({ lastReadMessageId: m.id }).where(eq(conversationMembers.conversationId, conv!.id));
    await notify(tx, added.map((a) => toAttendee(a.attendeeId)), { type: "group.added", category: "groups", title: `${mine} added you to “${name}”`, link: `/app/messages/${conv!.id}`,
      actorProfileId: me.profileId, actorAttendeeId: me.attendeeId, entityId: conv!.id, dedupeKey: `conv:${conv!.id}` });
    await audit(tx, { actorType: "attendee", actorId: me.attendeeId, action: "group.created", targetType: "conversation", targetId: conv!.id, data: { members: added.length + 1 } });
    return conv!.id;
  });
  return reply(201, { id });
}

export async function renameGroup(ctx: Ctx) {
  const { me, conv } = await requireGroup(ctx, true);
  const b = await ctx.json<{ name?: string }>();
  const name = groupName(b.name);
  if (name === conv.name) return { name };
  const mine = await myName(ctx.db, me.profileId);
  await ctx.db.transaction(async (tx) => {
    await tx.update(conversations).set({ name }).where(eq(conversations.id, conv.id));
    await systemMessage(tx, conv.id, me.attendeeId, `${mine} renamed the group to “${name}”`);
    const others = (await tx.select({ id: conversationMembers.attendeeId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conv.id))).map((r) => r.id).filter((x) => x !== me.attendeeId);
    await notify(tx, others.map(toAttendee), { type: "group.renamed", category: "groups", title: `Group renamed to “${name}”`, body: `by ${mine}`, link: `/app/messages/${conv.id}`,
      actorProfileId: me.profileId, actorAttendeeId: me.attendeeId, entityId: conv.id, dedupeKey: `conv:${conv.id}` });
  });
  return { name };
}

export async function setGroupPhoto(ctx: Ctx) {
  const { me, conv } = await requireGroup(ctx, true);
  const form = await ctx.req.formData().catch(() => null);
  const saved = await saveSquareImage((form?.get("file") as Blob | null) ?? null, "groups", [256]);
  const mine = await myName(ctx.db, me.profileId);
  await ctx.db.transaction(async (tx) => {
    await tx.update(conversations).set({ photoUrl: saved[256]!.url, photoKey: saved[256]!.key }).where(eq(conversations.id, conv.id));
    await systemMessage(tx, conv.id, me.attendeeId, `${mine} changed the group photo`);
  });
  await removeMedia([conv.photoUrl]);
  return { photoUrl: saved[256]!.url };
}

export async function removeGroupPhoto(ctx: Ctx) {
  const { conv } = await requireGroup(ctx, true);
  await ctx.db.update(conversations).set({ photoUrl: null, photoKey: null }).where(eq(conversations.id, conv.id));
  await removeMedia([conv.photoUrl]);
  return reply(204);
}

export async function addMembers(ctx: Ctx) {
  const { me, conv } = await requireGroup(ctx, true);
  const b = await ctx.json<{ memberProfileIds?: string[] }>();
  const mine = await myName(ctx.db, me.profileId);
  const count = await ctx.db.transaction(async (tx) => {
    await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conv.id)).for("update");
    const current = (await tx.select({ id: conversationMembers.attendeeId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conv.id))).map((r) => r.id);
    const added = await eligible(tx, me.attendeeId, b.memberProfileIds, current);
    if (!added.length) throw conflict("already_member", "They're already in this group.");
    if (current.length + added.length > MAX_GROUP_MEMBERS) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { members: [`Groups can have up to ${MAX_GROUP_MEMBERS} people.`] });
    const [{ last }] = (await tx.execute<{ last: number }>(sql`SELECT coalesce(max(id), 0)::int AS last FROM messages WHERE conversation_id = ${conv.id}`)).rows as [{ last: number }];
    await tx.insert(conversationMembers).values(added.map((a) => ({ conversationId: conv.id, attendeeId: a.attendeeId, role: "member", joinedAfterMessageId: last, lastReadMessageId: last })));
    await systemMessage(tx, conv.id, me.attendeeId, `${mine} added ${added.map((a) => a.displayName).join(", ")}`);
    await notify(tx, added.map((a) => toAttendee(a.attendeeId)), { type: "group.added", category: "groups", title: `${mine} added you to “${conv.name}”`, link: `/app/messages/${conv.id}`,
      actorProfileId: me.profileId, actorAttendeeId: me.attendeeId, entityId: conv.id, dedupeKey: `conv:${conv.id}` });
    await audit(tx, { actorType: "attendee", actorId: me.attendeeId, action: "group.members_added", targetType: "conversation", targetId: conv.id, data: { count: added.length } });
    return added.length;
  });
  return reply(201, { added: count });
}

async function memberByProfile(db: Executor, conversationId: string, profileId: string) {
  if (!isUuid(profileId)) throw notFound("Member not found.");
  const [m] = await db.select({ attendeeId: conversationMembers.attendeeId, role: conversationMembers.role, name: userProfiles.displayName })
    .from(conversationMembers).innerJoin(userProfiles, eq(userProfiles.attendeeId, conversationMembers.attendeeId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(userProfiles.id, profileId))).limit(1);
  if (!m) throw notFound("Member not found.");
  return m;
}

/** After someone leaves or is removed: keep at least one admin, and delete the group once nobody is left. */
async function settle(tx: Executor, conversationId: string) {
  const left = await tx.select().from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId)).orderBy(asc(conversationMembers.joinedAt));
  if (!left.length) { await tx.delete(conversations).where(eq(conversations.id, conversationId)); return "deleted" as const; }
  if (!left.some((m) => m.role === "admin"))
    await tx.update(conversationMembers).set({ role: "admin" }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.attendeeId, left[0]!.attendeeId)));
  return "ok" as const;
}

export async function removeMember(ctx: Ctx) {
  const { me, conv } = await requireGroup(ctx, true);
  const target = await memberByProfile(ctx.db, conv.id, ctx.params.profileId!);
  if (target.attendeeId === me.attendeeId) throw conflict("use_leave", "Use “Leave group” to leave.");
  const mine = await myName(ctx.db, me.profileId);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.attendeeId, target.attendeeId)));
    await systemMessage(tx, conv.id, me.attendeeId, `${mine} removed ${target.name}`);
    await tx.delete(schema.notifications).where(and(eq(schema.notifications.attendeeId, target.attendeeId), eq(schema.notifications.dedupeKey, `conv:${conv.id}`)));
    await notify(tx, toAttendee(target.attendeeId), { type: "group.removed", category: "groups", title: `You were removed from “${conv.name}”`, link: "/app/messages", entityId: conv.id });
    await settle(tx, conv.id);
    await audit(tx, { actorType: "attendee", actorId: me.attendeeId, action: "group.member_removed", targetType: "conversation", targetId: conv.id });
  });
  return reply(204);
}

export async function setAdmin(ctx: Ctx) {
  const { me, conv } = await requireGroup(ctx, true);
  const target = await memberByProfile(ctx.db, conv.id, ctx.params.profileId!);
  const b = await ctx.json<{ admin?: boolean }>();
  if (typeof b.admin !== "boolean") throw new AppError(400, "validation_failed", "admin must be true or false.");
  if (!b.admin && target.attendeeId === me.attendeeId) {
    const [{ n }] = (await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id = ${conv.id} AND role = 'admin'`)).rows as [{ n: number }];
    if (n <= 1) throw conflict("last_admin", "Make someone else an admin first.");
  }
  await ctx.db.update(conversationMembers).set({ role: b.admin ? "admin" : "member" })
    .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.attendeeId, target.attendeeId)));
  return reply(204);
}

export async function leaveGroup(ctx: Ctx) {
  const { me, conv } = await requireGroup(ctx);
  const mine = await myName(ctx.db, me.profileId);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.attendeeId, me.attendeeId)));
    if ((await settle(tx, conv.id)) === "ok") await systemMessage(tx, conv.id, me.attendeeId, `${mine} left`);
  });
  if (conv.photoUrl) {
    const [still] = await ctx.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conv.id)).limit(1);
    if (!still) await removeMedia([conv.photoUrl]);
  }
  return reply(204);
}

/** Accepted connections the caller can add (optionally excluding current members of a group). */
export async function groupCandidates(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const groupId = ctx.query("group");
  let exclude: string[] = [];
  if (groupId && isUuid(groupId)) {
    const { conv } = await conversationFor(ctx, groupId, me.attendeeId);
    exclude = (await ctx.db.select({ id: conversationMembers.attendeeId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conv.id))).map((r) => r.id);
  }
  const blocked = await blockedWith(ctx.db, me.attendeeId);
  const rows = (await ctx.db.execute<{ attendee_id: string; profile_id: string; display_name: string; username: string; thumb_url: string | null }>(sql`
    SELECT up.attendee_id, up.id AS profile_id, up.display_name, up.username, up.thumb_url FROM connections c
    JOIN user_profiles up ON up.attendee_id = CASE WHEN c.attendee_low_id = ${me.attendeeId} THEN c.attendee_high_id ELSE c.attendee_low_id END
    JOIN attendees a ON a.id = up.attendee_id AND a.status = 'active'
    WHERE c.status = 'accepted' AND (c.attendee_low_id = ${me.attendeeId} OR c.attendee_high_id = ${me.attendeeId}) ORDER BY up.display_name LIMIT 500`)).rows;
  return rows.filter((r) => !blocked.has(r.attendee_id) && !exclude.includes(r.attendee_id))
    .map((r) => ({ profileId: r.profile_id, displayName: r.display_name, username: r.username, thumbnailUrl: r.thumb_url }));
}
