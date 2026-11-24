/**
 * Removes data created by the Playwright journeys when they are run against a live deployment (D-32: no demo data).
 * Runs only when QRIOUS_PURGE_E2E=1 is passed as a one-off build env:  vercel deploy --prod --build-env QRIOUS_PURGE_E2E=1
 *
 * Scope is deliberately narrow:
 *   organizers  — email at the reserved example.com domain matching the E2E pattern (host…@example.com)
 *   orgs/events — organizations whose ONLY members are those organizers, and their events
 *   attendees   — people whose every participation is in those events (never anyone who joined a real event)
 * Everything runs in one transaction and aborts if the match looks too large to be test data.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { Client } from "pg";

async function main() {
  if (process.env.QRIOUS_PURGE_E2E !== "1") return;
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
  if (!url) return console.log("purge-e2e: no database configured");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(`CREATE TEMP TABLE e2e_orgusers ON COMMIT DROP AS
      SELECT id FROM organizer_users WHERE email_normalized ~ '^host[a-z0-9]+@example\\.com$' AND is_admin = false`);
    await c.query(`CREATE TEMP TABLE e2e_orgs ON COMMIT DROP AS
      SELECT o.id FROM organizations o WHERE EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id = o.id AND m.organizer_user_id NOT IN (SELECT id FROM e2e_orgusers))`);
    await c.query(`CREATE TEMP TABLE e2e_events ON COMMIT DROP AS SELECT id FROM events WHERE organization_id IN (SELECT id FROM e2e_orgs)`);
    await c.query(`CREATE TEMP TABLE e2e_attendees ON COMMIT DROP AS
      SELECT DISTINCT ep.attendee_id AS id FROM event_participants ep WHERE ep.event_id IN (SELECT id FROM e2e_events)
        AND NOT EXISTS (SELECT 1 FROM event_participants x WHERE x.attendee_id = ep.attendee_id AND x.event_id NOT IN (SELECT id FROM e2e_events))`);
    const n = async (t: string) => Number((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
    const counts = { organizers: await n("e2e_orgusers"), organizations: await n("e2e_orgs"), events: await n("e2e_events"), attendees: await n("e2e_attendees") };
    console.log("purge-e2e: matched", counts);
    if (counts.organizers > 50 || counts.attendees > 200) throw new Error("purge-e2e: match too large, refusing");

    await c.query(`DELETE FROM conversations WHERE origin_event_id IN (SELECT id FROM e2e_events)`);
    await c.query(`DELETE FROM connections WHERE origin_event_id IN (SELECT id FROM e2e_events)`);
    // Groups whose members are all test attendees (groups have no origin event).
    await c.query(`DELETE FROM conversations cv WHERE cv.kind = 'group' AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = cv.id)
      AND NOT EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = cv.id AND m.attendee_id NOT IN (SELECT id FROM e2e_attendees))`);
    await c.query(`DELETE FROM interests WHERE created_by_attendee_id IN (SELECT id FROM e2e_attendees)`);
    await c.query(`DELETE FROM skills WHERE created_by_attendee_id IN (SELECT id FROM e2e_attendees)`);
    await c.query(`DELETE FROM subscription_invoices WHERE payment_id IN (SELECT id FROM payments WHERE attendee_id IN (SELECT id FROM e2e_attendees))`);
    await c.query(`DELETE FROM payments WHERE attendee_id IN (SELECT id FROM e2e_attendees)`);
    await c.query(`DELETE FROM subscriptions WHERE attendee_id IN (SELECT id FROM e2e_attendees)`);
    await c.query(`DELETE FROM notification_settings WHERE (recipient_type = 'attendee' AND recipient_id IN (SELECT id FROM e2e_attendees)) OR (recipient_type = 'organizer' AND recipient_id IN (SELECT id FROM e2e_orgusers))`);
    await c.query(`DELETE FROM attendees WHERE id IN (SELECT id FROM e2e_attendees)`);
    // Test-mode billing rows of those organizations (credits → payments → subscriptions; FK order).
    await c.query(`DELETE FROM organization_event_credits WHERE organization_id IN (SELECT id FROM e2e_orgs)`);
    await c.query(`DELETE FROM subscription_invoices WHERE payment_id IN (SELECT id FROM payments WHERE organization_id IN (SELECT id FROM e2e_orgs))`);
    await c.query(`DELETE FROM payments WHERE organization_id IN (SELECT id FROM e2e_orgs)`);
    await c.query(`DELETE FROM subscriptions WHERE organization_id IN (SELECT id FROM e2e_orgs)`);
    await c.query(`DELETE FROM events WHERE id IN (SELECT id FROM e2e_events)`);
    await c.query(`DELETE FROM organizations WHERE id IN (SELECT id FROM e2e_orgs)`);
    await c.query(`DELETE FROM organizer_users WHERE id IN (SELECT id FROM e2e_orgusers)`);
    await c.query("COMMIT");
    console.log("purge-e2e: done");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
