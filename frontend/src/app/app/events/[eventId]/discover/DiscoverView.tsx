"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Compass, Filter, Lock, Search, Wand2, X } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { PersonCardView, AVAILABILITY_OPTIONS } from "@/components/People";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Form";
import { ErrorState, PageHeader, useDebounced } from "@/components/ui/Overlay";
import { TagPicker, type PickedTag } from "@/components/TagPicker";
import { api, ApiError } from "@/lib/api";
import { useEvent, useRememberEvent } from "@/lib/queries";
import type { Page, PersonCard } from "@/lib/types";

/** Identified discovery (M05): search, filters, highlights; excludes blocked and paused people. */
export function DiscoverView({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  useRememberEvent(eventId);
  const { data: me } = useEvent(eventId);
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [interests, setInterests] = useState<PickedTag[]>([]);
  const [skills, setSkills] = useState<PickedTag[]>([]);
  const [profession, setProfession] = useState("");
  const [intention, setIntention] = useState("");
  const [availability, setAvailability] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const dq = useDebounced(q), dp = useDebounced(profession), dc = useDebounced(company), dl = useDebounced(location);

  const qs = new URLSearchParams();
  if (dq.trim()) qs.set("q", dq.trim());
  interests.filter((t) => t.id).forEach((t) => qs.append("interests", t.id!));
  skills.filter((t) => t.id).forEach((t) => qs.append("skills", t.id!));
  if (dp.trim()) qs.set("profession", dp.trim());
  if (intention) qs.set("intentions", intention);
  if (availability) qs.set("availability", availability);
  if (dc.trim()) qs.set("company", dc.trim());
  if (dl.trim()) qs.set("location", dl.trim());
  const filterCount = [interests.length, skills.length, dp, intention, availability, dc, dl].filter(Boolean).length;

  const list = useInfiniteQuery({
    queryKey: ["people", eventId, qs.toString()],
    queryFn: ({ pageParam }) => api<Page<PersonCard>>(`/events/${eventId}/people?${qs}${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const advanced = list.data?.pages[0]?.advancedFilters ?? false;
  const err = list.error instanceof ApiError ? list.error : null;

  return (
    <AttendeePage eventId={eventId} title="Discover">
      <PageHeader title="Discover people" subtitle={me ? `At ${me.event.name}` : undefined}
        actions={<ButtonLink href={`/app/events/${eventId}/matches`} variant="secondary" icon={<Wand2 className="size-4" />}>Smart Matches</ButtonLink>} />

      <div className="flex min-w-0 gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or @username" className="pl-10" aria-label="Search people" />
        </div>
        <Button variant="secondary" className="h-12 shrink-0" icon={<Filter className="size-4" />} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{filterCount ? ` (${filterCount})` : ""}
        </Button>
      </div>

      {showFilters && (
        <div className="card mt-3 grid gap-4 p-4 md:grid-cols-2">
          <div><p className="mb-2 text-sm font-medium">Interests</p><TagPicker kind="interests" value={interests} onChange={(v) => setInterests(v.filter((t) => t.id))} eventId={eventId} max={5} /></div>
          <div><p className="mb-2 text-sm font-medium">Skills</p><TagPicker kind="skills" value={skills} onChange={(v) => setSkills(v.filter((t) => t.id))} eventId={eventId} max={5} /></div>
          <label className="block"><span className="mb-1.5 block text-sm font-medium">Profession</span><Input value={profession} onChange={(e) => setProfession(e.target.value)} placeholder="e.g. Designer" /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium">Networking intention</span>
            <Select className="h-12" value={intention} onChange={(e) => setIntention(e.target.value)}>
              <option value="">Any</option>{me?.intentions?.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </Select></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium">Availability</span>
            <Select className="h-12" value={availability} onChange={(e) => setAvailability(e.target.value)}>
              <option value="">Anyone</option>{AVAILABILITY_OPTIONS.filter((o) => !["temporarily_unavailable", "discovery_paused"].includes(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select></label>
          <div className="grid gap-3 sm:grid-cols-2 md:col-span-2">
            {advanced ? <>
              <label className="block"><span className="mb-1.5 block text-sm font-medium">Company / college</span><Input value={company} onChange={(e) => setCompany(e.target.value)} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium">Location</span><Input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
            </> : (
              <Link href="/app/premium" className="flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-sm text-text-2 sm:col-span-2">
                <Lock className="size-4 text-accent" /> Company and location filters are part of Premium.
              </Link>
            )}
          </div>
          {filterCount > 0 && <Button variant="ghost" icon={<X className="size-4" />} className="md:col-span-2 justify-self-start"
            onClick={() => { setInterests([]); setSkills([]); setProfession(""); setIntention(""); setAvailability(""); setCompany(""); setLocation(""); }}>Clear filters</Button>}
        </div>
      )}

      <div className="mt-5">
        {err && err.code === "networking_closed" ? (
          <div className="card"><EmptyState icon={<Compass className="size-7" />} title="Networking hasn't opened yet">{err.message} We&apos;ll be ready when it does.</EmptyState></div>
        ) : err && err.code === "feature_disabled" ? (
          <div className="card"><EmptyState icon={<Compass className="size-7" />} title="Discover is off">{err.message}</EmptyState></div>
        ) : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
        : list.isLoading ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
        : items.length === 0 ? (
          <div className="card"><EmptyState icon={<Compass className="size-7" />} title={filterCount || q ? "No one matches those filters" : "No one to show yet"}>
            {filterCount || q ? "Try removing a filter." : "As more people join this event, they'll appear here. Share the event QR with friends!"}</EmptyState></div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p, i) => <PersonCardView key={p.id} person={p} index={i} href={`/app/events/${eventId}/people/${p.id}`} />)}
            </div>
            {list.hasNextPage && <div className="mt-6 text-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Show more</Button></div>}
          </>
        )}
      </div>
    </AttendeePage>
  );
}
