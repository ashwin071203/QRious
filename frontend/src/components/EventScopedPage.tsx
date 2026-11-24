"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, ChevronRight, QrCode } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { CreateOrganization } from "@/components/CreateOrganization";
import { EVENT_STATUS } from "@/components/EventStatus";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { api } from "@/lib/api";
import { cn, formatEventDate } from "@/lib/format";
import type { OrgEventDetail, OrgEventRow } from "@/lib/types";

/** Live first, then upcoming (soonest), then paused, drafts, and finally past events (most recent first). */
const RANK: Record<string, number> = { active: 0, published: 1, networking_paused: 2, draft: 3, ended: 4, archived: 5 };
export function sortEventsForManagement(rows: OrgEventRow[]) {
  return [...rows].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9)
    || ((RANK[a.status] ?? 9) >= 4 ? +new Date(b.startsAt) - +new Date(a.startsAt) : +new Date(a.startsAt) - +new Date(b.startsAt)));
}

/**
 * Organizer pages that manage one aspect (QR, participants, networking) across ALL the organization's events:
 * pick an event, work on it in place. The chosen event lives in the URL (?event=…) so it survives reloads and sharing.
 */
export function EventScopedPage({ title, subtitle, icon, filter, emptyHint, children }: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  /** Events eligible for this page (others are listed but explained). */
  filter?: (e: OrgEventRow) => boolean;
  emptyHint?: string;
  children: (e: OrgEventDetail, onChange: (d: OrgEventDetail) => void) => ReactNode;
}) {
  const { orgId, me } = useOrg();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ["org-events", orgId], enabled: !!orgId, queryFn: () => api<OrgEventRow[]>(`/organizations/${orgId}/events`) });
  const sorted = useMemo(() => sortEventsForManagement(events.data ?? []), [events.data]);
  const eligible = filter ? sorted.filter(filter) : sorted;
  const requested = search.get("event");
  const selectedId = (eligible.find((e) => e.id === requested) ?? eligible[0])?.id ?? null;

  // Keep the URL in sync with the effective selection (e.g. after switching organization).
  useEffect(() => {
    if (selectedId && selectedId !== requested) router.replace(`${pathname}?event=${selectedId}`, { scroll: false });
  }, [selectedId, requested, pathname, router]);

  const detail = useQuery({ queryKey: ["org-event", selectedId], enabled: !!selectedId, queryFn: () => api<OrgEventDetail>(`/organizer/events/${selectedId}`) });
  const onChange = (d: OrgEventDetail) => {
    qc.setQueryData(["org-event", d.id], d);
    qc.invalidateQueries({ queryKey: ["org-events"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const select = (id: string) => router.replace(`${pathname}?event=${id}`, { scroll: false });

  if (!me.organizations?.length) return <CreateOrganization />;

  return (
    <>
      <PageHeader title={<span className="inline-flex items-center gap-2"><span className="text-accent-light">{icon}</span>{title}</span>} subtitle={subtitle} />
      {events.isError ? <ErrorState error={events.error} onRetry={() => events.refetch()} />
        : events.isLoading || !orgId ? <Skeleton className="h-48" />
        : !eligible.length ? (
          <div className="card">
            <EmptyState icon={<QrCode className="size-7" />} title={sorted.length ? "No events to manage here yet" : "No events yet"}
              action={<ButtonLink href="/organizer/events/new" icon={<CalendarPlus className="size-4" />}>Create an event</ButtonLink>}>
              {sorted.length ? emptyHint : "Create an event to get started."}
            </EmptyState>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
            {/* Event picker: horizontal chips on phones, a list on desktop */}
            <nav aria-label="Choose event" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
              <ul className="flex gap-2 lg:flex-col">
                {eligible.map((e) => {
                  const on = e.id === selectedId;
                  return (
                    <li key={e.id} className="shrink-0 lg:shrink">
                      <button type="button" onClick={() => select(e.id)} aria-current={on ? "true" : undefined}
                        className={cn("relative w-56 rounded-2xl border px-3.5 py-2.5 text-left transition-colors lg:w-full",
                          on ? "border-primary/60 bg-primary/15" : "border-line bg-card hover:border-line-strong")}>
                        <p className="truncate text-sm font-medium">{e.name}</p>
                        <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-text-2">
                          <span className={EVENT_STATUS[e.status]?.className}>{EVENT_STATUS[e.status]?.label}</span>
                          <span className="truncate">{e.participantCount} joined</span>
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="min-w-0">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={selectedId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  {detail.isError ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
                    : !detail.data || detail.data.id !== selectedId ? <Skeleton className="h-80" />
                    : (
                      <>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <h2 className="truncate font-display text-lg font-semibold">{detail.data.name}</h2>
                            <p className="text-sm text-text-2">{formatEventDate(detail.data.startsAt, detail.data.endsAt, detail.data.timeZone)} · {detail.data.venueName}</p>
                          </div>
                          <Link href={`/organizer/events/${detail.data.id}`} className="inline-flex items-center gap-1 text-sm text-accent-light hover:underline">Open event<ChevronRight className="size-4" /></Link>
                        </div>
                        {children(detail.data, onChange)}
                      </>
                    )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
    </>
  );
}
