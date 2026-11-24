import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { config } from "@/server/core/config";
import { AppError, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { requireAttendee } from "./identity";

const { subscriptionPlans, subscriptionFeatures, subscriptions, payments, paymentWebhooks, userEntitlements, organizationEntitlements, promotionalAccess, notifications } = schema;

/**
 * Entitlements (D-01, D-20). Essential networking is NEVER gated. Effective features = default plan overlaid with
 * active grants (subscriptions / promotional access). Numeric limits stay null (unlimited) until approved.
 */
export async function effectiveEntitlements(db: Executor, subject: { attendeeId?: string; organizationId?: string }) {
  const audience = subject.attendeeId ? "attendee" : "organization";
  const [plan] = await db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.audience, audience), eq(subscriptionPlans.isDefault, true))).limit(1);
  const feats = plan ? await db.select().from(subscriptionFeatures).where(eq(subscriptionFeatures.planId, plan.id)) : [];
  const map = new Map(feats.map((f) => [f.featureKey, { featureKey: f.featureKey, enabled: f.enabled, limit: f.limitValue }]));
  const now = new Date();
  const grants = subject.attendeeId
    ? await db.select().from(userEntitlements).where(and(eq(userEntitlements.attendeeId, subject.attendeeId), sql`${userEntitlements.validFrom} <= ${now}`, sql`(${userEntitlements.validUntil} IS NULL OR ${userEntitlements.validUntil} > ${now})`))
    : await db.select().from(organizationEntitlements).where(and(eq(organizationEntitlements.organizationId, subject.organizationId!), sql`${organizationEntitlements.validFrom} <= ${now}`, sql`(${organizationEntitlements.validUntil} IS NULL OR ${organizationEntitlements.validUntil} > ${now})`));
  let premium = false;
  for (const g of grants) {
    const cur = map.get(g.featureKey);
    map.set(g.featureKey, { featureKey: g.featureKey, enabled: (cur?.enabled ?? false) || g.enabled, limit: cur?.limit === null || g.limitValue === null ? null : Math.max(cur?.limit ?? 0, g.limitValue) });
    premium = true;
  }
  return { planCode: premium ? (audience === "attendee" ? "attendee_premium" : "org_paid") : plan?.code ?? "free", planName: premium ? (audience === "attendee" ? "Premium" : "Paid plan") : plan?.name ?? "Free", features: [...map.values()].sort((a, b) => a.featureKey.localeCompare(b.featureKey)) };
}

export async function hasFeature(db: Executor, attendeeId: string, key: string) {
  return (await effectiveEntitlements(db, { attendeeId })).features.some((f) => f.featureKey === key && f.enabled);
}
export async function orgHasFeature(db: Executor, organizationId: string, key: string) {
  return (await effectiveEntitlements(db, { organizationId })).features.some((f) => f.featureKey === key && f.enabled);
}
export async function entitlementLimit(db: Executor, attendeeId: string, key: string): Promise<number | null> {
  return (await effectiveEntitlements(db, { attendeeId })).features.find((f) => f.featureKey === key)?.limit ?? null;
}

/** Materializes a plan's features as entitlement rows for a source (subscription or promo). */
export async function grantPlan(db: Executor, subject: { attendeeId?: string | null; organizationId?: string | null }, planId: string, sourceType: "subscription" | "promo", sourceId: string, until: Date | null) {
  const feats = await db.select().from(subscriptionFeatures).where(eq(subscriptionFeatures.planId, planId));
  const now = new Date();
  for (const f of feats) {
    const row = { featureKey: f.featureKey, sourceType, sourceId, enabled: f.enabled, limitValue: f.limitValue, validFrom: now, validUntil: until };
    if (subject.attendeeId) await db.insert(userEntitlements).values({ ...row, attendeeId: subject.attendeeId }).onConflictDoUpdate({ target: [userEntitlements.attendeeId, userEntitlements.featureKey, userEntitlements.sourceType, userEntitlements.sourceId], set: { validUntil: until, enabled: f.enabled, limitValue: f.limitValue } });
    else if (subject.organizationId) await db.insert(organizationEntitlements).values({ ...row, organizationId: subject.organizationId }).onConflictDoUpdate({ target: [organizationEntitlements.organizationId, organizationEntitlements.featureKey, organizationEntitlements.sourceType, organizationEntitlements.sourceId], set: { validUntil: until, enabled: f.enabled, limitValue: f.limitValue } });
  }
}

