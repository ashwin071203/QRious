import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { Client, createAttendee, resetDb, setupEvent, uniq } from "@/server/test/harness";
import { totp } from "@/server/lib/totp";

/**
 * Switching Razorpay from TEST to LIVE mode. The Razorpay API is an in-memory fake that, like the real one, keeps test
 * and live data apart: a plan created with test keys doesn't exist for live keys. Nothing here touches the network.
 */
const db = () => getDb();
const WH = "whsec_live_secret_for_tests_0123456789";
const KEYS = { test: "rzp_test_FAKEKEY123", live: "rzp_live_FAKEKEY123" } as const;
const realFetch = globalThis.fetch;
type Mode = keyof typeof KEYS;
const gw = { plans: new Map<string, { id: string; mode: Mode; period: string; interval: number; item: { amount: number; currency: string } }>(),
  subs: [] as { id: string; mode: Mode; plan_id: string }[], cancels: [] as string[], orders: new Map<string, { mode: Mode }>(), seq: 0 };

function fake(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname !== "api.razorpay.com") return realFetch(input, init);
  const [key, secret] = Buffer.from((new Headers(init?.headers).get("authorization") ?? "").replace("Basic ", ""), "base64").toString().split(":");
  const mode = (Object.keys(KEYS) as Mode[]).find((m) => KEYS[m] === key);
  if (!mode || secret !== "fake_secret") return Promise.resolve(Response.json({ error: { description: "Authentication failed" } }, { status: 401 }));
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const p = url.pathname.replace("/v1", "");
  const json = (x: unknown, status = 200) => Promise.resolve(Response.json(x, { status }));
  if (p === "/plans" && init?.method === "POST") {
    const id = `plan_${mode[0]!.toUpperCase()}${++gw.seq}abcdef`;
    gw.plans.set(id, { id, mode, period: body.period, interval: body.interval, item: body.item });
    return json(gw.plans.get(id));
  }
  if (p === "/plans" || p === "/payments") return json({ items: [] });
  if (p.startsWith("/plans/")) {
    const plan = gw.plans.get(p.split("/")[2]!);
    return plan && plan.mode === mode ? json(plan) : json({ error: { description: "The id provided does not exist" } }, 400);
  }
  if (p === "/subscriptions" && init?.method === "POST") {
    const plan = gw.plans.get(body.plan_id);
    if (!plan || plan.mode !== mode) return json({ error: { description: "The id provided does not exist" } }, 400);
    const id = `sub_${mode[0]!.toUpperCase()}${++gw.seq}abcdef`;
    gw.subs.push({ id, mode, plan_id: body.plan_id });
    return json({ id, status: "created" });
  }
  if (/^\/subscriptions\/[^/]+\/cancel$/.test(p)) {
    const sub = gw.subs.find((s) => s.id === p.split("/")[2]);
    if (!sub || sub.mode !== mode) return json({ error: {} }, 400);
    gw.cancels.push(sub.id);
    return json({ status: "active" });
  }
  if (p === "/orders" && init?.method === "POST") {
    const id = `order_${mode[0]!.toUpperCase()}${++gw.seq}abcdef`;
    gw.orders.set(id, { mode });
    return json({ id, amount: body.amount, currency: body.currency, status: "created" });
  }
  return json({ error: {} }, 404);
}
/** A plan the admin created by hand in the Razorpay Dashboard. */
function dashboardPlan(mode: Mode, period: "monthly" | "yearly", amount: number, currency = "INR") {
  const id = `plan_${mode === "live" ? "L" : "T"}${++gw.seq}dash`;
  gw.plans.set(id, { id, mode, period, interval: 1, item: { amount, currency } });
  return id;
}

