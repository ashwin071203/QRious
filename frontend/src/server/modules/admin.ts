import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError, FieldErrors, conflict, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { isUuid, reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { removeMedia } from "@/server/core/media";
import { cleanTag, slugify, validateTag } from "@/server/lib/rules";
import { requireAdmin } from "./organizers";
import { revokeAllSessions } from "./identity";
import { grantPlan, revokeSource } from "./billing";

const { attendees, userProfiles, organizations, organizerUsers, organizerSessions, events, userReports, moderationActions, interests, skills, eventCategories,
  subscriptionPlans, promotionalAccess, auditLogs, accountDeletionRequests, socialLinks, profileInterests, profileSkills, profileLookingForSkills, savedProfiles } = schema;

const like = (q: string) => `%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

async function moderate(db: Executor, actorId: string, targetType: string, targetId: string, action: string, reason: string | null, reportId?: string | null) {
  await db.insert(moderationActions).values({ actorType: "admin", actorId, targetType, targetId, action, reason, reportId: reportId ?? null });
  await audit(db, { actorType: "admin", actorId, action: `admin.${action}`, targetType, targetId, data: { reason } });
}

// ---------- Users ----------
export async function searchAttendees(ctx: Ctx) {
  await requireAdmin(ctx);
  const q = ctx.query("q") ?? "";
  return (await ctx.db.execute<{ profile_id: string; attendee_id: string; display_name: string; username: string; status: string; created_at: Date; last_active_at: Date | null; events: number; reports: number }>(sql`
    SELECT up.id AS profile_id, a.id AS attendee_id, up.display_name, up.username, a.status, a.created_at, a.last_active_at,
      (SELECT count(*)::int FROM event_participants ep WHERE ep.attendee_id = a.id) AS events,
      (SELECT count(*)::int FROM user_reports r WHERE r.reported_attendee_id = a.id) AS reports
    FROM attendees a JOIN user_profiles up ON up.attendee_id = a.id
    WHERE ${q ? sql`(lower(up.display_name) LIKE ${like(q)} OR up.username_normalized LIKE ${like(q.replace(/^@/, ""))})` : sql`true`}
    ORDER BY a.created_at DESC LIMIT 100`)).rows;
}

export async function setAttendeeStatus(ctx: Ctx, suspend: boolean) {
  const admin = await requireAdmin(ctx);
  const b = await ctx.json<{ reason?: string }>();
  const [p] = await ctx.db.select({ a: userProfiles.attendeeId }).from(userProfiles).where(eq(userProfiles.id, ctx.params.profileId!)).limit(1);
  if (!p) throw notFound();
  await ctx.db.transaction(async (tx) => {
    const [a] = await tx.select().from(attendees).where(eq(attendees.id, p.a)).limit(1);
    if (a?.status === "deleted") throw conflict("deleted", "This account was deleted.");
    await tx.update(attendees).set(suspend ? { status: "suspended", suspendedReason: b.reason?.slice(0, 500) ?? null } : { status: "active", suspendedReason: null }).where(eq(attendees.id, p.a));
    if (suspend) await revokeAllSessions(tx, p.a, "suspension");
    await moderate(tx, admin.userId, "attendee", p.a, suspend ? "suspend" : "restore", b.reason ?? null);
  });
  return reply(204);
}

export async function revokeAttendeeSessions(ctx: Ctx) {
  const admin = await requireAdmin(ctx);
  const [p] = await ctx.db.select({ a: userProfiles.attendeeId }).from(userProfiles).where(eq(userProfiles.id, ctx.params.profileId!)).limit(1);
  if (!p) throw notFound();
  const n = await revokeAllSessions(ctx.db, p.a, "admin");
  await audit(ctx.db, { actorType: "admin", actorId: admin.userId, action: "admin.sessions_revoked", targetType: "attendee", targetId: p.a });
  return { revoked: n };
}

// ---------- Organizations & organizers ----------
export async function searchOrganizations(ctx: Ctx) {
  await requireAdmin(ctx);
  const q = ctx.query("q") ?? "";
  return (await ctx.db.execute<{ id: string; name: string; slug: string; status: string; created_at: Date; events: number; owner_email: string | null }>(sql`
    SELECT o.id, o.name, o.slug, o.status, o.created_at, (SELECT count(*)::int FROM events e WHERE e.organization_id = o.id) AS events,
      (SELECT u.email FROM organization_members m JOIN organizer_users u ON u.id = m.organizer_user_id WHERE m.organization_id = o.id AND m.role = 'owner' LIMIT 1) AS owner_email
    FROM organizations o WHERE ${q ? sql`lower(o.name) LIKE ${like(q)}` : sql`true`} ORDER BY o.created_at DESC LIMIT 100`)).rows;
}

export async function setOrganizationStatus(ctx: Ctx, suspend: boolean) {
  const admin = await requireAdmin(ctx);
  const b = await ctx.json<{ reason?: string }>();
  const r = await ctx.db.update(organizations).set({ status: suspend ? "suspended" : "active" }).where(eq(organizations.id, ctx.params.id!)).returning({ id: organizations.id });
  if (!r.length) throw notFound();
  await moderate(ctx.db, admin.userId, "organization", ctx.params.id!, suspend ? "suspend" : "restore", b.reason ?? null);
  return reply(204);
}

export async function searchOrganizers(ctx: Ctx) {
  await requireAdmin(ctx);
  const q = ctx.query("q") ?? "";
  return ctx.db.select({ id: organizerUsers.id, email: organizerUsers.email, displayName: organizerUsers.displayName, status: organizerUsers.status, isAdmin: organizerUsers.isAdmin, createdAt: organizerUsers.createdAt })
    .from(organizerUsers).where(q ? sql`(lower(${organizerUsers.email}) LIKE ${like(q)} OR lower(${organizerUsers.displayName}) LIKE ${like(q)})` : sql`true`)
    .orderBy(desc(organizerUsers.createdAt)).limit(100);
}

export async function setOrganizerStatus(ctx: Ctx, suspend: boolean) {
  const admin = await requireAdmin(ctx);
  if (ctx.params.id === admin.userId) throw conflict("self", "You can't suspend yourself.");
  const r = await ctx.db.update(organizerUsers).set({ status: suspend ? "suspended" : "active" }).where(eq(organizerUsers.id, ctx.params.id!)).returning({ id: organizerUsers.id });
  if (!r.length) throw notFound();
  if (suspend) await ctx.db.update(organizerSessions).set({ revokedAt: new Date() }).where(and(eq(organizerSessions.userId, ctx.params.id!), sql`revoked_at IS NULL`));
  await moderate(ctx.db, admin.userId, "organizer", ctx.params.id!, suspend ? "suspend" : "restore", null);
  return reply(204);
}

// ---------- Events ----------
export async function searchEvents(ctx: Ctx) {
  await requireAdmin(ctx);
  const q = ctx.query("q") ?? "";
  return (await ctx.db.execute<{ id: string; name: string; status: string; moderation_status: string; starts_at: Date; participant_count: number; organization: string }>(sql`
    SELECT e.id, e.name, e.status, e.moderation_status, e.starts_at, e.participant_count, o.name AS organization
    FROM events e JOIN organizations o ON o.id = e.organization_id WHERE ${q ? sql`lower(e.name) LIKE ${like(q)}` : sql`true`} ORDER BY e.created_at DESC LIMIT 100`)).rows;
}

export async function setEventModeration(ctx: Ctx, suspend: boolean) {
  const admin = await requireAdmin(ctx);
  const b = await ctx.json<{ reason?: string }>();
  const r = await ctx.db.update(events).set({ moderationStatus: suspend ? "suspended" : "ok", updatedAt: new Date() }).where(eq(events.id, ctx.params.id!)).returning({ id: events.id });
  if (!r.length) throw notFound();
  await moderate(ctx.db, admin.userId, "event", ctx.params.id!, suspend ? "suspend_event" : "restore_event", b.reason ?? null);
  return reply(204);
}

// ---------- Reports ----------
export async function listReports(ctx: Ctx) {
  await requireAdmin(ctx);
  const status = ctx.query("status") ?? "open";
  return (await ctx.db.execute<Record<string, unknown>>(sql`
    SELECT r.id, r.reason, r.details, r.status, r.escalated, r.created_at, r.message_excerpt, r.resolution_note,
      rp.display_name AS reported_name, rp.username AS reported_username, rp.id AS reported_profile_id, ra.status AS reported_status,
      sp.display_name AS reporter_name, e.name AS event_name, e.id AS event_id
    FROM user_reports r JOIN user_profiles rp ON rp.attendee_id = r.reported_attendee_id JOIN attendees ra ON ra.id = r.reported_attendee_id
    LEFT JOIN user_profiles sp ON sp.attendee_id = r.reporter_attendee_id LEFT JOIN events e ON e.id = r.event_id
    WHERE ${status === "all" ? sql`true` : status === "open" ? sql`r.status IN ('open','in_review')` : sql`r.status = ${status}`}
    ORDER BY r.escalated DESC, r.created_at DESC LIMIT 200`)).rows;
}

export async function resolveReport(ctx: Ctx, outcome: "actioned" | "dismissed" | "in_review") {
  const admin = await requireAdmin(ctx);
  const b = await ctx.json<{ note?: string; suspendUser?: boolean; deleteMessage?: boolean }>();
  await ctx.db.transaction(async (tx) => {
    const [r] = await tx.select().from(userReports).where(eq(userReports.id, ctx.params.id!)).limit(1);
    if (!r) throw notFound();
    await tx.update(userReports).set({ status: outcome, resolutionNote: b.note?.slice(0, 1000) ?? null, resolvedBy: admin.userId, resolvedAt: outcome === "in_review" ? null : new Date() }).where(eq(userReports.id, r.id));
    if (outcome === "actioned" && b.suspendUser) {
      await tx.update(attendees).set({ status: "suspended", suspendedReason: `Report ${r.reason}` }).where(eq(attendees.id, r.reportedAttendeeId));
      await revokeAllSessions(tx, r.reportedAttendeeId, "suspension");
      await moderate(tx, admin.userId, "attendee", r.reportedAttendeeId, "suspend", b.note ?? null, r.id);
    }
    if (outcome === "actioned" && b.deleteMessage && r.messageId) {
      await tx.execute(sql`UPDATE messages SET deleted_at = now() WHERE id = ${r.messageId}`);
      await moderate(tx, admin.userId, "message", r.reportedAttendeeId, "delete_message", b.note ?? null, r.id);
    }
    await moderate(tx, admin.userId, "report", r.id, outcome === "dismissed" ? "dismiss_report" : `report_${outcome}`, b.note ?? null, r.id);
  });
  return reply(204);
}

// ---------- Taxonomy & categories ----------
export async function listTags(ctx: Ctx, kind: "interest" | "skill") {
  await requireAdmin(ctx);
  const status = ctx.query("status") ?? "pending";
  const q = ctx.query("q") ?? "";
  const rows = (await ctx.db.execute<{ id: string; name: string; status: string; group_name: string | null; created_at: Date; uses: number }>(sql`
    SELECT t.id, t.name, t.status, t.group_name, t.created_at,
      (SELECT count(*)::int FROM ${sql.raw(kind === "interest" ? "profile_interests" : "profile_skills")} pt WHERE pt.${sql.raw(kind === "interest" ? "interest_id" : "skill_id")} = t.id) AS uses
    FROM ${sql.raw(kind === "interest" ? "interests" : "skills")} t
    WHERE ${status === "all" ? sql`true` : sql`t.status = ${status}`} AND ${q ? sql`t.normalized_name LIKE ${like(q)}` : sql`true`}
    ORDER BY t.created_at DESC LIMIT 200`)).rows;
  return rows;
}

export async function moderateTag(ctx: Ctx, kind: "interest" | "skill") {
  const admin = await requireAdmin(ctx);
  const t = kind === "interest" ? interests : skills;
  const b = await ctx.json<{ action?: "approve" | "reject" | "merge" | "rename"; mergeIntoId?: string; name?: string; group?: string }>();
  const id = ctx.params.id!;
  const [tag] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!tag) throw notFound();
  await ctx.db.transaction(async (tx) => {
    if (b.action === "approve") await tx.update(t).set({ status: "approved", groupName: b.group?.slice(0, 50) ?? tag.groupName }).where(eq(t.id, id));
    else if (b.action === "reject") await tx.update(t).set({ status: "rejected" }).where(eq(t.id, id));
    else if (b.action === "rename") {
      const name = cleanTag(b.name);
      const err = validateTag(name);
      if (err) throw new AppError(400, "validation_failed", err, { name: [err] });
      await tx.update(t).set({ name: name!, normalizedName: name!.toLowerCase() }).where(eq(t.id, id));
    } else if (b.action === "merge") {
      if (!isUuid(b.mergeIntoId) || b.mergeIntoId === id) throw new AppError(400, "validation_failed", "Choose a tag to merge into.");
      const [target] = await tx.select().from(t).where(eq(t.id, b.mergeIntoId)).limit(1);
      if (!target || target.status !== "approved") throw new AppError(400, "validation_failed", "Merge into an approved tag.");
      const col = kind === "interest" ? "interest_id" : "skill_id";
      const tbls = kind === "interest" ? ["profile_interests", "event_suggested_interests", "category_interest_suggestions"] : ["profile_skills", "profile_looking_for_skills", "event_suggested_skills", "category_skill_suggestions"];
      for (const tbl of tbls) {
        // Move references; drop rows that would duplicate an existing reference to the target.
        const pk = tbl.startsWith("profile") ? "profile_id" : tbl.startsWith("event") ? "event_id" : "category_id";
        await tx.execute(sql`DELETE FROM ${sql.raw(tbl)} x WHERE x.${sql.raw(col)} = ${id} AND EXISTS (SELECT 1 FROM ${sql.raw(tbl)} y WHERE y.${sql.raw(pk)} = x.${sql.raw(pk)} AND y.${sql.raw(col)} = ${b.mergeIntoId})`);
        await tx.execute(sql`UPDATE ${sql.raw(tbl)} SET ${sql.raw(col)} = ${b.mergeIntoId} WHERE ${sql.raw(col)} = ${id}`);
      }
      await tx.update(t).set({ status: "merged", mergedIntoId: b.mergeIntoId }).where(eq(t.id, id));
    } else throw new AppError(400, "validation_failed", "Unknown action.");
    await moderate(tx, admin.userId, kind, id, `${b.action}_tag`, null);
  });
  return reply(204);
}

export async function createTag(ctx: Ctx, kind: "interest" | "skill") {
  const admin = await requireAdmin(ctx);
  const b = await ctx.json<{ name?: string; group?: string }>();
  const name = cleanTag(b.name);
  const err = validateTag(name);
  if (err) throw new AppError(400, "validation_failed", err, { name: [err] });
  const t = kind === "interest" ? interests : skills;
  const r = await ctx.db.insert(t).values({ name: name!, normalizedName: name!.toLowerCase(), status: "approved", groupName: b.group?.slice(0, 50) ?? null }).onConflictDoNothing().returning({ id: t.id });
  if (!r.length) throw conflict("exists", "That already exists.");
  await audit(ctx.db, { actorType: "admin", actorId: admin.userId, action: `admin.${kind}_created`, targetType: kind, targetId: r[0]!.id });
  return reply(201, { id: r[0]!.id });
}

export async function listCategoriesAdmin(ctx: Ctx) {
  await requireAdmin(ctx);
  return ctx.db.select().from(eventCategories).orderBy(eventCategories.sortOrder);
}

export async function upsertCategory(ctx: Ctx) {
  const admin = await requireAdmin(ctx);
  const b = await ctx.json<{ name?: string; description?: string; isActive?: boolean; sortOrder?: number }>();
  const errors = new FieldErrors();
  const name = b.name?.trim();
  if (b.name !== undefined && (!name || name.length > 80)) errors.add("name", "Enter a name (up to 80 characters).");
  errors.throwIfAny();
  if (ctx.params.id) {
    const patch: Partial<typeof eventCategories.$inferInsert> = {};
    if (name) patch.name = name;
    if (b.description !== undefined) patch.description = b.description?.slice(0, 300) ?? null;
    if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
    if (Number.isInteger(b.sortOrder)) patch.sortOrder = b.sortOrder!;
    const r = await ctx.db.update(eventCategories).set(patch).where(eq(eventCategories.id, ctx.params.id)).returning();
    if (!r.length) throw notFound();
    await audit(ctx.db, { actorType: "admin", actorId: admin.userId, action: "admin.category_updated", targetType: "category", targetId: ctx.params.id });
    return r[0];
  }
  if (!name) throw new AppError(400, "validation_failed", "Enter a name.", { name: ["Enter a name."] });
  const r = await ctx.db.insert(eventCategories).values({ name, slug: slugify(name), description: b.description?.slice(0, 300) ?? null, imageUrl: "/images/categories/other.webp", sortOrder: 100 })
    .onConflictDoNothing().returning();
  if (!r.length) throw conflict("exists", "A category with that name exists.");
  await audit(ctx.db, { actorType: "admin", actorId: admin.userId, action: "admin.category_created", targetType: "category", targetId: r[0]!.id });
  return reply(201, r[0]);
}

// ---------- System, audit, billing ----------
export async function systemOverview(ctx: Ctx) {
  await requireAdmin(ctx);
  const t0 = Date.now();
  const [c] = (await ctx.db.execute<Record<string, number>>(sql`SELECT
    (SELECT count(*)::int FROM attendees) AS attendees, (SELECT count(*)::int FROM attendees WHERE created_at > now() - interval '24 hours') AS attendees_24h,
    (SELECT count(*)::int FROM organizations) AS organizations, (SELECT count(*)::int FROM events) AS events,
    (SELECT count(*)::int FROM events WHERE status IN ('active','networking_paused')) AS live_events,
    (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours') AS messages_24h,
    (SELECT count(*)::int FROM connections WHERE status = 'accepted' AND responded_at > now() - interval '24 hours') AS connections_24h,
    (SELECT count(*)::int FROM user_reports WHERE status IN ('open','in_review')) AS open_reports,
    (SELECT count(*)::int FROM interests WHERE status = 'pending') + (SELECT count(*)::int FROM skills WHERE status = 'pending') AS pending_tags`)).rows;
  return { counts: c, health: { database: "ok", dbLatencyMs: Date.now() - t0, payments: process.env.RAZORPAY_KEY_ID ? "configured" : "not_configured", storage: process.env.BLOB_READ_WRITE_TOKEN ? "vercel_blob" : "local" } };
}

export async function auditLog(ctx: Ctx) {
  await requireAdmin(ctx);
  const action = ctx.query("action");
  return ctx.db.select({ id: auditLogs.id, occurredAt: auditLogs.occurredAt, actorType: auditLogs.actorType, actorId: auditLogs.actorId, action: auditLogs.action,
    targetType: auditLogs.targetType, targetId: auditLogs.targetId, eventId: auditLogs.eventId, data: auditLogs.data })
    .from(auditLogs).where(action ? sql`${auditLogs.action} LIKE ${like(action)}` : sql`true`).orderBy(desc(auditLogs.id)).limit(200);
}

export async function billingOverview(ctx: Ctx) {
  await requireAdmin(ctx);
  // Revenue from verified (captured) payments only, net of refunds (§21).
  const [r] = (await ctx.db.execute<Record<string, number>>(sql`SELECT
    coalesce(sum(amount_minor - refunded_minor) FILTER (WHERE status IN ('captured','partially_refunded')), 0)::int AS revenue_minor,
    coalesce(sum(tax_minor) FILTER (WHERE status = 'captured'), 0)::int AS tax_minor,
    coalesce(sum(fee_minor) FILTER (WHERE status = 'captured'), 0)::int AS fee_minor,
    count(*) FILTER (WHERE status = 'failed')::int AS failed_payments FROM payments`)).rows;
  const [s] = (await ctx.db.execute<Record<string, number>>(sql`SELECT
    count(*) FILTER (WHERE s.status = 'active')::int AS active,
    count(*) FILTER (WHERE s.status IN ('cancelled','completed','expired'))::int AS cancelled,
    count(*) FILTER (WHERE s.status = 'active' AND s.subscriber_type = 'attendee')::int AS premium_attendees,
    count(*) FILTER (WHERE s.status = 'active' AND s.subscriber_type = 'organization')::int AS paid_orgs,
    coalesce(sum(CASE WHEN p.billing_period = 'month' THEN p.price_minor WHEN p.billing_period = 'year' THEN p.price_minor / 12 ELSE 0 END) FILTER (WHERE s.status = 'active'), 0)::int AS mrr_minor
    FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id`)).rows;
  const monthly = (await ctx.db.execute<{ month: string; revenue_minor: number }>(sql`SELECT to_char(date_trunc('month', captured_at), 'YYYY-MM') AS month,
    sum(amount_minor - refunded_minor)::int AS revenue_minor FROM payments WHERE status IN ('captured','partially_refunded') AND captured_at > now() - interval '12 months'
    GROUP BY 1 ORDER BY 1`)).rows;
  const popular = (await ctx.db.execute<{ name: string; n: number }>(sql`SELECT p.name, count(*)::int AS n FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
    WHERE s.status = 'active' GROUP BY p.name ORDER BY n DESC LIMIT 5`)).rows;
  const [{ attendees: totalAttendees }] = (await ctx.db.execute<{ attendees: number }>(sql`SELECT count(*)::int AS attendees FROM attendees WHERE status = 'active'`)).rows as [{ attendees: number }];
  const promos = await ctx.db.select({ p: promotionalAccess, plan: subscriptionPlans.name, profile: userProfiles.username, org: organizations.name }).from(promotionalAccess)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, promotionalAccess.planId))
    .leftJoin(userProfiles, eq(userProfiles.attendeeId, promotionalAccess.attendeeId)).leftJoin(organizations, eq(organizations.id, promotionalAccess.organizationId))
    .orderBy(desc(promotionalAccess.startsAt)).limit(100);
  return {
    paymentsEnabled: !!process.env.RAZORPAY_KEY_ID,
    revenue: { ...r, mrrMinor: s?.mrr_minor ?? 0, arrMinor: (s?.mrr_minor ?? 0) * 12 },
    subscriptions: s, conversionRate: totalAttendees ? Math.round(((s?.premium_attendees ?? 0) / totalAttendees) * 1000) / 10 : 0,
    monthly, popularPlans: popular,
    promotions: promos.map((x) => ({ id: x.p.id, plan: x.plan, subject: x.profile ? `@${x.profile}` : x.org, startsAt: x.p.startsAt, endsAt: x.p.endsAt, revokedAt: x.p.revokedAt, reason: x.p.reason })),
    plans: await ctx.db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder),
  };
}

export async function grantPromotion(ctx: Ctx) {
  const admin = await requireAdmin(ctx);
  const b = await ctx.json<{ username?: string; organizationId?: string; planCode?: string; days?: number; reason?: string }>();
  const days = Number(b.days);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new AppError(400, "validation_failed", "Choose 1–366 days.", { days: ["Choose 1–366 days."] });
  const [plan] = await ctx.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, b.planCode ?? "")).limit(1);
  if (!plan) throw new AppError(400, "validation_failed", "Unknown plan.", { planCode: ["Unknown plan."] });
  let attendeeId: string | null = null, organizationId: string | null = null;
  if (plan.audience === "attendee") {
    const [p] = await ctx.db.select({ a: userProfiles.attendeeId }).from(userProfiles).where(eq(userProfiles.usernameNormalized, (b.username ?? "").trim().replace(/^@/, "").toLowerCase())).limit(1);
    if (!p) throw new AppError(400, "validation_failed", "Unknown username.", { username: ["Unknown username."] });
    attendeeId = p.a;
  } else {
    if (!isUuid(b.organizationId)) throw new AppError(400, "validation_failed", "Choose an organization.", { organizationId: ["Choose an organization."] });
    organizationId = b.organizationId;
  }
  const endsAt = new Date(Date.now() + days * 86_400_000);
  const id = await ctx.db.transaction(async (tx) => {
    const [promo] = await tx.insert(promotionalAccess).values({ subscriberType: plan.audience, attendeeId, organizationId, planId: plan.id, grantedBy: admin.userId, reason: b.reason?.slice(0, 500) ?? null, startsAt: new Date(), endsAt }).returning({ id: promotionalAccess.id });
    await grantPlan(tx, { attendeeId, organizationId }, plan.id, "promo", promo!.id, endsAt);
    await audit(tx, { actorType: "admin", actorId: admin.userId, action: "admin.promo_granted", targetType: "promotional_access", targetId: promo!.id, data: { plan: plan.code, days } });
    return promo!.id;
  });
  return reply(201, { id });
}

export async function revokePromotion(ctx: Ctx) {
  const admin = await requireAdmin(ctx);
  await ctx.db.transaction(async (tx) => {
    const r = await tx.update(promotionalAccess).set({ revokedAt: new Date(), revokedBy: admin.userId }).where(and(eq(promotionalAccess.id, ctx.params.id!), sql`revoked_at IS NULL`)).returning({ id: promotionalAccess.id });
    if (!r.length) throw notFound();
    await revokeSource(tx, ctx.params.id!);
    await audit(tx, { actorType: "admin", actorId: admin.userId, action: "admin.promo_revoked", targetType: "promotional_access", targetId: ctx.params.id });
  });
  return reply(204);
}

// ---------- Scheduled maintenance (daily cron) ----------
/** Anonymizes accounts whose 14-day deletion grace period has passed (D-19) and prunes expired rows. */
export async function runMaintenance(db: Executor) {
  const due = await db.select().from(accountDeletionRequests).where(sql`completed_at IS NULL AND cancelled_at IS NULL AND scheduled_for <= now()`).limit(200);
  for (const d of due) {
    await db.transaction(async (tx) => {
      const [p] = await tx.select().from(userProfiles).where(eq(userProfiles.attendeeId, d.attendeeId)).limit(1);
      if (p) {
        await removeMedia([p.photoUrl, p.thumbUrl]);
        await tx.delete(socialLinks).where(eq(socialLinks.profileId, p.id));
        await tx.delete(profileInterests).where(eq(profileInterests.profileId, p.id));
        await tx.delete(profileSkills).where(eq(profileSkills.profileId, p.id));
        await tx.delete(profileLookingForSkills).where(eq(profileLookingForSkills.profileId, p.id));
        await tx.delete(savedProfiles).where(eq(savedProfiles.savedProfileId, p.id));
        // Username released after its 30-day hold via username_history; profile row anonymized.
        const anon = `deleted_${p.id.replace(/-/g, "").slice(0, 20)}`;
        await tx.execute(sql`INSERT INTO username_history (profile_id, username_normalized, changed_at, reserved_until) VALUES (${p.id}, ${p.usernameNormalized}, now(), now() + interval '30 days')`);
        await tx.update(userProfiles).set({ displayName: "Deleted user", username: anon, usernameNormalized: anon, bio: null, profession: null, professionNormalized: null, company: null,
          location: null, lookingForText: null, canOfferText: null, photoUrl: null, thumbUrl: null, photoKey: null, isPublic: false }).where(eq(userProfiles.id, p.id));
      }
      await tx.execute(sql`UPDATE event_participants SET status = 'left', left_at = now() WHERE attendee_id = ${d.attendeeId} AND status = 'active'`);
      await tx.execute(sql`UPDATE events e SET participant_count = (SELECT count(*) FROM event_participants ep WHERE ep.event_id = e.id AND ep.status = 'active')
        WHERE e.id IN (SELECT event_id FROM event_participants WHERE attendee_id = ${d.attendeeId})`);
      await tx.execute(sql`UPDATE connections SET status = 'removed', removed_at = now() WHERE status IN ('pending','accepted') AND (requester_attendee_id = ${d.attendeeId} OR addressee_attendee_id = ${d.attendeeId})`);
      await tx.update(attendees).set({ status: "deleted", deletedAt: new Date() }).where(eq(attendees.id, d.attendeeId));
      await revokeAllSessions(tx, d.attendeeId, "deletion");
      await tx.update(accountDeletionRequests).set({ completedAt: new Date() }).where(eq(accountDeletionRequests.id, d.id));
      await audit(tx, { actorType: "system", action: "attendee.deleted", targetType: "attendee", targetId: d.attendeeId });
    });
  }
  await db.execute(sql`DELETE FROM idempotency_keys WHERE expires_at < now()`);
  await db.execute(sql`DELETE FROM rate_limit_counters WHERE window_start < now() - interval '2 days'`);
  await db.execute(sql`DELETE FROM attendee_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days') OR absolute_expires_at < now() - interval '30 days'`);
  await db.execute(sql`DELETE FROM event_activity_counters WHERE bucket_start < now() - interval '90 days'`);
  const { syncStatuses } = await import("./events-core");
  await syncStatuses(db);
  return { anonymized: due.length };
}
