import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { ORGANIZER_SESSION, config } from "@/server/core/config";
import { AppError, FieldErrors, conflict, forbidden, isUniqueViolation, notFound } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { reply } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { removeMedia, saveSquareImage } from "@/server/core/media";
import { cleanText, generateRecoveryCode, hashRecoveryCode, newToken, normalizeHttpsUrl, normalizeRecoveryCode, sha256, slugify, userAgentSummary, verifyRecoveryCode } from "@/server/lib/rules";
import { orgEntitlements, requireOrgFeature } from "./entitlements";
import QRCode from "qrcode";
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUrl, verifyTotp } from "@/server/lib/totp";

const { organizerUsers, organizerSessions, organizerRecoveryCodes, organizations, organizationMembers, events } = schema;
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
export const ORGANIZER_COOKIE = "qr_o";

// ---------- Passwords ----------
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(actual, expected);
}
const COMMON = new Set(["password1234", "123456789012", "qwertyuiopas", "passwordpassword", "iloveyou1234", "adminadmin12", "qrious123456"]);
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 12) return "Use at least 12 characters.";
  if (pw.length > 200) return "Use at most 200 characters.";
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return "That password is too easy to guess.";
  return null;
}
const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- Sessions ----------
export type OrganizerAuth = { userId: string; sessionId: string; isAdmin: boolean; displayName: string; email: string; mfaEnrolled: boolean; mfaVerified: boolean };

async function createOrgSession(ctx: Ctx, db: Executor, userId: string, isAdmin: boolean) {
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + (isAdmin ? ORGANIZER_SESSION.adminIdleMs : ORGANIZER_SESSION.idleMs));
  await db.insert(organizerSessions).values({ userId, tokenHash: hash, createdAt: new Date(), lastSeenAt: new Date(), expiresAt, userAgentSummary: userAgentSummary(ctx.userAgent) });
  ctx.setCookie(ORGANIZER_COOKIE, token, { expires: expiresAt });
}

export async function maybeOrganizer(ctx: Ctx): Promise<OrganizerAuth | null> {
  return ctx.once("organizer", async () => {
    const token = ctx.readSessionCookie(ORGANIZER_COOKIE);
    if (!token || token.length > 100) return null;
    const [row] = await ctx.db.select({ s: organizerSessions, u: organizerUsers }).from(organizerSessions)
      .innerJoin(organizerUsers, eq(organizerUsers.id, organizerSessions.userId)).where(eq(organizerSessions.tokenHash, sha256(token))).limit(1);
    const now = new Date();
    if (!row || row.s.revokedAt || row.s.expiresAt <= now || row.u.status !== "active" || row.s.createdAt < row.u.passwordChangedAt) {
      ctx.clearCookie(ORGANIZER_COOKIE);
      return null;
    }
    if (now.getTime() - row.s.lastSeenAt.getTime() > 3_600_000) {
      const expiresAt = new Date(now.getTime() + (row.u.isAdmin ? ORGANIZER_SESSION.adminIdleMs : ORGANIZER_SESSION.idleMs));
      await ctx.db.update(organizerSessions).set({ lastSeenAt: now, expiresAt }).where(eq(organizerSessions.id, row.s.id));
      ctx.setCookie(ORGANIZER_COOKIE, token, { expires: expiresAt });
    }
    const mfaEnrolled = !!row.u.totpEnabledAt && !!row.u.totpSecretEnc;
    return { userId: row.u.id, sessionId: row.s.id, isAdmin: row.u.isAdmin, displayName: row.u.displayName, email: row.u.email,
      mfaEnrolled, mfaVerified: mfaEnrolled && !!row.s.mfaVerifiedAt && row.s.mfaVerifiedAt >= row.u.totpEnabledAt! };
  });
}

export async function requireOrganizer(ctx: Ctx) {
  const o = await maybeOrganizer(ctx);
  if (!o) throw new AppError(401, "organizer_login_required", "Please sign in to your organizer account.");
  return o;
}

