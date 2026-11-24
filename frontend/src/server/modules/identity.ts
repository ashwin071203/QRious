import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { SESSION, config } from "@/server/core/config";
import { AppError, unauthorized } from "@/server/core/errors";
import type { Ctx } from "@/server/core/http";
import { audit } from "@/server/core/platform";
import { generateRecoveryCode, hashRecoveryCode, newToken, normalizeRecoveryCode, normalizeUsername, sha256, userAgentSummary, verifyRecoveryCode } from "@/server/lib/rules";

const { attendeeSessions, attendees, attendeeRecoveryCodes, userProfiles, notifications } = schema;
export const ATTENDEE_COOKIE = "qr_s";

export type AttendeeAuth = { attendeeId: string; sessionId: string; profileId: string; status: string };

const min = (a: Date, b: Date) => (a < b ? a : b);

/** Adds a new session (caller is inside a transaction or not). Returns the raw token for the cookie. */
export async function createSession(db: Executor, attendeeId: string, ua: string | null) {
  const now = new Date();
  const { token, hash } = newToken();
  const absolute = new Date(now.getTime() + SESSION.absoluteMs);
  const [s] = await db.insert(attendeeSessions).values({
    attendeeId, tokenHash: hash, tokenIssuedAt: now, lastSeenAt: now,
    expiresAt: min(new Date(now.getTime() + SESSION.idleMs), absolute), absoluteExpiresAt: absolute,
    userAgentSummary: userAgentSummary(ua),
  }).returning({ id: attendeeSessions.id, expiresAt: attendeeSessions.expiresAt });
  return { token, sessionId: s!.id, expiresAt: s!.expiresAt };
}

export function writeAttendeeCookie(ctx: Ctx, token: string, expiresAt: Date) {
  ctx.setCookie(ATTENDEE_COOKIE, token, { expires: expiresAt });
}

/**
 * Validates the attendee session from the cookie (web) or bearer token (future mobile). Handles sliding renewal,
 * 24 h token rotation with a 2-minute grace window, and revokes a session if a rotated-out token is replayed (D-13).
 */
export async function maybeAttendee(ctx: Ctx): Promise<AttendeeAuth | null> {
  return ctx.once("attendee", async () => {
    let token = ctx.readSessionCookie(ATTENDEE_COOKIE);
    const fromCookie = !!token;
    if (!token) {
      const auth = ctx.req.headers.get("authorization");
      if (auth?.startsWith("Bearer ")) token = auth.slice(7).trim();
    }
    if (!token || token.length > 100) return null;

    const hash = sha256(token);
    const now = new Date();
    const db = ctx.db;
    const rows = await db.select({ s: attendeeSessions, status: attendees.status, profileId: userProfiles.id })
      .from(attendeeSessions)
      .innerJoin(attendees, eq(attendees.id, attendeeSessions.attendeeId))
      .leftJoin(userProfiles, eq(userProfiles.attendeeId, attendees.id))
      .where(or(eq(attendeeSessions.tokenHash, hash), eq(attendeeSessions.previousTokenHash, hash)))
      .limit(1);
    const row = rows[0];
    const invalid = () => { if (fromCookie) ctx.clearCookie(ATTENDEE_COOKIE); return null; };
    if (!row || !row.profileId) return invalid();
    const s = row.s;
    const active = !s.revokedAt && s.expiresAt > now && s.absoluteExpiresAt > now;

    if (!s.tokenHash.equals(hash)) {
      if (!s.revokedAt && s.previousTokenValidUntil && s.previousTokenValidUntil > now) {
        return active && row.status !== "suspended" && row.status !== "deleted"
          ? { attendeeId: s.attendeeId, sessionId: s.id, profileId: row.profileId, status: row.status } : invalid();
      }
      if (!s.revokedAt) {
        await db.update(attendeeSessions).set({ revokedAt: now, revokedReason: "token_reuse" }).where(eq(attendeeSessions.id, s.id));
      }
      return invalid();
    }
    if (!active || row.status === "suspended" || row.status === "deleted") return invalid();

    let newTok: string | null = null;
    const patch: Partial<typeof attendeeSessions.$inferInsert> = {};
    if (now.getTime() - s.tokenIssuedAt.getTime() >= SESSION.rotateMs) {
      const t = newToken();
      Object.assign(patch, { previousTokenHash: s.tokenHash, previousTokenValidUntil: new Date(now.getTime() + SESSION.graceMs), tokenHash: t.hash, tokenIssuedAt: now });
      newTok = t.token;
    }
    if (newTok || now.getTime() - s.lastSeenAt.getTime() >= SESSION.renewThrottleMs) {
      patch.lastSeenAt = now;
      patch.expiresAt = min(new Date(now.getTime() + SESSION.idleMs), s.absoluteExpiresAt);
    }
    if (Object.keys(patch).length) {
      // Optimistic: only the request that still sees the old hash rotates.
      const updated = await db.update(attendeeSessions).set(patch)
        .where(and(eq(attendeeSessions.id, s.id), eq(attendeeSessions.tokenHash, hash))).returning({ id: attendeeSessions.id });
      if (updated.length) {
        await db.update(attendees).set({ lastActiveAt: now }).where(eq(attendees.id, s.attendeeId));
        if (fromCookie) writeAttendeeCookie(ctx, newTok ?? token, patch.expiresAt!);
      }
    }
    return { attendeeId: s.attendeeId, sessionId: s.id, profileId: row.profileId, status: row.status };
  });
}

