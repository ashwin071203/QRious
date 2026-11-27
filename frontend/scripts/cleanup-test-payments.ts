/**
 * Removes Razorpay TEST-MODE billing data before (or right after) going live, so test purchases never keep paid access
 * and never show up in billing history or admin revenue.
 *
 *   npx tsx scripts/cleanup-test-payments.ts                      # dry run (default): prints exactly what would go
 *   npx tsx scripts/cleanup-test-payments.ts --apply --expect=N   # deletes, only if the dry run's total is still N
 *
 * What counts as test mode: rows tagged gateway_mode = 'test' (migration 0005 tagged every pre-existing gateway row as
 * test, because the app refused live keys until then). If the column doesn't exist yet (migration not deployed), every
 * gateway row is test by the same reasoning. Rows tagged 'live' are never touched.
 *
 * Removed: test subscriptions, test payments/orders (+ their invoices), Single Event credits bought with test payments,
 * the Premium/Pro/Business entitlement rows those subscriptions granted, billing notifications about them, and
 * test-mode webhook logs.
 * Kept: every user account, organization, event and profile; admin-granted promotional access and admin-granted event
 * credits; the audit log. Events created with a test credit or during a test Pro period stay.
 *
 * Everything runs in ONE transaction: it either all happens or nothing does.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { Client } from "pg";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expect = Number(args.find((a) => a.startsWith("--expect="))?.split("=")[1] ?? NaN);

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
  if (!url) throw new Error("No DATABASE_URL configured.");
  const u = new URL(url);
  console.log(`database: ${u.hostname.split(".")[0]}…/${u.pathname.slice(1)}   mode: ${apply ? "APPLY" : "DRY RUN (nothing is deleted)"}\n`);
  if (apply && !Number.isFinite(expect)) throw new Error("--apply needs --expect=<total from the dry run>, so only what you reviewed is deleted.");

  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    const hasCol = async (table: string, col: string) =>
      (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, col])).rowCount! > 0;
    // "Is test" predicates. Without the column, nothing can be live yet (payments refused live keys before migration 0005).
    const subTest = (await hasCol("subscriptions", "gateway_mode")) ? `coalesce(s.gateway_mode, 'test') = 'test'` : `true`;
    const payTest = (await hasCol("payments", "gateway_mode")) ? `coalesce(p.gateway_mode, 'test') = 'test'` : `true`;
    const whTest = (await hasCol("payment_webhooks", "gateway_mode")) ? `coalesce(w.gateway_mode, 'test') = 'test'` : `true`;

    await c.query(`CREATE TEMP TABLE t_subs ON COMMIT DROP AS SELECT s.id FROM subscriptions s WHERE ${subTest}`);
    await c.query(`CREATE TEMP TABLE t_pays ON COMMIT DROP AS SELECT p.id FROM payments p WHERE ${payTest}
      OR p.subscription_id IN (SELECT id FROM t_subs)`);
    // A live payment must never hang off a test subscription; refuse rather than guess.
    const mixed = (await c.query(`SELECT count(*)::int AS n FROM payments WHERE subscription_id IN (SELECT id FROM t_subs) AND id NOT IN (SELECT id FROM payments p WHERE ${payTest})`)).rows[0].n;
    if (mixed) throw new Error(`${mixed} live payment(s) belong to test subscriptions — refusing. Investigate before cleaning up.`);

    const subs = (await c.query(`SELECT s.id, s.subscriber_type, s.status, pl.name AS plan, s.created_at, s.current_period_end,
        coalesce(o.name, up.username) AS owner
      FROM subscriptions s JOIN subscription_plans pl ON pl.id = s.plan_id LEFT JOIN organizations o ON o.id = s.organization_id
      LEFT JOIN LATERAL (SELECT username FROM user_profiles WHERE attendee_id = s.attendee_id ORDER BY created_at LIMIT 1) up ON true
      WHERE s.id IN (SELECT id FROM t_subs) ORDER BY s.created_at`)).rows;
    const pays = (await c.query(`SELECT p.id, p.payer_type, p.purpose, p.status, p.amount_minor, p.refunded_minor, p.created_at,
        coalesce(o.name, up.username) AS owner
      FROM payments p LEFT JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN LATERAL (SELECT username FROM user_profiles WHERE attendee_id = p.attendee_id ORDER BY created_at LIMIT 1) up ON true
      WHERE p.id IN (SELECT id FROM t_pays) ORDER BY p.created_at`)).rows;
    const credits = (await c.query(`SELECT c.id, o.name AS owner, c.consumed_at, c.revoked_at, e.name AS event
      FROM organization_event_credits c JOIN organizations o ON o.id = c.organization_id LEFT JOIN events e ON e.id = c.consumed_event_id
      WHERE c.payment_id IN (SELECT id FROM t_pays) ORDER BY c.created_at`)).rows;
    const n = async (q: string) => Number((await c.query(q)).rows[0].n);
    const counts = {
      user_entitlements: await n(`SELECT count(*)::int AS n FROM user_entitlements WHERE source_type = 'subscription' AND source_id IN (SELECT id FROM t_subs)`),
      organization_entitlements: await n(`SELECT count(*)::int AS n FROM organization_entitlements WHERE source_type = 'subscription' AND source_id IN (SELECT id FROM t_subs)`),
      organization_event_credits: credits.length,
      subscription_invoices: await n(`SELECT count(*)::int AS n FROM subscription_invoices WHERE payment_id IN (SELECT id FROM t_pays) OR subscription_id IN (SELECT id FROM t_subs)`),
      payments: pays.length,
      subscriptions: subs.length,
      billing_notifications: await n(`SELECT count(*)::int AS n FROM notifications WHERE dedupe_key LIKE 'billing:%'
        AND split_part(dedupe_key, ':', 2) IN (SELECT id::text FROM t_subs UNION ALL SELECT id::text FROM t_pays)`),
      payment_webhooks: await n(`SELECT count(*)::int AS n FROM payment_webhooks w WHERE ${whTest}`),
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const accessNow = (await c.query(`SELECT
        (SELECT count(DISTINCT attendee_id)::int FROM user_entitlements WHERE source_type = 'subscription' AND source_id IN (SELECT id FROM t_subs) AND (valid_until IS NULL OR valid_until > now())) AS attendees,
        (SELECT count(DISTINCT organization_id)::int FROM organization_entitlements WHERE source_type = 'subscription' AND source_id IN (SELECT id FROM t_subs) AND (valid_until IS NULL OR valid_until > now())) AS orgs`)).rows[0];

    const inr = (m: number) => `₹${(m / 100).toFixed(2)}`;
    const d = (x: Date | null) => (x ? new Date(x).toISOString().slice(0, 16).replace("T", " ") : "—");
    console.log(`TEST SUBSCRIPTIONS (${subs.length})`);
    console.table(subs.map((s) => ({ id: s.id.slice(0, 8), who: s.subscriber_type, owner: s.owner, plan: s.plan, status: s.status, created: d(s.created_at), periodEnd: d(s.current_period_end) })));
    console.log(`TEST PAYMENTS / ORDERS (${pays.length})`);
    console.table(pays.map((p) => ({ id: p.id.slice(0, 8), payer: p.payer_type, owner: p.owner, purpose: p.purpose, status: p.status, amount: inr(p.amount_minor), refunded: inr(p.refunded_minor), created: d(p.created_at) })));
    console.log(`SINGLE EVENT CREDITS BOUGHT WITH TEST PAYMENTS (${credits.length})`);
    console.table(credits.map((x) => ({ id: x.id.slice(0, 8), org: x.owner, state: x.revoked_at ? "revoked" : x.consumed_at ? "used" : "unused", usedFor: x.event ?? "" })));
    if (credits.some((x) => x.consumed_at)) console.log("  note: used credits are removed from billing history; the events they created are kept.\n");
    console.log(`PAID ACCESS FROM TEST PAYMENTS, ACTIVE RIGHT NOW: ${accessNow.attendees} attendee(s) with Premium, ${accessNow.orgs} organization(s) with Pro/Business`);
    console.log("\nROWS TO DELETE");
    console.table(counts);
    console.log(`TOTAL: ${total}`);
    console.log("KEPT: user accounts, organizations, events, profiles, admin promotions, admin-granted credits, audit log, any gateway_mode='live' row.");

    if (!apply) {
      await c.query("ROLLBACK");
      console.log(`\nDry run only. To delete exactly this, run:  npx tsx scripts/cleanup-test-payments.ts --apply --expect=${total}`);
      return;
    }
    if (total !== expect) throw new Error(`Expected ${expect} rows but found ${total} — data changed since the dry run. Re-run the dry run and review again.`);

    await c.query(`DELETE FROM user_entitlements WHERE source_type = 'subscription' AND source_id IN (SELECT id FROM t_subs)`);
    await c.query(`DELETE FROM organization_entitlements WHERE source_type = 'subscription' AND source_id IN (SELECT id FROM t_subs)`);
    await c.query(`DELETE FROM organization_event_credits WHERE payment_id IN (SELECT id FROM t_pays)`);
    await c.query(`DELETE FROM subscription_invoices WHERE payment_id IN (SELECT id FROM t_pays) OR subscription_id IN (SELECT id FROM t_subs)`);
    await c.query(`DELETE FROM notifications WHERE dedupe_key LIKE 'billing:%' AND split_part(dedupe_key, ':', 2) IN (SELECT id::text FROM t_subs UNION ALL SELECT id::text FROM t_pays)`);
    await c.query(`DELETE FROM payments WHERE id IN (SELECT id FROM t_pays)`);
    await c.query(`DELETE FROM subscriptions WHERE id IN (SELECT id FROM t_subs)`);
    await c.query(`DELETE FROM payment_webhooks w WHERE ${whTest}`);
    await c.query(`INSERT INTO audit_logs (actor_type, action, data) VALUES ('system', 'billing.test_data_cleanup', $1)`, [JSON.stringify(counts)]);
    await c.query("COMMIT");
    console.log(`\nDeleted ${total} test-mode rows.`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
