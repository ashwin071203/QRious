"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { Activity, Handshake, MessageCircle, Sparkles, UserPlus, Users } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { api, ApiError } from "@/lib/api";
import { availabilityLabel } from "@/lib/format";
import { useRememberEvent } from "@/lib/queries";
import type { Pulse } from "@/lib/types";

function Counter({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString("en-IN"));
  useEffect(() => { const c = animate(mv, value, { duration: 0.9, ease: "easeOut" }); return c.stop; }, [mv, value]);
  return <motion.span>{rounded}</motion.span>;
}

function Stat({ icon, label, value, threshold }: { icon: React.ReactNode; label: string; value: number | null; threshold: number }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-sm text-text-2">{icon}{label}</div>
      <p className="mt-2 font-display text-3xl font-bold">{value === null ? <span className="text-lg text-text-2">Fewer than {threshold}</span> : <Counter value={value} />}</p>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="card p-5">
      <h2 className="font-display font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="mt-3 text-sm text-text-2">Not enough people yet to show this safely.</p> : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex justify-between text-sm"><span>{r.label}</span><span className="text-text-2 tabular-nums">{r.count}</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-2">
                <motion.div className="h-full rounded-full bg-grad-primary" initial={{ width: 0 }} animate={{ width: `${(r.count / max) * 100}%` }} transition={{ duration: 0.8 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Event Pulse (M07): live, aggregate-only activity with small-group suppression. */
export function PulseView({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  useRememberEvent(eventId);
  const q = useQuery({ queryKey: ["pulse", eventId], queryFn: () => api<Pulse>(`/events/${eventId}/pulse`), refetchInterval: 10_000, refetchIntervalInBackground: false });
  const err = q.error instanceof ApiError ? q.error : null;
  const p = q.data;

  return (
    <AttendeePage eventId={eventId} title="Event Pulse">
      <PageHeader title={<span className="inline-flex items-center gap-2">Event Pulse <span className="relative inline-flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" /><span className="relative size-2.5 rounded-full bg-success" /></span></span>}
        subtitle="Live networking activity at this event — totals only, never individuals." />
      {err?.code === "networking_closed" || err?.code === "feature_disabled" ? (
        <div className="card"><EmptyState icon={<Activity className="size-7" />} title="Pulse isn't available">{err.message}</EmptyState></div>
      ) : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
      : !p ? <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={<Users className="size-4" />} label="Participating" value={p.totals.participants} threshold={p.threshold} />
            <Stat icon={<Sparkles className="size-4" />} label="Discoverable" value={p.totals.discoverable} threshold={p.threshold} />
            <Stat icon={<MessageCircle className="size-4" />} label="Open to talk" value={p.totals.openToTalk} threshold={p.threshold} />
            <Stat icon={<Handshake className="size-4" />} label="Want collaborators" value={p.totals.lookingForCollaborators} threshold={p.threshold} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Bars title="What people are here for" rows={p.byIntention.map((i) => ({ label: i.label, count: i.count }))} />
            <Bars title="Right now" rows={p.byStatus.map((s) => ({ label: availabilityLabel[s.status] ?? s.status, count: s.count }))} />
            <Bars title="Popular interests" rows={p.topInterests.map((i) => ({ label: i.name, count: i.count }))} />
            <Bars title="Popular skills" rows={p.topSkills.map((i) => ({ label: i.name, count: i.count }))} />
          </div>
          <section className="card flex flex-wrap gap-6 p-5 text-sm">
            <span className="flex items-center gap-2"><UserPlus className="size-4 text-accent" />Joined in the last hour: <b>{p.activityLastHour.join ?? `<${p.threshold}`}</b></span>
            <span className="flex items-center gap-2"><Handshake className="size-4 text-accent" />New connections: <b>{p.activityLastHour.connection_accepted ?? `<${p.threshold}`}</b></span>
            <span className="flex items-center gap-2"><MessageCircle className="size-4 text-accent" />Messages: <b>{p.activityLastHour.message_sent ?? `<${p.threshold}`}</b></span>
          </section>
          <p className="text-center text-xs text-text-2">Groups smaller than {p.threshold} are hidden to protect privacy. Updates every few seconds.</p>
        </div>
      )}
    </AttendeePage>
  );
}
