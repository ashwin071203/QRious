"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Download, Repeat, Users } from "lucide-react";
import { AllowanceMeter, PlanBadge, UpgradeHint } from "@/components/OrgPlan";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Misc";
import { useToast } from "@/components/Providers";
import { api } from "@/lib/api";
import { useOrgBilling } from "@/lib/queries";

type Analytics = { totals: { events: number; joined: number; connections: number; conversations: number; uniquePeople: number; returningPeople: number };
  events: { id: string; name: string; status: string; startsAt: string; joined: number; activeParticipants: number; connections: number; conversations: number }[] };

/** Dashboard plan card + Business cross-event analytics (server-gated: the API returns 403 below Business). */
export function OrgInsights({ orgId }: { orgId: string }) {
  const b = useOrgBilling(orgId);
  const crossEvent = b.data?.features.includes("org.analytics.cross_event");
  const a = useQuery({ queryKey: ["org-analytics", orgId], enabled: !!crossEvent, queryFn: () => api<Analytics>(`/organizations/${orgId}/analytics`) });
  const toast = useToast();
  if (!b.data) return <Skeleton className="mt-5 h-40" />;

  async function download() {
    const res = await fetch(`/api/v1/organizations/${orgId}/analytics?format=csv`, { headers: { "X-QRious-Client": "web" } });
    if (!res.ok) return toast("error", "Report unavailable.");
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: "organization-report.csv" }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <section className="card p-5">
        <div className="flex items-center justify-between gap-2"><h2 className="font-display font-semibold">Your plan</h2><PlanBadge tier={b.data.tier} /></div>
        <AllowanceMeter a={b.data.allowance} className="mt-4" />
        <Link href="/organizer/billing" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent-light hover:underline">{b.data.tier === "starter" ? "Upgrade" : "Billing & Plans"}<ArrowRight className="size-4" /></Link>
      </section>
      {!crossEvent ? (
        <section className="card flex flex-col justify-center p-5">
          <h2 className="flex items-center gap-2 font-display font-semibold"><BarChart3 className="size-4 text-accent-light" />Cross-event analytics</h2>
          <UpgradeHint plan="Business" title="Compare all your events" className="mt-3">Unique and returning attendees, connections per event, and a downloadable organization report.</UpgradeHint>
        </section>
      ) : !a.data ? <Skeleton className="h-40" /> : (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-semibold"><BarChart3 className="size-4 text-accent-light" />Cross-event analytics</h2>
            <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={download}>Organization report</Button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Unique attendees", a.data.totals.uniquePeople, <Users key="u" className="size-4" />], ["Returning attendees", a.data.totals.returningPeople, <Repeat key="r" className="size-4" />],
              ["Connections", a.data.totals.connections, null], ["Conversations", a.data.totals.conversations, null]].map(([l, v, icon]) => (
              <div key={l as string} className="rounded-2xl bg-bg-2 p-3"><p className="flex items-center gap-1.5 text-xs text-text-2">{icon}{l}</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{v as number}</p></div>
            ))}
          </div>
          {a.data.events.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs text-text-2"><tr><th className="py-2 font-medium">Event</th><th className="py-2 text-right font-medium">Joined</th><th className="py-2 text-right font-medium">Connections</th><th className="py-2 text-right font-medium">Conversations</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {a.data.events.slice(0, 8).map((e) => (
                    <tr key={e.id}><td className="py-2"><Link href={`/organizer/events/${e.id}`} className="hover:text-accent-light">{e.name}</Link></td>
                      <td className="py-2 text-right tabular-nums">{e.joined}</td><td className="py-2 text-right tabular-nums">{e.connections}</td><td className="py-2 text-right tabular-nums">{e.conversations}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
