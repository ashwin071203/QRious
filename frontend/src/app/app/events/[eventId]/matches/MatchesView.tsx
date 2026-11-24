"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { RefreshCw, Sparkles, Wand2, X } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { AvailabilityPill } from "@/components/People";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/Misc";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { api, ApiError } from "@/lib/api";
import { useRememberEvent } from "@/lib/queries";
import type { MatchItem } from "@/lib/types";

const SIGNAL_LABEL: Record<string, string> = {
  looking_for: "Has what you need", reverse_fit: "Needs what you offer", shared_interests: "Shared interests", intentions: "Same goals",
  profession: "Same profession", availability: "Open to talk", event_relevance: "Event fit",
};

function ScoreRing({ score }: { score: number }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-14 shrink-0 place-items-center" aria-label={`Match score ${score}`}>
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(196,181,253,.15)" strokeWidth="5" />
        <motion.circle cx="28" cy="28" r={r} fill="none" stroke="url(#mg)" strokeWidth="5" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 0.9, ease: "easeOut" }} />
        <defs><linearGradient id="mg"><stop offset="0" stopColor="#8B5CF6" /><stop offset="1" stopColor="#E879F9" /></linearGradient></defs>
      </svg>
      <span className="font-display text-sm font-bold">{score}</span>
    </div>
  );
}

/** Smart Matches (M06): transparent, rule-based recommendations with explanations. */
export function MatchesView({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  useRememberEvent(eventId);
  const q = useQuery({ queryKey: ["matches", eventId], queryFn: () => api<{ detailed: boolean; profileComplete: boolean; items: MatchItem[] }>(`/events/${eventId}/matches`) });
  const err = q.error instanceof ApiError ? q.error : null;

  async function dismiss(profileId: string) {
    await api(`/events/${eventId}/matches/${profileId}/dismiss`, { method: "POST" }).catch(() => {});
    q.refetch();
  }

  return (
    <AttendeePage eventId={eventId} title="Smart Matches">
      <PageHeader title="Smart Matches" subtitle="People who fit what you're into and what you're looking for."
        actions={<Button variant="secondary" icon={<RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />} onClick={() => q.refetch()}>Refresh</Button>} />
      {q.data && !q.data.profileComplete && (
        <Link href={`/app/events/${eventId}/availability`} className="card mb-4 flex items-center gap-3 p-4 text-sm hover:border-accent/40">
          <Sparkles className="size-5 shrink-0 text-pink" />
          <span>Get better matches: add <b>skills you&apos;re looking for</b> to your profile and pick your <b>goals for this event</b>.</span>
        </Link>
      )}
      {err?.code === "networking_closed" || err?.code === "feature_disabled" ? (
        <div className="card"><EmptyState icon={<Wand2 className="size-7" />} title="Smart Matching isn't available">{err.message}</EmptyState></div>
      ) : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
      : q.isLoading ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      : !q.data?.items.length ? (
        <div className="card"><EmptyState icon={<Wand2 className="size-7" />} title="No matches yet" action={<ButtonLink href={`/app/events/${eventId}/discover`} variant="secondary">Browse everyone</ButtonLink>}>
          As more people join, we&apos;ll suggest the ones who fit you best.</EmptyState></div>
      ) : (
        <div className="space-y-3">
          {q.data.items.map((m, i) => (
            <motion.div key={m.profile.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card p-4">
              <div className="flex items-start gap-3">
                <Link href={`/app/events/${eventId}/people/${m.profile.id}`} className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar name={m.profile.displayName} src={m.profile.photo?.thumbnailUrl} size={52} />
                  <div className="min-w-0">
                    <p className="truncate font-display font-semibold">{m.profile.displayName}</p>
                    <p className="truncate text-sm text-text-2">@{m.profile.username}{m.profile.profession ? ` · ${m.profile.profession}` : ""}</p>
                    {m.profile.availability && <AvailabilityPill status={m.profile.availability} className="mt-1.5" />}
                  </div>
                </Link>
                <ScoreRing score={m.score} />
                <button onClick={() => dismiss(m.profile.id)} className="rounded-lg p-1.5 text-text-2 hover:bg-white/5 hover:text-text" aria-label={`Hide ${m.profile.displayName}`}><X className="size-4" /></button>
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {m.reasons.map((r) => <li key={r} className="flex gap-2 text-text-2"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-pink" />{r}</li>)}
              </ul>
              {m.breakdown && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.breakdown.map((b) => <span key={b.signal} className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-accent-light">{SIGNAL_LABEL[b.signal] ?? b.signal} +{b.points}</span>)}
                </div>
              )}
            </motion.div>
          ))}
          {!q.data.detailed && <Link href="/app/premium" className="block text-center text-sm text-accent-light">See detailed compatibility insights with Premium →</Link>}
        </div>
      )}
    </AttendeePage>
  );
}
