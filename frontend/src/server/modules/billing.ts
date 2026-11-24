import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { config } from "@/server/core/config";
import { AppError, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { requireAttendee } from "./identity";
import { requireOrgMember } from "./organizers";
import { orgEntitlements } from "./entitlements";

const { subscriptionPlans, subscriptionFeatures, subscriptions, payments, paymentWebhooks, userEntitlements, organizationEntitlements, promotionalAccess, notifications, organizationEventCredits, events } = schema;

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
      // Recurring plans need a linked Razorpay plan; one-time packages are paid with a Razorpay Order.
      purchasable: config.razorpay.enabled && p.priceMinor > 0 && (p.billingPeriod === "one_time" || !!p.gatewayPlanId),
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
    payment?: { entity: { id: string; amount: number; currency: string; status: string; method?: string; amount_refunded?: number; order_id?: string; error_description?: string | null } };
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
        if (sub.status === "expired" && status !== "expired" && (sub.attendeeId || sub.organizationId)) {
          const owner = sub.attendeeId ? eq(subscriptions.attendeeId, sub.attendeeId) : eq(subscriptions.organizationId, sub.organizationId!);
          const [other] = await tx.select({ id: subscriptions.id }).from(subscriptions)
            .where(and(owner, inArray(subscriptions.status, [...LIVE_STATUSES]), sql`${subscriptions.id} <> ${sub.id}`)).limit(1);
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
    // Single Event packages (Razorpay Orders): the webhook grants the credit even if the browser never came back.
    if (!subEntity && pay?.order_id && ["payment.captured", "payment.failed", "order.paid"].includes(payload.event))
      await settleEventCreditPayment(tx, pay.order_id, pay);
    if (payload.event === "refund.processed" && pay) {
      const refunded = pay.amount_refunded ?? payload.payload.refund?.entity.amount ?? pay.amount;
      const full = refunded >= pay.amount;
      const [p] = await tx.update(payments).set({ status: full ? "refunded" : "partially_refunded", refundedMinor: refunded }).where(eq(payments.gatewayPaymentId, pay.id)).returning();
      if (p?.subscriptionId && full) await revokeSource(tx, p.subscriptionId);
      // A fully refunded Single Event credit is withdrawn if unused. A used one keeps its event: data is never deleted.
      if (p?.purpose === "event_credit" && full) {
        const revoked = await tx.update(organizationEventCredits).set({ revokedAt: new Date() })
          .where(and(eq(organizationEventCredits.paymentId, p.id), isNull(organizationEventCredits.consumedAt), isNull(organizationEventCredits.revokedAt))).returning({ id: organizationEventCredits.id });
        await audit(tx, { actorType: "gateway", action: revoked.length ? "billing.event_credit_revoked" : "billing.event_credit_refunded_after_use", targetType: "payment", targetId: p.id, organizationId: p.organizationId });
      }
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
  const plans = await ctx.db.select().from(subscriptionPlans).where(and(inArray(subscriptionPlans.billingPeriod, ["month", "year"]), sql`${subscriptionPlans.priceMinor} > 0`, eq(subscriptionPlans.isActive, true))).orderBy(asc(subscriptionPlans.sortOrder));
  const [last] = await ctx.db.select({ at: paymentWebhooks.receivedAt, type: paymentWebhooks.eventType }).from(paymentWebhooks).orderBy(desc(paymentWebhooks.receivedAt)).limit(1);
  return {
    mode: rz.mode, enabled: rz.enabled, keyIdSet: !!rz.keyId, keySecretSet: !!rz.keySecret, webhookSecretSet: !!rz.webhookSecret, keysValid, subscriptionsEnabled,
    webhookUrl: webhookUrl(ctx), lastWebhook: last ?? null,
    webhookEvents: ["subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.pending", "subscription.halted", "subscription.paused",
      "subscription.resumed", "subscription.cancelled", "subscription.completed", "subscription.updated", "payment.captured", "payment.failed", "order.paid", "refund.processed"],
    plans: plans.map((p) => ({ code: p.code, audience: p.audience, name: p.name, billingPeriod: p.billingPeriod, priceMinor: p.priceMinor, currency: p.currency, isActive: p.isActive, gatewayPlanId: p.gatewayPlanId })),
  };
}

async function purchasablePlan(ctx: Ctx, code: string) {
  const [plan] = await ctx.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, code)).limit(1);
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

// ---------- Organizer billing: Pro / Business subscriptions and Single Event credits (TEST MODE ONLY) ----------
const ORG_SUBSCRIPTION_PLANS = ["org_pro_monthly", "org_business_monthly"];
export const EVENT_PACKAGE_CODE = "org_event_package";

/** Billing & Plans data for one organization: plan, allowance, subscription, credits and payment history. */
export async function orgBilling(ctx: Ctx) {
  const orgId = ctx.params.orgId!;
  const { role } = await requireOrgMember(ctx, orgId);
  const ent = await orgEntitlements(ctx.db, orgId);
  const [sub] = await ctx.db.select({ s: subscriptions, planName: subscriptionPlans.name, planCode: subscriptionPlans.code, priceMinor: subscriptionPlans.priceMinor }).from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
    .where(and(eq(subscriptions.organizationId, orgId), sql`(${subscriptions.status} <> 'created' OR ${subscriptions.createdAt} > now() - interval '1 day')`))
    .orderBy(desc(subscriptions.createdAt)).limit(1);
  const promos = await ctx.db.select({ p: promotionalAccess, planName: subscriptionPlans.name }).from(promotionalAccess)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, promotionalAccess.planId))
    .where(and(eq(promotionalAccess.organizationId, orgId), isNull(promotionalAccess.revokedAt), sql`${promotionalAccess.endsAt} > now()`)).orderBy(desc(promotionalAccess.endsAt)).limit(1);
  const history = await ctx.db.select({ p: payments, planName: subscriptionPlans.name }).from(payments).leftJoin(subscriptionPlans, eq(subscriptionPlans.id, payments.planId))
    .where(and(eq(payments.organizationId, orgId), sql`${payments.status} <> 'created'`)).orderBy(desc(payments.createdAt)).limit(50);
  // Subscription payments carry no plan_id; fall back to the subscription's plan name.
  const subPlan = new Map<string, string>();
  const subIds = [...new Set(history.map((h) => h.p.subscriptionId).filter((x): x is string => !!x))];
  if (subIds.length) for (const r of await ctx.db.select({ id: subscriptions.id, name: subscriptionPlans.name }).from(subscriptions).innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId)).where(inArray(subscriptions.id, subIds))) subPlan.set(r.id, r.name);
  const credits = await ctx.db.select({ c: organizationEventCredits, eventName: events.name }).from(organizationEventCredits).leftJoin(events, eq(events.id, organizationEventCredits.consumedEventId))
    .where(eq(organizationEventCredits.organizationId, orgId)).orderBy(desc(organizationEventCredits.createdAt)).limit(100);
  const periodEnd = sub?.s.currentPeriodEnd ?? null;
  const lapsed = !!sub && ["active", "pending"].includes(sub.s.status) && !!periodEnd && periodEnd.getTime() + RENEWAL_GRACE_MS < Date.now();
  return {
    ...ent,
    canManageBilling: role === "owner",
    paymentsEnabled: config.razorpay.enabled,
    paymentsMode: config.razorpay.enabled ? config.razorpay.mode : "off",
    subscription: sub ? { status: lapsed ? "expired" : sub.s.status, planCode: sub.planCode, planName: sub.planName, priceMinor: sub.priceMinor, currentPeriodStart: sub.s.currentPeriodStart,
      currentPeriodEnd: periodEnd, cancelAtPeriodEnd: sub.s.cancelAtPeriodEnd, cancelledAt: sub.s.cancelledAt, createdAt: sub.s.createdAt } : null,
    promotion: promos[0] ? { planName: promos[0].planName, endsAt: promos[0].p.endsAt } : null,
    credits: credits.map((x) => ({ id: x.c.id, source: x.c.source, createdAt: x.c.createdAt, consumedAt: x.c.consumedAt, eventName: x.eventName ?? null, revokedAt: x.c.revokedAt })),
    payments: history.map((h) => ({ id: h.p.id, purpose: h.p.purpose, description: h.planName ?? (h.p.subscriptionId ? subPlan.get(h.p.subscriptionId) : null) ?? "Payment", amountMinor: h.p.amountMinor,
      refundedMinor: h.p.refundedMinor, currency: h.p.currency, status: h.p.status, method: h.p.method, createdAt: h.p.createdAt, capturedAt: h.p.capturedAt })),
  };
}