export async function requireAdmin(ctx: Ctx) {
  const o = await requireOrganizer(ctx);
  if (!o.isAdmin) throw forbidden("Platform administrators only.");
  if (!o.mfaEnrolled) throw new AppError(403, "mfa_enrollment_required", "Set up two-factor authentication to use the admin panel.");
  if (!o.mfaVerified) throw new AppError(403, "mfa_required", "Enter the code from your authenticator app to continue.");
  return o;
}

// ---------- Admin MFA (D-24): TOTP, required for every admin session ----------
async function requireAdminAccount(ctx: Ctx) {
  const o = await requireOrganizer(ctx);
  if (!o.isAdmin) throw forbidden("Platform administrators only.");
  return o;
}

/** Starts (or restarts) enrollment: a fresh secret is stored encrypted but inactive until a code confirms it. */
export async function mfaSetup(ctx: Ctx) {
  const o = await requireAdminAccount(ctx);
  if (o.mfaEnrolled) throw conflict("mfa_already_enabled", "Two-factor authentication is already set up.");
  await ctx.limit("mfa-setup", 20, 3600, o.userId);
  const secret = newTotpSecret();
  await ctx.db.update(organizerUsers).set({ totpSecretEnc: encryptSecret(secret, config.recoveryPepper), totpEnabledAt: null, totpLastStep: null, totpFailedAttempts: 0, totpLockedUntil: null })
    .where(eq(organizerUsers.id, o.userId));
  const url = otpauthUrl(secret, o.email);
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }) };
}

async function checkTotp(ctx: Ctx, userId: string, code: unknown, mode: "enable" | "verify") {
  await ctx.limit(`mfa-${mode}`, 30, 900, userId);
  return ctx.db.transaction(async (tx) => {
    const [u] = (await tx.execute<{ totp_secret_enc: string | null; totp_enabled_at: Date | null; totp_last_step: string | null; totp_failed_attempts: number; totp_locked_until: Date | null }>(
      sql`SELECT totp_secret_enc, totp_enabled_at, totp_last_step, totp_failed_attempts, totp_locked_until FROM organizer_users WHERE id = ${userId} FOR UPDATE`)).rows;
    if (!u?.totp_secret_enc) throw new AppError(409, "mfa_not_started", "Start two-factor setup first.");
    if (mode === "enable" && u.totp_enabled_at) throw conflict("mfa_already_enabled", "Two-factor authentication is already set up.");
    if (mode === "verify" && !u.totp_enabled_at) throw new AppError(403, "mfa_enrollment_required", "Set up two-factor authentication first.");
    if (u.totp_locked_until && new Date(u.totp_locked_until) > new Date())
      throw new AppError(429, "mfa_locked", "Too many incorrect codes. Try again in 15 minutes.");
    const step = verifyTotp(decryptSecret(u.totp_secret_enc, config.recoveryPepper), code, Date.now(), u.totp_last_step === null ? null : Number(u.totp_last_step));
    if (step === null) {
      const n = u.totp_failed_attempts + 1;
      await tx.update(organizerUsers).set(n >= 5 ? { totpFailedAttempts: 0, totpLockedUntil: new Date(Date.now() + 15 * 60_000) } : { totpFailedAttempts: n }).where(eq(organizerUsers.id, userId));
      return false;
    }
    const now = new Date();
    await tx.update(organizerUsers).set({ totpLastStep: step, totpFailedAttempts: 0, totpLockedUntil: null, ...(mode === "enable" ? { totpEnabledAt: now } : {}) }).where(eq(organizerUsers.id, userId));
    return now;
  });
}

export async function mfaEnable(ctx: Ctx) {
  const o = await requireAdminAccount(ctx);
  const { code } = await ctx.json<{ code?: string }>();
  const at = await checkTotp(ctx, o.userId, code, "enable");
  if (!at) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { code: ["That code isn’t right. Check your authenticator app and try again."] });
  await ctx.db.update(organizerSessions).set({ mfaVerifiedAt: at }).where(eq(organizerSessions.id, o.sessionId));
  await audit(ctx.db, { actorType: "admin", actorId: o.userId, action: "admin.mfa_enabled", ip: ctx.ip });
  return { ok: true };
}

