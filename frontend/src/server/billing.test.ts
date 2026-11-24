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
const gateway = { plans: new Map<string, Record<string, unknown>>(), subs: [] as Record<string, unknown>[], cancels: [] as string[], seq: 0 };

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
    expect(st.body.plans.map((p: { code: string }) => p.code)).toEqual(["attendee_premium_monthly", "attendee_premium_yearly"]);

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
    expect(JSON.stringify(notes.body)).toContain("renewal payment failed");
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
