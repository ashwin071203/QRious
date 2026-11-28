"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, ArrowRight, Bookmark, CalendarDays, Compass, Handshake, KeyRound, MapPin, MessageCircle, Sparkles, UserRoundPen, Wand2 } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { AvailabilityPill } from "@/components/People";
import { Avatar, EmptyState, Skeleton, StatusDot } from "@/components/ui/Misc";
import { ButtonLink } from "@/components/ui/Button";
import { useEvent, useProfile, useRememberEvent, useUnread } from "@/lib/queries";
import { formatDateTime, formatEventDate, formatEventTime, networkingStatusLabel } from "@/lib/format";
import { api, ApiError } from "@/lib/api";
import type { MatchItem, OwnProfile } from "@/lib/types";

/** Event networking home — where attendees land after creating a profile (never Discover, PRD §3.3). */
export function EventHome({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  useRememberEvent(eventId);
  const { data, isLoading, error } = useEvent(eventId);
  const { data: profile } = useProfile();
  const { data: unread } = useUnread();
  const open = data?.event.networkingStatus === "open";
  const matches = useQuery({
    queryKey: ["matches", eventId], enabled: !!open && !!data?.event.features.smartMatching,
    queryFn: () => api<{ items: MatchItem[] }>(`/events/${eventId}/matches`),
  });

  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return (
      <AttendeePage>
        <div className="card mx-auto max-w-md p-8 text-center">
          <h1 className="font-display text-xl font-bold">{error.code === "not_participant" ? "You're not part of this event" : "Event unavailable"}</h1>
          <p className="mt-2 text-sm text-text-2">Scan the event&apos;s QR code to join it with your QRious profile.</p>
          <ButtonLink href="/app/events" className="mt-6">My events</ButtonLink>
        </div>
      </AttendeePage>
    );
  }

  const ev = data?.event;
  const status = ev ? networkingStatusLabel[ev.networkingStatus] : null;
  const f = ev?.features;
  const tiles = [
    { href: `/app/events/${eventId}/discover`, icon: <Compass />, title: "Discover", body: "Browse people here", on: f?.discover },
    { href: `/app/events/${eventId}/matches`, icon: <Wand2 />, title: "Smart Matches", body: "People who fit you", on: f?.smartMatching },
    { href: `/app/events/${eventId}/pulse`, icon: <Activity />, title: "Event Pulse", body: "Live activity", on: f?.pulse },
    { href: `/app/events/${eventId}/availability`, icon: <Sparkles />, title: "Open to Talk", body: "Set your status", on: true },
    { href: "/app/connections", icon: <Handshake />, title: "Connections", body: unread?.requests ? `${unread.requests} new request${unread.requests > 1 ? "s" : ""}` : "Requests & contacts", on: true, badge: unread?.requests },
    { href: "/app/messages", icon: <MessageCircle />, title: "Messages", body: unread?.messages ? `${unread.messages} unread` : "Private chats", on: true, badge: unread?.messages },
  ];

  return (
    <AttendeePage eventId={eventId} title={ev?.name}>
      <section className="relative overflow-hidden rounded-3xl border border-line">
        {ev ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ev.bannerUrl ?? `/images/categories/${ev.categorySlug}.webp`} alt="" className="absolute inset-0 size-full object-cover opacity-50" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/75 to-bg/20" />
            <div className="relative p-5 pt-16 sm:p-8 sm:pt-24">
              <div className="flex flex-wrap items-center gap-2">
                <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"><StatusDot tone={status!.tone} /> {status!.label}</span>
                <span className="glass rounded-full px-3 py-1 text-xs text-accent-light">{ev.categoryName}</span>
              </div>
              <h1 className="mt-3 font-display text-2xl leading-tight font-bold sm:text-4xl">{ev.name}</h1>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-text-2">
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" />{formatEventDate(ev.startsAt, ev.endsAt, ev.timeZone)} · {formatEventTime(ev.startsAt, ev.endsAt, ev.timeZone)}</span>
                <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{[ev.venueName, ev.city].filter(Boolean).join(", ")}</span>
              </div>
            </div>
          </>
        ) : <div className="space-y-3 p-8 pt-24"><Skeleton className="h-5 w-32" /><Skeleton className="h-9 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>}
      </section>

      {ev && ev.networkingStatus === "not_open" && (
        <p className="card mt-4 px-4 py-3 text-sm text-text-2">Networking opens <b className="text-text">{formatDateTime(ev.networkingOpensAt, ev.timeZone)}</b>. Set up your profile and status now so people find you right away.</p>
      )}
      {ev && ev.networkingStatus === "paused" && <p className="card mt-4 px-4 py-3 text-sm text-warning">The organizer has paused networking for now. Your connections and chats still work.</p>}
      {ev && ev.networkingStatus === "ended" && <p className="card mt-4 px-4 py-3 text-sm text-text-2">This event has ended. Your connections and conversations stay with you.</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card flex items-center gap-4 p-5">
            {profile ? <Avatar name={profile.displayName} src={profile.photo?.url} size={56} /> : <Skeleton className="size-14 rounded-full" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-2">You&apos;re in,</p>
              <p className="truncate font-display text-lg font-semibold">{profile?.displayName ?? "…"}</p>
              {data && <AvailabilityPill status={data.participation.discoveryPaused ? "discovery_paused" : data.participation.availabilityStatus} className="mt-1" />}
            </div>
            <ButtonLink href={`/app/events/${eventId}/availability`} variant="secondary" size="sm">Change</ButtonLink>
          </motion.section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold">Start networking</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {isLoading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />) : tiles.map((a, i) => (
                <motion.div key={a.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  {a.on === false ? (
                    <div className="card flex h-full flex-col gap-2 p-4 opacity-50" aria-disabled>
                      <span className="grid size-10 place-items-center rounded-xl bg-card-2 text-text-2 [&>svg]:size-5">{a.icon}</span>
                      <span className="font-medium">{a.title}</span><span className="text-xs text-text-2">Turned off by the organizer</span>
                    </div>
                  ) : (
                    <Link href={a.href} className="card relative flex h-full flex-col gap-2 p-4 transition hover:-translate-y-0.5 hover:border-accent/40">
                      <span className="grid size-10 place-items-center rounded-xl bg-card-2 text-accent [&>svg]:size-5">{a.icon}</span>
                      <span className="font-medium">{a.title}</span><span className="text-xs text-text-2">{a.body}</span>
                      {!!a.badge && <span className="absolute top-3 right-3 rounded-full bg-pink px-2 py-0.5 text-[10px] font-bold text-bg">{a.badge}</span>}
                    </Link>
                  )}
                </motion.div>
              ))}
            </div>
          </section>

          {open && f?.smartMatching && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">Top matches for you</h2>
                <Link href={`/app/events/${eventId}/matches`} className="inline-flex items-center gap-1 text-sm text-accent-light">All matches <ArrowRight className="size-4" /></Link>
              </div>
              {matches.isLoading ? <Skeleton className="h-24" /> : !matches.data?.items.length ? (
                <div className="card"><EmptyState icon={<Wand2 className="size-7" />} title="No matches yet">We&apos;ll suggest people as more attendees join.</EmptyState></div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  {matches.data.items.slice(0, 3).map((m) => (
                    <Link key={m.profile.id} href={`/app/events/${eventId}/people/${m.profile.id}`} className="card p-4 transition hover:border-accent/40">
                      <div className="flex items-center gap-3"><Avatar name={m.profile.displayName} src={m.profile.photo?.thumbnailUrl} size={44} />
                        <div className="min-w-0"><p className="truncate font-medium">{m.profile.displayName}</p><p className="text-xs text-accent-light">{m.score}% match</p></div></div>
                      <p className="mt-2 line-clamp-2 text-xs text-text-2">{m.reasons[0]}</p>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {profile && <ProfileStrength profile={profile} />}
          <SideLink href="/app/saved" icon={<Bookmark className="size-5" />} title="Saved profiles" body="People you bookmarked." />
          <SideLink href="/app/settings#recovery" icon={<KeyRound className="size-5" />} title="Recovery code" body="Your way back in on a new device." />
          <SideLink href="/app/events" icon={<CalendarDays className="size-5" />} title="My events" body="One profile, every event." />
        </aside>
      </div>
    </AttendeePage>
  );
}

function SideLink({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link href={href} className="card flex items-center gap-3 p-4 transition hover:border-accent/40">
      <span className="grid size-10 place-items-center rounded-xl bg-card-2 text-accent">{icon}</span>
      <div className="min-w-0 flex-1"><p className="font-medium">{title}</p><p className="text-xs text-text-2">{body}</p></div>
      <ArrowRight className="size-4 text-text-2" />
    </Link>
  );
}

function ProfileStrength({ profile }: { profile: OwnProfile }) {
  const checks = [
    { done: !!profile.photo, label: "Add a photo" }, { done: !!profile.bio, label: "Write a short bio" }, { done: !!profile.profession, label: "Add your profession" },
    { done: !!profile.lookingForText || profile.lookingForSkills.length > 0, label: "Say what you're looking for" }, { done: profile.interests.length >= 3, label: "Pick 3+ interests" },
  ];
  const pct = Math.round((checks.filter((c) => c.done).length / checks.length) * 100);
  const next = checks.find((c) => !c.done);
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between"><p className="font-medium">Profile strength</p><span className="font-display text-lg font-bold text-accent-light">{pct}%</span></div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-2"><motion.div className="h-full rounded-full bg-grad-primary" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} /></div>
      {next ? <Link href="/app/profile/edit" className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent-light"><UserRoundPen className="size-4" />{next.label}</Link>
        : <p className="mt-3 text-sm text-success">Looking great — people can find you easily.</p>}
    </div>
  );
}