export async function mfaVerify(ctx: Ctx) {
  const o = await requireAdminAccount(ctx);
  const { code } = await ctx.json<{ code?: string }>();
  const at = await checkTotp(ctx, o.userId, code, "verify");
  if (!at) {
    await audit(ctx.db, { actorType: "admin", actorId: o.userId, action: "admin.mfa_failed", ip: ctx.ip });
    throw new AppError(400, "validation_failed", "One or more fields are invalid.", { code: ["That code isn’t right. Check your authenticator app and try again."] });
  }
  await ctx.db.update(organizerSessions).set({ mfaVerifiedAt: at }).where(eq(organizerSessions.id, o.sessionId));
  return { ok: true };
}

async function issueOrgRecovery(db: Executor, userId: string) {
  await db.update(organizerRecoveryCodes).set({ status: "rotated" }).where(and(eq(organizerRecoveryCodes.userId, userId), eq(organizerRecoveryCodes.status, "active")));
  const raw = generateRecoveryCode();
  const salt = randomBytes(16);
  await db.insert(organizerRecoveryCodes).values({ userId, salt, codeHash: hashRecoveryCode(normalizeRecoveryCode(raw)!, salt, config.recoveryPepper) });
  return raw;
}

export async function register(ctx: Ctx) {
  await ctx.limit("org-register", 20, 3600);
  const b = await ctx.json<{ email?: string; password?: string; displayName?: string }>();
  const errors = new FieldErrors();
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email) || email.length > 254) errors.add("email", "Enter a valid email address.");
  const pp = passwordProblem(b.password);
  if (pp) errors.add("password", pp);
  const name = cleanText(b.displayName);
  if (!name || name.length > 100) errors.add("displayName", "Enter your name (up to 100 characters).");
  errors.throwIfAny();
  const isAdmin = config.adminEmails.includes(email);
  try {
    const result = await ctx.db.transaction(async (tx) => {
      const [u] = await tx.insert(organizerUsers).values({ email: b.email!.trim(), emailNormalized: email, passwordHash: await hashPassword(b.password!), displayName: name!, isAdmin, passwordChangedAt: new Date(Date.now() - 1000) }).returning();
      const code = await issueOrgRecovery(tx, u!.id);
      await createOrgSession(ctx, tx, u!.id, isAdmin);
      await audit(tx, { actorType: "organizer", actorId: u!.id, action: "organizer.registered", ip: ctx.ip });
      return code;
    });
    return reply(201, { recoveryCode: result });
  } catch (e) {
    if (isUniqueViolation(e, "ux_organizer_users_email")) throw conflict("email_taken", "An account with this email already exists. Sign in instead.");
    throw e;
  }
}

export async function login(ctx: Ctx) {
  await ctx.limit("org-login", 30, 600);
  const b = await ctx.json<{ email?: string; password?: string }>();
  const email = normEmail(b.email);
  await ctx.limit("org-login-account", 10, 600, `email:${email}`);
  const fail = () => new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  const [u] = await ctx.db.select().from(organizerUsers).where(eq(organizerUsers.emailNormalized, email)).limit(1);
  if (!u) { await hashPassword("timing-equalizer-password"); throw fail(); }
  if (u.lockedUntil && u.lockedUntil > new Date()) throw new AppError(423, "account_locked", "Too many failed attempts. Try again in 15 minutes or use your recovery code.");
  if (u.status !== "active") throw forbidden("This account is suspended.", "account_suspended");
  if (typeof b.password !== "string" || !(await verifyPassword(b.password, u.passwordHash))) {
    const failed = u.failedLogins + 1;
    await ctx.db.update(organizerUsers).set(failed >= 5 ? { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) } : { failedLogins: failed }).where(eq(organizerUsers.id, u.id));
    await audit(ctx.db, { actorType: "organizer", actorId: u.id, action: "organizer.login_failed", ip: ctx.ip });
    throw fail();
  }
  await ctx.db.update(organizerUsers).set({ failedLogins: 0, lockedUntil: null }).where(eq(organizerUsers.id, u.id));
  await createOrgSession(ctx, ctx.db, u.id, u.isAdmin);
  await audit(ctx.db, { actorType: u.isAdmin ? "admin" : "organizer", actorId: u.id, action: "organizer.login", ip: ctx.ip });
  return { ok: true, isAdmin: u.isAdmin };
}

