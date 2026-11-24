import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { Client, createAttendee, resetDb, setupEvent, uniq } from "@/server/test/harness";
import { nextSubscriptionStatus } from "@/server/modules/billing";
import { totp } from "@/server/lib/totp";

/**
 * Razorpay subscriptions in TEST MODE (D-01). The Razorpay REST API is replaced by an in-memory fake so these tests
 * never touch the network; webhooks are signed exactly as Razorpay signs them (HMAC-SHA256 hex of the raw body).
 */
const db = () => getDb();
const WH = "whsec_test_secret_for_tests_0123456789";
const realFetch = globalThis.fetch;
const gateway = { plans: new Map<string, Record<string, unknown>>(), subs: [] as Record<string, unknown>[], cancels: [] as string[], seq: 0,
  orders: new Map<string, Record<string, unknown>>(), payments: new Map<string, Record<string, unknown>>(), captures: [] as string[] };

function fakeRazorpay(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname !== "api.razorpay.com") return realFetch(input, init);
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  if (Buffer.from(auth.replace("Basic ", ""), "base64").toString() !== "rzp_test_FAKEKEY123:fake_secret")
    return Promise.resolve(Response.json({ error: { description: "Authentication failed" } }, { status: 401 }));
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const p = url.pathname.replace("/v1", "");
  if (p === "/plans" && init?.method === "POST") {
    const id = `plan_T${++gateway.seq}abcdef`;
    gateway.plans.set(id, { id, period: body.period, interval: body.interval, item: { amount: body.item.amount, currency: body.item.currency } });
    return Promise.resolve(Response.json(gateway.plans.get(id)));
  }
  if (p === "/plans" || p === "/payments") return Promise.resolve(Response.json({ items: [] }));
  if (p.startsWith("/plans/")) {
    const plan = gateway.plans.get(p.split("/")[2]!);
    return Promise.resolve(plan ? Response.json(plan) : Response.json({ error: {} }, { status: 400 }));
  }
  if (p === "/subscriptions" && init?.method === "POST") {
    const id = `sub_T${++gateway.seq}abcdef`;
    gateway.subs.push({ id, ...body });
    return Promise.resolve(Response.json({ id, status: "created" }));
  }
  if (p === "/orders" && init?.method === "POST") {
    const id = `order_T${++gateway.seq}abcdef`;
    gateway.orders.set(id, { id, ...body });
    return Promise.resolve(Response.json({ id, amount: body.amount, currency: body.currency, status: "created" }));
  }
  if (/^\/payments\/[^/]+\/capture$/.test(p) && init?.method === "POST") {
    const pay = gateway.payments.get(p.split("/")[2]!);
    if (!pay || pay.status !== "authorized") return Promise.resolve(Response.json({ error: {} }, { status: 400 }));
    pay.status = "captured";
    gateway.captures.push(String(pay.id));
    return Promise.resolve(Response.json(pay));
  }
  if (p.startsWith("/payments/")) {
    const pay = gateway.payments.get(p.split("/")[2]!);
    return Promise.resolve(pay ? Response.json(pay) : Response.json({ error: {} }, { status: 400 }));
  }
  if (/^\/subscriptions\/[^/]+\/cancel$/.test(p)) {
    gateway.cancels.push(p.split("/")[2]!);
    return Promise.resolve(Response.json({ status: "active" }));
  }
  return Promise.resolve(Response.json({ error: {} }, { status: 404 }));
}

let n = 0;
async function webhook(event: string, sub: Record<string, unknown> | null, payment?: Record<string, unknown>, opts: { id?: string; secret?: string; extra?: Record<string, unknown> } = {}) {
  const payload: Record<string, unknown> = {};
  if (sub) payload.subscription = { entity: sub };
  if (payment) payload.payment = { entity: payment };
  Object.assign(payload, opts.extra ?? {});
  const raw = JSON.stringify({ entity: "event", event, payload });
  const sig = createHmac("sha256", opts.secret ?? WH).update(raw).digest("hex");
  return new Client().post("/payments/webhook/razorpay", JSON.parse(raw), { "x-razorpay-signature": sig, "x-razorpay-event-id": opts.id ?? `evt_${++n}_${Date.now()}` });
}

async function admin() {
  const c = new Client();
  const email = `${uniq("payadmin")}@example.com`;
  await c.post("/organizer/auth/register", { email, password: "a very long admin password", displayName: "Pay Admin" });
  await db().execute(sql`UPDATE organizer_users SET is_admin = true WHERE email_normalized = ${email.toLowerCase()}`);
  const s = await c.post("/organizer/auth/mfa/setup");
  expect((await c.post("/organizer/auth/mfa/enable", { code: totp(s.body.secret) })).status).toBe(200);
  return c;
}

const premium = async (c: Client) => (await c.get("/entitlements")).body.planCode;

