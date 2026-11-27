/**
 * Build-time payment configuration report (never fails the build, never prints secret values).
 * Confirms which Razorpay variables are present, which mode the key belongs to, and that Razorpay accepts the key pair
 * (a read-only GET /v1/plans — creates nothing, charges nothing).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const id = (process.env.RAZORPAY_KEY_ID ?? "").trim();
  const secret = (process.env.RAZORPAY_KEY_SECRET ?? "").trim();
  const wh = (process.env.RAZORPAY_WEBHOOK_SECRET ?? "").trim();
  const mode = !id || !secret ? "off" : id.startsWith("rzp_test_") ? "test" : id.startsWith("rzp_live_") ? "live" : "invalid";
  const present = (v: string) => (v ? "set" : "missing");
  console.log(`payments: RAZORPAY_KEY_ID ${present(id)}, RAZORPAY_KEY_SECRET ${present(secret)}, RAZORPAY_WEBHOOK_SECRET ${present(wh)}, mode=${mode}`);
  if (mode === "live" && process.env.RAZORPAY_ALLOW_LIVE !== "1") { console.log("payments: LIVE key detected but RAZORPAY_ALLOW_LIVE is not 1 — payments stay DISABLED."); return; }
  if (mode === "live") console.log("payments: LIVE mode — real money will be charged.");
  if (mode !== "test" && mode !== "live") return;
  // Shape checks only (lengths/charsets), so a mis-paste is diagnosable without revealing anything.
  console.log(`payments: key id length ${id.length} (${/^rzp_(test|live)_[A-Za-z0-9]+$/.test(id) ? "well-formed" : "unexpected characters"}), secret length ${secret.length} (${/^[A-Za-z0-9]+$/.test(secret) ? "alphanumeric" : "contains non-alphanumeric characters"})`);
  for (const path of ["/v1/payments?count=1", "/v1/plans?count=1"]) {
    try {
      const res = await fetch(`https://api.razorpay.com${path}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; description?: string } };
      console.log(`payments: GET ${path.split("?")[0]} → HTTP ${res.status}${res.ok ? " (key pair accepted)" : ` ${body.error?.code ?? ""}: ${body.error?.description ?? ""}`}`);
      if (path.startsWith("/v1/plans") && res.status === 401) console.log(`payments: Subscriptions is not enabled for this Razorpay account (${mode} mode) — enable it in the Razorpay Dashboard.`);
    } catch {
      console.log(`payments: GET ${path.split("?")[0]} → network error`);
    }
  }
}

main().catch(() => {});
