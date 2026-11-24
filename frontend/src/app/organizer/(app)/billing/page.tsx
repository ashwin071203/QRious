"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CalendarClock, Check, CreditCard, Crown, Receipt, Sparkles, Ticket } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { AllowanceMeter, PlanBadge } from "@/components/OrgPlan";
import { CreateOrganization } from "@/components/CreateOrganization";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Misc";
import { ConfirmDialog, ErrorState, PageHeader } from "@/components/ui/Overlay";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { useOrgBilling } from "@/lib/queries";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { cn } from "@/lib/format";
import type { OrgBilling, Plan } from "@/lib/types";

const inr = (m: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(m / 100);
const day = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "—");

/** What each plan really includes (PRD §19.3, limited to features that exist in QRious). */
const PLAN_FEATURES: Record<string, string[]> = {
  org_starter: ["3 events (lifetime, per organization)", "Event QR codes (PNG & SVG)", "Participant management", "Basic Event Pulse", "Networking feature switches"],
  org_pro_monthly: ["Everything in Starter", "Unlimited events", "Advanced Event Pulse (goals, interests, skills)", "Detailed participant statistics", "Custom interest, skill & goal suggestions", "Custom event banners", "Participant export (with attendee consent)"],
  org_business_monthly: ["Everything in Pro", "Team members (up to 25 organizers)", "Cross-event analytics", "Organization reports (CSV)"],
  org_event_package: ["One additional event", "Pay once — no subscription", "Uses your current plan's features"],
};
const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "text-success" }, authenticated: { label: "Starting", tone: "text-warning" }, created: { label: "Awaiting payment", tone: "text-warning" },
  pending: { label: "Payment retrying", tone: "text-warning" }, halted: { label: "Stopped — payment failed", tone: "text-error" }, cancelled: { label: "Cancelled", tone: "text-text-2" },
  completed: { label: "Completed", tone: "text-text-2" }, expired: { label: "Expired", tone: "text-text-2" },
};
const PAY_STATUS: Record<string, string> = { captured: "Paid", failed: "Failed", refunded: "Refunded", partially_refunded: "Partly refunded", authorized: "Processing", created: "Started" };

/** Billing & Plans (PRD §19.3–19.4): plan, free-event usage, subscription, Single Event credits, payment history. */
export default function OrganizerBillingPage() {
  const { orgId, me } = useOrg();
  const b = useOrgBilling(orgId);
  const plans = useQuery({ queryKey: ["plans", "organization"], queryFn: () => api<{ paymentsEnabled: boolean; paymentsMode: string; plans: Plan[] }>("/plans?audience=organization") });
  if (!me.organizations?.length) return <CreateOrganization />;
  return (
    <>
      <PageHeader title="Billing & Plans" subtitle="Your plan, free-event allowance, subscription and payments." />
      {b.isError ? <ErrorState error={b.error} onRetry={() => b.refetch()} />
        : !b.data || !plans.data || !orgId ? <Skeleton className="h-96" />
        : <Billing orgId={orgId} b={b.data} plans={plans.data.plans} />}
    </>
  );
}