export async function revokeSource(db: Executor, sourceId: string) {
  const now = new Date();
  await db.update(userEntitlements).set({ validUntil: now }).where(eq(userEntitlements.sourceId, sourceId));
  await db.update(organizationEntitlements).set({ validUntil: now }).where(eq(organizationEntitlements.sourceId, sourceId));
}

export async function listPlans(ctx: Ctx) {
  const audience = ctx.query("audience") === "organization" ? "organization" : "attendee";
  const plans = await ctx.db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.audience, audience), eq(subscriptionPlans.isActive, true))).orderBy(asc(subscriptionPlans.sortOrder));
  const feats = plans.length ? await ctx.db.select().from(subscriptionFeatures).where(inArray(subscriptionFeatures.planId, plans.map((p) => p.id))) : [];
  return {
    paymentsEnabled: config.razorpay.enabled,
    plans: plans.map((p) => ({ code: p.code, name: p.name, description: p.description, billingPeriod: p.billingPeriod, priceMinor: p.priceMinor, currency: p.currency, isDefault: p.isDefault,
      features: feats.filter((f) => f.planId === p.id && f.enabled).map((f) => f.featureKey) })),
  };
}

export async function myBilling(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const ent = await effectiveEntitlements(ctx.db, { attendeeId: me.attendeeId });
  const [sub] = await ctx.db.select({ s: subscriptions, planName: subscriptionPlans.name, planCode: subscriptionPlans.code }).from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
    .where(eq(subscriptions.attendeeId, me.attendeeId)).orderBy(desc(subscriptions.createdAt)).limit(1);
  const [promo] = await ctx.db.select({ p: promotionalAccess, planName: subscriptionPlans.name }).from(promotionalAccess)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, promotionalAccess.planId))
    .where(and(eq(promotionalAccess.attendeeId, me.attendeeId), isNull(promotionalAccess.revokedAt), sql`${promotionalAccess.endsAt} > now()`)).limit(1);
  const history = await ctx.db.select().from(payments).where(eq(payments.attendeeId, me.attendeeId)).orderBy(desc(payments.createdAt)).limit(50);
  return {
    ...ent,
    paymentsEnabled: config.razorpay.enabled,
    subscription: sub ? { status: sub.s.status, planName: sub.planName, planCode: sub.planCode, currentPeriodEnd: sub.s.currentPeriodEnd, cancelAtPeriodEnd: sub.s.cancelAtPeriodEnd } : null,
    promotion: promo ? { planName: promo.planName, endsAt: promo.p.endsAt } : null,
    payments: history.map((p) => ({ id: p.id, amountMinor: p.amountMinor, currency: p.currency, status: p.status, createdAt: p.createdAt, method: p.method })),
  };
}

/** Checkout (Phase 8B). Razorpay test mode only; activation happens ONLY via a verified webhook (BR-25). */
export async function checkout(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  if (!config.razorpay.enabled)
    throw new AppError(503, "payments_unavailable", "Payments aren't switched on yet. Premium will be available soon.");
  const { planCode } = await ctx.json<{ planCode?: string }>();
  const [plan] = await ctx.db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.code, planCode ?? ""), eq(subscriptionPlans.audience, "attendee"), eq(subscriptionPlans.isActive, true))).limit(1);
  if (!plan || plan.priceMinor === 0) throw notFound("Plan not found.");
  if (!plan.gatewayPlanId) throw new AppError(503, "payments_unavailable", "This plan isn't available for purchase yet.");
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
    method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ plan_id: plan.gatewayPlanId, total_count: plan.billingPeriod === "year" ? 5 : 60, customer_notify: 1, notes: { attendee_id: me.attendeeId } }),
  });
  if (!res.ok) throw new AppError(502, "gateway_error", "The payment provider is unavailable. Please try again.");
  const data = (await res.json()) as { id: string };
  await ctx.db.transaction(async (tx) => {
    await tx.update(subscriptions).set({ status: "expired" }).where(and(eq(subscriptions.attendeeId, me.attendeeId), eq(subscriptions.status, "created")));
    await tx.insert(subscriptions).values({ planId: plan.id, subscriberType: "attendee", attendeeId: me.attendeeId, status: "created", gatewaySubscriptionId: data.id });
  });
  return { gateway: "razorpay", keyId: config.razorpay.keyId, subscriptionId: data.id };
}

