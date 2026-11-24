/**
 * Applies database migrations and the reference taxonomy required by the PRD (event categories, predefined
 * interests/skills, networking intentions, subscription plans). Idempotent. Creates NO demo organizations,
 * events or people. Run: `npm run db:migrate` (also runs automatically during Vercel builds).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";
import { ALIASES, CATEGORIES, GLOBAL_INTENTIONS, INTERESTS, SKILLS } from "../src/server/seed/reference-data";

const norm = (s: string) => {
  let v = s.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (v === v.toLowerCase() && /\p{L}/u.test(v[0]!)) v = v[0]!.toUpperCase() + v.slice(1);
  return v.toLowerCase();
};

const PREMIUM = ["attendee.discover.advanced_filters", "attendee.matching.detailed", "attendee.profile.badge", "attendee.saved_by.visibility", "attendee.analytics"];
const PRO = ["org.pulse.advanced", "org.reports.export", "org.branding"];
const BUSINESS = [...PRO, "org.members", "org.analytics.cross_event"];

export async function run(url: string) {
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await migrate(db, { migrationsFolder: "./drizzle" });

    // Interests & skills
    for (const [kind, data] of [["interests", INTERESTS], ["skills", SKILLS]] as const) {
      const t = kind === "interests" ? schema.interests : schema.skills;
      const rows = Object.entries(data).flatMap(([group, names]) => names.map((name) => ({ name, normalizedName: norm(name), groupName: group, status: "approved" })));
      for (let i = 0; i < rows.length; i += 200) await db.insert(t).values(rows.slice(i, i + 200)).onConflictDoNothing();
    }
    const interestIds = new Map((await db.select({ id: schema.interests.id, n: schema.interests.normalizedName }).from(schema.interests)).map((r) => [r.n, r.id]));
    const skillIds = new Map((await db.select({ id: schema.skills.id, n: schema.skills.normalizedName }).from(schema.skills)).map((r) => [r.n, r.id]));
    for (const [alias, canonical, isSkill] of ALIASES) {
      const id = (isSkill ? skillIds : interestIds).get(norm(canonical));
      if (!id) continue;
      if (isSkill) await db.insert(schema.skillAliases).values({ aliasNormalized: norm(alias), skillId: id }).onConflictDoNothing();
      else await db.insert(schema.interestAliases).values({ aliasNormalized: norm(alias), interestId: id }).onConflictDoNothing();
    }

    // Global intentions
    for (const [i, g] of GLOBAL_INTENTIONS.entries())
      await db.execute(sql`INSERT INTO networking_intentions (slug, label, pulse_group, sort_order) SELECT ${g.slug}, ${g.label}, ${g.group}, ${i}
        WHERE NOT EXISTS (SELECT 1 FROM networking_intentions WHERE category_id IS NULL AND slug = ${g.slug})`);

    // Categories with suggestions and intentions
    for (const [order, c] of CATEGORIES.entries()) {
      await db.insert(schema.eventCategories).values({ slug: c.slug, name: c.name, description: c.description, imageUrl: c.image, sortOrder: order }).onConflictDoNothing();
      const [cat] = await db.select({ id: schema.eventCategories.id }).from(schema.eventCategories).where(sql`slug = ${c.slug}`);
      for (const [rank, name] of c.interests.entries()) {
        const id = interestIds.get(norm(name));
        if (id) await db.insert(schema.categoryInterestSuggestions).values({ categoryId: cat!.id, interestId: id, rank }).onConflictDoNothing();
      }
      for (const [rank, name] of c.skills.entries()) {
        const id = skillIds.get(norm(name));
        if (id) await db.insert(schema.categorySkillSuggestions).values({ categoryId: cat!.id, skillId: id, rank }).onConflictDoNothing();
      }
      for (const [i, it] of c.intentions.entries())
        await db.execute(sql`INSERT INTO networking_intentions (category_id, slug, label, pulse_group, sort_order) VALUES (${cat!.id}, ${it.slug}, ${it.label}, ${it.group}, ${i})
          ON CONFLICT DO NOTHING`);
    }

    // Plans (PRD §19). All numeric limits null until approved (D-20); per-event package inactive until priced.
    const plans: { code: string; audience: string; name: string; description: string; period: string; price: number; isDefault: boolean; active: boolean; on: string[]; off: string[]; limits: string[]; sort: number }[] = [
      { code: "attendee_free", audience: "attendee", name: "Free", description: "Essential networking for everyone.", period: "none", price: 0, isDefault: true, active: true, on: [], off: PREMIUM, limits: ["attendee.saved_profiles.limit"], sort: 0 },
      { code: "attendee_premium_monthly", audience: "attendee", name: "Premium", description: "Advanced discovery and networking.", period: "month", price: 9900, isDefault: false, active: true, on: PREMIUM, off: [], limits: ["attendee.saved_profiles.limit"], sort: 1 },
      { code: "attendee_premium_yearly", audience: "attendee", name: "Premium (yearly)", description: "Advanced discovery and networking.", period: "year", price: 79900, isDefault: false, active: true, on: PREMIUM, off: [], limits: ["attendee.saved_profiles.limit"], sort: 2 },
      { code: "org_starter", audience: "organization", name: "Starter", description: "Create and publish events with QR networking.", period: "none", price: 0, isDefault: true, active: true, on: [], off: BUSINESS, limits: ["org.events.active.limit", "org.participants.limit"], sort: 10 },
      { code: "org_pro_monthly", audience: "organization", name: "Pro", description: "Advanced event management and networking tools.", period: "month", price: 49900, isDefault: false, active: true, on: PRO, off: ["org.members", "org.analytics.cross_event"], limits: ["org.events.active.limit", "org.participants.limit"], sort: 11 },
      { code: "org_business_monthly", audience: "organization", name: "Business", description: "Multi-member organizations and cross-event insights.", period: "month", price: 149900, isDefault: false, active: true, on: BUSINESS, off: [], limits: ["org.events.active.limit", "org.participants.limit"], sort: 12 },
      { code: "org_event_package", audience: "organization", name: "Single event package", description: "One-time purchase for a single event (price to be confirmed).", period: "one_time", price: 19900, isDefault: false, active: false, on: PRO, off: [], limits: [], sort: 13 },
    ];
    for (const p of plans) {
      await db.insert(schema.subscriptionPlans).values({ code: p.code, audience: p.audience, name: p.name, description: p.description, billingPeriod: p.period, priceMinor: p.price, isDefault: p.isDefault, isActive: p.active, sortOrder: p.sort }).onConflictDoNothing();
      const [plan] = await db.select({ id: schema.subscriptionPlans.id }).from(schema.subscriptionPlans).where(sql`code = ${p.code}`);
      const feats = [...p.on.map((k) => ({ k, e: true })), ...p.off.map((k) => ({ k, e: false })), ...p.limits.map((k) => ({ k, e: true }))];
      for (const f of feats) await db.insert(schema.subscriptionFeatures).values({ planId: plan!.id, featureKey: f.k, enabled: f.e, limitValue: null }).onConflictDoNothing();
    }
    console.log("Migrations and reference data applied.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.includes("migrate")) {
  const url = 
    // DDL over a direct connection (Neon pooler runs in transaction mode)
    process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    console.log("DATABASE_URL not set — skipping migrations.");
    process.exit(0);
  }
  run(url).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
