import { describe, expect, it } from "vitest";
import {
  cleanTag, generateRecoveryCode, hashRecoveryCode, newToken, normalizeLink, normalizeRecoveryCode, normalizeTag, normalizeUsername,
  sha256, usernameCandidates, validateTag, validateUsername, verifyRecoveryCode, userAgentSummary,
} from "./rules";

describe("usernames", () => {
  it.each([["Ashwin", "ashwin"], ["  @Ashwin.S ", "ashwin.s"], ["DJ_Neo", "dj_neo"]])("normalizes %s", (i, o) => expect(normalizeUsername(i)).toBe(o));
  it.each(["abc", "ashwin.s", "a_b.c_d", "user_", "x23456789012345678901234567890"])("accepts %s", (u) => expect(validateUsername(u)).toBeNull());
  it.each(["ab", "x234567890123456789012345678901", ".abc", "_abc", "abc.", "a..b", "ab cd", "ab-cd", "admin", "qrious_support", "ñandu"])(
    "rejects %s", (u) => expect(validateUsername(u)).not.toBeNull());
  it("suggests valid alternatives", () => {
    const c = usernameCandidates("ashwin");
    expect(c).not.toContain("ashwin");
    expect(c.length).toBeGreaterThan(3);
    c.forEach((x) => expect(validateUsername(x)).toBeNull());
  });
});

describe("tags", () => {
  it.each([["  music   production ", "music production"], ["MUSIC Production", "music production"], ["Ｍｕｓｉｃ", "music"]])(
    "normalizes %s", (i, o) => expect(normalizeTag(i)).toBe(o));
  it("capitalizes all-lowercase input but keeps intentional casing", () => {
    expect(cleanTag("synthwave")).toBe("Synthwave");
    expect(cleanTag("UI/UX design")).toBe("UI/UX design");
  });
  it.each(["x", "<script>", "fuck this"])("rejects %s", (t) => expect(validateTag(cleanTag(t))).not.toBeNull());
  it.each(["C#", "Rock & Roll", "Carnatic music", "संगीत"])("accepts %s", (t) => expect(validateTag(cleanTag(t))).toBeNull());
});

describe("recovery codes", () => {
  it("generates unique, well-formed codes", () => {
    const codes = Array.from({ length: 300 }, generateRecoveryCode);
    expect(new Set(codes).size).toBe(300);
    codes.forEach((c) => expect(c).toMatch(/^QRS(-[0-9A-HJKMNP-TV-Z]{4}){6}$/));
  });
  it("normalizes lowercase, missing dashes, prefix and confusables", () => {
    const code = generateRecoveryCode();
    const n = normalizeRecoveryCode(code)!;
    expect(n).toHaveLength(24);
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ""))).toBe(n);
    expect(normalizeRecoveryCode(code.slice(4))).toBe(n);
    expect(normalizeRecoveryCode("QRS-0000-0000-0000-0000-0000-000O")).toBe("0".repeat(24));
  });
  it.each(["", "QRS-1234", "QRS-UUUU-UUUU-UUUU-UUUU-UUUU-UUUU"])("rejects %s", (c) => expect(normalizeRecoveryCode(c)).toBeNull());
  it("verifies only with the same code, salt and pepper", () => {
    const n = normalizeRecoveryCode(generateRecoveryCode())!;
    const salt = Buffer.from("0123456789abcdef");
    const h = hashRecoveryCode(n, salt, "pepper");
    expect(verifyRecoveryCode(n, salt, h, "pepper")).toBe(true);
    expect(verifyRecoveryCode(n, salt, h, "other")).toBe(false);
    expect(verifyRecoveryCode(n, Buffer.from("fedcba9876543210"), h, "pepper")).toBe(false);
  });
  it("session tokens are random and stored as sha-256", () => {
    const a = newToken(), b = newToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash.equals(sha256(a.token))).toBe(true);
  });
});

describe("links", () => {
  it("normalizes and validates per platform", () => {
    expect(normalizeLink("instagram", "instagram.com/me")).toEqual({ url: "https://instagram.com/me" });
    expect("error" in normalizeLink("instagram", "https://evil.example/me")).toBe(true);
    expect("error" in normalizeLink("website", "javascript:alert(1)")).toBe(true);
    expect("error" in normalizeLink("website", "https://user:pw@site.com")).toBe(true);
  });
});

describe("user agent", () => {
  it("summarizes coarsely", () => {
    expect(userAgentSummary("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(userAgentSummary(null)).toBeNull();
  });
});
