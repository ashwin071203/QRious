import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hotp, newTotpSecret, otpauthUrl, totp, verifyTotp } from "./totp";

describe("TOTP (D-24)", () => {
  it("matches the RFC 4226 HOTP test vectors", () => {
    const key = Buffer.from("12345678901234567890");
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, i) => expect(hotp(key, i)).toBe(code));
  });

  it("matches the RFC 6238 SHA-1 vector at T=59s (8-digit 94287082 → 6-digit 287082)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totp(secret, 59_000)).toBe("287082");
  });

  it("round-trips base32", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 9]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("accepts ±1 step of drift, rejects wrong/malformed codes and replays", () => {
    const s = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(s, totp(s, now), now)).toBe(step);
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(s, totp(s, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBeNull();
    expect(verifyTotp(s, "12345", now)).toBeNull();
    expect(verifyTotp(s, 123456, now)).toBeNull();
    expect(verifyTotp(s, totp(s, now), now, step)).toBeNull(); // same code reused
    expect(verifyTotp(s, ` ${totp(s, now).slice(0, 3)} ${totp(s, now).slice(3)} `, now)).toBe(step);
  });

  it("encrypts secrets at rest; wrong pepper or tampering fails", () => {
    const s = newTotpSecret();
    const enc = encryptSecret(s, "pepper-one-xxxxxxxxxxxxxxxxxxxx");
    expect(enc).not.toContain(s);
    expect(decryptSecret(enc, "pepper-one-xxxxxxxxxxxxxxxxxxxx")).toBe(s);
    expect(() => decryptSecret(enc, "pepper-two-xxxxxxxxxxxxxxxxxxxx")).toThrow();
    const parts = enc.split(".");
    parts[2] = Buffer.from("AAAAAAAAAAAAAAAA").toString("base64url");
    expect(() => decryptSecret(parts.join("."), "pepper-one-xxxxxxxxxxxxxxxxxxxx")).toThrow();
  });

  it("builds an otpauth URL", () => {
    expect(otpauthUrl("ABC", "a@b.co")).toBe("otpauth://totp/QRious%3Aa%40b.co?secret=ABC&issuer=QRious&algorithm=SHA1&digits=6&period=30");
  });
});
