import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError } from "@/server/core/errors";

/**
 * Organizer entitlements — the single server-side source of truth for what an organization may do (PRD §19.3).
 *
 *  - Starter (free): 3 lifetime events per organization, QR codes, basic participants, basic Pulse, feature toggles.
 *  - Pro: Starter + unlimited events and the Pro features below.
 *  - Business: Pro + team members and cross-event analytics.
 *  - Single Event credit: one more event, no subscription.
 *
 * Validity comes from organization_entitlements rows (written by verified webhooks / admin promotions, ended by
 * cancellation, halt, refund or expiry). WHICH features a grant unlocks comes from the plan's current feature list, so
 * a pricing change applies to existing subscribers. Attendee privacy and essential networking are never gated here.
 */
const { organizations, organizationEntitlements, subscriptions, promotionalAccess, subscriptionPlans, subscriptionFeatures, organizationEventCredits } = schema;

export const FREE_EVENT_ALLOWANCE = 3;

export type OrgTier = "starter" | "pro" | "business";
export const TIER_RANK: Record<OrgTier, number> = { starter: 0, pro: 1, business: 2 };
const TIER_BY_PLAN: Record<string, OrgTier> = { org_pro_monthly: "pro", org_business_monthly: "business" };
const TIER_NAME: Record<OrgTier, string> = { starter: "Starter", pro: "Pro", business: "Business" };

/** Every gated organizer feature, the lowest tier that includes it, and the message shown when it's missing. */
export const ORG_FEATURES = {
  "org.events.unlimited": { tier: "pro", label: "Unlimited events", deny: "You've used your 3 free events. Upgrade to Pro or Business, or buy a Single Event, to create more." },
  "org.pulse.advanced": { tier: "pro", label: "Advanced Event Pulse analytics", deny: "Goal and interest breakdowns in Event Pulse are part of Pro." },
  "org.participants.detailed_stats": { tier: "pro", label: "Detailed participant statistics", deny: "Detailed participant statistics are part of Pro." },
  "org.networking.advanced": { tier: "pro", label: "Advanced networking configuration (custom interest, skill and goal suggestions)", deny: "Custom interest, skill and goal suggestions are part of Pro." },
  "org.branding": { tier: "pro", label: "Custom event banners", deny: "Custom event banners are part of Pro." },
  "org.reports.export": { tier: "pro", label: "Exportable participant reports (with attendee consent)", deny: "Participant exports are part of Pro." },
  "org.members": { tier: "business", label: "Multiple organization members", deny: "Adding team members is part of Business." },
  "org.analytics.cross_event": { tier: "business", label: "Cross-event analytics and organization reports", deny: "Cross-event analytics are part of Business." },
} as const satisfies Record<string, { tier: OrgTier; label: string; deny: string }>;
export type OrgFeature = keyof typeof ORG_FEATURES;

export type OrgEntitlements = {
  tier: OrgTier;
  planCode: string;
  planName: string;
  /** Where the current paid tier comes from (null on Starter). */
  source: "subscription" | "promo" | null;
  validUntil: Date | null;
  features: OrgFeature[];
  allowance: { freeLimit: number; eventsCreated: number; freeUsed: number; freeRemaining: number; credits: number; unlimited: boolean; canCreateEvent: boolean };
};

