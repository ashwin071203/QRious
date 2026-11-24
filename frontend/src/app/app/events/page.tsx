"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, MapPin, ScanLine } from "lucide-react";
import { AttendeeNav, PageContainer, TopBar } from "@/components/AppShell";
import { EmptyState, Skeleton, StatusDot } from "@/components/ui/Misc";
import { useMyEvents } from "@/lib/queries";
import { cn, formatEventDate, networkingStatusLabel } from "@/lib/format";

const tabs = [
  { key: "current", label: "Current" },
  { key: "upcoming", label: "Upcoming" },
  { key: "previous", label: "Previous" },
] as const;

/** My Events: current, upcoming and previous participations (Module 4). */
export default function MyEventsPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]["key"]>("current");
  const { data, isLoading } = useMyEvents(tab);

  return (
    <>
      <TopBar title="My events" />
      <PageContainer>
        <h1 className="font-display text-2xl font-bold">My events</h1>
        <p className="mt-1 text-sm text-text-2">One global profile across every event you join.</p>

        <div role="tablist" className="mt-5 inline-flex rounded-2xl border border-line bg-bg-2 p-1">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("rounded-xl px-4 py-1.5 text-sm font-medium transition-colors", tab === t.key ? "bg-card-2 text-text" : "text-text-2 hover:text-text")}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {isLoading && Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
          {data?.map(({ event }) => {
            const status = networkingStatusLabel[event.networkingStatus];
            return (
              <Link key={event.id} href={`/app/events/${event.id}/home`} className="card group overflow-hidden p-0 transition hover:-translate-y-0.5 hover:border-accent/40">
                <div className="relative h-32 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={event.bannerUrl ?? `/images/categories/${event.categorySlug}.webp`} alt="" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
                  <span className="glass absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"><StatusDot tone={status.tone} />{status.label}</span>
                </div>
                <div className="p-4">
                  <p className="font-display font-semibold">{event.name}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-text-2"><CalendarDays className="size-4" />{formatEventDate(event.startsAt, event.endsAt, event.timeZone)}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-text-2"><MapPin className="size-4" />{[event.venueName, event.city].filter(Boolean).join(", ")}</p>
                </div>
              </Link>
            );
          })}
        </div>
        {data && data.length === 0 && (
          <div className="card mt-2">
            <EmptyState icon={<ScanLine className="size-7" />} title={`No ${tab} events`}>
              Scan an event&apos;s QR code to join it. Your existing profile is reused automatically.
            </EmptyState>
          </div>
        )}
      </PageContainer>
      <AttendeeNav />
    </>
  );
}
