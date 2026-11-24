"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Crown, Infinity as InfinityIcon, Lock, Ticket } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { useOrgBilling } from "@/lib/queries";
import { cn } from "@/lib/format";
import type { OrgAllowance, OrgTier } from "@/lib/types";

export const TIER_LABEL: Record<OrgTier, string> = { starter: "Starter", pro: "Pro", business: "Business" };

/** The UI only mirrors entitlements; every premium API enforces them on the server. */
export function useOrgFeature(feature: string) {
  const { orgId } = useOrg();
  const q = useOrgBilling(orgId);
  return { has: q.data ? q.data.features.includes(feature) : undefined, billing: q.data };
}

/** True at tablet width and up (≥ 768px). Phone layouts are untouched below this breakpoint. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");

export function PlanBadge({ tier, className }: { tier: OrgTier; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
      tier === "starter" ? "border-line-strong text-text-2" : "border-primary/50 bg-primary/15 text-accent-light", className)}>
      {tier !== "starter" && <Crown className="size-3" />}{TIER_LABEL[tier]}
    </span>
  );
}

export function UpgradeHint({ plan = "Pro", title, children, className }: { plan?: "Pro" | "Business"; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/[0.08] p-4", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/20 text-accent-light"><Lock className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title} <span className="ml-1 rounded-full bg-primary/25 px-2 py-0.5 text-[11px] font-semibold text-accent-light">{plan}</span></p>
        {children && <p className="mt-0.5 text-sm text-text-2">{children}</p>}
      </div>
      <Link href="/organizer/billing" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-light hover:underline">See plans<ArrowRight className="size-4" /></Link>
    </div>
  );
}

/** "2 of 3 free events used" with remaining Single Event credits and the plan's unlimited allowance. */
export function AllowanceMeter({ a, className }: { a: OrgAllowance; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Free events</p>
        <p className="text-sm tabular-nums text-text-2"><span className="font-semibold text-text">{a.freeUsed}</span> of {a.freeLimit} used</p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden>
        {Array.from({ length: a.freeLimit }, (_, i) => (
          <span key={i} className={cn("h-2 rounded-full", i < a.freeUsed ? "bg-grad-primary" : "bg-white/10")} />
        ))}
      </div>
      <ul className="mt-3 space-y-1 text-sm text-text-2">
        <li>{a.freeRemaining > 0 ? `${a.freeRemaining} free event${a.freeRemaining === 1 ? "" : "s"} left (lifetime, shared by your whole organization)` : "All free events used"}</li>
        {a.unlimited && <li className="flex items-center gap-1.5 text-success"><InfinityIcon className="size-4" />Unlimited events with your plan</li>}
        {a.credits > 0 && <li className="flex items-center gap-1.5 text-accent-light"><Ticket className="size-4" />{a.credits} Single Event credit{a.credits === 1 ? "" : "s"} available</li>}
      </ul>
    </div>
  );
}