/** Pro / Business checkout: creates a Razorpay subscription. Access is granted ONLY by a verified webhook. Owner only. */
export async function orgCheckout(ctx: Ctx) {
  const orgId = ctx.params.orgId!;
  const { organizer } = await requireOrgMember(ctx, orgId, true);
  requirePayments();
  await ctx.limit("org-checkout", 10, 3600, organizer.userId);
  const { planCode } = await ctx.json<{ planCode?: string }>();
  if (!ORG_SUBSCRIPTION_PLANS.includes(planCode ?? "")) throw notFound("Plan not found.");
  const [plan] = await ctx.db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.code, planCode!), eq(subscriptionPlans.isActive, true))).limit(1);
  if (!plan) throw notFound("Plan not found.");
  if (!plan.gatewayPlanId) throw new AppError(503, "payments_unavailable", "This plan isn't available for purchase yet.");
  const [live] = await ctx.db.select({ id: subscriptions.id }).from(subscriptions)
    .where(and(eq(subscriptions.organizationId, orgId), inArray(subscriptions.status, ["authenticated", "active", "pending"]))).limit(1);
  if (live) throw new AppError(409, "already_subscribed", "This organization already has a subscription. Cancel it before choosing another plan.");
  const r = await rzp<{ id?: string }>("/subscriptions", {
    method: "POST",
    body: { plan_id: plan.gatewayPlanId, total_count: 60, customer_notify: 1, notes: { organization_id: orgId, plan_code: plan.code } },
  });
  if (!r.ok || !r.data.id) throw new AppError(502, "gateway_error", "The payment provider couldn't start checkout. Please try again.");
  await ctx.db.transaction(async (tx) => {
    await tx.update(subscriptions).set({ status: "expired", updatedAt: new Date() }).where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.status, "created")));
    await tx.insert(subscriptions).values({ planId: plan.id, subscriberType: "organization", organizationId: orgId, status: "created", gatewaySubscriptionId: r.data.id! });
    await audit(tx, { actorType: "organizer", actorId: organizer.userId, action: "billing.checkout_started", targetType: "organization", targetId: orgId, organizationId: orgId, data: { plan: plan.code } });
  });
  return { gateway: "razorpay", kind: "subscription", mode: config.razorpay.mode, keyId: config.razorpay.keyId, subscriptionId: r.data.id, planName: plan.name };
}

