import "server-only";

const isProd = process.env.NODE_ENV === "production";

function secret(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v && v.length >= 16) return v;
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    throw new Error(`${name} must be set (min 16 chars) in deployed environments.`);
  }
  return v || devDefault;
}

export const config = {
  get recoveryPepper() {
    return secret("QRIOUS_RECOVERY_PEPPER", "dev-only-recovery-pepper-0123456789");
  },
  get ipSalt() {
    return secret("QRIOUS_IP_SALT", "dev-only-ip-salt-0123456789");
  },
  rateLimitEnabled: process.env.QRIOUS_DISABLE_RATE_LIMIT !== "1",
  /** Comma-separated organizer emails that become platform admins on registration. */
  adminEmails: (process.env.QRIOUS_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
    get enabled() {
      return !!(this.keyId && this.keySecret);
    },
  },
  cronSecret: process.env.CRON_SECRET ?? "",
  isProd,
};

// Session policy (D-13)
export const SESSION = {
  idleMs: 30 * 86_400_000,
  absoluteMs: 180 * 86_400_000,
  rotateMs: 24 * 3_600_000,
  graceMs: 2 * 60_000,
  renewThrottleMs: 3_600_000,
};
export const ORGANIZER_SESSION = { idleMs: 7 * 86_400_000, adminIdleMs: 12 * 3_600_000 };