/** Requires an active attendee (PRD M02). Deactivated (pending deletion) attendees may only use allowDeactivated routes. */
export async function requireAttendee(ctx: Ctx, opts: { allowDeactivated?: boolean } = {}): Promise<AttendeeAuth> {
  const a = await maybeAttendee(ctx);
  if (!a) throw unauthorized();
  if (a.status === "deactivated" && !opts.allowDeactivated)
    throw new AppError(403, "account_deactivated", "Your account is scheduled for deletion. Cancel the deletion to continue using QRious.");
  return a;
}

export async function revokeSession(db: Executor, sessionId: string, attendeeId: string, reason: (typeof schema.SESSION_REVOKED)[number]) {
  await db.update(attendeeSessions).set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(attendeeSessions.id, sessionId), eq(attendeeSessions.attendeeId, attendeeId), isNull(attendeeSessions.revokedAt)));
}

export async function revokeAllSessions(db: Executor, attendeeId: string, reason: (typeof schema.SESSION_REVOKED)[number], exceptSessionId?: string) {
  const conds = [eq(attendeeSessions.attendeeId, attendeeId), isNull(attendeeSessions.revokedAt)];
  if (exceptSessionId) conds.push(ne(attendeeSessions.id, exceptSessionId));
  const r = await db.update(attendeeSessions).set({ revokedAt: new Date(), revokedReason: reason }).where(and(...conds)).returning({ id: attendeeSessions.id });
  return r.length;
}

export async function listSessions(db: Executor, attendeeId: string, currentSessionId: string) {
  const now = new Date();
  const rows = await db.select().from(attendeeSessions)
    .where(and(eq(attendeeSessions.attendeeId, attendeeId), isNull(attendeeSessions.revokedAt), sql`${attendeeSessions.expiresAt} > ${now}`, sql`${attendeeSessions.absoluteExpiresAt} > ${now}`))
    .orderBy(sql`${attendeeSessions.lastSeenAt} DESC`);
  return rows.map((s) => ({
    id: s.id, device: s.userAgentSummary ?? "Unknown device", createdAt: s.createdAt, lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt, absoluteExpiresAt: s.absoluteExpiresAt, isCurrent: s.id === currentSessionId,
  }));
}