let n = 0;
function webhook(event: string, sub: Record<string, unknown> | null, payment?: Record<string, unknown>, id?: string) {
  const payload: Record<string, unknown> = {};
  if (sub) payload.subscription = { entity: sub };
  if (payment) payload.payment = { entity: payment };
  const raw = JSON.stringify({ entity: "event", event, payload });
  return new Client().post("/payments/webhook/razorpay", JSON.parse(raw), { "x-razorpay-signature": createHmac("sha256", WH).update(raw).digest("hex"), "x-razorpay-event-id": id ?? `evt_gl_${++n}_${Date.now()}` });
}
function useKeys(mode: Mode, allowLive = true) {
  process.env.RAZORPAY_KEY_ID = KEYS[mode];
  process.env.RAZORPAY_KEY_SECRET = "fake_secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = WH;
  if (allowLive) process.env.RAZORPAY_ALLOW_LIVE = "1"; else delete process.env.RAZORPAY_ALLOW_LIVE;
}
async function admin() {
  const c = new Client();
  const email = `${uniq("liveadmin")}@example.com`;
  await c.post("/organizer/auth/register", { email, password: "a very long admin password", displayName: "Live Admin" });
  await db().execute(sql`UPDATE organizer_users SET is_admin = true WHERE email_normalized = ${email.toLowerCase()}`);
  const s = await c.post("/organizer/auth/mfa/setup");
  expect((await c.post("/organizer/auth/mfa/enable", { code: totp(s.body.secret) })).status).toBe(200);
  return c;
}
async function orgWithOwner() {
  const c = new Client();
  expect((await c.post("/organizer/auth/register", { email: `${uniq("liveorg")}@example.com`, password: "correct horse battery staple", displayName: "Owner" })).status).toBe(201);
  const org = await c.post("/organizations", { name: `Live Org ${uniq()}` });
  return { owner: c, orgId: org.body.id as string };
}
const plansOf = async (audience = "attendee") => (await new Client().get(`/plans?audience=${audience}`)).body as { paymentsEnabled: boolean; paymentsMode: string; plans: { code: string; purchasable: boolean }[] };
const purchasable = async (code: string) => (await plansOf(code.startsWith("org_") ? "organization" : "attendee")).plans.find((p) => p.code === code)!.purchasable;
const premium = async (c: Client) => (await c.get("/entitlements")).body.planCode;
const LIVE_IDS: Record<string, string> = {};

