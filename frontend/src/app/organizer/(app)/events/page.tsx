"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, QrCode } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { EVENT_STATUS } from "@/components/EventStatus";
import { CreateOrganization } from "@/components/CreateOrganization";
import { api } from "@/lib/api";
import { formatEventDate } from "@/lib/format";
import type { OrgEventRow } from "@/lib/types";

function EventsList() {
  const { orgId, me } = useOrg();
  const q = useQuery({ queryKey: ["org-events", orgId], enabled: !!orgId, queryFn: () => api<OrgEventRow[]>(`/organizations/${orgId}/events`) });
  if (!me.organizations?.length) return <CreateOrganization />;
  return (
    <>
      <PageHeader title="Events" subtitle="Create, publish and manage your events." actions={<ButtonLink href="/organizer/events/new" icon={<CalendarPlus className="size-4" />}>New event</ButtonLink>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-48" /> : !q.data?.length ? (
        <div className="card"><EmptyState icon={<QrCode className="size-7" />} title="No events yet" action={<ButtonLink href="/organizer/events/new">Create an event</ButtonLink>}>Create an event to get its QR code.</EmptyState></div>
      ) : (
        <>
        <ul className="space-y-3 md:hidden">
          {q.data.map((e) => (
            <li key={e.id}>
              <Link href={`/organizer/events/${e.id}`} className="card block p-4 transition-colors active:bg-white/[0.03]">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{e.name}</p>
                  <span className={`shrink-0 text-xs ${EVENT_STATUS[e.status]?.className ?? ""}`}>{EVENT_STATUS[e.status]?.label}</span>
                </div>
                <p className="mt-1 text-xs text-text-2">{formatEventDate(e.startsAt, e.endsAt, e.timeZone)}</p>
                <p className="mt-0.5 text-xs text-text-2">{e.venueName}{e.city ? `, ${e.city}` : ""} · {e.participantCount} joined{e.moderationStatus === "suspended" ? " · Suspended" : ""}</p>
              </Link>
            </li>
          ))}
        </ul>
        <div className="card hidden overflow-x-auto p-0 md:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-text-2"><tr><th className="px-4 py-3 font-medium">Event</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Participants</th></tr></thead>
            <tbody className="divide-y divide-line">
              {q.data.map((e) => (
                <tr key={e.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3"><Link href={`/organizer/events/${e.id}`} className="font-medium hover:text-accent-light">{e.name}</Link><p className="text-xs text-text-2">{e.categoryName} · {e.venueName}{e.city ? `, ${e.city}` : ""}</p></td>
                  <td className="px-4 py-3 text-text-2">{formatEventDate(e.startsAt, e.endsAt, e.timeZone)}</td>
                  <td className="px-4 py-3"><span className={EVENT_STATUS[e.status]?.className}>{EVENT_STATUS[e.status]?.label}</span>{e.moderationStatus === "suspended" && <span className="ml-2 text-xs text-error">Suspended</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{e.participantCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}

export default function EventsPage() {
  return <Suspense><EventsList /></Suspense>;
}
