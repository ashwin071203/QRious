/**
 * TOTP (RFC 6238 / RFC 4226) for platform-admin MFA (D-24). HMAC-SHA1, 30-second steps, 6 digits — the
 * parameters every authenticator app supports. Secrets are encrypted at rest with AES-256-GCM using a key
 * derived (HKDF) from the deployment pepper, so a database dump alone can't mint codes.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret (RFC 4226 recommendation), base32 for authenticator apps. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

export function totp(secretB32: string, nowMs = Date.now()): string {
  return hotp(base32Decode(secretB32), totpStep(nowMs));
}

/**
 * Verifies a code within ±1 step (clock drift) and rejects any step at or before `lastStep` (replay).
 * Returns the matched step to store as the new `lastStep`, or null.
 */
export function verifyTotp(secretB32: string, code: unknown, nowMs = Date.now(), lastStep: number | null = null): number | null {
  if (typeof code !== "string") return null;
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const now = totpStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUrl(secretB32: string, account: string, issuer = "QRious"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${q}`;
}

function key(pepper: string): Buffer {
  return Buffer.from(hkdfSync("sha256", pepper, "qrious-totp", "admin-mfa-secret-v1", 32));
}

export function encryptSecret(secretB32: string, pepper: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(pepper), iv);
  const enc = Buffer.concat([c.update(secretB32, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

export function decryptSecret(stored: string, pepper: string): string {
  const [v, iv, enc, tag] = stored.split(".");
  if (v !== "v1" || !iv || !enc || !tag) throw new Error("Unsupported secret format");
  const d = createDecipheriv("aes-256-gcm", key(pepper), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
