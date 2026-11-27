"use client";

import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { AttendeePage, useEventContext } from "@/components/AppShell";
import { PersonCardView } from "@/components/People";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { api } from "@/lib/api";
import type { PersonCard } from "@/lib/types";

export default function SavedPage() {
  const ev = useEventContext();
  const q = useQuery({ queryKey: ["saved"], queryFn: () => api<PersonCard[]>("/me/saved-profiles") });
  return (
    <AttendeePage title="Saved">
      <PageHeader title="Saved profiles" subtitle="People you bookmarked across events." />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? (
        <div className="card"><EmptyState icon={<Bookmark className="size-7" />} title="Nothing saved yet">Tap Save on someone&apos;s profile to keep them here.</EmptyState></div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((p, i) => {
            const eventId = p.eventId ?? ev;
            const href = p.connectionState === "connected" || p.audience === "connection" || !eventId ? `/app/people/${p.id}` : `/app/events/${eventId}/people/${p.id}`;
            return <PersonCardView key={p.id} person={{ ...p, saved: true }} index={i} href={href} />;
          })}
        </div>
      )}
    </AttendeePage>
  );
}
