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
    paymentsMode: config.razorpay.enabled ? config.razorpay.mode : "off",
    plans: plans.map((p) => ({ code: p.code, name: p.name, description: p.description, billingPeriod: p.billingPeriod, priceMinor: p.priceMinor, currency: p.currency, isDefault: p.isDefault,
      purchasable: config.razorpay.enabled && p.priceMinor > 0 && !!p.gatewayPlanId,
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
    paymentsMode: config.razorpay.enabled ? config.razorpay.mode : "off",
    subscription: sub ? { status: sub.s.status, planName: sub.planName, planCode: sub.planCode, currentPeriodEnd: sub.s.currentPeriodEnd, cancelAtPeriodEnd: sub.s.cancelAtPeriodEnd } : null,
    promotion: promo ? { planName: promo.planName, endsAt: promo.p.endsAt } : null,
    payments: history.map((p) => ({ id: p.id, amountMinor: p.amountMinor, currency: p.currency, status: p.status, createdAt: p.createdAt, method: p.method })),
  };
}

// ---------- Razorpay (D-01: TEST MODE ONLY until live activation is explicitly approved) ----------
const RZP = "https://api.razorpay.com/v1";
/** Entitlements outlive the paid period by a day so a slightly late renewal webhook never interrupts Premium. */
const RENEWAL_GRACE_MS = 24 * 3_600_000;

async function rzp<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(`${RZP}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: config.razorpay.authHeader(), "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(502, "gateway_error", "The payment provider is unavailable. Please try again.");
  }
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

function requirePayments() {
  if (!config.razorpay.enabled)
    throw new AppError(503, "payments_unavailable", "Payments aren't switched on yet. Premium will be available soon.");
}

const LIVE_STATUSES = ["created", "authenticated", "active", "pending"] as const;

/** Checkout (Phase 8B). Creates a Razorpay subscription; access is granted ONLY by a verified webhook (BR-25). */
export async function checkout(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  requirePayments();
  await ctx.limit("checkout", 10, 3600, me.attendeeId);
  const { planCode } = await ctx.json<{ planCode?: string }>();
  const [plan] = await ctx.db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.code, planCode ?? ""), eq(subscriptionPlans.audience, "attendee"), eq(subscriptionPlans.isActive, true))).limit(1);
  if (!plan || plan.priceMinor === 0) throw notFound("Plan not found.");
  if (!plan.gatewayPlanId) throw new AppError(503, "payments_unavailable", "This plan isn't available for purchase yet.");
  // One paid subscription at a time — checked BEFORE creating anything at the gateway.
  const [live] = await ctx.db.select({ id: subscriptions.id, status: subscriptions.status }).from(subscriptions)
    .where(and(eq(subscriptions.attendeeId, me.attendeeId), inArray(subscriptions.status, ["authenticated", "active", "pending"]))).limit(1);
  if (live) throw new AppError(409, "already_subscribed", "You already have a Premium subscription.");

  const r = await rzp<{ id?: string; error?: { description?: string } }>("/subscriptions", {
    method: "POST",
    body: { plan_id: plan.gatewayPlanId, total_count: plan.billingPeriod === "year" ? 5 : 60, customer_notify: 1, notes: { attendee_id: me.attendeeId, plan_code: plan.code } },
  });
  if (!r.ok || !r.data.id) throw new AppError(502, "gateway_error", "The payment provider couldn't start checkout. Please try again.");
  await ctx.db.transaction(async (tx) => {
    // Abandoned, never-paid checkouts are superseded (they can still be revived by a webhook if paid later).
    await tx.update(subscriptions).set({ status: "expired", updatedAt: new Date() }).where(and(eq(subscriptions.attendeeId, me.attendeeId), eq(subscriptions.status, "created")));
    await tx.insert(subscriptions).values({ planId: plan.id, subscriberType: "attendee", attendeeId: me.attendeeId, status: "created", gatewaySubscriptionId: r.data.id! });
  });
  return { gateway: "razorpay", mode: config.razorpay.mode, keyId: config.razorpay.keyId, subscriptionId: r.data.id };
}

export async function cancelSubscription(ctx: Ctx) {
  const me = await requireAttendee(ctx);
  const [sub] = await ctx.db.select().from(subscriptions).where(and(eq(subscriptions.attendeeId, me.attendeeId), inArray(subscriptions.status, ["active", "authenticated", "pending"]))).limit(1);
  if (!sub) throw notFound("You don't have an active subscription.");
  if (sub.cancelAtPeriodEnd) return reply(204);
  if (config.razorpay.enabled && sub.gatewaySubscriptionId) {
    const r = await rzp(`/subscriptions/${sub.gatewaySubscriptionId}/cancel`, { method: "POST", body: { cancel_at_cycle_end: 1 } });
    if (!r.ok) throw new AppError(502, "gateway_error", "The payment provider is unavailable. Please try again.");
  }
  // Access continues until the end of the paid period (§19.6).
  await ctx.db.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
  await audit(ctx.db, { actorType: "attendee", actorId: me.attendeeId, action: "billing.subscription_cancel_requested", targetType: "subscription", targetId: sub.id });
  return reply(204);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const TERMINAL = new Set(["cancelled", "completed"]);
const GATEWAY_STATUS: Record<string, string> = { authenticated: "authenticated", active: "active", pending: "pending", halted: "halted", paused: "halted", cancelled: "cancelled", completed: "completed", expired: "expired" };

/**
 * Razorpay may deliver events late or out of order. Never move backwards: cancelled/completed are final, and a late
 * "authenticated" can't downgrade a subscription that has already been charged.
 */
export function nextSubscriptionStatus(current: string, incoming: string | undefined, everActivated: boolean): string {
  const mapped = incoming ? GATEWAY_STATUS[incoming] : undefined;
  if (!mapped || TERMINAL.has(current)) return current;
  if (mapped === "authenticated" && (everActivated || !["created", "expired"].includes(current))) return current;
  return mapped;
}

type RzpPayload = {
  event: string;
  payload: {
    subscription?: { entity: { id: string; status: string; current_start?: number | null; current_end?: number | null } };
    payment?: { entity: { id: string; amount: number; currency: string; status: string; method?: string; amount_refunded?: number } };
    refund?: { entity: { id: string; amount: number; payment_id: string } };
  };
};

/** Razorpay webhook: verify HMAC over the raw body FIRST; record + process atomically and idempotently. */
export async function razorpayWebhook(ctx: Ctx) {
  const raw = await ctx.req.text();
  if (!config.razorpay.webhookSecret) throw new AppError(503, "webhook_not_configured", "Webhook secret not configured.");
  if (!verifyWebhookSignature(raw, ctx.req.headers.get("x-razorpay-signature"), config.razorpay.webhookSecret))
    throw new AppError(401, "invalid_signature", "Invalid signature.");
  const eventId = ctx.req.headers.get("x-razorpay-event-id") ?? createHmac("sha256", "id").update(raw).digest("hex");
  let payload: RzpPayload;
  try { payload = JSON.parse(raw); } catch { throw new AppError(400, "bad_request", "Invalid JSON."); }

  // Recording and processing share one transaction: if processing fails nothing is stored, so Razorpay's retry is
  // processed again instead of being mistaken for a duplicate.
  const result = await ctx.db.transaction(async (tx) => {
    const inserted = await tx.insert(paymentWebhooks).values({ gatewayEventId: eventId, eventType: payload.event, signatureValid: true, payload }).onConflictDoNothing().returning({ id: paymentWebhooks.id });
    if (!inserted.length) return "duplicate" as const;

    const subEntity = payload.payload.subscription?.entity;
    const pay = payload.payload.payment?.entity;
    if (subEntity) {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.gatewaySubscriptionId, subEntity.id)).for("update").limit(1);
      if (sub) {
        const everActivated = !!sub.currentPeriodStart;
        let status = nextSubscriptionStatus(sub.status, subEntity.status, everActivated);
        // A superseded checkout that was paid after all: revive it unless another subscription is already live.
        if (sub.status === "expired" && status !== "expired" && sub.attendeeId) {
          const [other] = await tx.select({ id: subscriptions.id }).from(subscriptions)
            .where(and(eq(subscriptions.attendeeId, sub.attendeeId), inArray(subscriptions.status, [...LIVE_STATUSES]), sql`${subscriptions.id} <> ${sub.id}`)).limit(1);
          if (other) {
            status = "cancelled";
            await audit(tx, { actorType: "gateway", action: "billing.duplicate_subscription", targetType: "subscription", targetId: sub.id, data: { gatewaySubscriptionId: subEntity.id, note: "Paid while another subscription was live; cancel/refund in Razorpay." } });
          }
        }
        const periodStart = subEntity.current_start ? new Date(subEntity.current_start * 1000) : sub.currentPeriodStart;
        const periodEnd = subEntity.current_end ? new Date(subEntity.current_end * 1000) : sub.currentPeriodEnd;
        await tx.update(subscriptions).set({ status, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, updatedAt: new Date(),
          ...(subEntity.status === "cancelled" ? { cancelAtPeriodEnd: true } : {}) }).where(eq(subscriptions.id, sub.id));
        if (status === "active" && periodEnd)
          await grantPlan(tx, { attendeeId: sub.attendeeId, organizationId: sub.organizationId }, sub.planId, "subscription", sub.id, new Date(periodEnd.getTime() + RENEWAL_GRACE_MS));
        // Halted/paused: retries exhausted or paused → access stops now. Cancelled/completed: access runs to the
        // already-paid period end, which the entitlement rows carry as valid_until.
        if (status === "halted") await revokeSource(tx, sub.id);
        if (pay) {
          const st = pay.status === "captured" ? "captured" : pay.status === "failed" ? "failed" : pay.status === "refunded" ? "refunded" : "authorized";
          await tx.insert(payments).values({ subscriptionId: sub.id, payerType: sub.subscriberType, attendeeId: sub.attendeeId, organizationId: sub.organizationId, gatewayPaymentId: pay.id,
            amountMinor: pay.amount, currency: pay.currency, status: st, method: pay.method ?? null, capturedAt: st === "captured" ? new Date() : null })
            .onConflictDoUpdate({ target: payments.gatewayPaymentId, set: { status: st, method: pay.method ?? null, ...(st === "captured" ? { capturedAt: sql`coalesce(${payments.capturedAt}, now())` } : {}) } });
        }
        if (subEntity.status === "pending" && sub.attendeeId && sub.status !== "pending")
          await tx.insert(notifications).values({ attendeeId: sub.attendeeId, type: "billing", payload: { kind: "payment_failed", message: "Your Premium renewal payment failed. Razorpay will retry — please check your payment method." } });
      }
    }
    if (payload.event === "refund.processed" && pay) {
      const refunded = pay.amount_refunded ?? payload.payload.refund?.entity.amount ?? pay.amount;
      const full = refunded >= pay.amount;
      const [p] = await tx.update(payments).set({ status: full ? "refunded" : "partially_refunded", refundedMinor: refunded }).where(eq(payments.gatewayPaymentId, pay.id)).returning();
      if (p?.subscriptionId && full) await revokeSource(tx, p.subscriptionId);
    }
    await tx.update(paymentWebhooks).set({ processedAt: new Date() }).where(eq(paymentWebhooks.id, inserted[0]!.id));
    await audit(tx, { actorType: "gateway", action: `billing.webhook.${payload.event}`, data: { eventId } });
    return "ok" as const;
  });
  return { status: result };
}

// ---------- Admin: gateway configuration (no secret values are ever returned) ----------
const PERIOD: Record<string, string> = { month: "monthly", year: "yearly" };

export function webhookUrl(ctx: Ctx) {
  return `${new URL(ctx.req.url).origin}/api/v1/payments/webhook/razorpay`;
}

export async function gatewayStatus(ctx: Ctx) {
  const rz = config.razorpay;
  let keysValid: boolean | null = null;
  let subscriptionsEnabled: boolean | null = null;
  if (rz.mode === "test" || rz.mode === "live") {
    // Keys are checked against a core endpoint; the Subscriptions product separately (Razorpay answers 401 on
    // /plans when Subscriptions isn't enabled for the account, even with a valid key pair).
    try { keysValid = (await rzp("/payments?count=1")).ok; } catch { keysValid = null; }
    if (keysValid) try { subscriptionsEnabled = (await rzp("/plans?count=1")).ok; } catch { subscriptionsEnabled = null; }
  }
  const plans = await ctx.db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.audience, "attendee"), sql`${subscriptionPlans.priceMinor} > 0`)).orderBy(asc(subscriptionPlans.sortOrder));
  const [last] = await ctx.db.select({ at: paymentWebhooks.receivedAt, type: paymentWebhooks.eventType }).from(paymentWebhooks).orderBy(desc(paymentWebhooks.receivedAt)).limit(1);
  return {
    mode: rz.mode, enabled: rz.enabled, keyIdSet: !!rz.keyId, keySecretSet: !!rz.keySecret, webhookSecretSet: !!rz.webhookSecret, keysValid, subscriptionsEnabled,
    webhookUrl: webhookUrl(ctx), lastWebhook: last ?? null,
    webhookEvents: ["subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.pending", "subscription.halted", "subscription.paused",
      "subscription.resumed", "subscription.cancelled", "subscription.completed", "subscription.updated", "refund.processed"],
    plans: plans.map((p) => ({ code: p.code, name: p.name, billingPeriod: p.billingPeriod, priceMinor: p.priceMinor, currency: p.currency, isActive: p.isActive, gatewayPlanId: p.gatewayPlanId })),
  };
}

async function purchasablePlan(ctx: Ctx, code: string) {
  const [plan] = await ctx.db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.code, code), eq(subscriptionPlans.audience, "attendee"))).limit(1);
  if (!plan || plan.priceMinor <= 0 || !PERIOD[plan.billingPeriod]) throw notFound("Plan not found.");
  return plan;
}

/** Creates the matching plan in Razorpay — TEST MODE ONLY — and links it. */
export async function createGatewayPlan(ctx: Ctx, adminId: string, code: string) {
  if (config.razorpay.mode !== "test") throw new AppError(409, "test_mode_required", "Plans can only be created automatically with Razorpay TEST keys.");
  const plan = await purchasablePlan(ctx, code);
  if (plan.gatewayPlanId) throw new AppError(409, "already_linked", "This plan is already linked to a Razorpay plan.");
  const r = await rzp<{ id?: string; error?: { description?: string } }>("/plans", {
    method: "POST",
    body: { period: PERIOD[plan.billingPeriod], interval: 1, item: { name: `QRious ${plan.name}`, amount: plan.priceMinor, currency: plan.currency, description: plan.description ?? undefined }, notes: { qrious_plan_code: plan.code } },
  });
  if (r.status === 401) throw new AppError(409, "subscriptions_not_enabled", "Razorpay refused: enable Subscriptions for your account in the Razorpay Dashboard (Test Mode), then try again.");
  if (!r.ok || !r.data.id) throw new AppError(502, "gateway_error", r.data.error?.description ?? "Razorpay rejected the plan.");
  await ctx.db.update(subscriptionPlans).set({ gatewayPlanId: r.data.id }).where(eq(subscriptionPlans.id, plan.id));
  await audit(ctx.db, { actorType: "admin", actorId: adminId, action: "billing.gateway_plan_created", targetType: "plan", targetId: plan.id, data: { gatewayPlanId: r.data.id, mode: config.razorpay.mode } });
  return { code: plan.code, gatewayPlanId: r.data.id };
}

/** Links a plan created in the Razorpay Dashboard after checking its period, amount and currency match exactly. */
export async function linkGatewayPlan(ctx: Ctx, adminId: string, code: string, gatewayPlanId: unknown) {
  if (!config.razorpay.enabled) throw new AppError(409, "payments_unavailable", "Add Razorpay test keys first.");
  const plan = await purchasablePlan(ctx, code);
  if (typeof gatewayPlanId !== "string" || !/^plan_[A-Za-z0-9]{6,40}$/.test(gatewayPlanId.trim()))
    throw new AppError(400, "validation_failed", "One or more fields are invalid.", { gatewayPlanId: ["Enter a Razorpay plan id (starts with plan_)."] });
  const id = gatewayPlanId.trim();
  const r = await rzp<{ id?: string; period?: string; interval?: number; item?: { amount?: number; currency?: string } }>(`/plans/${id}`);
  if (!r.ok) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { gatewayPlanId: ["Razorpay doesn't have a plan with this id in the current mode."] });
  const problems: string[] = [];
  if (r.data.period !== PERIOD[plan.billingPeriod] || r.data.interval !== 1) problems.push(`billing must be every 1 ${PERIOD[plan.billingPeriod]}`);
  if (r.data.item?.amount !== plan.priceMinor) problems.push(`amount must be ${plan.priceMinor} paise`);
  if (r.data.item?.currency !== plan.currency) problems.push(`currency must be ${plan.currency}`);
  if (problems.length) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { gatewayPlanId: [`That Razorpay plan doesn't match: ${problems.join(", ")}.`] });
  await ctx.db.update(subscriptionPlans).set({ gatewayPlanId: id }).where(eq(subscriptionPlans.id, plan.id));
  await audit(ctx.db, { actorType: "admin", actorId: adminId, action: "billing.gateway_plan_linked", targetType: "plan", targetId: plan.id, data: { gatewayPlanId: id } });
  return { code: plan.code, gatewayPlanId: id };
}
