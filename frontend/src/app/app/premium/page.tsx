"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { BadgeCheck, Check, Crown, Sparkles } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Misc";
import { PageHeader, Tabs } from "@/components/ui/Overlay";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Plan } from "@/lib/types";

const FREE = ["Create your profile", "Join unlimited events", "Discover people", "Basic Smart Matching", "Event Pulse", "Open to Talk", "Connection requests", "Private messaging", "Privacy controls"];
const PREMIUM = ["Everything in Free", "Detailed compatibility insights", "Advanced discovery filters (company, location)", "See who saved your profile", "Profile highlight badge", "Networking analytics"];

type RazorpayInstance = { open: () => void; on: (event: string, cb: (r: { error?: { description?: string } }) => void) => void };
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance } }

/** Loads Razorpay Checkout.js once, on demand (only when the user actually upgrades). */
function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay]");
    const s = existing ?? Object.assign(document.createElement("script"), { src: "https://checkout.razorpay.com/v1/checkout.js", async: true });
    s.dataset.razorpay = "1";
    s.addEventListener("load", () => resolve(), { once: true });
    s.addEventListener("error", () => reject(new Error("load")), { once: true });
    if (!existing) document.body.appendChild(s);
  });
}

type Billing = { planCode: string; planName: string; paymentsEnabled: boolean; subscription: { status: string; planName: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  promotion: { planName: string; endsAt: string } | null; payments: { id: string; amountMinor: number; currency: string; status: string; createdAt: string }[] };

/** Subscription management (PRD §19.4). Essential networking always stays free (D-20). Payments activate only after gateway approval (D-01). */
export default function PremiumPage() {
  const toast = useToast();
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState(false);
  const billing = useQuery({ queryKey: ["billing"], queryFn: () => api<Billing>("/me/billing") });
  const plans = useQuery({ queryKey: ["plans", "attendee"], queryFn: () => api<{ paymentsEnabled: boolean; paymentsMode: string; plans: (Plan & { purchasable?: boolean })[] }>("/plans?audience=attendee") });
  const premium = plans.data?.plans.find((p) => p.code === (period === "month" ? "attendee_premium_monthly" : "attendee_premium_yearly"));
  const isPremium = billing.data?.planCode === "attendee_premium";
  const inr = (minor: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(minor / 100);

  async function upgrade() {
    if (!premium) return;
    setBusy(true);
    try {
      const c = await api<{ gateway: string; keyId: string; subscriptionId: string }>("/subscriptions/checkout", { method: "POST", body: { planCode: premium.code } });
      try { await loadRazorpay(); } catch { throw new Error("The payment window couldn't load. Check your connection and try again."); }
      const rz = new window.Razorpay!({
        key: c.keyId,
        subscription_id: c.subscriptionId,
        name: "QRious",
        description: premium.name,
        theme: { color: "#8b5cf6" },
        // Access is granted only by the verified server webhook (BR-25); the client just waits for it.
        handler: () => {
          toast("success", "Payment received — activating Premium…");
          let tries = 0;
          const poll = async () => {
            const b = await billing.refetch();
            if (b.data?.planCode === "attendee_premium" || ++tries > 20) {
              setBusy(false);
              if (b.data?.planCode !== "attendee_premium") toast("success", "Your payment is processing. Premium will switch on shortly.");
              return;
            }
            setTimeout(poll, 3000);
          };
          void poll();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rz.on("payment.failed", (r) => toast("error", r.error?.description ?? "Payment failed. You haven't been charged."));
      rz.open();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try { await api("/subscriptions/cancel", { method: "POST" }); toast("success", "Your subscription will end at the close of this billing period."); billing.refetch(); }
    catch (e) { toast("error", e instanceof ApiError ? e.message : "Couldn't cancel."); }
    finally { setBusy(false); }
  }

  return (
    <AttendeePage title="Premium" className="max-w-4xl">
      <PageHeader title={<span className="inline-flex items-center gap-2"><Crown className="size-6 text-pink" />QRious Premium</span>} subtitle="Networking essentials are free forever. Premium adds power tools." />
      {billing.isLoading || plans.isLoading ? <Skeleton className="h-96" /> : (
        <div className="space-y-6">
          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="text-sm text-text-2">Current plan</p>
              <p className="flex items-center gap-2 font-display text-xl font-bold">{isPremium && <BadgeCheck className="size-5 text-pink" />}{billing.data?.planName ?? "Free"}</p>
              {billing.data?.promotion && <p className="mt-1 text-sm text-text-2">Promotional access until {formatDateTime(billing.data.promotion.endsAt)}</p>}
              {billing.data?.subscription?.currentPeriodEnd && <p className="mt-1 text-sm text-text-2">{billing.data.subscription.cancelAtPeriodEnd ? "Ends" : "Renews"} {formatDateTime(billing.data.subscription.currentPeriodEnd)}</p>}
            </div>
            {billing.data?.subscription?.status === "active" && !billing.data.subscription.cancelAtPeriodEnd && <Button variant="secondary" loading={busy} onClick={cancel}>Cancel subscription</Button>}
          </div>

          <div className="flex justify-center"><Tabs value={period} onChange={setPeriod} items={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly · save 33%" }]} /></div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="card p-6">
              <p className="font-display text-lg font-semibold">Free</p>
              <p className="mt-1 font-display text-3xl font-bold">₹0</p>
              <ul className="mt-5 space-y-2 text-sm">{FREE.map((f) => <li key={f} className="flex gap-2"><Check className="size-4 shrink-0 text-success" />{f}</li>)}</ul>
            </div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[1.25rem] border border-primary/50 bg-gradient-to-br from-primary/25 via-card to-pink/15 p-6 shadow-[var(--shadow-glow)]">
              <p className="flex items-center gap-2 font-display text-lg font-semibold"><Sparkles className="size-5 text-pink" />Premium</p>
              <p className="mt-1 font-display text-3xl font-bold">{premium ? inr(premium.priceMinor) : "—"}<span className="text-base font-normal text-text-2">/{period === "month" ? "month" : "year"}</span></p>
              <ul className="mt-5 space-y-2 text-sm">{PREMIUM.map((f) => <li key={f} className="flex gap-2"><Check className="size-4 shrink-0 text-pink" />{f}</li>)}</ul>
              {isPremium ? <p className="mt-6 rounded-xl bg-success/15 px-3 py-2 text-center text-sm text-success">You have Premium</p>
                : plans.data?.paymentsEnabled && premium?.purchasable ? <Button className="mt-6 w-full" size="lg" loading={busy} onClick={upgrade}>Upgrade to Premium</Button>
                : <p className="mt-6 rounded-xl bg-bg-2 px-3 py-2.5 text-center text-sm text-text-2">Payments are coming soon. Premium will be available to purchase shortly.</p>}
              {!isPremium && plans.data?.paymentsMode === "test" && premium?.purchasable && (
                <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  Test mode — no real money is charged. Use test card 4718 6091 0820 4366, any future expiry, any CVV and any 4–10 digit OTP.
                </p>
              )}
              <p className="mt-3 text-center text-xs text-text-2">Premium never overrides anyone&apos;s privacy, blocks or discovery settings.</p>
            </motion.div>
          </div>

          <section className="card p-5">
            <h2 className="font-display font-semibold">Billing history</h2>
            {!billing.data?.payments.length ? <p className="mt-2 text-sm text-text-2">No payments yet.</p> : (
              <ul className="mt-3 divide-y divide-line text-sm">
                {billing.data.payments.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{formatDateTime(p.createdAt)}</span><span>{inr(p.amountMinor)} · {p.status}</span></li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </AttendeePage>
  );
}