describe("Razorpay subscriptions — test mode (D-01)", () => {
  beforeAll(async () => {
    await resetDb();
    await db().execute(sql`UPDATE subscription_plans SET gateway_plan_id = NULL`);
    vi.stubGlobal("fetch", fakeRazorpay);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_ALLOW_LIVE"]) delete process.env[k];
  });
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_FAKEKEY123";
    process.env.RAZORPAY_KEY_SECRET = "fake_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = WH;
    delete process.env.RAZORPAY_ALLOW_LIVE;
  });

  it("only TEST keys switch payments on; live or unrecognised keys stay off", async () => {
    expect((await new Client().get("/plans")).body).toMatchObject({ paymentsEnabled: true, paymentsMode: "test" });
    process.env.RAZORPAY_KEY_ID = "rzp_live_SOMETHING";
    expect((await new Client().get("/plans")).body).toMatchObject({ paymentsEnabled: false, paymentsMode: "off" });
    process.env.RAZORPAY_KEY_ID = "not_a_key";
    expect((await new Client().get("/plans")).body.paymentsEnabled).toBe(false);
    process.env.RAZORPAY_KEY_SECRET = "";
    expect((await new Client().get("/plans")).body.paymentsEnabled).toBe(false);
  });

  it("admin sees gateway status without secret values, creates test plans and validates linked plans", async () => {
    const a = await admin();
    const st = await a.get("/admin/payments/gateway");
    expect(st.body).toMatchObject({ mode: "test", enabled: true, keyIdSet: true, keySecretSet: true, webhookSecretSet: true, keysValid: true, subscriptionsEnabled: true });
    expect(JSON.stringify(st.body)).not.toContain("fake_secret");
    expect(JSON.stringify(st.body)).not.toContain(WH);
    expect(st.body.webhookUrl).toMatch(/\/api\/v1\/payments\/webhook\/razorpay$/);
    expect(st.body.plans.map((p: { code: string }) => p.code)).toEqual(["attendee_premium_monthly", "attendee_premium_yearly", "org_pro_monthly", "org_business_monthly"]);

    const m = await a.post("/admin/payments/plans/attendee_premium_monthly/create");
    expect(m.body.gatewayPlanId).toMatch(/^plan_/);
    expect(gateway.plans.get(m.body.gatewayPlanId)).toMatchObject({ period: "monthly", interval: 1, item: { amount: 9900, currency: "INR" } });
    expect((await a.post("/admin/payments/plans/attendee_premium_monthly/create")).body.code).toBe("already_linked");
    // Linking validates against Razorpay: the monthly plan can't be linked as the yearly one
    const bad = await a.put("/admin/payments/plans/attendee_premium_yearly/gateway", { gatewayPlanId: m.body.gatewayPlanId });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.gatewayPlanId[0]).toMatch(/yearly.*79900 paise/);
    expect((await a.put("/admin/payments/plans/attendee_premium_yearly/gateway", { gatewayPlanId: "nope" })).status).toBe(400);
    const y = await a.post("/admin/payments/plans/attendee_premium_yearly/create");
    expect(gateway.plans.get(y.body.gatewayPlanId)).toMatchObject({ period: "yearly", item: { amount: 79900 } });
    // Never against live keys
    process.env.RAZORPAY_KEY_ID = "rzp_live_X";
    process.env.RAZORPAY_ALLOW_LIVE = "1";
    expect((await a.post("/admin/payments/plans/org_pro_monthly/create")).body.code).toBe("test_mode_required");
    // Non-admins can't see any of it
    const { org } = await setupEvent();
    expect((await org.get("/admin/payments/gateway")).status).toBe(403);
  });

  it("checkout → webhook activation → renewal → cancel; Premium only from verified webhooks", async () => {
    const { qr } = await setupEvent();
    const u = await createAttendee(qr);
    const co = await u.client.post("/subscriptions/checkout", { planCode: "attendee_premium_monthly" });
    expect(co.status).toBe(200);
    expect(co.body).toMatchObject({ gateway: "razorpay", mode: "test", keyId: "rzp_test_FAKEKEY123" });
    expect(JSON.stringify(co.body)).not.toContain("fake_secret");
    expect(gateway.subs.at(-1)).toMatchObject({ plan_id: expect.stringMatching(/^plan_/), total_count: 60 });
    const subId = co.body.subscriptionId as string;
    expect(await premium(u.client)).not.toBe("attendee_premium"); // paying in the browser grants nothing by itself

    // Forged / unsigned webhooks are rejected
    expect((await webhook("subscription.activated", { id: subId, status: "active" }, undefined, { secret: "wrong" })).status).toBe(401);
    expect(await premium(u.client)).not.toBe("attendee_premium");

    const start = Math.floor(Date.now() / 1000) - 60, end = start + 30 * 86400;
    await webhook("subscription.authenticated", { id: subId, status: "authenticated" });
    const act = await webhook("subscription.activated", { id: subId, status: "active", current_start: start, current_end: end },
      { id: "pay_T1", amount: 9900, currency: "INR", status: "captured", method: "card" }, { id: "evt_activate" });
    expect(act.body.status).toBe("ok");
    expect(await premium(u.client)).toBe("attendee_premium");
    expect((await webhook("subscription.activated", { id: subId, status: "active", current_start: start, current_end: end }, undefined, { id: "evt_activate" })).body.status).toBe("duplicate");
    // Late, out-of-order "authenticated" must not downgrade
    await webhook("subscription.authenticated", { id: subId, status: "authenticated" });
    const bill = await u.client.get("/me/billing");
    expect(bill.body.subscription).toMatchObject({ status: "active", planCode: "attendee_premium_monthly" });
    expect(bill.body.payments).toEqual([expect.objectContaining({ amountMinor: 9900, status: "captured", method: "card" })]);

    // Only one subscription at a time — refused before anything is created at Razorpay
    const before = gateway.subs.length;
    expect((await u.client.post("/subscriptions/checkout", { planCode: "attendee_premium_yearly" })).body.code).toBe("already_subscribed");
    expect(gateway.subs.length).toBe(before);

    // Renewal charge extends access; a payment status update is applied, not ignored
    await webhook("subscription.charged", { id: subId, status: "active", current_start: end, current_end: end + 30 * 86400 }, { id: "pay_T2", amount: 9900, currency: "INR", status: "authorized" });
    await webhook("subscription.charged", { id: subId, status: "active", current_start: end, current_end: end + 30 * 86400 }, { id: "pay_T2", amount: 9900, currency: "INR", status: "captured" });
    const rows = (await db().execute<{ status: string; n: number }>(sql`SELECT status, count(*)::int AS n FROM payments WHERE gateway_payment_id = 'pay_T2' GROUP BY status`)).rows;
    expect(rows).toEqual([{ status: "captured", n: 1 }]);
    const [{ until }] = (await db().execute<{ until: Date }>(sql`SELECT max(valid_until) AS until FROM user_entitlements WHERE attendee_id = (SELECT attendee_id FROM user_profiles WHERE id = ${u.profileId})`)).rows;
    expect(new Date(until).getTime()).toBe((end + 30 * 86400) * 1000 + 86_400_000); // period end + 1 day renewal grace

    // Cancel at period end: Razorpay told to cancel at cycle end, access remains for the paid period
    expect((await u.client.post("/subscriptions/cancel")).status).toBe(204);
    expect(gateway.cancels).toContain(subId);
    expect(await premium(u.client)).toBe("attendee_premium");
    await webhook("subscription.cancelled", { id: subId, status: "cancelled", current_start: end, current_end: end + 30 * 86400 });
    expect(await premium(u.client)).toBe("attendee_premium");
    await webhook("subscription.activated", { id: subId, status: "active" }); // stray late event after cancellation
    expect((await u.client.get("/me/billing")).body.subscription.status).toBe("cancelled");
  });

  it("failed renewals notify, halt removes access, full refunds revoke; processing failures are retried", async () => {
    const { qr } = await setupEvent();
    const u = await createAttendee(qr);
    const co = await u.client.post("/subscriptions/checkout", { planCode: "attendee_premium_yearly" });
    const subId = co.body.subscriptionId as string;
    expect(gateway.subs.at(-1)).toMatchObject({ total_count: 5 });
    const start = Math.floor(Date.now() / 1000), end = start + 365 * 86400;
    await webhook("subscription.activated", { id: subId, status: "active", current_start: start, current_end: end }, { id: "pay_Y1", amount: 79900, currency: "INR", status: "captured" });
    expect(await premium(u.client)).toBe("attendee_premium");

    await webhook("subscription.pending", { id: subId, status: "pending", current_start: start, current_end: end });
    const notes = await u.client.get("/me/notifications");
    expect(notes.body.items[0]).toMatchObject({ type: "billing.payment_failed", category: "billing", title: "Premium payment failed", link: "/app/premium" });
    await webhook("subscription.halted", { id: subId, status: "halted", current_start: start, current_end: end });
    expect(await premium(u.client)).not.toBe("attendee_premium");
    await webhook("subscription.resumed", { id: subId, status: "active", current_start: start, current_end: end });
    expect(await premium(u.client)).toBe("attendee_premium");

    await webhook("refund.processed", null, { id: "pay_Y1", amount: 79900, currency: "INR", status: "refunded", amount_refunded: 79900 });
    expect(await premium(u.client)).not.toBe("attendee_premium");
    expect((await u.client.get("/me/billing")).body.payments[0]).toMatchObject({ status: "refunded" });

    // If processing throws, the event is NOT recorded, so Razorpay's retry is processed instead of skipped
    const id = "evt_retry_me";
    await db().execute(sql`ALTER TABLE subscriptions ADD CONSTRAINT tmp_block CHECK (status <> 'pending') NOT VALID`);
    try {
      expect((await webhook("subscription.pending", { id: subId, status: "pending" }, undefined, { id })).status).toBe(500);
    } finally {
      await db().execute(sql`ALTER TABLE subscriptions DROP CONSTRAINT tmp_block`);
    }
    expect((await webhook("subscription.pending", { id: subId, status: "pending" }, undefined, { id })).body.status).toBe("ok");
  });

  it("webhooks without a configured secret are refused (Razorpay retries later)", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "";
    expect((await webhook("subscription.activated", { id: "sub_x", status: "active" })).status).toBe(503);
  });

  it("status transitions never move backwards", () => {
    expect(nextSubscriptionStatus("active", "authenticated", true)).toBe("active");
    expect(nextSubscriptionStatus("created", "authenticated", false)).toBe("authenticated");
    expect(nextSubscriptionStatus("cancelled", "active", true)).toBe("cancelled");
    expect(nextSubscriptionStatus("completed", "halted", true)).toBe("completed");
    expect(nextSubscriptionStatus("active", "paused", true)).toBe("halted");
    expect(nextSubscriptionStatus("halted", "active", true)).toBe("active");
    expect(nextSubscriptionStatus("active", "weird", true)).toBe("active");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Organizer pricing: Starter (3 lifetime events), Pro, Business, Single Event — and centralized entitlements.
// ---------------------------------------------------------------------------------------------------------------------
async function organizer(name = "Org") {
  const c = new Client();
  const email = `${uniq("orgbill")}@example.com`;
  expect((await c.post("/organizer/auth/register", { email, password: "correct horse battery staple", displayName: name })).status).toBe(201);
  return { c, email };
}
async function orgWithOwner() {
  const o = await organizer("Owner");
  const org = await o.c.post("/organizations", { name: `Billing Org ${uniq()}` });
  expect(org.status).toBe(201);
  return { owner: o.c, ownerEmail: o.email, orgId: org.body.id as string };
}
async function userId(email: string) {
  const [{ id }] = (await db().execute<{ id: string }>(sql`SELECT id FROM organizer_users WHERE email_normalized = ${email.toLowerCase()}`)).rows as [{ id: string }];
  return id;
}
let categoryId = "";
const eventBody = (name = "Event") => {
  const start = new Date(Date.now() + 2 * 86_400_000);
  return { name, categoryId, venueName: "Hall", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3 * 3_600_000).toISOString() };
};
const createEvent = (c: Client, orgId: string, name?: string) => c.post(`/organizations/${orgId}/events`, eventBody(name));
const billingOf = async (c: Client, orgId: string) => (await c.get(`/organizations/${orgId}/billing`)).body;
const sign = (orderId: string, payId: string) => createHmac("sha256", "fake_secret").update(`${orderId}|${payId}`).digest("hex");

describe("Organizer plans, lifetime free events and entitlements", () => {
  let adminClient: Client;
  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_FAKEKEY123";
    process.env.RAZORPAY_KEY_SECRET = "fake_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = WH;
    await resetDb();
    await db().execute(sql`UPDATE subscription_plans SET gateway_plan_id = NULL`);
    vi.stubGlobal("fetch", fakeRazorpay);
    categoryId = ((await new Client().get("/public/categories")).body as { id: string }[])[0]!.id;
    adminClient = await admin();
    for (const code of ["org_pro_monthly", "org_business_monthly"]) {
      const r = await adminClient.post(`/admin/payments/plans/${code}/create`);
      expect(r.body.gatewayPlanId).toMatch(/^plan_/);
      expect(gateway.plans.get(r.body.gatewayPlanId)).toMatchObject({ period: "monthly", interval: 1, item: { amount: code === "org_pro_monthly" ? 49900 : 149900, currency: "INR" } });
    }
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_FAKEKEY123";
    process.env.RAZORPAY_KEY_SECRET = "fake_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = WH;
  });

  it("publishes the exact organizer pricing and keeps attendee Premium pricing", async () => {
    const org = (await new Client().get("/plans?audience=organization")).body.plans as { code: string; name: string; priceMinor: number; billingPeriod: string; purchasable: boolean }[];
    expect(org.map((p) => [p.name, p.priceMinor, p.billingPeriod])).toEqual([["Starter", 0, "none"], ["Pro", 49900, "month"], ["Business", 149900, "month"], ["Single Event", 19900, "one_time"]]);
    expect(org.find((p) => p.code === "org_event_package")!.purchasable).toBe(true);
    const att = (await new Client().get("/plans")).body.plans as { priceMinor: number; billingPeriod: string }[];
    expect(att.map((p) => [p.priceMinor, p.billingPeriod])).toEqual([[0, "none"], [9900, "month"], [79900, "year"]]);
  });

  it("3 free events per organization; the 4th is blocked; deleting and failed creations never restore or consume", async () => {
    const { owner, orgId } = await orgWithOwner();
    expect((await billingOf(owner, orgId)).allowance).toMatchObject({ freeLimit: 3, freeUsed: 0, freeRemaining: 3, canCreateEvent: true });
    // Validation failure consumes nothing
    expect((await owner.post(`/organizations/${orgId}/events`, { ...eventBody(), name: "" })).status).toBe(400);
    // A database failure inside the creating transaction consumes nothing either
    await db().execute(sql`ALTER TABLE events ADD CONSTRAINT tmp_no_boom CHECK (name <> 'boom') NOT VALID`);
    try { expect((await createEvent(owner, orgId, "boom")).status).toBe(500); } finally { await db().execute(sql`ALTER TABLE events DROP CONSTRAINT tmp_no_boom`); }
    expect((await billingOf(owner, orgId)).allowance.freeUsed).toBe(0);

    const ids: string[] = [];
    for (const n of [1, 2, 3]) { const r = await createEvent(owner, orgId, `Free ${n}`); expect(r.status).toBe(201); ids.push(r.body.id); }
    const fourth = await createEvent(owner, orgId, "Fourth");
    expect(fourth.status).toBe(402);
    expect(fourth.body).toMatchObject({ code: "event_allowance_exhausted", freeLimit: 3 });
    // Draft deletion works but does not give the allowance back
    expect((await owner.del(`/organizer/events/${ids[0]}`)).status).toBe(204);
    expect((await createEvent(owner, orgId, "After delete")).status).toBe(402);
    expect((await billingOf(owner, orgId)).allowance).toMatchObject({ eventsCreated: 3, freeUsed: 3, freeRemaining: 0, canCreateEvent: false });
    // Published events can't be deleted (archive instead); editing never consumes allowance
    expect((await owner.post(`/organizer/events/${ids[1]}/publish`)).status).toBe(200);
    expect((await owner.del(`/organizer/events/${ids[1]}`)).body.code).toBe("event_not_deletable");
    expect((await owner.patch(`/organizer/events/${ids[2]}`, { name: "Renamed" })).status).toBe(200);
    expect((await billingOf(owner, orgId)).allowance.eventsCreated).toBe(3);
  });

  it("concurrent creation can't overspend the allowance", async () => {
    const { owner, orgId } = await orgWithOwner();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => createEvent(owner, orgId, `Race ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 402)).toHaveLength(5);
    const [{ n }] = (await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM events WHERE organization_id = ${orgId}`)).rows as [{ n: number }];
    expect(n).toBe(3);
    expect((await billingOf(owner, orgId)).allowance.eventsCreated).toBe(3);
  });

  it("the allowance is shared by every organizer account in the organization", async () => {
    const { owner, orgId } = await orgWithOwner();
    const m = await organizer("Member");
    await db().execute(sql`INSERT INTO organization_members (organization_id, organizer_user_id, role) VALUES (${orgId}, ${await userId(m.email)}, 'member')`);
    expect((await createEvent(owner, orgId)).status).toBe(201);
    expect((await createEvent(m.c, orgId)).status).toBe(201);
    expect((await createEvent(owner, orgId)).status).toBe(201);
    expect((await createEvent(m.c, orgId)).status).toBe(402);
    // A new organization has its own 3
    const other = await m.c.post("/organizations", { name: `Second ${uniq()}` });
    expect((await createEvent(m.c, other.body.id)).status).toBe(201);
  });

  it("Starter is blocked from every premium API; outsiders and non-owners are refused", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = (await createEvent(owner, orgId)).body.id as string;
    await owner.post(`/organizer/events/${ev}/publish`);
    const blocked = [
      await owner.put(`/organizer/events/${ev}/suggestions`, { interestIds: [] }),
      await owner.get(`/organizer/events/${ev}/participants/export`),
      await owner.get(`/organizations/${orgId}/analytics`),
      await owner.post(`/organizations/${orgId}/members`, { email: "someone@example.com" }),
      await owner.req("PUT", `/organizer/events/${ev}/banner`, new FormData()),
    ];
    for (const r of blocked) { expect(r.status).toBe(403); expect(r.body.code).toBe("entitlement_required"); }
    expect(blocked.map((r) => r.body.requiredPlan)).toEqual(["pro", "pro", "business", "business", "pro"]);
    // Basic statistics and Pulse stay available; detailed parts are withheld server-side
    expect((await owner.get(`/organizer/events/${ev}/participants/stats`)).body).toMatchObject({ detailed: false, connections: null, today: null });
    expect((await owner.get(`/organizer/events/${ev}/pulse`)).body).toMatchObject({ advanced: false, byIntention: [], topInterests: [] });
    // Basic networking configuration (feature toggles) is Starter
    expect((await owner.put(`/organizer/events/${ev}/networking-settings`, { pulseEnabled: false })).status).toBe(200);

    const stranger = (await organizer("Stranger")).c;
    expect((await stranger.get(`/organizations/${orgId}/billing`)).status).toBe(404);
    expect((await stranger.post(`/organizations/${orgId}/billing/checkout`, { planCode: "org_pro_monthly" })).status).toBe(404);
    expect((await stranger.post(`/organizations/${orgId}/events`, eventBody())).status).toBe(404);
    const m = await organizer("Member");
    await db().execute(sql`INSERT INTO organization_members (organization_id, organizer_user_id, role) VALUES (${orgId}, ${await userId(m.email)}, 'member')`);
    expect((await m.c.post(`/organizations/${orgId}/billing/checkout`, { planCode: "org_pro_monthly" })).status).toBe(403);
    expect((await m.c.post(`/organizations/${orgId}/billing/event-credits/order`)).status).toBe(403);
    expect((await m.c.post(`/organizations/${orgId}/billing/cancel`)).status).toBe(403);
  });

  it("Pro via verified webhook: unlimited events and Pro features; Business-only features stay locked", async () => {
    const { owner, orgId } = await orgWithOwner();
    for (let i = 0; i < 3; i++) await createEvent(owner, orgId);
    const co = await owner.post(`/organizations/${orgId}/billing/checkout`, { planCode: "org_pro_monthly" });
    expect(co.status).toBe(200);
    expect(co.body).toMatchObject({ kind: "subscription", mode: "test", keyId: "rzp_test_FAKEKEY123" });
    expect(gateway.subs.at(-1)).toMatchObject({ notes: { organization_id: orgId, plan_code: "org_pro_monthly" } });
    // Checkout success in the browser grants nothing
    expect((await createEvent(owner, orgId)).status).toBe(402);
    const start = Math.floor(Date.now() / 1000) - 60, end = start + 30 * 86400;
    await webhook("subscription.activated", { id: co.body.subscriptionId, status: "active", current_start: start, current_end: end }, { id: "pay_ORGPRO1", amount: 49900, currency: "INR", status: "captured", method: "upi" });
    const b = await billingOf(owner, orgId);
    expect(b).toMatchObject({ tier: "pro", planName: "Pro", source: "subscription", subscription: { status: "active", planCode: "org_pro_monthly" } });
    expect(b.payments).toEqual([expect.objectContaining({ amountMinor: 49900, status: "captured", description: "Pro" })]);
    const fourth = await createEvent(owner, orgId, "Pro event");
    expect(fourth.status).toBe(201);
    expect((await db().execute<{ s: string }>(sql`SELECT allowance_source AS s FROM events WHERE id = ${fourth.body.id}`)).rows[0]!.s).toBe("plan");
    await owner.post(`/organizer/events/${fourth.body.id}/publish`);
    expect((await owner.put(`/organizer/events/${fourth.body.id}/suggestions`, { interestIds: [] })).status).toBe(200);
    expect((await owner.get(`/organizer/events/${fourth.body.id}/participants/export`)).status).toBe(200);
    expect((await owner.get(`/organizer/events/${fourth.body.id}/participants/stats`)).body.detailed).toBe(true);
    expect((await owner.get(`/organizer/events/${fourth.body.id}/pulse`)).body.advanced).toBe(true);
    expect((await owner.get(`/organizations/${orgId}/analytics`)).body.requiredPlan).toBe("business");
    expect((await owner.post(`/organizations/${orgId}/members`, { email: "x@example.com" })).body.requiredPlan).toBe("business");
    // One subscription at a time
    expect((await owner.post(`/organizations/${orgId}/billing/checkout`, { planCode: "org_business_monthly" })).body.code).toBe("already_subscribed");
    // Cancel: Razorpay told to cancel at cycle end, Pro continues for the paid period
    expect((await owner.post(`/organizations/${orgId}/billing/cancel`)).status).toBe(204);
    expect(gateway.cancels).toContain(co.body.subscriptionId);
    expect((await billingOf(owner, orgId)).subscription.cancelAtPeriodEnd).toBe(true);
    expect((await createEvent(owner, orgId)).status).toBe(201);
  });

  it("Business includes Pro: members, cross-event analytics and organization report", async () => {
    const { owner, orgId } = await orgWithOwner();
    const co = await owner.post(`/organizations/${orgId}/billing/checkout`, { planCode: "org_business_monthly" });
    const start = Math.floor(Date.now() / 1000) - 60;
    await webhook("subscription.charged", { id: co.body.subscriptionId, status: "active", current_start: start, current_end: start + 30 * 86400 }, { id: "pay_ORGBIZ1", amount: 149900, currency: "INR", status: "captured" });
    const b = await billingOf(owner, orgId);
    expect(b.tier).toBe("business");
    expect(b.features).toEqual(expect.arrayContaining(["org.events.unlimited", "org.reports.export", "org.members", "org.analytics.cross_event"]));
    for (let i = 0; i < 5; i++) expect((await createEvent(owner, orgId)).status).toBe(201);
    const m = await organizer("Teammate");
    expect((await owner.post(`/organizations/${orgId}/members`, { email: "nobody-here@example.com" })).status).toBe(400);
    expect((await owner.post(`/organizations/${orgId}/members`, { email: m.email })).status).toBe(201);
    expect((await owner.post(`/organizations/${orgId}/members`, { email: m.email })).body.code).toBe("already_member");
    const members = (await m.c.get(`/organizations/${orgId}/members`)).body;
    expect(members.members.map((x: { role: string }) => x.role)).toEqual(["owner", "member"]);
    expect(members.canInvite).toBe(false); // members can't invite
    expect((await createEvent(m.c, orgId)).status).toBe(201);
    const a = await m.c.get(`/organizations/${orgId}/analytics`);
    expect(a.status).toBe(200);
    expect(a.body.totals).toMatchObject({ joined: 0, connections: 0 });
    const csv = await owner.get(`/organizations/${orgId}/analytics?format=csv`);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    // Members may leave; the owner can't
    expect((await owner.del(`/organizations/${orgId}/members/${members.members[0].userId}`)).body.code).toBe("owner_required");
    expect((await m.c.del(`/organizations/${orgId}/members/${await userId(m.email)}`)).status).toBe(204);
    expect((await m.c.get(`/organizations/${orgId}/billing`)).status).toBe(404);
  });

  it("Single Event: order → verified payment → exactly one credit → one more event; webhooks and retries are idempotent", async () => {
    const { owner, orgId } = await orgWithOwner();
    for (let i = 0; i < 3; i++) await createEvent(owner, orgId);
    const o = await owner.post(`/organizations/${orgId}/billing/event-credits/order`);
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ kind: "order", amountMinor: 19900, currency: "INR", mode: "test" });
    expect(gateway.orders.get(o.body.orderId)).toMatchObject({ amount: 19900, currency: "INR", notes: { organization_id: orgId, purpose: "event_credit" } });
    const orderId = o.body.orderId as string;
    const verify = (paymentId: string, signature: string) => owner.post(`/organizations/${orgId}/billing/event-credits/verify`, { orderId, paymentId, signature });
    // Forged signature and a payment that isn't for this order are rejected
    gateway.payments.set("pay_SE1abcdef", { id: "pay_SE1abcdef", order_id: orderId, amount: 19900, currency: "INR", status: "authorized", method: "card" });
    expect((await verify("pay_SE1abcdef", "00".repeat(32))).body.code).toBe("invalid_signature");
    gateway.payments.set("pay_OTHERabc", { id: "pay_OTHERabc", order_id: "order_elsewhere1", amount: 19900, currency: "INR", status: "captured" });
    expect((await verify("pay_OTHERabc", sign(orderId, "pay_OTHERabc"))).body.code).toBe("invalid_payment");
    expect((await billingOf(owner, orgId)).allowance.credits).toBe(0);
    // Valid: server fetches the payment, captures the authorization, grants one credit
    expect((await verify("pay_SE1abcdef", sign(orderId, "pay_SE1abcdef"))).body).toEqual({ status: "granted" });
    expect(gateway.captures).toContain("pay_SE1abcdef");
    expect((await verify("pay_SE1abcdef", sign(orderId, "pay_SE1abcdef"))).body).toEqual({ status: "already" });
    await webhook("payment.captured", null, { id: "pay_SE1abcdef", order_id: orderId, amount: 19900, currency: "INR", status: "captured" });
    await webhook("order.paid", null, { id: "pay_SE1abcdef", order_id: orderId, amount: 19900, currency: "INR", status: "captured" });
    const b = await billingOf(owner, orgId);
    expect(b.allowance).toMatchObject({ credits: 1, canCreateEvent: true });
    expect(b.payments).toEqual([expect.objectContaining({ purpose: "event_credit", amountMinor: 19900, status: "captured", description: "Single Event" })]);
    const ev = await createEvent(owner, orgId, "Paid single");
    expect(ev.status).toBe(201);
    expect((await createEvent(owner, orgId)).status).toBe(402);
    expect((await billingOf(owner, orgId)).credits[0]).toMatchObject({ eventName: "Paid single" });
    // A refund after use never deletes the event
    await webhook("refund.processed", null, { id: "pay_SE1abcdef", amount: 19900, currency: "INR", status: "refunded", amount_refunded: 19900 });
    expect((await owner.get(`/organizer/events/${ev.body.id}`)).status).toBe(200);
  });

  it("webhook alone grants a Single Event credit; a full refund withdraws an unused credit; failures grant nothing", async () => {
    const { owner, orgId } = await orgWithOwner();
    const o1 = await owner.post(`/organizations/${orgId}/billing/event-credits/order`);
    await webhook("payment.failed", null, { id: "pay_FAIL1abc", order_id: o1.body.orderId, amount: 19900, currency: "INR", status: "failed", error_description: "Card declined" });
    expect((await billingOf(owner, orgId)).allowance.credits).toBe(0);
    expect((await billingOf(owner, orgId)).payments[0]).toMatchObject({ status: "failed" });
    // Wrong amount never grants
    const o2 = await owner.post(`/organizations/${orgId}/billing/event-credits/order`);
    await webhook("payment.captured", null, { id: "pay_LOW1abcd", order_id: o2.body.orderId, amount: 100, currency: "INR", status: "captured" });
    expect((await billingOf(owner, orgId)).allowance.credits).toBe(0);
    await webhook("payment.captured", null, { id: "pay_OK1abcde", order_id: o2.body.orderId, amount: 19900, currency: "INR", status: "captured" });
    expect((await billingOf(owner, orgId)).allowance.credits).toBe(1);
    await webhook("refund.processed", null, { id: "pay_OK1abcde", amount: 19900, currency: "INR", status: "refunded", amount_refunded: 19900 });
    expect((await billingOf(owner, orgId)).allowance.credits).toBe(0);
  });

  it("expired or halted subscriptions remove paid access but never delete events or data", async () => {
    const { owner, orgId } = await orgWithOwner();
    const co = await owner.post(`/organizations/${orgId}/billing/checkout`, { planCode: "org_pro_monthly" });
    const now = Math.floor(Date.now() / 1000);
    await webhook("subscription.activated", { id: co.body.subscriptionId, status: "active", current_start: now - 60, current_end: now + 86400 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await createEvent(owner, orgId)).body.id);
    await owner.post(`/organizer/events/${ids[4]}/publish`);
    expect((await owner.put(`/organizer/events/${ids[4]}/suggestions`, { interestIds: [] })).status).toBe(200);
    // Payment retries exhausted → halted: access stops now
    await webhook("subscription.halted", { id: co.body.subscriptionId, status: "halted", current_start: now - 60, current_end: now + 86400 });
    expect((await billingOf(owner, orgId)).tier).toBe("starter");
    expect((await createEvent(owner, orgId)).status).toBe(402);
    expect((await owner.put(`/organizer/events/${ids[4]}/suggestions`, { interestIds: [] })).status).toBe(403);
    for (const id of ids) expect((await owner.get(`/organizer/events/${id}`)).status).toBe(200);
    expect((await owner.get(`/organizations/${orgId}/events`)).body).toHaveLength(5);
    // A period that ended (plus grace) without renewal: entitlements lapse on their own; maintenance marks it expired
    const { orgId: org2, owner: o2 } = await orgWithOwner();
    const co2 = await o2.post(`/organizations/${org2}/billing/checkout`, { planCode: "org_pro_monthly" });
    await webhook("subscription.activated", { id: co2.body.subscriptionId, status: "active", current_start: now - 40 * 86400, current_end: now - 10 * 86400 });
    expect((await billingOf(o2, org2)).tier).toBe("starter");
    expect((await billingOf(o2, org2)).subscription.status).toBe("expired");
    process.env.CRON_SECRET = "cron_secret_for_tests_123";
    expect((await new Client().req("GET", "/cron/maintenance", undefined, { authorization: "Bearer cron_secret_for_tests_123" })).status).toBe(200);
    const [{ status }] = (await db().execute<{ status: string }>(sql`SELECT status FROM subscriptions WHERE gateway_subscription_id = ${co2.body.subscriptionId}`)).rows as [{ status: string }];
    expect(status).toBe("expired");
  });

  it("admin: organizer plans, allowance, revenue; promotional Business access and event credits", async () => {
    const { owner, orgId } = await orgWithOwner();
    // Other organizations already have subscriptions and payments; none of it may leak into this one (regression).
    expect(await billingOf(owner, orgId)).toMatchObject({ subscription: null, payments: [], credits: [], tier: "starter" });
    for (let i = 0; i < 3; i++) await createEvent(owner, orgId);
    // Promotions are admin-only and validated
    expect((await owner.post("/admin/promotional-access", { organizationId: orgId, planCode: "org_business_monthly", days: 30 })).status).toBe(403);
    expect((await adminClient.post("/admin/promotional-access", { organizationId: "00000000-0000-4000-8000-000000000000", planCode: "org_business_monthly", days: 30 })).status).toBe(400);
    expect((await adminClient.post("/admin/promotional-access", { organizationId: orgId, planCode: "org_starter", days: 30 })).status).toBe(400);
    const promo = await adminClient.post("/admin/promotional-access", { organizationId: orgId, planCode: "org_business_monthly", days: 30, reason: "Pilot" });
    expect(promo.status).toBe(201);
    expect(await billingOf(owner, orgId)).toMatchObject({ tier: "business", source: "promo" });
    expect((await createEvent(owner, orgId)).status).toBe(201);
    expect((await adminClient.post(`/admin/promotional-access/${promo.body.id}/revoke`)).status).toBe(204);
    expect((await billingOf(owner, orgId)).tier).toBe("starter");
    // Event credits as a promotion
    expect((await adminClient.post("/admin/promotional-access", { organizationId: orgId, planCode: "org_event_package", credits: 2, reason: "Festival" })).body).toEqual({ credits: 2 });
    expect((await billingOf(owner, orgId)).allowance.credits).toBe(2);
    expect((await createEvent(owner, orgId)).status).toBe(201);
    const ov = (await adminClient.get("/admin/billing")).body;
    const row = ov.organizers.organizations.find((o: { id: string }) => o.id === orgId);
    expect(row).toMatchObject({ tier: "starter", eventsCreated: 5, freeUsed: 3, freeRemaining: 0, creditsAvailable: 1, creditsUsed: 1 });
    expect(ov.organizers.totals).toEqual(expect.objectContaining({ revenue_minor: expect.any(Number), event_purchases: expect.any(Number), pro_active: expect.any(Number) }));
    const unused = ov.eventCreditGrants.find((g: { consumedAt: string | null; revokedAt: string | null }) => !g.consumedAt && !g.revokedAt);
    expect((await adminClient.post(`/admin/event-credits/${unused.id}/revoke`)).status).toBe(204);
    expect((await billingOf(owner, orgId)).allowance.credits).toBe(0);
  });
});