export async function logout(ctx: Ctx) {
  const o = await maybeOrganizer(ctx);
  if (o) await ctx.db.update(organizerSessions).set({ revokedAt: new Date() }).where(eq(organizerSessions.id, o.sessionId));
  ctx.clearCookie(ORGANIZER_COOKIE);
  return reply(204);
}

/** Organizer account recovery: email + recovery code → new password (no email provider needed). */
export async function recoverOrganizer(ctx: Ctx) {
  await ctx.limit("org-recover", 10, 900);
  const b = await ctx.json<{ email?: string; recoveryCode?: string; newPassword?: string }>();
  const pp = passwordProblem(b.newPassword);
  if (pp) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { newPassword: [pp] });
  const fail = () => new AppError(401, "recovery_failed", "We couldn't recover an account with that email and recovery code.");
  const [u] = await ctx.db.select().from(organizerUsers).where(eq(organizerUsers.emailNormalized, normEmail(b.email))).limit(1);
  const code = normalizeRecoveryCode(b.recoveryCode);
  if (!u || u.status !== "active") throw fail();
  const result = await ctx.db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string; code_hash: Buffer; salt: Buffer; failed_attempts: number; locked_until: Date | null }>(
      sql`SELECT id, code_hash, salt, failed_attempts, locked_until FROM organizer_recovery_codes WHERE user_id = ${u.id} AND status = 'active' FOR UPDATE`);
    const rc = rows.rows[0];
    if (!rc || (rc.locked_until && new Date(rc.locked_until) > new Date())) return null;
    if (!code || !verifyRecoveryCode(code, rc.salt, rc.code_hash, config.recoveryPepper)) {
      const n = rc.failed_attempts + 1;
      await tx.update(organizerRecoveryCodes).set(n >= 5 ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + 3_600_000) } : { failedAttempts: n }).where(eq(organizerRecoveryCodes.id, rc.id));
      return null;
    }
    await tx.update(organizerRecoveryCodes).set({ status: "used", usedAt: new Date() }).where(eq(organizerRecoveryCodes.id, rc.id));
    // The recovery code doubles as the admin MFA backup factor: recovering resets TOTP so a lost phone can be re-enrolled.
    await tx.update(organizerUsers).set({ passwordHash: await hashPassword(b.newPassword!), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null,
      totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, totpFailedAttempts: 0, totpLockedUntil: null }).where(eq(organizerUsers.id, u.id));
    await tx.update(organizerSessions).set({ revokedAt: new Date() }).where(and(eq(organizerSessions.userId, u.id), sql`revoked_at IS NULL`));
    const newCode = await issueOrgRecovery(tx, u.id);
    await new Promise((r) => setTimeout(r, 5)); // session created after passwordChangedAt
    await createOrgSession(ctx, tx, u.id, u.isAdmin);
    await audit(tx, { actorType: "organizer", actorId: u.id, action: "organizer.recovered", ip: ctx.ip });
    return newCode;
  });
  if (!result) throw fail();
  return { newRecoveryCode: result };
}

export async function changePassword(ctx: Ctx) {
  const o = await requireOrganizer(ctx);
  const b = await ctx.json<{ currentPassword?: string; newPassword?: string }>();
  const [u] = await ctx.db.select().from(organizerUsers).where(eq(organizerUsers.id, o.userId)).limit(1);
  if (!u || typeof b.currentPassword !== "string" || !(await verifyPassword(b.currentPassword, u.passwordHash)))
    throw new AppError(400, "validation_failed", "One or more fields are invalid.", { currentPassword: ["Current password is incorrect."] });
  const pp = passwordProblem(b.newPassword);
  if (pp) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { newPassword: [pp] });
  await ctx.db.update(organizerUsers).set({ passwordHash: await hashPassword(b.newPassword!), passwordChangedAt: new Date() }).where(eq(organizerUsers.id, u.id));
  await new Promise((r) => setTimeout(r, 5));
  await createOrgSession(ctx, ctx.db, u.id, u.isAdmin);
  return reply(204);
}