function Billing({ orgId, b, plans }: { orgId: string; b: OrgBilling; plans: Plan[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useOrg();
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const sub = b.subscription;
  const liveSub = !!sub && ["active", "authenticated", "pending"].includes(sub.status);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["org-billing", orgId] }), qc.invalidateQueries({ queryKey: ["dashboard"] })]);

  /** Access is granted by the server only after Razorpay's signed webhook; poll until it lands. */
  async function waitForTier(code: string) {
    for (let i = 0; i < 20; i++) {
      const d = await api<OrgBilling>(`/organizations/${orgId}/billing`);
      if (d.planCode === code) { qc.setQueryData(["org-billing", orgId], d); return true; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    await refresh();
    return false;
  }

  async function subscribe(p: Plan) {
    setBusy(p.code);
    try {
      const co = await api<{ keyId: string; subscriptionId: string; planName: string }>(`/organizations/${orgId}/billing/checkout`, { method: "POST", body: { planCode: p.code } });
      const r = await openRazorpayCheckout({ keyId: co.keyId, subscriptionId: co.subscriptionId, name: "QRious", description: `${co.planName} plan — monthly`, prefill: { name: me.user?.displayName, email: me.user?.email } });
      if (!r) { await refresh(); return; }
      toast("success", "Payment received — activating your plan…");
      const ok = await waitForTier(p.code);
      toast(ok ? "success" : "error", ok ? `${p.name} is active` : "Payment received. Your plan will activate as soon as Razorpay confirms it.");
    } catch (err) {
      toast("error", err instanceof ApiError || err instanceof Error ? err.message : "Couldn't start checkout.");
      await refresh();
    } finally { setBusy(null); }
  }

  async function buyEvent() {
    setBusy("event");
    try {
      const o = await api<{ keyId: string; orderId: string; amountMinor: number; currency: string; planName: string }>(`/organizations/${orgId}/billing/event-credits/order`, { method: "POST" });
      const r = await openRazorpayCheckout({ keyId: o.keyId, orderId: o.orderId, amountMinor: o.amountMinor, currency: o.currency, name: "QRious", description: "Single Event — one additional event",
        prefill: { name: me.user?.displayName, email: me.user?.email } });
      if (!r) { await refresh(); return; }
      await api(`/organizations/${orgId}/billing/event-credits/verify`, { method: "POST", body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } });
      toast("success", "Event credit added — you can create one more event");
    } catch (err) {
      toast("error", err instanceof ApiError || err instanceof Error ? err.message : "Couldn't complete the purchase.");
    } finally { setBusy(null); await refresh(); }
  }

  async function cancel() {
    setBusy("cancel");
    try {
      await api(`/organizations/${orgId}/billing/cancel`, { method: "POST" });
      toast("success", "Cancelled — your plan stays active until the end of the paid period");
      setCancelOpen(false);
    } catch (err) { toast("error", err instanceof ApiError ? err.message : "Couldn't cancel."); }
    finally { setBusy(null); await refresh(); }
  }

  const ctaFor = (p: Plan): React.ReactNode => {
    const current = b.planCode === p.code || (p.isDefault && b.tier === "starter");
    if (current) return <span className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-primary/50 text-sm font-semibold text-accent-light">Current plan</span>;
    if (p.isDefault) return null;
    if (!b.canManageBilling) return <p className="text-center text-xs text-text-2">Only the organization owner can buy plans.</p>;
    if (!b.paymentsEnabled || !p.purchasable) return <Button variant="secondary" className="w-full" disabled>Not available yet</Button>;
    if (p.code === "org_event_package") return <Button variant="secondary" className="w-full" icon={<Ticket className="size-4" />} loading={busy === "event"} disabled={!!busy} onClick={buyEvent}>Buy one event — {inr(p.priceMinor)}</Button>;
    if (liveSub) return <p className="text-center text-xs text-text-2">Cancel your current subscription to switch plans.</p>;
    return <Button className="w-full" icon={<Sparkles className="size-4" />} loading={busy === p.code} disabled={!!busy} onClick={() => subscribe(p)}>Upgrade to {p.name}</Button>;
  };

  return (
    <div className="space-y-6">
      {b.paymentsMode === "test" && (
        <p className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Test mode — no real money moves. Pay with card <span className="font-mono">4718 6091 0820 4366</span>, any future expiry, any CVV, any OTP.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-text-2 uppercase">Current plan</p>
              <p className="mt-1 flex items-center gap-2 font-display text-2xl font-bold">{b.planName}<PlanBadge tier={b.tier} /></p>
            </div>
            {b.canManageBilling && liveSub && !sub!.cancelAtPeriodEnd && <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>Cancel subscription</Button>}
          </div>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            {sub ? <>
              <Info label="Subscription" value={<span className={STATUS[sub.status]?.tone}>{sub.planName} · {STATUS[sub.status]?.label ?? sub.status}</span>} />
              <Info label={sub.cancelAtPeriodEnd || !liveSub ? "Access until" : "Renews on"} value={day(sub.currentPeriodEnd)} />
              <Info label="Price" value={`${inr(sub.priceMinor)} / month`} />
              <Info label="Started" value={day(sub.currentPeriodStart ?? sub.createdAt)} />
            </> : <Info label="Subscription" value="None — Starter is free" />}
            {b.promotion && <Info label="Promotional access" value={`${b.promotion.planName} until ${day(b.promotion.endsAt)}`} />}
          </dl>
          {sub?.cancelAtPeriodEnd && liveSub && <p className="mt-4 rounded-xl bg-white/5 px-3 py-2 text-sm text-text-2">Cancelled. Paid features stay on until {day(sub.currentPeriodEnd)}; your events and data are always kept.</p>}
          {sub?.status === "pending" && <p className="mt-4 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">A renewal payment failed. Razorpay will retry — check your payment method.</p>}
          {sub?.status === "halted" && <p className="mt-4 rounded-xl bg-error/10 px-3 py-2 text-sm text-error">Payments failed, so paid features are paused. Your events and data are kept.</p>}
        </section>
        <section className="card p-5">
          <AllowanceMeter a={b.allowance} />
          {!b.allowance.canCreateEvent && <p className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-sm">To create more events, upgrade to Pro or Business, or buy a Single Event.</p>}
        </section>
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Plans</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {plans.map((p, i) => {
            const current = b.planCode === p.code || (p.isDefault && b.tier === "starter");
            const featured = p.code === "org_pro_monthly";
            return (
              <motion.div key={p.code} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className={cn("card relative flex flex-col p-5", current && "border-primary/60", featured && !current && "border-accent/40")}>
                {featured && <span className="absolute -top-2.5 right-4 rounded-full bg-grad-primary px-2.5 py-0.5 text-[11px] font-semibold text-white">Most popular</span>}
                <p className="flex items-center gap-2 font-display text-lg font-semibold">{p.code === "org_event_package" ? <Ticket className="size-4 text-accent-light" /> : p.isDefault ? null : <Crown className="size-4 text-accent-light" />}{p.name}</p>
                <p className="mt-1 font-display text-3xl font-bold">{p.priceMinor ? inr(p.priceMinor) : "Free"}
                  <span className="text-sm font-normal text-text-2">{p.billingPeriod === "month" ? " /month" : p.billingPeriod === "one_time" ? " per event" : ""}</span></p>
                <p className="mt-2 text-sm text-text-2">{p.description}</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {(PLAN_FEATURES[p.code] ?? []).map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{f}</li>)}
                </ul>
                <div className="mt-5">{ctaFor(p)}</div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {b.credits.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-display font-semibold"><Ticket className="size-4 text-accent-light" />Single Event credits</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {b.credits.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>{c.source === "promo" ? "Granted by QRious" : "Purchased"} · {day(c.createdAt)}</span>
                <span className={c.consumedAt ? "text-text-2" : c.revokedAt ? "text-error" : "text-success"}>{c.consumedAt ? `Used for ${c.eventName ?? "a deleted event"}` : c.revokedAt ? "Refunded" : "Available"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-0">
        <h2 className="flex items-center gap-2 px-5 pt-5 font-display font-semibold"><Receipt className="size-4 text-accent-light" />Payment history</h2>
        {!b.payments.length ? <p className="px-5 pt-2 pb-5 text-sm text-text-2">No payments yet.</p> : (
          <>
            <ul className="mt-3 divide-y divide-line md:hidden">
              {b.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div><p className="font-medium">{p.description}</p><p className="text-xs text-text-2">{day(p.createdAt)}{p.method ? ` · ${p.method.toUpperCase()}` : ""}</p></div>
                  <div className="text-right"><p className="font-semibold tabular-nums">{inr(p.amountMinor)}</p><p className={cn("text-xs", p.status === "failed" ? "text-error" : "text-text-2")}>{PAY_STATUS[p.status] ?? p.status}</p></div>
                </li>
              ))}
            </ul>
            <table className="mt-3 hidden w-full text-sm md:table">
              <thead className="border-y border-line text-left text-text-2"><tr><th className="px-5 py-2.5 font-medium">Date</th><th className="px-5 py-2.5 font-medium">Description</th><th className="px-5 py-2.5 font-medium">Method</th><th className="px-5 py-2.5 font-medium">Status</th><th className="px-5 py-2.5 text-right font-medium">Amount</th></tr></thead>
              <tbody className="divide-y divide-line">
                {b.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3 text-text-2">{day(p.createdAt)}</td>
                    <td className="px-5 py-3">{p.description}{p.purpose === "event_credit" ? " (one event)" : ""}</td>
                    <td className="px-5 py-3 text-text-2">{p.method ? p.method.toUpperCase() : "—"}</td>
                    <td className={cn("px-5 py-3", p.status === "failed" ? "text-error" : p.status === "captured" ? "text-success" : "text-text-2")}>{PAY_STATUS[p.status] ?? p.status}{p.refundedMinor > 0 && p.status !== "refunded" ? ` (${inr(p.refundedMinor)} refunded)` : ""}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">{inr(p.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      <p className="flex items-center gap-2 text-xs text-text-2"><CreditCard className="size-4" />Payments are processed by Razorpay. Paid access starts only after Razorpay confirms the payment to QRious. <CalendarClock className="ml-1 size-4" />Cancelling or expiry never deletes events or data.</p>

      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel subscription?" confirmLabel="Cancel subscription" danger busy={busy === "cancel"} onConfirm={cancel}
        body={`Paid features stay on until ${day(sub?.currentPeriodEnd)}. After that the organization returns to Starter. Events, participants and reports are kept.`} />
    </div>
  );
}

const Info = ({ label, value }: { label: string; value: React.ReactNode }) => <div><dt className="text-xs tracking-wide text-text-2 uppercase">{label}</dt><dd className="mt-1">{value}</dd></div>;
