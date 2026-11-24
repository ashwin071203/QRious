import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Executor } from "@/server/db";
import { validation } from "@/server/core/errors";
import { cleanTag, validateTag } from "@/server/lib/rules";

const { interests, skills, interestAliases, skillAliases, categoryInterestSuggestions, categorySkillSuggestions, eventSuggestedInterests,
  eventSuggestedSkills, events, eventCategories, networkingIntentions } = schema;

export type TagKind = "interest" | "skill";
export type TagInput = { id?: string; name?: string };
const table = (k: TagKind) => (k === "interest" ? interests : skills);

export async function categories() {
  return getDb().select({ id: eventCategories.id, slug: eventCategories.slug, name: eventCategories.name, description: eventCategories.description, imageUrl: eventCategories.imageUrl })
    .from(eventCategories).where(eq(eventCategories.isActive, true)).orderBy(asc(eventCategories.sortOrder));
}

async function suggestedIds(db: Executor, kind: TagKind, eventId?: string | null, categoryId?: string | null): Promise<string[]> {
  if (eventId) {
    const rows = kind === "interest"
      ? await db.select({ id: eventSuggestedInterests.interestId }).from(eventSuggestedInterests).where(eq(eventSuggestedInterests.eventId, eventId)).orderBy(asc(eventSuggestedInterests.sortOrder))
      : await db.select({ id: eventSuggestedSkills.skillId }).from(eventSuggestedSkills).where(eq(eventSuggestedSkills.eventId, eventId)).orderBy(asc(eventSuggestedSkills.sortOrder));
    if (rows.length) return rows.map((r) => r.id);
    const [ev] = await db.select({ c: events.categoryId }).from(events).where(eq(events.id, eventId)).limit(1);
    categoryId ??= ev?.c;
  }
  if (!categoryId) return [];
  const rows = kind === "interest"
    ? await db.select({ id: categoryInterestSuggestions.interestId }).from(categoryInterestSuggestions).where(eq(categoryInterestSuggestions.categoryId, categoryId)).orderBy(asc(categoryInterestSuggestions.rank))
    : await db.select({ id: categorySkillSuggestions.skillId }).from(categorySkillSuggestions).where(eq(categorySkillSuggestions.categoryId, categoryId)).orderBy(asc(categorySkillSuggestions.rank));
  return rows.map((r) => r.id);
}

/** Approved tags; event/category suggestions first when there's no query (PRD §3.2). Aliases match too. */
export async function searchTags(kind: TagKind, q: string | null, eventId: string | null, categoryId: string | null, limitIn: number) {
  const db = getDb();
  const limit = Math.min(Math.max(limitIn || 24, 1), 50);
  const t = table(kind);
  const sugg = await suggestedIds(db, kind, eventId, categoryId);
  const n = cleanTag(q)?.toLowerCase() ?? null;
  type Row = { id: string; name: string; groupName: string | null; normalizedName: string };
  let rows: Row[];
  if (!n) {
    const s = sugg.length ? await db.select().from(t).where(and(inArray(t.id, sugg), eq(t.status, "approved"))) : [];
    rows = s.sort((a, b) => sugg.indexOf(a.id) - sugg.indexOf(b.id));
    if (rows.length < limit) {
      const more = await db.select().from(t)
        .where(and(eq(t.status, "approved"), sugg.length ? sql`${t.id} NOT IN (${sql.join(sugg.map((x) => sql`${x}`), sql`, `)})` : sql`true`))
        .orderBy(asc(t.groupName), asc(t.name)).limit(limit - rows.length);
      rows = rows.concat(more);
    }
  } else {
    const pattern = `%${n.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const aliasSub = kind === "interest"
      ? sql`SELECT interest_id FROM interest_aliases WHERE alias_normalized LIKE ${pattern}`
      : sql`SELECT skill_id FROM skill_aliases WHERE alias_normalized LIKE ${pattern}`;
    rows = await db.select().from(t)
      .where(and(eq(t.status, "approved"), sql`(${t.normalizedName} LIKE ${pattern} OR ${t.id} IN (${aliasSub}))`))
      .orderBy(sql`(${t.normalizedName} = ${n}) DESC`, sql`(${t.normalizedName} LIKE ${n + "%"}) DESC`, sql`length(${t.normalizedName})`)
      .limit(limit * 2);
    rows.sort((a, b) => Number(b.normalizedName === n) - Number(a.normalizedName === n)
      || Number(sugg.includes(b.id)) - Number(sugg.includes(a.id))
      || Number(b.normalizedName.startsWith(n)) - Number(a.normalizedName.startsWith(n)));
  }
  return rows.slice(0, limit).map((r) => ({ id: r.id, name: r.name, group: r.groupName, suggested: sugg.includes(r.id) }));
}

async function findExisting(db: Executor, kind: TagKind, normalized: string): Promise<{ id: string; status: string } | null> {
  const t = table(kind);
  const [row] = await db.select({ id: t.id, status: t.status, merged: t.mergedIntoId }).from(t).where(eq(t.normalizedName, normalized)).limit(1);
  if (row) return row.status === "merged" && row.merged ? { id: row.merged, status: "approved" } : { id: row.id, status: row.status };
  const alias = kind === "interest"
    ? (await db.select({ id: interestAliases.interestId }).from(interestAliases).where(eq(interestAliases.aliasNormalized, normalized)).limit(1))[0]
    : (await db.select({ id: skillAliases.skillId }).from(skillAliases).where(eq(skillAliases.aliasNormalized, normalized)).limit(1))[0];
  return alias ? { id: alias.id, status: "approved" } : null;
}

/**
 * Resolves chosen tags to ids inside the caller's transaction. Custom entries are normalized, matched against
 * existing tags/aliases, else created as `pending` (D-18). Duplicates collapse.
 */
export async function resolveTags(db: Executor, kind: TagKind, inputs: TagInput[], attendeeId: string, field: string): Promise<string[]> {
  const t = table(kind);
  const out: string[] = [];
  for (const input of inputs) {
    let id: string | null = null;
    if (input.id) {
      const [row] = await db.select({ id: t.id, status: t.status, merged: t.mergedIntoId }).from(t).where(eq(t.id, input.id)).limit(1);
      if (!row || row.status === "rejected") throw validation(field, "One of the selected items is no longer available.");
      id = row.status === "merged" && row.merged ? row.merged : row.id;
    } else {
      const cleaned = cleanTag(input.name);
      const err = validateTag(cleaned);
      if (err) throw validation(field, `"${input.name ?? ""}": ${err}`);
      const normalized = cleaned!.toLowerCase();
      let found = await findExisting(db, kind, normalized);
      if (!found) {
        await db.insert(t).values({ name: cleaned!, normalizedName: normalized, status: "pending", createdByAttendeeId: attendeeId }).onConflictDoNothing();
        found = await findExisting(db, kind, normalized);
      }
      if (!found) throw new Error("Tag creation failed.");
      if (found.status === "rejected") throw validation(field, `"${cleaned}" isn't available. Please choose a different name.`);
      id = found.id;
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export async function intentionsForCategory(db: Executor, categoryId: string) {
  return db.select().from(networkingIntentions)
    .where(and(eq(networkingIntentions.isActive, true), sql`(${networkingIntentions.categoryId} = ${categoryId} OR ${networkingIntentions.categoryId} IS NULL)`))
    .orderBy(sql`${networkingIntentions.categoryId} IS NULL`, asc(networkingIntentions.sortOrder));
}
