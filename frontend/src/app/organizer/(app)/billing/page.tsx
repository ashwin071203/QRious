"use client";

import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { Skeleton } from "@/components/ui/Misc";
import { PageHeader } from "@/components/ui/Overlay";
import { api } from "@/lib/api";
import type { Entitlements, Plan } from "@/lib/types";

const FEATURES: Record<string, string> = {
  "org.pulse.advanced": "Advanced Event Pulse analytics", "org.reports.export": "Exportable participant reports (with consent)", "org.branding": "Event branding & custom banners",
  "org.members": "Multiple organization members", "org.analytics.cross_event": "Cross-event analytics",
};

/** Billing & Plans (PRD §19.3–19.4). Payments activate after gateway approval (D-01). */
export default function OrganizerBillingPage() {
  const { orgId } = useOrg();
  const plans = useQuery({ queryKey: ["plans", "organization"], queryFn: () => api<{ paymentsEnabled: boolean; plans: Plan[] }>("/plans?audience=organization") });
  const ent = useQuery({ queryKey: ["org-ent", orgId], enabled: !!orgId, queryFn: () => api<Entitlements>(`/organizations/${orgId}/billing`) });
  const inr = (m: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(m / 100);
  return (
    <>
      <PageHeader title="Billing & Plans" subtitle={ent.data ? `Current plan: ${ent.data.planName}` : undefined} />
      {!plans.data ? <Skeleton className="h-72" /> : (
        <>
          {!plans.data.paymentsEnabled && <p className="card mb-5 p-4 text-sm text-text-2">Online payments are being activated. Every organizer can use all Starter features for free today; contact QRious to try Pro or Business.</p>}
          <div className="grid gap-4 md:grid-cols-3">
            {plans.data.plans.map((p) => (
              <div key={p.code} className={`card p-5 ${ent.data?.planCode === p.code ? "border-primary/60" : ""}`}>
                <p className="font-display text-lg font-semibold">{p.name}</p>
                <p className="mt-1 font-display text-2xl font-bold">{p.priceMinor ? inr(p.priceMinor) : "Free"}{p.billingPeriod === "month" && <span className="text-sm font-normal text-text-2">/month</span>}</p>
                <p className="mt-2 text-sm text-text-2">{p.description}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  <li className="flex gap-2"><Check className="size-4 text-success" />Events, QR codes, participants, Pulse</li>
                  {p.features.filter((f) => FEATURES[f]).map((f) => <li key={f} className="flex gap-2"><Check className="size-4 text-success" />{FEATURES[f]}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