export async function regenerateOrgRecovery(ctx: Ctx) {
  const o = await requireOrganizer(ctx);
  return { recoveryCode: await ctx.db.transaction((tx) => issueOrgRecovery(tx, o.userId)) };
}

/** One-time admin bootstrap: the deployment's QRIOUS_ADMIN_BOOTSTRAP_TOKEN promotes the caller if no admin exists. */
export async function bootstrapAdmin(ctx: Ctx) {
  const o = await requireOrganizer(ctx);
  const b = await ctx.json<{ token?: string }>();
  const expected = process.env.QRIOUS_ADMIN_BOOTSTRAP_TOKEN ?? "";
  if (expected.length < 24 || typeof b.token !== "string" || b.token.length !== expected.length || !timingSafeEqual(Buffer.from(b.token), Buffer.from(expected)))
    throw forbidden("Invalid bootstrap token.");
  const [{ n }] = (await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM organizer_users WHERE is_admin = true`)).rows as [{ n: number }];
  if (n > 0) throw conflict("admin_exists", "A platform administrator already exists.");
  await ctx.db.update(organizerUsers).set({ isAdmin: true }).where(eq(organizerUsers.id, o.userId));
  await audit(ctx.db, { actorType: "admin", actorId: o.userId, action: "admin.bootstrapped", ip: ctx.ip });
  return { ok: true };
}

// ---------- Organizations (M13) ----------
export async function myOrganizations(db: Executor, userId: string) {
  return db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, logoUrl: organizations.logoUrl, status: organizations.status, role: organizationMembers.role })
    .from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.organizerUserId, userId)).orderBy(organizations.name);
}

export async function organizerMe(ctx: Ctx) {
  const o = await maybeOrganizer(ctx);
  if (!o) return { authenticated: false };
  return { authenticated: true, user: { id: o.userId, displayName: o.displayName, email: o.email, isAdmin: o.isAdmin, mfaEnrolled: o.mfaEnrolled, mfaVerified: o.mfaVerified }, organizations: await myOrganizations(ctx.db, o.userId) };
}

/** Membership check: every organizer action is scoped to orgs the caller belongs to (BR-21). */
export async function requireOrgMember(ctx: Ctx, organizationId: string, ownerOnly = false) {
  const o = await requireOrganizer(ctx);
  const [m] = await ctx.db.select({ role: organizationMembers.role, status: organizations.status }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.organizerUserId, o.userId))).limit(1);
  if (!m) throw notFound("Organization not found.");
  if (m.status !== "active") throw forbidden("This organization is suspended. Contact QRious support.", "organization_suspended");
  if (ownerOnly && m.role !== "owner") throw forbidden("Only the organization owner can do this.");
  return { organizer: o, role: m.role };
}

function orgFields(b: Record<string, unknown>, errors: FieldErrors, requireName: boolean) {
  const name = cleanText(b.name);
  if (requireName || b.name !== undefined) { if (!name || name.length > 120) errors.add("name", "Enter an organization name (up to 120 characters)."); }
  const description = cleanText(b.description);
  if (description && description.length > 2000) errors.add("description", "Up to 2000 characters.");
  const contactEmail = cleanText(b.contactEmail);
  if (contactEmail && !EMAIL_RE.test(contactEmail)) errors.add("contactEmail", "Enter a valid email.");
  const contactPhone = cleanText(b.contactPhone);
  if (contactPhone && !/^[+0-9 ()-]{6,30}$/.test(contactPhone)) errors.add("contactPhone", "Enter a valid phone number.");
  const web = normalizeHttpsUrl(b.website as string);
  if (web && typeof web === "object") errors.add("website", web.error);
  return { name, description, contactEmail, contactPhone, website: typeof web === "string" ? web : null };
}

export async function createOrganization(ctx: Ctx) {
  const o = await requireOrganizer(ctx);
  const b = await ctx.json<Record<string, unknown>>();
  const errors = new FieldErrors();
  const f = orgFields(b, errors, true);
  errors.throwIfAny();
  const existing = await myOrganizations(ctx.db, o.userId);
  if (existing.length >= 5) throw conflict("too_many_organizations", "You can belong to up to 5 organizations.");
  const org = await ctx.db.transaction(async (tx) => {
    let slug = slugify(f.name!);
    const taken = await tx.execute(sql`SELECT 1 FROM organizations WHERE slug = ${slug}`);
    if (taken.rows.length) slug = `${slug}-${randomBytes(3).toString("hex")}`;
    const [org] = await tx.insert(organizations).values({ name: f.name!, slug, description: f.description, contactEmail: f.contactEmail, contactPhone: f.contactPhone, website: f.website, createdBy: o.userId }).returning();
    await tx.insert(organizationMembers).values({ organizationId: org!.id, organizerUserId: o.userId, role: "owner" });
    await audit(tx, { actorType: "organizer", actorId: o.userId, action: "organization.created", targetType: "organization", targetId: org!.id, organizationId: org!.id });
    return org!;
  });
  return reply(201, org);
}

export async function getOrganization(ctx: Ctx) {
  const { role } = await requireOrgMember(ctx, ctx.params.orgId!);
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.params.orgId!)).limit(1);
  return { ...org, role };
}

export async function updateOrganization(ctx: Ctx) {
  const { organizer } = await requireOrgMember(ctx, ctx.params.orgId!, true);
  const b = await ctx.json<Record<string, unknown>>();
  const errors = new FieldErrors();
  const f = orgFields(b, errors, false);
  errors.throwIfAny();
  const patch: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() };
  if (b.name !== undefined) patch.name = f.name!;
  if (b.description !== undefined) patch.description = f.description;
  if (b.contactEmail !== undefined) patch.contactEmail = f.contactEmail;
  if (b.contactPhone !== undefined) patch.contactPhone = f.contactPhone;
  if (b.website !== undefined) patch.website = f.website;
  await ctx.db.update(organizations).set(patch).where(eq(organizations.id, ctx.params.orgId!));
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "organization.updated", targetType: "organization", targetId: ctx.params.orgId, organizationId: ctx.params.orgId });
  return getOrganization(ctx);
}

export async function uploadLogo(ctx: Ctx) {
  await requireOrgMember(ctx, ctx.params.orgId!, true);
  const form = await ctx.req.formData().catch(() => null);
  const saved = await saveSquareImage((form?.get("file") as Blob | null) ?? null, "logos", [256]);
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.params.orgId!)).limit(1);
  await ctx.db.update(organizations).set({ logoUrl: saved[256]!.url, logoKey: saved[256]!.key, updatedAt: new Date() }).where(eq(organizations.id, ctx.params.orgId!));
  await removeMedia([org?.logoUrl]);
  return { logoUrl: saved[256]!.url };
}

export async function removeLogo(ctx: Ctx) {
  await requireOrgMember(ctx, ctx.params.orgId!, true);
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.params.orgId!)).limit(1);
  await ctx.db.update(organizations).set({ logoUrl: null, logoKey: null }).where(eq(organizations.id, ctx.params.orgId!));
  await removeMedia([org?.logoUrl]);
  return reply(204);
}

export async function dashboard(ctx: Ctx) {
  await requireOrgMember(ctx, ctx.params.orgId!);
  const orgId = ctx.params.orgId!;
  const { syncStatuses } = await import("./events-core");
  const ids = (await ctx.db.select({ id: events.id }).from(events).where(eq(events.organizationId, orgId))).map((r) => r.id);
  await syncStatuses(ctx.db, ids);
  const [t] = (await ctx.db.execute<{ total: number; active: number; participants: number; open: number }>(sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('active','networking_paused'))::int AS active,
      coalesce(sum(participant_count), 0)::int AS participants,
      (SELECT count(*)::int FROM event_participants ep JOIN events e ON e.id = ep.event_id JOIN event_availability ea ON ea.participant_id = ep.id
        WHERE e.organization_id = ${orgId} AND e.status = 'active' AND ep.status = 'active' AND ep.discovery_paused = false
        AND ea.status IN ('available_now','open_to_conversations','meet_new_people','looking_for_collaborators','quick_conversations')) AS open
    FROM events WHERE organization_id = ${orgId} AND status <> 'archived'`)).rows;
  const recent = await ctx.db.select().from(events).where(eq(events.organizationId, orgId)).orderBy(desc(events.updatedAt)).limit(6);
  return {
    totals: { events: t?.total ?? 0, activeEvents: t?.active ?? 0, participants: t?.participants ?? 0, openToTalkNow: t && t.open >= 5 ? t.open : null },
    recentEvents: recent.map((e) => ({ id: e.id, name: e.name, status: e.status, startsAt: e.startsAt, endsAt: e.endsAt, timeZone: e.timeZone, participantCount: e.participantCount, bannerUrl: e.bannerUrl })),
    plan: await (async () => { const e = await orgEntitlements(ctx.db, orgId); return { tier: e.tier, name: e.planName, pro: e.tier !== "starter", allowance: e.allowance }; })(),
  };
}

