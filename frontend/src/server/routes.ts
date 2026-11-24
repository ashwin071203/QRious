import "server-only";
import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { compile, reply, type Ctx, type Route } from "@/server/core/http";
import { forbidden } from "@/server/core/errors";
import * as identity from "./modules/identity";
import * as taxonomy from "./modules/taxonomy";
import * as core from "./modules/events-core";
import * as participation from "./modules/participation";
import * as profiles from "./modules/profiles";
import * as discovery from "./modules/discovery";
import * as matching from "./modules/matching";
import * as pulse from "./modules/pulse";
import * as social from "./modules/social";
import * as organizers from "./modules/organizers";
import * as ev from "./modules/events-admin";
import * as admin from "./modules/admin";
import * as billing from "./modules/billing";

const R = (method: Route["method"], path: string, handler: (ctx: Ctx) => Promise<unknown>, csrfExempt = false): Route => ({ method, path, handler, csrfExempt });

const routes: Route[] = [
  // ---------- Public / QR entry (M01, M05 anonymous) ----------
  R("GET", "/public/qr/:code", async (ctx) => {
    await ctx.limit("public-qr", 600, 60);
    const r = await core.resolveQr(ctx.params.code!);
    const head = r.full && r.state === "valid" ? await pulse.headline(ctx.db, r.full) : null;
    return { state: r.state, code: r.code, event: r.event ? { ...r.event, headline: head } : null };
  }),
  R("GET", "/public/categories", () => taxonomy.categories()),
  R("GET", "/public/events/:code/people", discovery.publicPeople),
  R("GET", "/public/events/:code/people/:profileId", discovery.publicPerson),
  R("GET", "/public/events/:code/facets", discovery.publicFacets),
  R("GET", "/taxonomy/interests", (ctx) => taxonomy.searchTags("interest", ctx.query("q"), ctx.query("eventId"), ctx.query("categoryId"), Number(ctx.query("limit")))),
  R("GET", "/taxonomy/skills", (ctx) => taxonomy.searchTags("skill", ctx.query("q"), ctx.query("eventId"), ctx.query("categoryId"), Number(ctx.query("limit")))),

  // ---------- Identity & onboarding (M02) ----------
  R("GET", "/onboarding/username-availability", profiles.usernameAvailability),
  R("POST", "/onboarding/profile", profiles.createProfile),
  R("POST", "/recovery", async (ctx) => {
    await ctx.limit("recovery", 30, 900);
    const b = await ctx.json<{ username?: string; recoveryCode?: string }>();
    return { ...(await identity.recoverAccount(ctx, b.username, b.recoveryCode)), redirectTo: "/app" };
  }),
  R("GET", "/me/session", async (ctx) => {
    const me = await identity.maybeAttendee(ctx);
    if (!me) return { authenticated: false, profile: null, isParticipant: null, status: null };
    const eventId = ctx.query("eventId");
    return {
      authenticated: true, status: me.status, profile: await profiles.profileSummary(ctx.db, me.attendeeId),
      isParticipant: eventId && /^[0-9a-f-]{36}$/i.test(eventId) ? await participation.isActiveParticipant(ctx.db, eventId, me.attendeeId) : null,
    };
  }),
  R("POST", "/me/session/logout", async (ctx) => {
    const me = await identity.maybeAttendee(ctx);
    if (me) await identity.revokeSession(ctx.db, me.sessionId, me.attendeeId, "logout");
    ctx.clearCookie(identity.ATTENDEE_COOKIE);
    return reply(204);
  }),
  R("GET", "/me/sessions", async (ctx) => { const me = await identity.requireAttendee(ctx); return identity.listSessions(ctx.db, me.attendeeId, me.sessionId); }),
  R("DELETE", "/me/sessions/:sessionId", async (ctx) => {
    const me = await identity.requireAttendee(ctx);
    await identity.revokeSession(ctx.db, ctx.params.sessionId!, me.attendeeId, "user_revoked");
    if (ctx.params.sessionId === me.sessionId) ctx.clearCookie(identity.ATTENDEE_COOKIE);
    return reply(204);
  }),
  R("POST", "/me/sessions/revoke-others", async (ctx) => { const me = await identity.requireAttendee(ctx); return { revoked: await identity.revokeAllSessions(ctx.db, me.attendeeId, "user_revoked", me.sessionId) }; }),
  R("GET", "/me/recovery-code/status", async (ctx) => {
    const me = await identity.requireAttendee(ctx);
    const [active] = await ctx.db.select({ createdAt: schema.attendeeRecoveryCodes.createdAt }).from(schema.attendeeRecoveryCodes)
      .where(and(eq(schema.attendeeRecoveryCodes.attendeeId, me.attendeeId), eq(schema.attendeeRecoveryCodes.status, "active"))).limit(1);
    return { hasActiveCode: !!active, createdAt: active?.createdAt ?? null };
  }),
  R("POST", "/me/recovery-code/regenerate", async (ctx) => {
    const me = await identity.requireAttendee(ctx);
    await ctx.limit("recovery-regen", 10, 3600, `att:${me.attendeeId}`);
    return { recoveryCode: await ctx.db.transaction((tx) => identity.issueRecoveryCode(tx, me.attendeeId, "rotated")) };
  }),

  // ---------- Profile & privacy (M03, M12) ----------
  R("GET", "/me/profile", async (ctx) => { const me = await identity.requireAttendee(ctx); return profiles.ownProfile(ctx.db, me.attendeeId); }),
  R("PATCH", "/me/profile", profiles.updateProfile),
  R("PUT", "/me/profile/interests", (ctx) => profiles.replaceTags(ctx, "interests")),
  R("PUT", "/me/profile/skills", (ctx) => profiles.replaceTags(ctx, "skills")),
  R("PUT", "/me/profile/looking-for-skills", (ctx) => profiles.replaceTags(ctx, "looking-for-skills")),
  R("PUT", "/me/profile/social-links", profiles.replaceSocialLinks),
  R("PUT", "/me/profile/photo", profiles.uploadPhoto),
  R("DELETE", "/me/profile/photo", profiles.removePhoto),
  R("GET", "/me/privacy", async (ctx) => { const me = await identity.requireAttendee(ctx); return (await profiles.ownProfile(ctx.db, me.attendeeId)).privacy; }),
  R("PATCH", "/me/privacy", profiles.updatePrivacy),
  R("GET", "/me/deletion-request", profiles.deletionStatus),
  R("POST", "/me/deletion-request", profiles.requestDeletion),
  R("DELETE", "/me/deletion-request", profiles.cancelDeletion),
  R("GET", "/me/notification-preferences", social.getPreferences),
  R("PUT", "/me/notification-preferences", social.putPreferences),

  // ---------- Participation & availability (M04, M08) ----------
  R("GET", "/me/events", participation.myEvents),
  R("GET", "/events/:eventId", (ctx) => participation.getMyEvent(ctx, ctx.params.eventId!)),
  R("POST", "/events/:eventId/participation", (ctx) => participation.joinEvent(ctx, ctx.params.eventId!)),
  R("DELETE", "/events/:eventId/participation", async (ctx) => { await participation.leaveEvent(ctx, ctx.params.eventId!); return reply(204); }),
  R("PATCH", "/events/:eventId/me", (ctx) => participation.updateMyParticipation(ctx, ctx.params.eventId!)),

  // ---------- Discovery, matching, pulse (M05–M07) ----------
  R("GET", "/events/:eventId/people", discovery.memberPeople),
  R("GET", "/events/:eventId/people/:profileId", discovery.memberPerson),
  R("GET", "/events/:eventId/matches", matching.matches),
  R("POST", "/events/:eventId/matches/:profileId/dismiss", matching.dismissMatch),
  R("GET", "/events/:eventId/pulse", pulse.attendeePulse),
  R("GET", "/people/:profileId", discovery.connectionProfile),
  R("GET", "/me/saved-profiles", discovery.listSaved),
  R("PUT", "/me/saved-profiles/:profileId", discovery.saveProfile),
  R("DELETE", "/me/saved-profiles/:profileId", discovery.unsaveProfile),
  R("GET", "/me/saved-by", discovery.savedBy),

  // ---------- Connections, messaging, notifications, safety (M09–M12) ----------
  R("POST", "/events/:eventId/connections", social.requestConnection),
  R("GET", "/me/connections", social.listConnections),
  R("POST", "/connections/:id/accept", (ctx) => social.respondConnection(ctx, "accept")),
  R("POST", "/connections/:id/decline", (ctx) => social.respondConnection(ctx, "decline")),
  R("POST", "/connections/:id/withdraw", (ctx) => social.respondConnection(ctx, "withdraw")),
  R("DELETE", "/connections/:id", social.removeConnection),
  R("GET", "/conversations", social.listConversations),
  R("POST", "/conversations", social.startConversation),
  R("GET", "/conversations/:id/messages", social.getMessages),
  R("POST", "/conversations/:id/messages", social.sendMessage),
  R("POST", "/conversations/:id/read", social.markRead),
  R("POST", "/conversations/:id/typing", social.typing),
  R("GET", "/me/unread-counts", social.unreadCounts),
  R("GET", "/me/notifications", social.listNotifications),
  R("POST", "/me/notifications/read-all", social.markAllNotificationsRead),
  R("POST", "/me/notifications/:id/read", social.markNotificationRead),
  R("GET", "/me/blocks", social.listBlocks),
  R("PUT", "/me/blocks/:profileId", social.block),
  R("DELETE", "/me/blocks/:profileId", social.unblock),
  R("POST", "/reports", social.report),

  // ---------- Billing (M18) ----------
  R("GET", "/plans", billing.listPlans),
  R("GET", "/me/billing", billing.myBilling),
  R("GET", "/entitlements", async (ctx) => { const me = await identity.requireAttendee(ctx); return billing.effectiveEntitlements(ctx.db, { attendeeId: me.attendeeId }); }),
  R("POST", "/subscriptions/checkout", billing.checkout),
  R("POST", "/subscriptions/cancel", billing.cancelSubscription),
  R("POST", "/payments/webhook/razorpay", billing.razorpayWebhook, true),

  // ---------- Organizers (M13) ----------
  R("POST", "/organizer/auth/register", organizers.register),
  R("POST", "/organizer/auth/login", organizers.login),
  R("POST", "/organizer/auth/logout", organizers.logout),
  R("POST", "/organizer/auth/recover", organizers.recoverOrganizer),
  R("POST", "/organizer/auth/change-password", organizers.changePassword),
  R("POST", "/organizer/auth/recovery-code", organizers.regenerateOrgRecovery),
  R("POST", "/organizer/auth/bootstrap-admin", organizers.bootstrapAdmin),
  R("POST", "/organizer/auth/mfa/setup", organizers.mfaSetup),
  R("POST", "/organizer/auth/mfa/enable", organizers.mfaEnable),
  R("POST", "/organizer/auth/mfa/verify", organizers.mfaVerify),
  R("GET", "/organizer/me", organizers.organizerMe),
  R("POST", "/organizations", organizers.createOrganization),
  R("GET", "/organizations/:orgId", organizers.getOrganization),
  R("PATCH", "/organizations/:orgId", organizers.updateOrganization),
  R("PUT", "/organizations/:orgId/logo", organizers.uploadLogo),
  R("DELETE", "/organizations/:orgId/logo", organizers.removeLogo),
  R("GET", "/organizations/:orgId/dashboard", organizers.dashboard),
  R("GET", "/organizations/:orgId/events", ev.listOrgEvents),
  R("POST", "/organizations/:orgId/events", ev.createEvent),
  R("GET", "/organizations/:orgId/billing", billing.orgBilling),
  R("POST", "/organizations/:orgId/billing/checkout", billing.orgCheckout),
  R("POST", "/organizations/:orgId/billing/cancel", billing.orgCancelSubscription),
  R("POST", "/organizations/:orgId/billing/event-credits/order", billing.eventCreditOrder),
  R("POST", "/organizations/:orgId/billing/event-credits/verify", billing.eventCreditVerify),
  R("GET", "/organizations/:orgId/members", organizers.listMembers),
  R("POST", "/organizations/:orgId/members", organizers.addMember),
  R("DELETE", "/organizations/:orgId/members/:userId", organizers.removeMember),
  R("GET", "/organizations/:orgId/analytics", organizers.orgAnalytics),

  // ---------- Event management, QR, configuration, participants (M14–M17) ----------
  R("GET", "/organizer/events/:eventId", ev.getEvent),
  R("PATCH", "/organizer/events/:eventId", ev.updateEvent),
  R("DELETE", "/organizer/events/:eventId", ev.deleteEvent),
  R("PUT", "/organizer/events/:eventId/banner", ev.uploadBanner),
  R("DELETE", "/organizer/events/:eventId/banner", ev.removeBanner),
  ...(["publish", "unpublish", "pause", "resume", "start", "end", "archive"] as const).map((a) => R("POST", `/organizer/events/:eventId/${a}`, (ctx) => ev.transition(ctx, a))),
  R("PUT", "/organizer/events/:eventId/networking-settings", ev.updateSettings),
  R("POST", "/organizer/events/:eventId/networking-settings/reset-defaults", ev.resetSettings),
  R("PUT", "/organizer/events/:eventId/suggestions", ev.updateSuggestions),
  R("GET", "/organizer/events/:eventId/qr/image", ev.qrImage),
  R("POST", "/organizer/events/:eventId/qr/regenerate", ev.regenerateQr),
  R("POST", "/organizer/events/:eventId/qr/revoke", ev.revokeQr),
  R("PUT", "/organizer/events/:eventId/qr/access", ev.setQrAccess),
  R("GET", "/organizer/events/:eventId/participants", ev.participants),
  R("GET", "/organizer/events/:eventId/participants/stats", ev.participantStats),
  R("GET", "/organizer/events/:eventId/participants/export", ev.exportParticipants),
  R("POST", "/organizer/events/:eventId/participants/:participantId/remove", (ctx) => ev.removeParticipant(ctx, false)),
  R("POST", "/organizer/events/:eventId/participants/:participantId/restore", (ctx) => ev.removeParticipant(ctx, true)),
  R("GET", "/organizer/events/:eventId/reports", ev.eventReports),
  R("POST", "/organizer/events/:eventId/reports/:reportId/escalate", ev.escalateReport),
  R("GET", "/organizer/events/:eventId/pulse", ev.organizerPulse),

  // ---------- Admin (PRD §7, §21) ----------
  R("GET", "/admin/system", admin.systemOverview),
  R("GET", "/admin/attendees", admin.searchAttendees),
  R("POST", "/admin/attendees/:profileId/suspend", (ctx) => admin.setAttendeeStatus(ctx, true)),
  R("POST", "/admin/attendees/:profileId/restore", (ctx) => admin.setAttendeeStatus(ctx, false)),
  R("POST", "/admin/attendees/:profileId/revoke-sessions", admin.revokeAttendeeSessions),
  R("GET", "/admin/organizations", admin.searchOrganizations),
  R("POST", "/admin/organizations/:id/suspend", (ctx) => admin.setOrganizationStatus(ctx, true)),
  R("POST", "/admin/organizations/:id/restore", (ctx) => admin.setOrganizationStatus(ctx, false)),
  R("GET", "/admin/organizers", admin.searchOrganizers),
  R("POST", "/admin/organizers/:id/suspend", (ctx) => admin.setOrganizerStatus(ctx, true)),
  R("POST", "/admin/organizers/:id/restore", (ctx) => admin.setOrganizerStatus(ctx, false)),
  R("GET", "/admin/events", admin.searchEvents),
  R("POST", "/admin/events/:id/suspend", (ctx) => admin.setEventModeration(ctx, true)),
  R("POST", "/admin/events/:id/restore", (ctx) => admin.setEventModeration(ctx, false)),
  R("GET", "/admin/reports", admin.listReports),
  R("POST", "/admin/reports/:id/review", (ctx) => admin.resolveReport(ctx, "in_review")),
  R("POST", "/admin/reports/:id/action", (ctx) => admin.resolveReport(ctx, "actioned")),
  R("POST", "/admin/reports/:id/dismiss", (ctx) => admin.resolveReport(ctx, "dismissed")),
  R("GET", "/admin/interests", (ctx) => admin.listTags(ctx, "interest")),
  R("POST", "/admin/interests", (ctx) => admin.createTag(ctx, "interest")),
  R("POST", "/admin/interests/:id", (ctx) => admin.moderateTag(ctx, "interest")),
  R("GET", "/admin/skills", (ctx) => admin.listTags(ctx, "skill")),
  R("POST", "/admin/skills", (ctx) => admin.createTag(ctx, "skill")),
  R("POST", "/admin/skills/:id", (ctx) => admin.moderateTag(ctx, "skill")),
  R("GET", "/admin/categories", admin.listCategoriesAdmin),
  R("POST", "/admin/categories", admin.upsertCategory),
  R("PATCH", "/admin/categories/:id", admin.upsertCategory),
  R("GET", "/admin/audit-logs", admin.auditLog),
  R("GET", "/admin/billing", admin.billingOverview),
  R("GET", "/admin/payments/gateway", async (ctx) => { await organizers.requireAdmin(ctx); return billing.gatewayStatus(ctx); }),
  R("POST", "/admin/payments/plans/:code/create", async (ctx) => { const a = await organizers.requireAdmin(ctx); return billing.createGatewayPlan(ctx, a.userId, ctx.params.code!); }),
  R("PUT", "/admin/payments/plans/:code/gateway", async (ctx) => {
    const a = await organizers.requireAdmin(ctx);
    const b = await ctx.json<{ gatewayPlanId?: string }>();
    return billing.linkGatewayPlan(ctx, a.userId, ctx.params.code!, b.gatewayPlanId);
  }),
  R("POST", "/admin/promotional-access", admin.grantPromotion),
  R("POST", "/admin/promotional-access/:id/revoke", admin.revokePromotion),
  R("POST", "/admin/event-credits/:id/revoke", admin.revokeEventCredit),

  // ---------- Scheduled maintenance (Vercel Cron) ----------
  R("GET", "/cron/maintenance", async (ctx) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || ctx.req.headers.get("authorization") !== `Bearer ${secret}`) throw forbidden("Forbidden.");
    return admin.runMaintenance(ctx.db);
  }),
];

export const routeTable = compile(routes);