export async function orgCancelSubscription(ctx: Ctx) {
  const orgId = ctx.params.orgId!;
  const { organizer } = await requireOrgMember(ctx, orgId, true);
  const [sub] = await ctx.db.select().from(subscriptions).where(and(eq(subscriptions.organizationId, orgId), inArray(subscriptions.status, ["active", "authenticated", "pending"]))).limit(1);
  if (!sub) throw notFound("This organization doesn't have an active subscription.");
  if (sub.cancelAtPeriodEnd) return reply(204);
  if (config.razorpay.enabled && sub.gatewaySubscriptionId) {
    const r = await rzp(`/subscriptions/${sub.gatewaySubscriptionId}/cancel`, { method: "POST", body: { cancel_at_cycle_end: 1 } });
    if (!r.ok) throw new AppError(502, "gateway_error", "The payment provider is unavailable. Please try again.");
  }
  // Paid features continue until the end of the paid period; events and data are never removed.
  await ctx.db.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "billing.subscription_cancel_requested", targetType: "subscription", targetId: sub.id, organizationId: orgId });
  return reply(204);
}

/** Single Event package: a Razorpay Order for one event credit. Nothing is granted until the payment is verified. */
export async function eventCreditOrder(ctx: Ctx) {
  const orgId = ctx.params.orgId!;
  const { organizer } = await requireOrgMember(ctx, orgId, true);
  requirePayments();
  await ctx.limit("org-credit-order", 20, 3600, organizer.userId);
  const [plan] = await ctx.db.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.code, EVENT_PACKAGE_CODE), eq(subscriptionPlans.isActive, true))).limit(1);
  if (!plan || plan.priceMinor <= 0) throw new AppError(503, "payments_unavailable", "Single Event packages aren't available right now.");
  const receipt = `evc_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const r = await rzp<{ id?: string; amount?: number; currency?: string }>("/orders", {
    method: "POST",
    body: { amount: plan.priceMinor, currency: plan.currency, receipt, notes: { organization_id: orgId, plan_code: plan.code, purpose: "event_credit" } },
  });
  if (!r.ok || !r.data.id) throw new AppError(502, "gateway_error", "The payment provider couldn't start checkout. Please try again.");
  await ctx.db.insert(payments).values({ payerType: "organization", organizationId: orgId, gatewayOrderId: r.data.id, amountMinor: plan.priceMinor, currency: plan.currency, status: "created", purpose: "event_credit", planId: plan.id });
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "billing.event_credit_order", targetType: "organization", targetId: orgId, organizationId: orgId, data: { orderId: r.data.id } });
  return { gateway: "razorpay", kind: "order", mode: config.razorpay.mode, keyId: config.razorpay.keyId, orderId: r.data.id, amountMinor: plan.priceMinor, currency: plan.currency, planName: plan.name };
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

type RzpPayment = { id: string; order_id?: string; amount: number; currency: string; status: string; method?: string; error_description?: string | null };

/**
 * Grants the credit for a captured Single Event payment. Idempotent (one credit per payment) and safe to call from both
 * the checkout verification and the webhook, in either order.
 */
async function settleEventCreditPayment(tx: Executor, orderId: string, pay: RzpPayment): Promise<"granted" | "already" | "failed" | "ignored"> {
  const [row] = await tx.select().from(payments).where(and(eq(payments.gatewayOrderId, orderId), eq(payments.purpose, "event_credit"))).for("update").limit(1);
  if (!row || !row.organizationId) return "ignored";
  if (pay.amount !== row.amountMinor || pay.currency !== row.currency) {
    await audit(tx, { actorType: "gateway", action: "billing.amount_mismatch", targetType: "payment", targetId: row.id, organizationId: row.organizationId, data: { orderId, paid: pay.amount, expected: row.amountMinor } });
    return "ignored";
  }
  if (pay.status === "failed") {
    if (row.status === "created" || row.status === "authorized")
      await tx.update(payments).set({ status: "failed", gatewayPaymentId: pay.id, failureReason: pay.error_description?.slice(0, 300) ?? null, method: pay.method ?? null }).where(eq(payments.id, row.id));
    return "failed";
  }
  if (pay.status !== "captured") return "ignored";
  if (["refunded", "partially_refunded"].includes(row.status)) return "already";
  if (row.status !== "captured")
    await tx.update(payments).set({ status: "captured", gatewayPaymentId: pay.id, method: pay.method ?? null, capturedAt: new Date(), failureReason: null }).where(eq(payments.id, row.id));
  const granted = await tx.insert(organizationEventCredits).values({ organizationId: row.organizationId, source: "purchase", paymentId: row.id }).onConflictDoNothing().returning({ id: organizationEventCredits.id });
  if (!granted.length) return "already";
  await audit(tx, { actorType: "gateway", action: "billing.event_credit_granted", targetType: "payment", targetId: row.id, organizationId: row.organizationId, data: { orderId, paymentId: pay.id } });
  return "granted";
}

/**
 * Checkout success callback for a Single Event order. The browser's word is never enough: the Razorpay signature is
 * verified, then the payment is fetched from Razorpay server-to-server (and captured if only authorized).
 */
export async function eventCreditVerify(ctx: Ctx) {
  const orgId = ctx.params.orgId!;
  await requireOrgMember(ctx, orgId);
  requirePayments();
  const b = await ctx.json<{ orderId?: string; paymentId?: string; signature?: string }>();
  const orderId = String(b.orderId ?? ""), paymentId = String(b.paymentId ?? ""), signature = String(b.signature ?? "");
  if (!/^order_[A-Za-z0-9]{6,40}$/.test(orderId) || !/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId)) throw new AppError(400, "bad_request", "Invalid payment details.");
  if (!verifyPaymentSignature(orderId, paymentId, signature, config.razorpay.keySecret)) throw new AppError(400, "invalid_signature", "We couldn't verify this payment.");
  const [row] = await ctx.db.select({ id: payments.id, organizationId: payments.organizationId }).from(payments).where(and(eq(payments.gatewayOrderId, orderId), eq(payments.purpose, "event_credit"))).limit(1);
  if (!row || row.organizationId !== orgId) throw notFound("Payment not found.");
  let pay = (await rzp<RzpPayment>(`/payments/${paymentId}`)).data;
  if (!pay?.id || pay.order_id !== orderId) throw new AppError(400, "invalid_payment", "This payment doesn't belong to the order.");
  if (pay.status === "authorized") {
    const c = await rzp<RzpPayment>(`/payments/${paymentId}/capture`, { method: "POST", body: { amount: pay.amount, currency: pay.currency } });
    if (c.ok && c.data.id) pay = c.data;
    else pay = (await rzp<RzpPayment>(`/payments/${paymentId}`)).data; // may have been captured concurrently (auto-capture / webhook)
  }
  const result = await ctx.db.transaction((tx) => settleEventCreditPayment(tx, orderId, pay));
  if (result === "failed") throw new AppError(402, "payment_failed", "The payment failed. No money was taken — please try again.");
  if (result === "ignored") throw new AppError(409, "payment_pending", "The payment isn't complete yet. If money was taken, your event credit will appear shortly.");
  return { status: result };
}

// ---------- Admin: organizer billing overview ----------
export async function adminOrganizerBilling(db: Executor) {
  const orgs = (await db.execute<{ id: string; name: string; status: string; events_created: number; credits_available: number; credits_used: number; revenue_minor: number; sub_status: string | null; sub_plan: string | null; period_end: Date | null; cancel_at_period_end: boolean | null }>(sql`
    SELECT o.id, o.name, o.status, o.events_created_count AS events_created,
      (SELECT count(*)::int FROM organization_event_credits c WHERE c.organization_id = o.id AND c.consumed_at IS NULL AND c.revoked_at IS NULL) AS credits_available,
      (SELECT count(*)::int FROM organization_event_credits c WHERE c.organization_id = o.id AND c.consumed_at IS NOT NULL) AS credits_used,
      (SELECT coalesce(sum(p.amount_minor - p.refunded_minor), 0)::int FROM payments p WHERE p.organization_id = o.id AND p.status IN ('captured','partially_refunded')) AS revenue_minor,
      s.status AS sub_status, sp.name AS sub_plan, s.current_period_end AS period_end, s.cancel_at_period_end
    FROM organizations o
    LEFT JOIN LATERAL (SELECT * FROM subscriptions s WHERE s.organization_id = o.id AND s.status <> 'created' ORDER BY s.created_at DESC LIMIT 1) s ON true
    LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
    ORDER BY revenue_minor DESC, o.created_at DESC LIMIT 200`)).rows;
  const ents = await Promise.all(orgs.map((o) => orgEntitlements(db, o.id)));
  const [t] = (await db.execute<Record<string, number>>(sql`SELECT
    coalesce(sum(amount_minor - refunded_minor) FILTER (WHERE status IN ('captured','partially_refunded')), 0)::int AS revenue_minor,
    coalesce(sum(amount_minor - refunded_minor) FILTER (WHERE status IN ('captured','partially_refunded') AND purpose = 'event_credit'), 0)::int AS event_revenue_minor,
    count(*) FILTER (WHERE status IN ('captured','partially_refunded') AND purpose = 'event_credit')::int AS event_purchases,
    count(*) FILTER (WHERE status = 'failed')::int AS failed_payments
    FROM payments WHERE payer_type = 'organization'`)).rows;
  const [s] = (await db.execute<Record<string, number>>(sql`SELECT
    count(*) FILTER (WHERE s.status IN ('active','authenticated','pending') AND p.code = 'org_pro_monthly')::int AS pro_active,
    count(*) FILTER (WHERE s.status IN ('active','authenticated','pending') AND p.code = 'org_business_monthly')::int AS business_active,
    count(*) FILTER (WHERE s.status IN ('cancelled','completed','expired','halted'))::int AS ended
    FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.subscriber_type = 'organization' AND s.status <> 'created'`)).rows;
  const recent = (await db.execute<{ id: string; org: string; purpose: string; amount_minor: number; refunded_minor: number; status: string; created_at: Date; plan: string | null }>(sql`
    SELECT p.id, o.name AS org, p.purpose, p.amount_minor, p.refunded_minor, p.status, p.created_at, coalesce(pl.name, sp.name) AS plan
    FROM payments p JOIN organizations o ON o.id = p.organization_id LEFT JOIN subscription_plans pl ON pl.id = p.plan_id
    LEFT JOIN subscriptions su ON su.id = p.subscription_id LEFT JOIN subscription_plans sp ON sp.id = su.plan_id
    WHERE p.payer_type = 'organization' AND p.status <> 'created' ORDER BY p.created_at DESC LIMIT 50`)).rows;
  return {
    totals: { ...t, ...s },
    organizations: orgs.map((o, i) => ({ id: o.id, name: o.name, status: o.status, tier: ents[i]!.tier, planName: ents[i]!.planName, tierSource: ents[i]!.source, tierUntil: ents[i]!.validUntil,
      eventsCreated: o.events_created, freeUsed: ents[i]!.allowance.freeUsed, freeRemaining: ents[i]!.allowance.freeRemaining, creditsAvailable: o.credits_available, creditsUsed: o.credits_used,
      revenueMinor: o.revenue_minor, subscription: o.sub_status ? { status: o.sub_status, plan: o.sub_plan, periodEnd: o.period_end, cancelAtPeriodEnd: !!o.cancel_at_period_end } : null })),
    payments: recent.map((p) => ({ id: p.id, organization: p.org, purpose: p.purpose, plan: p.plan, amountMinor: p.amount_minor, refundedMinor: p.refunded_minor, status: p.status, createdAt: p.created_at })),
  };
}