describe("Going live: plan links, mode separation and payment safety", () => {
  let a: Client;
  const testLinks: Record<string, string> = {};
  beforeAll(async () => {
    await resetDb();
    await db().execute(sql`UPDATE subscription_plans SET gateway_plan_id = NULL, gateway_plan_mode = NULL`);
    vi.stubGlobal("fetch", fake);
    useKeys("test");
    a = await admin();
    // Test mode as it is today: all four subscription plans linked to TEST plans.
    for (const code of ["attendee_premium_monthly", "attendee_premium_yearly", "org_pro_monthly", "org_business_monthly"])
      testLinks[code] = (await a.post(`/admin/payments/plans/${code}/create`)).body.gatewayPlanId;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_ALLOW_LIVE"]) delete process.env[k];
  });
  beforeEach(() => useKeys("live"));

  it("live keys stay off without RAZORPAY_ALLOW_LIVE=1, and without a webhook secret nobody can pay", async () => {
    useKeys("live", false);
    expect(await plansOf()).toMatchObject({ paymentsEnabled: false, paymentsMode: "off" });
    useKeys("live");
    process.env.RAZORPAY_WEBHOOK_SECRET = "";
    expect(await plansOf()).toMatchObject({ paymentsEnabled: false });
    const { qr } = await setupEvent();
    const u = await createAttendee(qr);
    expect((await u.client.post("/subscriptions/checkout", { planCode: "attendee_premium_monthly" })).body.code).toBe("payments_unavailable");
    const { owner, orgId } = await orgWithOwner();
    expect((await owner.post(`/organizations/${orgId}/billing/event-credits/order`)).body.code).toBe("payments_unavailable");
    expect(gw.orders.size).toBe(0); // refused before anything was created at Razorpay
  });

  it("test plan links are ignored with live keys: nothing is purchasable and checkout never reaches a test plan", async () => {
    expect(await plansOf()).toMatchObject({ paymentsEnabled: true, paymentsMode: "live" });
    for (const code of ["attendee_premium_monthly", "attendee_premium_yearly", "org_pro_monthly", "org_business_monthly"]) expect(await purchasable(code)).toBe(false);
    expect(await purchasable("org_event_package")).toBe(true); // one-time orders need no plan
    const st = (await a.get("/admin/payments/gateway")).body;
    expect(st).toMatchObject({ mode: "live", enabled: true });
    for (const p of st.plans) expect(p).toMatchObject({ gatewayPlanId: null, otherModeLink: { gatewayPlanId: testLinks[p.code], mode: "test" } });
    const { qr } = await setupEvent();
    const u = await createAttendee(qr);
    const subsBefore = gw.subs.length;
    expect((await u.client.post("/subscriptions/checkout", { planCode: "attendee_premium_monthly" })).body.code).toBe("payments_unavailable");
    const { owner, orgId } = await orgWithOwner();
    expect((await owner.post(`/organizations/${orgId}/billing/checkout`, { planCode: "org_pro_monthly" })).body.code).toBe("payments_unavailable");
    expect(gw.subs.length).toBe(subsBefore);
    // Switching back to test keys brings the test links back untouched
    useKeys("test");
    expect(await purchasable("attendee_premium_monthly")).toBe(true);
  });

  it("admin links live plans with the same price/period checks, can replace and unlink them, and never creates live plans", async () => {
    expect((await a.post("/admin/payments/plans/org_pro_monthly/create")).body.code).toBe("test_mode_required");
    const link = (code: string, id: string) => a.put(`/admin/payments/plans/${code}/gateway`, { gatewayPlanId: id });
    // A TEST plan id doesn't exist in live mode
    expect((await link("attendee_premium_monthly", testLinks.attendee_premium_monthly!)).body.errors.gatewayPlanId[0]).toMatch(/doesn't have a plan with this id/);
    // Price and period must match exactly (₹99 monthly, ₹799 yearly, ₹499, ₹1,499)
    const accidentalMonthly = dashboardPlan("live", "monthly", 79900); // e.g. a "yearly" plan created as monthly by mistake
    expect((await link("attendee_premium_yearly", accidentalMonthly)).body.errors.gatewayPlanId[0]).toMatch(/billing must be every 1 yearly/);
    expect((await link("org_business_monthly", dashboardPlan("live", "monthly", 149900, "USD"))).body.errors.gatewayPlanId[0]).toMatch(/currency must be INR/);
    LIVE_IDS.attendee_premium_monthly = dashboardPlan("live", "monthly", 9900);
    LIVE_IDS.attendee_premium_yearly = dashboardPlan("live", "yearly", 79900);
    LIVE_IDS.org_pro_monthly = dashboardPlan("live", "monthly", 49900);
    LIVE_IDS.org_business_monthly = dashboardPlan("live", "monthly", 149900);
    expect((await link("org_pro_monthly", LIVE_IDS.org_business_monthly!)).body.errors.gatewayPlanId[0]).toMatch(/amount must be 49900/);
    for (const [code, id] of Object.entries(LIVE_IDS)) expect((await link(code, id)).body).toEqual({ code, gatewayPlanId: id, mode: "live" });
    // One Razorpay plan can't back two QRious plans
    const dup = dashboardPlan("live", "monthly", 9900);
    expect((await link("attendee_premium_monthly", dup)).status).toBe(200); // replace with an identical plan…
    expect((await link("attendee_premium_monthly", LIVE_IDS.attendee_premium_monthly!)).status).toBe(200); // …and back
    await db().execute(sql`UPDATE subscription_plans SET gateway_plan_id = ${dup}, gateway_plan_mode = 'live' WHERE code = 'attendee_premium_yearly'`);
    await db().execute(sql`UPDATE subscription_plans SET gateway_plan_id = ${LIVE_IDS.attendee_premium_yearly!} WHERE code = 'attendee_premium_yearly'`);
    expect((await link("attendee_premium_yearly", LIVE_IDS.attendee_premium_monthly!)).body.errors.gatewayPlanId[0]).toMatch(/billing must be every 1 yearly/);
    const st = (await a.get("/admin/payments/gateway")).body;
    for (const p of st.plans) expect(p).toMatchObject({ gatewayPlanId: LIVE_IDS[p.code], otherModeLink: null });
    for (const code of Object.keys(LIVE_IDS)) expect(await purchasable(code)).toBe(true);
    // Unlink stops new checkouts for that plan only
    expect((await a.del("/admin/payments/plans/org_business_monthly/gateway")).status).toBe(204);
    expect(await purchasable("org_business_monthly")).toBe(false);
    expect(await purchasable("org_pro_monthly")).toBe(true);
    expect((await link("org_business_monthly", LIVE_IDS.org_business_monthly!)).status).toBe(200);
    // Everything is audited; non-admins can't unlink
    const audits = (await db().execute<{ action: string; n: number }>(sql`SELECT action, count(*)::int AS n FROM audit_logs WHERE action LIKE 'billing.gateway_plan_%' GROUP BY action`)).rows;
    expect(Object.fromEntries(audits.map((r) => [r.action, r.n]))).toMatchObject({ "billing.gateway_plan_unlinked": 1 });
    const { owner } = await orgWithOwner();
    expect((await owner.del("/admin/payments/plans/org_pro_monthly/gateway")).status).toBe(403);
  });

  it("live checkout uses the live plan and records live mode; Premium and Pro unlock only from verified live webhooks", async () => {
    const { qr } = await setupEvent();
    const u = await createAttendee(qr);
    for (const code of ["attendee_premium_monthly", "attendee_premium_yearly"] as const) {
      const co = await u.client.post("/subscriptions/checkout", { planCode: code });
      expect(co.body).toMatchObject({ mode: "live", keyId: KEYS.live });
      expect(gw.subs.at(-1)).toMatchObject({ mode: "live", plan_id: LIVE_IDS[code] });
    }
    const subId = gw.subs.at(-1)!.id; // the yearly one superseded the abandoned monthly checkout
    expect(await premium(u.client)).not.toBe("attendee_premium");
    const now = Math.floor(Date.now() / 1000);
    await webhook("subscription.activated", { id: subId, status: "active", current_start: now, current_end: now + 365 * 86400 }, { id: "pay_LIVE1abc", amount: 79900, currency: "INR", status: "captured", method: "upi" });
    expect(await premium(u.client)).toBe("attendee_premium");
    const rows = (await db().execute<{ s: string; p: string }>(sql`SELECT s.gateway_mode AS s, p.gateway_mode AS p FROM subscriptions s JOIN payments p ON p.subscription_id = s.id WHERE s.gateway_subscription_id = ${subId}`)).rows;
    expect(rows).toEqual([{ s: "live", p: "live" }]);
    // Cancelling is sent to Razorpay (cycle end) before it's recorded; access lasts the paid period
    expect((await u.client.post("/subscriptions/cancel")).status).toBe(204);
    expect(gw.cancels).toContain(subId);
    expect(await premium(u.client)).toBe("attendee_premium");

    const { owner, orgId } = await orgWithOwner();
    const co = await owner.post(`/organizations/${orgId}/billing/checkout`, { planCode: "org_business_monthly" });
    expect(gw.subs.at(-1)).toMatchObject({ mode: "live", plan_id: LIVE_IDS.org_business_monthly });
    await webhook("subscription.activated", { id: co.body.subscriptionId, status: "active", current_start: now, current_end: now + 30 * 86400 });
    expect((await owner.get(`/organizations/${orgId}/billing`)).body.tier).toBe("business");
    const order = await owner.post(`/organizations/${orgId}/billing/event-credits/order`);
    expect(order.body).toMatchObject({ mode: "live", amountMinor: 19900 });
    const [{ mode }] = (await db().execute<{ mode: string }>(sql`SELECT gateway_mode AS mode FROM payments WHERE gateway_order_id = ${order.body.orderId}`)).rows as [{ mode: string }];
    expect(mode).toBe("live");
  });

  it("test-mode leftovers are never acted on in live mode: no access, no credits, no refunds, no gateway calls", async () => {
    // A subscription and a Single Event order made while in test mode (as left over from before go-live)
    useKeys("test");
    const { qr } = await setupEvent();
    const u = await createAttendee(qr);
    const co = { body: { subscriptionId: "sub_TESTLEFTOVER1" } };
    await db().execute(sql`INSERT INTO subscriptions (plan_id, subscriber_type, attendee_id, status, gateway_subscription_id, gateway_mode)
      SELECT p.id, 'attendee', up.attendee_id, 'created', ${co.body.subscriptionId}, 'test' FROM subscription_plans p, user_profiles up
      WHERE p.code = 'attendee_premium_monthly' AND up.id = ${u.profileId}`);
    const { owner, orgId } = await orgWithOwner();
    const order = await owner.post(`/organizations/${orgId}/billing/event-credits/order`);
    useKeys("live");
    const now = Math.floor(Date.now() / 1000);
    // Even a correctly signed event (e.g. a webhook secret reused across modes) can't unlock anything
    await webhook("subscription.activated", { id: co.body.subscriptionId, status: "active", current_start: now, current_end: now + 30 * 86400 });
    expect(await premium(u.client)).not.toBe("attendee_premium");
    await webhook("payment.captured", null, { id: "pay_TESTLEFT1", order_id: order.body.orderId, amount: 19900, currency: "INR", status: "captured" });
    expect((await owner.get(`/organizations/${orgId}/billing`)).body.allowance.credits).toBe(0);
    const sig = createHmac("sha256", "fake_secret").update(`${order.body.orderId}|pay_TESTLEFT1`).digest("hex");
    expect((await owner.post(`/organizations/${orgId}/billing/event-credits/verify`, { orderId: order.body.orderId, paymentId: "pay_TESTLEFT1", signature: sig })).status).toBe(404);
    const audit = (await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'billing.webhook_mode_mismatch'`)).rows[0]!;
    expect(audit.n).toBeGreaterThan(0);
  });

  it("every attendee Premium gate is enforced by the API and follows the subscription: activate → halt → resume → refund", async () => {
    const { qr, eventId } = await setupEvent();
    const u = await createAttendee(qr);
    await createAttendee(qr, { company: "Acme Studios", profession: "Producer", interests: [{ name: "Indie" }], skills: [{ name: "Guitar" }] });
    await createAttendee(qr, { company: "Other Co", interests: [{ name: "Indie" }], skills: [{ name: "Guitar" }] });
    const gates = async () => {
      const people = (await u.client.get(`/events/${eventId}/people?company=acme`)).body;
      const matches = (await u.client.get(`/events/${eventId}/matches`)).body;
      return {
        advancedFilters: people.advancedFilters as boolean,
        companyFilterApplied: people.items.length === 1, // free: the company filter is ignored, everyone is listed
        detailedMatches: matches.detailed as boolean,
        breakdown: (matches.items as { breakdown: unknown }[]).some((m) => m.breakdown !== null),
        savedBy: (await u.client.get("/me/saved-by")).status,
        analytics: (await u.client.get("/me/analytics")).status,
        badge: (await u.client.get("/entitlements")).body.features.some((f: { featureKey: string; enabled: boolean }) => f.featureKey === "attendee.profile.badge" && f.enabled),
      };
    };
    const LOCKED = { advancedFilters: false, companyFilterApplied: false, detailedMatches: false, breakdown: false, savedBy: 403, analytics: 403, badge: false };
    const OPEN = { advancedFilters: true, companyFilterApplied: true, detailedMatches: true, breakdown: true, savedBy: 200, analytics: 200, badge: true };
    expect(await gates()).toEqual(LOCKED);
    const co = await u.client.post("/subscriptions/checkout", { planCode: "attendee_premium_monthly" });
    expect(await gates()).toEqual(LOCKED); // checkout alone unlocks nothing
    const now = Math.floor(Date.now() / 1000);
    const sub = (status: string) => ({ id: co.body.subscriptionId, status, current_start: now, current_end: now + 30 * 86400 });
    await webhook("subscription.activated", sub("active"), { id: "pay_GATES1", amount: 9900, currency: "INR", status: "captured" });
    expect(await gates()).toEqual(OPEN);
    await webhook("subscription.pending", sub("pending"));
    expect(await gates()).toEqual(OPEN); // Razorpay is retrying the card: access continues
    await webhook("subscription.halted", sub("halted"));
    expect(await gates()).toEqual(LOCKED);
    await webhook("subscription.charged", sub("active"), { id: "pay_GATES2", amount: 9900, currency: "INR", status: "captured" });
    expect(await gates()).toEqual(OPEN);
    await webhook("refund.processed", null, { id: "pay_GATES2", amount: 9900, currency: "INR", status: "refunded", amount_refunded: 9900 });
    expect(await gates()).toEqual(LOCKED);
  });

  it("cancelling never pretends: if Razorpay can't be reached the cancellation is refused, not just recorded", async () => {
    const { qr } = await setupEvent();
    const u = await createAttendee(qr);
    const co = await u.client.post("/subscriptions/checkout", { planCode: "attendee_premium_monthly" });
    const now = Math.floor(Date.now() / 1000);
    await webhook("subscription.activated", { id: co.body.subscriptionId, status: "active", current_start: now, current_end: now + 30 * 86400 });
    delete process.env.RAZORPAY_ALLOW_LIVE; // payments switched off while a live subscription is running
    expect((await u.client.post("/subscriptions/cancel")).body.code).toBe("payments_unavailable");
    expect((await u.client.get("/me/billing")).body.subscription.cancelAtPeriodEnd).toBe(false);
    useKeys("live");
    expect((await u.client.post("/subscriptions/cancel")).status).toBe(204);
    expect((await u.client.get("/me/billing")).body.subscription.cancelAtPeriodEnd).toBe(true);
  });
});

describe("Test-payment cleanup script", () => {
  const url = process.env.DATABASE_URL!;
  const runScript = (...args: string[]) => {
    try {
      return { ok: true, out: execFileSync(process.execPath, ["--import", "tsx", "scripts/cleanup-test-payments.ts", ...args], { env: { ...process.env, DATABASE_URL_UNPOOLED: url, DATABASE_URL: url }, encoding: "utf8" }) };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };
  beforeAll(() => vi.stubGlobal("fetch", fake));
  afterAll(() => vi.unstubAllGlobals());

  it("dry run deletes nothing; apply removes only test-mode billing data and the access it granted, never accounts or events", async () => {
    expect(url).toMatch(/_test$/);
    await resetDb();
    await db().execute(sql`UPDATE subscription_plans SET gateway_plan_id = NULL, gateway_plan_mode = NULL`);
    useKeys("test");
    const ad = await admin();
    for (const code of ["attendee_premium_monthly", "org_pro_monthly"]) await ad.post(`/admin/payments/plans/${code}/create`);
    const now = Math.floor(Date.now() / 1000);
    // TEST: Premium attendee, Pro organization with an event, and a Single Event credit
    const { qr } = await setupEvent();
    const tu = await createAttendee(qr);
    const tco = await tu.client.post("/subscriptions/checkout", { planCode: "attendee_premium_monthly" });
    await webhook("subscription.activated", { id: tco.body.subscriptionId, status: "active", current_start: now, current_end: now + 30 * 86400 }, { id: "pay_TCLEAN1", amount: 9900, currency: "INR", status: "captured" });
    const { owner: to, orgId: torg } = await orgWithOwner();
    const tpro = await to.post(`/organizations/${torg}/billing/checkout`, { planCode: "org_pro_monthly" });
    await webhook("subscription.activated", { id: tpro.body.subscriptionId, status: "active", current_start: now, current_end: now + 30 * 86400 });
    const tord = await to.post(`/organizations/${torg}/billing/event-credits/order`);
    await webhook("payment.captured", null, { id: "pay_TCLEAN2", order_id: tord.body.orderId, amount: 19900, currency: "INR", status: "captured" });
    const cat = ((await new Client().get("/public/categories")).body as { id: string }[])[0]!.id;
    const start = new Date(Date.now() + 2 * 86_400_000);
    const ev = await to.post(`/organizations/${torg}/events`, { name: "Kept event", categoryId: cat, venueName: "Hall", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() });
    expect(ev.status).toBe(201);
    expect(await premium(tu.client)).toBe("attendee_premium");
    expect((await to.get(`/organizations/${torg}/billing`)).body).toMatchObject({ tier: "pro", allowance: { credits: 1 } });
    // LIVE: a real Premium subscriber must survive untouched
    useKeys("live");
    const livePlan = dashboardPlan("live", "monthly", 9900);
    expect((await ad.put("/admin/payments/plans/attendee_premium_monthly/gateway", { gatewayPlanId: livePlan })).status).toBe(200);
    const lu = await createAttendee(qr);
    const lco = await lu.client.post("/subscriptions/checkout", { planCode: "attendee_premium_monthly" });
    await webhook("subscription.activated", { id: lco.body.subscriptionId, status: "active", current_start: now, current_end: now + 30 * 86400 }, { id: "pay_LCLEAN1", amount: 9900, currency: "INR", status: "captured" });
    expect(await premium(lu.client)).toBe("attendee_premium");
    const count = async () => (await db().execute<Record<string, number>>(sql`SELECT
      (SELECT count(*)::int FROM subscriptions) AS subs, (SELECT count(*)::int FROM payments) AS pays, (SELECT count(*)::int FROM user_entitlements) AS ue,
      (SELECT count(*)::int FROM organization_entitlements) AS oe, (SELECT count(*)::int FROM organization_event_credits) AS credits,
      (SELECT count(*)::int FROM attendees) AS attendees, (SELECT count(*)::int FROM organizations) AS orgs, (SELECT count(*)::int FROM events) AS events`)).rows[0]!;
    const before = await count();

    const dry = runScript();
    expect(dry.ok).toBe(true);
    expect(dry.out).toContain("DRY RUN");
    expect(await count()).toEqual(before);
    const total = Number(/--expect=(\d+)/.exec(dry.out)![1]);
    expect(total).toBeGreaterThan(0);
    // Apply refuses without the reviewed total, or with a stale one
    expect(runScript("--apply").ok).toBe(false);
    expect(runScript("--apply", `--expect=${total + 1}`).out).toMatch(/data changed since the dry run/);
    expect(await count()).toEqual(before);

    const applied = runScript("--apply", `--expect=${total}`);
    expect(applied.ok).toBe(true);
    const after = await count();
    expect(after).toMatchObject({ subs: 1, pays: 1, oe: 0, credits: 0, attendees: before.attendees, orgs: before.orgs, events: before.events });
    expect(await premium(tu.client)).not.toBe("attendee_premium");
    expect(await premium(lu.client)).toBe("attendee_premium");
    const tb = (await to.get(`/organizations/${torg}/billing`)).body;
    expect(tb).toMatchObject({ tier: "starter", subscription: null, payments: [], credits: [], allowance: { credits: 0 } });
    expect((await to.get(`/organizer/events/${ev.body.id}`)).status).toBe(200);
    expect((await tu.client.get("/me/billing")).body).toMatchObject({ subscription: null, payments: [] });
    expect((await lu.client.get("/me/billing")).body.payments).toHaveLength(1);
    const notes = (await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM notifications WHERE type LIKE 'billing.%' AND attendee_id = (SELECT attendee_id FROM user_profiles WHERE id = ${tu.profileId})`)).rows[0]!;
    expect(notes.n).toBe(0);
    // A second dry run finds nothing left
    expect(runScript().out).toMatch(/TOTAL: 0/);
  }, 120_000);
});
