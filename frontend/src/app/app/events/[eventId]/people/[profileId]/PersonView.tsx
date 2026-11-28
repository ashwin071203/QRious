"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { PersonActions, ProfileDetail } from "@/components/People";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";
import { useEvent } from "@/lib/queries";
import type { PersonCard } from "@/lib/types";

export function PersonView({ params }: { params: Promise<{ eventId: string; profileId: string }> }) {
  const { eventId, profileId } = use(params);
  const router = useRouter();
  const { data: me } = useEvent(eventId);
  const q = useQuery({ queryKey: ["person", eventId, profileId], queryFn: () => api<PersonCard>(`/events/${eventId}/people/${profileId}`) });
  const open = me?.event.networkingStatus === "open";

  return (
    <AttendeePage eventId={eventId} title={q.data?.displayName} className="max-w-5xl">
      <button onClick={() => router.back()} className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ArrowLeft className="size-4" />Back</button>
      {q.isLoading ? <Skeleton className="h-80" />
        : q.error ? <div className="card"><EmptyState icon={<ArrowLeft className="size-7" />} title="Profile unavailable">{q.error instanceof ApiError ? q.error.message : "Something went wrong."}</EmptyState></div>
        : q.data && <ProfileDetail person={q.data} actions={<PersonActions person={q.data} eventId={eventId} canConnect={!!open && !!me?.event.features.connections} canMessage onChanged={() => q.refetch()} />} />}
    </AttendeePage>
  );
}
