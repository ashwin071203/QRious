/**
 * Pure business rules (no I/O) — unit tested in src/server/lib/rules.test.ts.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// ---------- Usernames (PRD §3.2, D-16) ----------
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_]|\.(?!\.)){1,28}[a-z0-9_]$/;
export const USERNAME_CHANGE_COOLDOWN_MS = 30 * 86_400_000;
export const USERNAME_HOLD_MS = 30 * 86_400_000;
const RESERVED = new Set([
  "admin", "administrator", "root", "system", "support", "help", "qrious", "official", "api", "app", "www", "mail", "security",
  "moderator", "mod", "staff", "organizer", "organiser", "settings", "profile", "discover", "pulse", "messages", "events",
  "event", "me", "null", "undefined", "anonymous", "everyone", "billing", "premium", "recovery", "login", "logout", "signup", "register",
]);

export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (s.startsWith("@")) s = s.slice(1);
  return s ? s.toLowerCase() : null;
}

export function validateUsername(u: string | null): string | null {
  if (!u) return "Username is required.";
  if (u.length < 3) return "Username must be at least 3 characters.";
  if (u.length > 30) return "Username must be at most 30 characters.";
  if (!USERNAME_RE.test(u)) return "Use lowercase letters, numbers, underscores and single dots. Start with a letter or number and don't end with a dot.";
  if (RESERVED.has(u) || u.startsWith("qrious")) return "This username is reserved.";
  return null;
}

export function usernameCandidates(u: string): string[] {
  const stem = (u.length > 24 ? u.slice(0, 24) : u).replace(/\.+$/, "");
  const out = [`${stem}_`, `${stem}1`, `${stem}7`, `${stem}22`, `${stem}99`, `${stem}_${randomInt(100, 999)}`, `${stem}${randomInt(1000, 9999)}`];
  if (stem.length + 4 <= 30) out.splice(1, 0, `the.${stem}`);
  return [...new Set(out)].filter((c) => validateUsername(c) === null);
}

// ---------- Tags (interests/skills, D-18) ----------
const BLOCKED_WORDS = new Set([
  "fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "slut", "whore", "rape", "porn", "dick", "pussy",
  "chutiya", "madarchod", "bhenchod", "behenchod", "randi", "gandu",
]);
const TAG_ALLOWED = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &+#./'’-]*$/u;

export function cleanTag(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!s) return null;
  if (s === s.toLowerCase() && /\p{L}/u.test(s[0]!)) s = s[0]!.toUpperCase() + s.slice(1);
  return s;
}
export const normalizeTag = (input: unknown) => cleanTag(input)?.toLowerCase() ?? null;

export function validateTag(cleaned: string | null): string | null {
  if (!cleaned) return "Enter a name.";
  if (cleaned.length < 2) return "Must be at least 2 characters.";
  if (cleaned.length > 50) return "Must be at most 50 characters.";
  if (!TAG_ALLOWED.test(cleaned)) return "Use letters, numbers, spaces and & + # . / - ' only.";
  if (cleaned.toLowerCase().split(/[\s\-./&+]+/).some((w) => BLOCKED_WORDS.has(w))) return "Please choose a different name.";
  return null;
}

/** Cheap profanity screen for free text shown to others (bios, intros). */
export function containsBlockedWord(text: string): boolean {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => BLOCKED_WORDS.has(w));
}

// ---------- Tokens ----------
export const base64url = (b: Buffer) => b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function newToken(): { token: string; hash: Buffer } {
  const token = base64url(randomBytes(32));
  return { token, hash: sha256(token) };
}

export function randomBase62(length: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

/** QR codes avoid look-alike characters (printed on posters, sometimes typed). */
export function newQrCode(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 12; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

// ---------- Recovery codes (D-13) ----------
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateRecoveryCode(): string {
  const bytes = randomBytes(15);
  let buffer = 0, bits = 0, out = "";
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  return `QRS-${out.match(/.{4}/g)!.join("-")}`;
}

export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  let s = "";
  for (const raw of input.trim().toUpperCase()) {
    const c = raw === "I" || raw === "L" ? "1" : raw === "O" ? "0" : raw;
    if (c === "-" || c === " " || c === "_") continue;
    s += c;
  }
  if (s.length === 27 && s.startsWith("QRS")) s = s.slice(3);
  if (s.length !== 24 || [...s].some((c) => !CROCKFORD.includes(c))) return null;
  return s;
}

export function hashRecoveryCode(normalized: string, salt: Buffer, pepper: string): Buffer {
  return createHmac("sha256", pepper).update(Buffer.concat([salt, Buffer.from(normalized, "ascii")])).digest();
}

export function verifyRecoveryCode(normalized: string, salt: Buffer, expected: Buffer, pepper: string): boolean {
  const actual = hashRecoveryCode(normalized, salt, pepper);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- Text helpers ----------
export function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC").trim();
  return s ? s : null;
}

export function userAgentSummary(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = ua.includes("Edg/") ? "Edge" : ua.includes("OPR/") ? "Opera" : ua.includes("SamsungBrowser") ? "Samsung Internet"
    : ua.includes("Firefox/") || ua.includes("FxiOS") ? "Firefox" : ua.includes("CriOS") || ua.includes("Chrome/") ? "Chrome"
    : ua.includes("Safari/") ? "Safari" : "Browser";
  const os = ua.includes("Android") ? "Android" : ua.includes("iPhone") || ua.includes("iPad") ? "iOS" : ua.includes("Windows") ? "Windows"
    : ua.includes("Mac OS X") ? "macOS" : ua.includes("Linux") ? "Linux" : "device";
  return `${browser} on ${os}`;
}

export function slugify(s: string): string {
  return s.normalize("NFKD").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";
}

// ---------- Social links ----------
export const PLATFORM_HOSTS: Record<string, string[]> = {
  instagram: ["instagram.com"], linkedin: ["linkedin.com"], x: ["x.com", "twitter.com"], github: ["github.com"],
  behance: ["behance.net"], dribbble: ["dribbble.com"], youtube: ["youtube.com", "youtu.be"], spotify: ["spotify.com"],
  soundcloud: ["soundcloud.com"],
};

/** Returns a normalized https URL or an error message. */
export function normalizeLink(platform: string, raw: string): { url: string } | { error: string } {
  let url = (raw ?? "").trim();
  if (!url) return { error: "Enter a link." };
  if (/^(javascript|data|vbscript|file):/i.test(url)) return { error: `"${raw}" isn't a valid web address.` };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/^http:\/\//i, "https://");
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: `"${raw}" isn't a valid web address.` };
  }
  if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password || url.length > 500)
    return { error: `"${raw}" isn't a valid web address.` };
  const hosts = PLATFORM_HOSTS[platform];
  if (hosts && !hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return { error: `That doesn't look like a ${platform} link.` };
  return { url: u.toString() };
}

export function normalizeHttpsUrl(raw: string | null | undefined): string | null | { error: string } {
  if (!raw || !raw.trim()) return null;
  const r = normalizeLink("website", raw);
  return "error" in r ? r : r.url;
}
