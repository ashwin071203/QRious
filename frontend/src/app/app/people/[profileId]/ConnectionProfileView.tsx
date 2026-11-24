"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, UserX } from "lucide-react";
import { AttendeePage, useEventContext } from "@/components/AppShell";
import { PersonActions, ProfileDetail } from "@/components/People";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";
import type { PersonCard } from "@/lib/types";

/** A connection's profile outside any event (e.g. from Messages). */
export function ConnectionProfileView({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = use(params);
  const router = useRouter();
  const ev = useEventContext();
  const q = useQuery({ queryKey: ["connection-profile", profileId], queryFn: () => api<PersonCard>(`/people/${profileId}`) });
  return (
    <AttendeePage title={q.data?.displayName} className="max-w-3xl">
      <button onClick={() => router.back()} className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ArrowLeft className="size-4" />Back</button>
      {q.isLoading ? <Skeleton className="h-80" /> : q.error ? (
        <div className="card"><EmptyState icon={<UserX className="size-7" />} title="Profile unavailable">{q.error instanceof ApiError ? q.error.message : "Something went wrong."}</EmptyState></div>
      ) : q.data && <ProfileDetail person={q.data} actions={<PersonActions person={q.data} eventId={ev ?? ""} canConnect={false} canMessage onChanged={() => q.refetch()} />} />}
    </AttendeePage>
  );
}