// ---------- Members (Business: multiple organization members) ----------
const MAX_MEMBERS = 25;

export async function listMembers(ctx: Ctx) {
  const { role, organizer } = await requireOrgMember(ctx, ctx.params.orgId!);
  const rows = await ctx.db.select({ userId: organizerUsers.id, displayName: organizerUsers.displayName, email: organizerUsers.email, role: organizationMembers.role, joinedAt: organizationMembers.createdAt })
    .from(organizationMembers).innerJoin(organizerUsers, eq(organizerUsers.id, organizationMembers.organizerUserId))
    .where(eq(organizationMembers.organizationId, ctx.params.orgId!)).orderBy(sql`${organizationMembers.role} = 'member'`, organizationMembers.createdAt);
  const ent = await orgEntitlements(ctx.db, ctx.params.orgId!);
  return { myRole: role, canInvite: role === "owner" && ent.features.includes("org.members"), membersFeature: ent.features.includes("org.members"), limit: MAX_MEMBERS,
    members: rows.map((r) => ({ ...r, isMe: r.userId === organizer.userId })) };
}

/** Adds an existing QRious organizer account to the organization (owner only, Business plan). */
export async function addMember(ctx: Ctx) {
  const orgId = ctx.params.orgId!;
  const { organizer } = await requireOrgMember(ctx, orgId, true);
  await requireOrgFeature(ctx.db, orgId, "org.members");
  await ctx.limit("org-member-add", 30, 3600, organizer.userId);
  const b = await ctx.json<{ email?: string }>();
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email)) throw new AppError(400, "validation_failed", "One or more fields are invalid.", { email: ["Enter a valid email."] });
  const [user] = await ctx.db.select({ id: organizerUsers.id, status: organizerUsers.status }).from(organizerUsers).where(eq(organizerUsers.emailNormalized, email)).limit(1);
  if (!user || user.status !== "active") throw new AppError(400, "validation_failed", "One or more fields are invalid.", { email: ["No active QRious organizer account uses this email. Ask them to sign up first."] });
  await ctx.db.transaction(async (tx) => {
    await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).for("update");
    const [{ n }] = (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM organization_members WHERE organization_id = ${orgId}`)).rows as [{ n: number }];
    if (n >= MAX_MEMBERS) throw conflict("member_limit", `Organizations can have up to ${MAX_MEMBERS} members.`);
    if ((await myOrganizations(tx, user.id)).length >= 5) throw conflict("too_many_organizations", "That person already belongs to 5 organizations.");
    const r = await tx.insert(organizationMembers).values({ organizationId: orgId, organizerUserId: user.id, role: "member" }).onConflictDoNothing().returning({ id: organizationMembers.organizerUserId });
    if (!r.length) throw conflict("already_member", "That person is already a member.");
    await audit(tx, { actorType: "organizer", actorId: organizer.userId, action: "organization.member_added", targetType: "organizer", targetId: user.id, organizationId: orgId });
  });
  return reply(201, { ok: true });
}

/** Owners remove members; members may leave. Allowed on every plan so a downgraded organization can tidy up. */
export async function removeMember(ctx: Ctx) {
  const orgId = ctx.params.orgId!;
  const { organizer, role } = await requireOrgMember(ctx, orgId);
  const target = ctx.params.userId!;
  if (target !== organizer.userId && role !== "owner") throw forbidden("Only the organization owner can remove members.");
  const [m] = await ctx.db.select({ role: organizationMembers.role }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.organizerUserId, target))).limit(1);
  if (!m) throw notFound("Member not found.");
  if (m.role === "owner") throw conflict("owner_required", "The owner can't be removed or leave the organization.");
  await ctx.db.delete(organizationMembers).where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.organizerUserId, target)));
  await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: target === organizer.userId ? "organization.member_left" : "organization.member_removed", targetType: "organizer", targetId: target, organizationId: orgId });
  return reply(204);
}

// ---------- Cross-event analytics & organization report (Business) ----------
export async function orgAnalytics(ctx: Ctx) {
  const orgId = ctx.params.orgId!;
  const { organizer } = await requireOrgMember(ctx, orgId);
  await requireOrgFeature(ctx.db, orgId, "org.analytics.cross_event");
  const rows = (await ctx.db.execute<{ id: string; name: string; status: string; starts_at: Date; active: number; joined: number; connections: number; conversations: number }>(sql`
    SELECT e.id, e.name, e.status, e.starts_at, e.participant_count AS active,
      (SELECT count(*)::int FROM event_participants ep WHERE ep.event_id = e.id) AS joined,
      (SELECT count(*)::int FROM connections c WHERE c.origin_event_id = e.id AND c.status = 'accepted') AS connections,
      (SELECT count(*)::int FROM conversations cv WHERE cv.origin_event_id = e.id) AS conversations
    FROM events e WHERE e.organization_id = ${orgId} AND e.status <> 'draft' ORDER BY e.starts_at DESC LIMIT 200`)).rows;
  const [u] = (await ctx.db.execute<{ unique_people: number; returning_people: number }>(sql`
    SELECT count(*)::int AS unique_people, count(*) FILTER (WHERE n > 1)::int AS returning_people FROM (
      SELECT ep.attendee_id, count(DISTINCT ep.event_id) AS n FROM event_participants ep JOIN events e ON e.id = ep.event_id
      WHERE e.organization_id = ${orgId} GROUP BY ep.attendee_id) x`)).rows;
  const events = rows.map((r) => ({ id: r.id, name: r.name, status: r.status, startsAt: r.starts_at, activeParticipants: r.active, joined: r.joined, connections: r.connections, conversations: r.conversations }));
  const sum = (k: "joined" | "connections" | "conversations") => events.reduce((a, e) => a + e[k], 0);
  const totals = { events: events.length, joined: sum("joined"), connections: sum("connections"), conversations: sum("conversations"), uniquePeople: u?.unique_people ?? 0, returningPeople: u?.returning_people ?? 0 };
  if (ctx.query("format") === "csv") {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const csv = ["Event,Status,Starts at,Joined,Active participants,Connections,Conversations",
      ...events.map((e) => [e.name, e.status, new Date(e.startsAt).toISOString(), e.joined, e.activeParticipants, e.connections, e.conversations].map(esc).join(","))].join("\r\n");
    await audit(ctx.db, { actorType: "organizer", actorId: organizer.userId, action: "organization.report_exported", targetType: "organization", targetId: orgId, organizationId: orgId, data: { rows: events.length } });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="organization-report.csv"`, "Cache-Control": "no-store" } });
  }
  return { totals, events };
}
