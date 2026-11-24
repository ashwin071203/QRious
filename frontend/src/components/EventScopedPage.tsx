"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, CalendarPlus, ChevronRight, MapPin, QrCode, Search, Users } from "lucide-react";
import { useIsDesktop } from "@/components/OrgPlan";
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
export function EventScopedPage({ title, subtitle, icon, filter, emptyHint, children, desktop }: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  /** Events eligible for this page (others are listed but explained). */
  filter?: (e: OrgEventRow) => boolean;
  emptyHint?: string;
  /** Phone layout (unchanged). */
  children: (e: OrgEventDetail, onChange: (d: OrgEventDetail) => void) => ReactNode;
  /** Tablet & desktop layout (≥ 768px). */
  desktop?: (e: OrgEventDetail, onChange: (d: OrgEventDetail) => void) => ReactNode;
}) {
  const isDesktop = useIsDesktop();
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

  if (isDesktop && desktop) {
    return (
      <DesktopLayout title={title} subtitle={subtitle} icon={icon} emptyHint={emptyHint} events={events} sorted={sorted} eligible={eligible} selectedId={selectedId} select={select}
        detail={detail.data && detail.data.id === selectedId ? detail.data : null} detailError={detail.isError ? detail.error : null} retryDetail={() => detail.refetch()}>
        {detail.data && detail.data.id === selectedId ? desktop(detail.data, onChange) : null}
      </DesktopLayout>
    );
  }

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

// ---------------------------------------------------------------- Tablet & desktop (≥ 768px)
const GROUP_OF: Record<string, string> = { active: "Live now", networking_paused: "Live now", published: "Upcoming", draft: "Drafts", ended: "Past", archived: "Past" };
const GROUP_ORDER = ["Live now", "Upcoming", "Drafts", "Past"];
const DOT: Record<string, string> = { active: "bg-success", networking_paused: "bg-warning", published: "bg-warning", draft: "bg-text-2/50", ended: "bg-text-2/40", archived: "bg-text-2/30" };

function DesktopLayout({ title, subtitle, icon, emptyHint, events, sorted, eligible, selectedId, select, detail, detailError, retryDetail, children }: {
  title: string; subtitle: string; icon: ReactNode; emptyHint?: string;
  events: UseQueryResult<OrgEventRow[]>; sorted: OrgEventRow[]; eligible: OrgEventRow[]; selectedId: string | null; select: (id: string) => void;
  detail: OrgEventDetail | null; detailError: unknown; retryDetail: () => void; children: ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const shown = filter.trim() ? eligible.filter((e) => e.name.toLowerCase().includes(filter.trim().toLowerCase())) : eligible;
  const groups = GROUP_ORDER.map((g) => ({ g, items: shown.filter((e) => GROUP_OF[e.status] === g) })).filter((x) => x.items.length);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/15 text-accent-light ring-1 ring-primary/30">{icon}</span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">{title}</h1>
            <p className="mt-0.5 text-sm text-text-2">{subtitle}</p>
          </div>
        </div>
        <ButtonLink href="/organizer/events/new" variant="secondary" size="sm" icon={<CalendarPlus className="size-4" />}>New event</ButtonLink>
      </header>

      {events.isError ? <ErrorState error={events.error} onRetry={() => events.refetch()} />
        : events.isLoading || !events.data ? <div className="grid gap-6 lg:grid-cols-[288px_minmax(0,1fr)]"><Skeleton className="h-72" /><Skeleton className="h-96" /></div>
        : !eligible.length ? (
          <div className="card">
            <EmptyState icon={<QrCode className="size-7" />} title={sorted.length ? "No events to manage here yet" : "No events yet"}
              action={<ButtonLink href="/organizer/events/new" icon={<CalendarPlus className="size-4" />}>Create an event</ButtonLink>}>
              {sorted.length ? emptyHint : "Create an event to get started."}
            </EmptyState>
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[288px_minmax(0,1fr)]">
            {/* Event rail: horizontal strip on tablets, sticky grouped list on desktop */}
            <nav aria-label="Choose event" className="min-w-0 lg:sticky lg:top-6">
              <div className="rounded-[1.25rem] border border-line bg-card lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <p className="text-sm font-semibold">Events <span className="font-normal text-text-2">{eligible.length}</span></p>
                </div>
                {eligible.length > 5 && (
                  <div className="relative border-b border-line p-3">
                    <Search className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2 text-text-2" />
                    <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter events" aria-label="Filter events"
                      className="h-9 w-full rounded-xl border border-line bg-bg-2 pr-3 pl-9 text-sm outline-none focus:border-accent/60" />
                  </div>
                )}
                <div className="flex gap-2 overflow-x-auto p-3 lg:block lg:max-h-[calc(100dvh-12rem)] lg:space-y-4 lg:overflow-y-auto">
                  {groups.map(({ g, items }) => (
                    <div key={g} className="flex shrink-0 gap-2 lg:block lg:space-y-1">
                      <p className="hidden px-2 pb-1 text-[11px] font-semibold tracking-wide text-text-2 uppercase lg:block">{g}</p>
                      {items.map((e) => {
                        const on = e.id === selectedId;
                        return (
                          <button key={e.id} type="button" onClick={() => select(e.id)} aria-current={on ? "true" : undefined}
                            className={cn("relative flex w-60 shrink-0 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors lg:w-full",
                              on ? "border-primary/50 bg-primary/15" : "border-transparent bg-bg-2/60 hover:bg-white/[0.04] lg:bg-transparent")}>
                            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[e.status])} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{e.name}</span>
                              <span className="mt-0.5 block truncate text-xs text-text-2">{formatEventDate(e.startsAt, e.endsAt, e.timeZone)} · {e.participantCount} joined</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {!groups.length && <p className="px-2 py-4 text-sm text-text-2">No events match “{filter}”.</p>}
                </div>
              </div>
            </nav>

            <div className="min-w-0">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={selectedId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="space-y-5">
                  {detailError ? <ErrorState error={detailError} onRetry={retryDetail} />
                    : !detail ? <><Skeleton className="h-28" /><Skeleton className="h-80" /></>
                    : (
                      <>
                        <section className="flex items-center gap-4 overflow-hidden rounded-[1.25rem] border border-line bg-card p-3 pr-5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={detail.bannerUrl ?? `/images/categories/${detail.categorySlug}.webp`} alt="" className="hidden h-20 w-32 shrink-0 rounded-xl object-cover sm:block" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="truncate font-display text-lg font-semibold">{detail.name}</h2>
                              <span className={cn("text-xs", EVENT_STATUS[detail.status]?.className)}>{EVENT_STATUS[detail.status]?.label}</span>
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-2">
                              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" />{formatEventDate(detail.startsAt, detail.endsAt, detail.timeZone)}</span>
                              <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{[detail.venueName, detail.city].filter(Boolean).join(", ")}</span>
                              <span className="inline-flex items-center gap-1.5"><Users className="size-4" />{detail.participantCount}{detail.maxParticipants ? ` / ${detail.maxParticipants}` : ""} joined</span>
                            </p>
                          </div>
                          <ButtonLink href={`/organizer/events/${detail.id}`} variant="secondary" size="sm" className="shrink-0">Open event<ChevronRight className="size-4" /></ButtonLink>
                        </section>
                        {children}
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