export async function cancelSubscription(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const [sub] = await ctx.db.select().from(subscriptions).where(and(eq(subscriptions.attendeeId, me.attendeeId), inArray(subscriptions.status, ["active", "authenticated", "pending"]))).limit(1);
  if (!sub) throw notFound("You don't have an active subscription.");
  if (config.razorpay.enabled && sub.gatewaySubscriptionId) {
    const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${sub.gatewaySubscriptionId}/cancel`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify({ cancel_at_cycle_end: 1 }) });
    if (!res.ok) throw new AppError(502, "gateway_error", "The payment provider is unavailable. Please try again.");
  }
  // Access continues until the end of the paid period (§19.6).
  await ctx.db.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
  return reply(204);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Razorpay webhook: verify HMAC over the raw body FIRST, store once (unique event id), process idempotently. */
export async function razorpayWebhook(ctx: Ctx) {
  const raw = await ctx.req.text();
  const signature = ctx.req.headers.get("x-razorpay-signature");
  if (!verifyWebhookSignature(raw, signature, config.razorpay.webhookSecret)) throw new AppError(401, "invalid_signature", "Invalid signature.");
  const eventId = ctx.req.headers.get("x-razorpay-event-id") ?? createHmac("sha256", "id").update(raw).digest("hex");
  let payload: { event: string; payload: { subscription?: { entity: { id: string; status: string; current_start?: number; current_end?: number } }; payment?: { entity: { id: string; amount: number; currency: string; status: string; method?: string; order_id?: string } } } };
  try { payload = JSON.parse(raw); } catch { throw new AppError(400, "bad_request", "Invalid JSON."); }
  const inserted = await ctx.db.insert(paymentWebhooks).values({ gatewayEventId: eventId, eventType: payload.event, signatureValid: true, payload }).onConflictDoNothing().returning({ id: paymentWebhooks.id });
  if (!inserted.length) return { status: "duplicate" };

  await ctx.db.transaction(async (tx) => {
    const subEntity = payload.payload.subscription?.entity;
    if (subEntity) {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.gatewaySubscriptionId, subEntity.id)).limit(1);
      if (sub) {
        const status = ({ authenticated: "authenticated", active: "active", pending: "pending", halted: "halted", cancelled: "cancelled", completed: "completed", expired: "expired" } as Record<string, string>)[subEntity.status] ?? sub.status;
        const periodEnd = subEntity.current_end ? new Date(subEntity.current_end * 1000) : sub.currentPeriodEnd;
        await tx.update(subscriptions).set({ status, currentPeriodStart: subEntity.current_start ? new Date(subEntity.current_start * 1000) : sub.currentPeriodStart, currentPeriodEnd: periodEnd, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
        if (status === "active" && periodEnd) await grantPlan(tx, { attendeeId: sub.attendeeId, organizationId: sub.organizationId }, sub.planId, "subscription", sub.id, periodEnd);
        if (["halted", "cancelled", "completed", "expired"].includes(status)) {
          // Paid access remains until the period ends; entitlements already carry valid_until.
          if (status === "halted") await revokeSource(tx, sub.id);
        }
        const pay = payload.payload.payment?.entity;
        if (pay) {
          await tx.insert(payments).values({ subscriptionId: sub.id, payerType: sub.subscriberType, attendeeId: sub.attendeeId, organizationId: sub.organizationId, gatewayPaymentId: pay.id, gatewayOrderId: pay.order_id ?? null,
            amountMinor: pay.amount, currency: pay.currency, status: pay.status === "captured" ? "captured" : pay.status === "failed" ? "failed" : "authorized", method: pay.method ?? null, capturedAt: pay.status === "captured" ? new Date() : null }).onConflictDoNothing();
          if (pay.status === "failed" && sub.attendeeId)
            await tx.insert(notifications).values({ attendeeId: sub.attendeeId, type: "billing", payload: { kind: "payment_failed", message: "Your Premium payment failed. Please update your payment method." } });
        }
      }
    }
    if (payload.event === "refund.processed" && payload.payload.payment?.entity) {
      const pay = payload.payload.payment.entity;
      const [p] = await tx.update(payments).set({ status: "refunded", refundedMinor: pay.amount }).where(eq(payments.gatewayPaymentId, pay.id)).returning();
      if (p?.subscriptionId) await revokeSource(tx, p.subscriptionId);
    }
    await tx.update(paymentWebhooks).set({ processedAt: new Date() }).where(eq(paymentWebhooks.id, inserted[0]!.id));
    await audit(tx, { actorType: "gateway", action: `billing.webhook.${payload.event}`, data: { eventId } });
  });
  return { status: "ok" };
}