// ---------- Recovery codes (D-13) ----------
export async function issueRecoveryCode(db: Executor, attendeeId: string, retireAs: "rotated" | "used" | null): Promise<string> {
  const now = new Date();
  if (retireAs) {
    await db.update(attendeeRecoveryCodes).set({ status: retireAs, rotatedAt: now, ...(retireAs === "used" ? { usedAt: now } : {}) })
      .where(and(eq(attendeeRecoveryCodes.attendeeId, attendeeId), eq(attendeeRecoveryCodes.status, "active")));
  }
  const raw = generateRecoveryCode();
  const salt = randomBytes(16);
  await db.insert(attendeeRecoveryCodes).values({ attendeeId, salt, codeHash: hashRecoveryCode(normalizeRecoveryCode(raw)!, salt, config.recoveryPepper) });
  return raw;
}

const RECOVERY_FAILED = () => new AppError(401, "recovery_failed", "We couldn't recover an account with that username and recovery code.");

export async function recoverAccount(ctx: Ctx, usernameInput: unknown, codeInput: unknown) {
  const username = normalizeUsername(usernameInput);
  const code = normalizeRecoveryCode(codeInput);
  if (!username) throw RECOVERY_FAILED();
  const db = ctx.db;
  const [profile] = await db.select({ id: userProfiles.id, attendeeId: userProfiles.attendeeId, status: attendees.status })
    .from(userProfiles).innerJoin(attendees, eq(attendees.id, userProfiles.attendeeId))
    .where(eq(userProfiles.usernameNormalized, username)).limit(1);
  if (!profile || profile.status === "suspended" || profile.status === "deleted") {
    hashRecoveryCode(code ?? "0".repeat(24), Buffer.alloc(16), config.recoveryPepper); // comparable timing
    throw RECOVERY_FAILED();
  }

  type Outcome = { ok: true; token: string; expiresAt: Date; newCode: string } | { ok: false };
  const outcome: Outcome = await db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string; code_hash: Buffer; salt: Buffer; failed_attempts: number; locked_until: Date | null }>(
      sql`SELECT id, code_hash, salt, failed_attempts, locked_until FROM attendee_recovery_codes WHERE attendee_id = ${profile.attendeeId} AND status = 'active' FOR UPDATE`);
    const rc = locked.rows[0];
    const now = new Date();
    if (!rc) return { ok: false };
    if (rc.locked_until && new Date(rc.locked_until) > now) {
      await audit(tx, { actorType: "attendee", action: "attendee.recovery_locked", targetType: "profile", targetId: profile.id, ip: ctx.ip });
      return { ok: false };
    }
    if (!code || !verifyRecoveryCode(code, rc.salt, rc.code_hash, config.recoveryPepper)) {
      const attempts = rc.failed_attempts + 1;
      await tx.update(attendeeRecoveryCodes).set(attempts >= 5
        ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + 3_600_000) } : { failedAttempts: attempts })
        .where(eq(attendeeRecoveryCodes.id, rc.id));
      await audit(tx, { actorType: "attendee", action: "attendee.recovery_failed", targetType: "profile", targetId: profile.id, ip: ctx.ip });
      return { ok: false };
    }
    await revokeAllSessions(tx, profile.attendeeId, "recovery");
    const newCode = await issueRecoveryCode(tx, profile.attendeeId, "used");
    const session = await createSession(tx, profile.attendeeId, ctx.userAgent);
    await tx.insert(notifications).values({
      attendeeId: profile.attendeeId, type: "system",
      payload: { kind: "account_recovered", message: "Your account was recovered on a new device. Other devices were signed out." },
    });
    await audit(tx, { actorType: "attendee", actorId: profile.attendeeId, action: "attendee.recovered", targetType: "profile", targetId: profile.id, ip: ctx.ip });
    return { ok: true, token: session.token, expiresAt: session.expiresAt, newCode };
  });
  if (!outcome.ok) throw RECOVERY_FAILED();
  writeAttendeeCookie(ctx, outcome.token, outcome.expiresAt);
  return { newRecoveryCode: outcome.newCode };
}
