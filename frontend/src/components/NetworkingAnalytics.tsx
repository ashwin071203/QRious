"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Bookmark, CalendarDays, Handshake, MessageCircle, Send, UserCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/Misc";
import { ErrorState } from "@/components/ui/Overlay";
import { api } from "@/lib/api";
import type { NetworkingAnalytics } from "@/lib/types";

/** Premium "Enhanced networking analytics" (PRD §19.2) — your own activity only; never anyone else's data. */
export function NetworkingAnalyticsCard() {
  const q = useQuery({ queryKey: ["my-analytics"], queryFn: () => api<NetworkingAnalytics>("/me/analytics") });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-56" />;
  const a = q.data;
  const max = Math.max(1, ...a.connectionsByEvent.map((e) => e.connections));
  const stats: [string, string | number, React.ReactNode][] = [
    ["Connections", a.connections, <Handshake key="c" className="size-4" />],
    ["New in last 30 days", a.connectionsLast30Days, <UserCheck key="n" className="size-4" />],
    ["Events joined", a.eventsJoined, <CalendarDays key="e" className="size-4" />],
    ["Requests accepted", a.requestAcceptanceRate === null ? "—" : `${a.requestAcceptanceRate}%`, <Send key="r" className="size-4" />],
    ["Conversations", a.conversations, <MessageCircle key="v" className="size-4" />],
    ["Saved your profile", a.savedBy, <Bookmark key="s" className="size-4" />],
  ];
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-display font-semibold"><BarChart3 className="size-5 text-pink" />Your networking analytics</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map(([label, value, icon]) => (
          <div key={label} className="rounded-2xl bg-bg-2 p-3">
            <p className="flex items-center gap-1.5 text-xs text-text-2"><span className="text-accent-light">{icon}</span>{label}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-text-2">{a.requestsSent} requests sent · {a.requestsReceived} received · {a.messagesSent} messages sent</p>
      {a.connectionsByEvent.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">Where you made connections</p>
          <ul className="space-y-2">
            {a.connectionsByEvent.map((e) => (
              <li key={e.eventId} className="text-sm">
                <div className="flex justify-between gap-2"><span className="truncate">{e.name}</span><span className="tabular-nums text-text-2">{e.connections}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-grad-primary" style={{ width: `${(e.connections / max) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