export async function orgEntitlements(db: Executor, organizationId: string): Promise<OrgEntitlements> {
  const now = new Date();
  // Active grants → their sources → the plans they belong to.
  const grants = await db.select({ sourceType: organizationEntitlements.sourceType, sourceId: organizationEntitlements.sourceId, validUntil: sql<Date | null>`max(${organizationEntitlements.validUntil})` })
    .from(organizationEntitlements)
    .where(and(eq(organizationEntitlements.organizationId, organizationId), sql`${organizationEntitlements.validFrom} <= ${now}`,
      sql`(${organizationEntitlements.validUntil} IS NULL OR ${organizationEntitlements.validUntil} > ${now})`))
    .groupBy(organizationEntitlements.sourceType, organizationEntitlements.sourceId);
  const subIds = grants.filter((g) => g.sourceType === "subscription").map((g) => g.sourceId);
  const promoIds = grants.filter((g) => g.sourceType === "promo").map((g) => g.sourceId);
  const planOf = new Map<string, string>();
  if (subIds.length) for (const r of await db.select({ id: subscriptions.id, planId: subscriptions.planId }).from(subscriptions).where(and(inArray(subscriptions.id, subIds), eq(subscriptions.organizationId, organizationId)))) planOf.set(r.id, r.planId);
  if (promoIds.length) for (const r of await db.select({ id: promotionalAccess.id, planId: promotionalAccess.planId }).from(promotionalAccess).where(and(inArray(promotionalAccess.id, promoIds), isNull(promotionalAccess.revokedAt)))) planOf.set(r.id, r.planId);
  const planIds = [...new Set(planOf.values())];
  const plans = planIds.length ? await db.select({ id: subscriptionPlans.id, code: subscriptionPlans.code }).from(subscriptionPlans).where(inArray(subscriptionPlans.id, planIds)) : [];
  const feats = planIds.length ? await db.select({ key: subscriptionFeatures.featureKey }).from(subscriptionFeatures).where(and(inArray(subscriptionFeatures.planId, planIds), eq(subscriptionFeatures.enabled, true))) : [];

  let tier: OrgTier = "starter";
  let best: { source: "subscription" | "promo"; validUntil: Date | null; code: string } | null = null;
  for (const g of grants) {
    const plan = plans.find((p) => p.id === planOf.get(g.sourceId));
    const t = plan ? TIER_BY_PLAN[plan.code] : undefined;
    if (!plan || !t) continue;
    const until = g.validUntil ? new Date(g.validUntil) : null;
    // Highest tier wins; for equal tiers prefer the grant that lasts longest.
    if (TIER_RANK[t] > TIER_RANK[tier] || (best && TIER_RANK[t] === TIER_RANK[tier] && (until === null || (best.validUntil !== null && until > best.validUntil)))) {
      tier = t;
      best = { source: g.sourceType as "subscription" | "promo", validUntil: until, code: plan.code };
    }
  }
  const features = [...new Set(feats.map((f) => f.key))].filter((k): k is OrgFeature => k in ORG_FEATURES && TIER_RANK[ORG_FEATURES[k as OrgFeature].tier] <= TIER_RANK[tier]).sort();

  const [org] = await db.select({ n: organizations.eventsCreatedCount }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const [{ credits }] = await db.select({ credits: sql<number>`count(*)::int` }).from(organizationEventCredits)
    .where(and(eq(organizationEventCredits.organizationId, organizationId), isNull(organizationEventCredits.consumedAt), isNull(organizationEventCredits.revokedAt))) as [{ credits: number }];
  const eventsCreated = org?.n ?? 0;
  const freeUsed = Math.min(eventsCreated, FREE_EVENT_ALLOWANCE);
  const unlimited = features.includes("org.events.unlimited");
  return {
    tier, planCode: best?.code ?? "org_starter", planName: TIER_NAME[tier], source: best?.source ?? null, validUntil: best?.validUntil ?? null, features,
    allowance: { freeLimit: FREE_EVENT_ALLOWANCE, eventsCreated, freeUsed, freeRemaining: FREE_EVENT_ALLOWANCE - freeUsed, credits, unlimited,
      canCreateEvent: freeUsed < FREE_EVENT_ALLOWANCE || unlimited || credits > 0 },
  };
}

export async function orgHas(db: Executor, organizationId: string, feature: OrgFeature) {
  return (await orgEntitlements(db, organizationId)).features.includes(feature);
}

export function entitlementError(feature: OrgFeature) {
  const f = ORG_FEATURES[feature];
  return new AppError(403, "entitlement_required", f.deny, undefined, { feature, requiredPlan: f.tier });
}

/** Backend gate for premium organizer features — call in every API that serves one (never rely on the UI). */
export async function requireOrgFeature(db: Executor, organizationId: string, feature: OrgFeature) {
  if (!(await orgHas(db, organizationId, feature))) throw entitlementError(feature);
}

/**
 * Reserves the right to create one event. MUST run inside the creating transaction: it locks the organization row,
 * so concurrent requests from any member of the organization are serialized and can't overspend the allowance.
 * Order: free allowance → Pro/Business plan → a Single Event credit. The caller increments the lifetime counter.
 */
export async function allocateEventAllowance(tx: Executor, organizationId: string): Promise<{ source: "free" | "plan" | "credit"; creditId?: string }> {
  const [org] = await tx.select({ n: organizations.eventsCreatedCount }).from(organizations).where(eq(organizations.id, organizationId)).for("update").limit(1);
  if (!org) throw new AppError(404, "not_found", "Organization not found.");
  if (org.n < FREE_EVENT_ALLOWANCE) return { source: "free" };
  if (await orgHas(tx, organizationId, "org.events.unlimited")) return { source: "plan" };
  const [credit] = await tx.select({ id: organizationEventCredits.id }).from(organizationEventCredits)
    .where(and(eq(organizationEventCredits.organizationId, organizationId), isNull(organizationEventCredits.consumedAt), isNull(organizationEventCredits.revokedAt)))
    .orderBy(asc(organizationEventCredits.createdAt)).for("update").limit(1);
  if (credit) return { source: "credit", creditId: credit.id };
  throw new AppError(402, "event_allowance_exhausted", ORG_FEATURES["org.events.unlimited"].deny, undefined, { freeLimit: FREE_EVENT_ALLOWANCE });
}
