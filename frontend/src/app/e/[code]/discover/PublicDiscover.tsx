"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Compass, Search, UserPlus } from "lucide-react";
import { PersonCardView } from "@/components/People";
import { Chip, EmptyState, Logo, Skeleton } from "@/components/ui/Misc";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { useDebounced } from "@/components/ui/Overlay";
import { api, ApiError } from "@/lib/api";
import type { Page, PersonCard, QrResolution, SessionStatus } from "@/lib/types";

export function PublicDiscover({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [q, setQ] = useState("");
  const [interest, setInterest] = useState<string | null>(null);
  const [skill, setSkill] = useState<string | null>(null);
  const dq = useDebounced(q);
  const event = useQuery({ queryKey: ["qr", code], queryFn: () => api<QrResolution>(`/public/qr/${code}`) });
  const session = useQuery({ queryKey: ["session-ev", event.data?.event?.id], enabled: !!event.data?.event, queryFn: () => api<SessionStatus>(`/me/session?eventId=${event.data!.event!.id}`) });
  const facets = useQuery({ queryKey: ["facets", code], queryFn: () => api<{ interests: { id: string; name: string }[]; skills: { id: string; name: string }[] }>(`/public/events/${code}/facets`), retry: false });

  const qs = new URLSearchParams();
  if (dq.trim()) qs.set("q", dq.trim());
  if (interest) qs.set("interests", interest);
  if (skill) qs.set("skills", skill);
  const list = useInfiniteQuery({
    queryKey: ["public-people", code, qs.toString()], initialPageParam: "", retry: false,
    queryFn: ({ pageParam }) => api<Page<PersonCard>>(`/public/events/${code}/people?${qs}${pageParam ? `&cursor=${pageParam}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const err = list.error instanceof ApiError ? list.error : null;
  const ev = event.data?.event;
  const member = session.data?.authenticated && session.data.isParticipant && ev;

  return (
    <main className="ambient min-h-dvh pb-28">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href={`/e/${code}`} className="rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text" aria-label="Back to event"><ArrowLeft className="size-5" /></Link>
          <div className="min-w-0 flex-1"><p className="truncate text-xs text-text-2">{ev?.name ?? "Event"}</p><p className="font-display text-[15px] font-semibold">Discover people</p></div>
          <Logo className="hidden text-base sm:inline-flex" />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 pt-5">
        {member ? (
          <Link href={`/app/events/${ev.id}/discover`} className="card mb-4 flex items-center gap-3 p-4 text-sm hover:border-accent/40">
            <Compass className="size-5 text-accent" /><span className="flex-1">You&apos;ve joined this event — open member Discover to connect and message.</span>
          </Link>
        ) : session.data?.authenticated && ev ? (
          <Link href={`/e/${code}/join`} className="card mb-4 flex items-center gap-3 p-4 text-sm hover:border-accent/40">
            <UserPlus className="size-5 text-accent" /><span className="flex-1">Join this event as <b>{session.data.profile?.displayName}</b> to connect with people here.</span>
          </Link>
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or @username" className="pl-10" aria-label="Search people" />
        </div>
        {(facets.data?.interests.length || facets.data?.skills.length) ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {facets.data!.interests.map((t) => <Chip key={t.id} selected={interest === t.id} onClick={() => setInterest(interest === t.id ? null : t.id)} className="shrink-0">{t.name}</Chip>)}
            {facets.data!.skills.map((t) => <Chip key={t.id} selected={skill === t.id} onClick={() => setSkill(skill === t.id ? null : t.id)} className="shrink-0">{t.name}</Chip>)}
          </div>
        ) : null}

        <div className="mt-5">
          {err ? (
            <div className="card"><EmptyState icon={<Compass className="size-7" />} title={err.code === "networking_closed" ? "Networking hasn't opened yet" : err.code === "anonymous_browsing_disabled" ? "Members only" : "Discover isn't available"}
              action={<ButtonLink href={`/e/${code}/join`} icon={<UserPlus className="size-4" />}>Create My Profile</ButtonLink>}>{err.message}</EmptyState></div>
          ) : list.isLoading ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
          : items.length === 0 ? (
            <div className="card"><EmptyState icon={<Compass className="size-7" />} title={q || interest || skill ? "No one matches" : "No public profiles yet"}
              action={<ButtonLink href={`/e/${code}/join`} icon={<UserPlus className="size-4" />}>Be the first — create your profile</ButtonLink>}>
              {q || interest || skill ? "Try a different search." : "People who choose to be visible will appear here."}</EmptyState></div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((p, i) => <PersonCardView key={p.id} person={p} index={i} href={`/e/${code}/discover/${p.id}`} />)}
              </div>
              {list.hasNextPage && <div className="mt-6 text-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Show more</Button></div>}
            </>
          )}
        </div>
      </div>

      {!member && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-x-0 border-b-0 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-text-2">Want to connect? It takes under a minute.</p>
            <ButtonLink href={`/e/${code}/join`} icon={<UserPlus className="size-4" />}>Create profile</ButtonLink>
          </div>
        </div>
      )}
    </main>
  );
}
