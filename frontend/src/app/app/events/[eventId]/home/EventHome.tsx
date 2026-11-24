"use client";

import { use } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  Activity, ArrowRight, BellRing, CalendarDays, Compass, Handshake, KeyRound, MapPin, MessageCircle, Sparkles, UserRoundPen, Users, Wand2,
} from "lucide-react";
import { AttendeeNav, PageContainer, TopBar } from "@/components/AppShell";
import { Avatar, Skeleton, StatusDot } from "@/components/ui/Misc";
import { ButtonLink } from "@/components/ui/Button";
import { useEvent, useProfile } from "@/lib/queries";
import { availabilityLabel, formatEventDate, formatEventTime, networkingStatusLabel } from "@/lib/format";
import { ApiError } from "@/lib/api";
import type { OwnProfile } from "@/lib/types";

/** Event networking home — where attendees land after creating a profile (never Discover, PRD §3.3). */
export function EventHome({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { data, isLoading, error } = useEvent(eventId);
  const { data: profile } = useProfile();

  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return (
      <>
        <TopBar />
        <PageContainer>
          <div className="card mx-auto max-w-md p-8 text-center">
            <h1 className="font-display text-xl font-bold">You haven&apos;t joined this event</h1>
            <p className="mt-2 text-sm text-text-2">Scan the event&apos;s QR code to join it with your QRious profile.</p>
            <ButtonLink href="/app/events" className="mt-6">My events</ButtonLink>
          </div>
        </PageContainer>
        <AttendeeNav />
      </>
    );
  }

  const ev = data?.event;
  const status = ev ? networkingStatusLabel[ev.networkingStatus] : null;

  return (
    <>
      <TopBar eventId={eventId} title={ev?.name} />
      <PageContainer>
        {/* Current event — always clearly indicated (PRD §5) */}
        <section className="relative overflow-hidden rounded-3xl border border-line">
          {ev ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ev.bannerUrl ?? `/images/categories/${ev.categorySlug}.webp`} alt="" className="absolute inset-0 size-full object-cover opacity-50" />
              <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/75 to-bg/20" />
              <div className="relative p-5 pt-16 sm:p-8 sm:pt-24">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium">
                    <StatusDot tone={status!.tone} /> {status!.label}
                  </span>
                  <span className="glass rounded-full px-3 py-1 text-xs text-accent-light">{ev.categoryName}</span>
                </div>
                <h1 className="mt-3 font-display text-2xl leading-tight font-bold sm:text-4xl">{ev.name}</h1>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-text-2">
                  <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" />{formatEventDate(ev.startsAt, ev.endsAt, ev.timeZone)} · {formatEventTime(ev.startsAt, ev.endsAt, ev.timeZone)}</span>
                  <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{[ev.venueName, ev.city].filter(Boolean).join(", ")}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3 p-8 pt-24"><Skeleton className="h-5 w-32" /><Skeleton className="h-9 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
          )}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Welcome + availability */}
            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card flex items-center gap-4 p-5">
              {profile ? <Avatar name={profile.displayName} src={profile.photo?.url} size={56} /> : <Skeleton className="size-14 rounded-full" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-2">You&apos;re in{profile ? "," : ""}</p>
                <p className="truncate font-display text-lg font-semibold">{profile?.displayName ?? "…"}</p>
                {data && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-success">
                    <span className="size-2 rounded-full bg-success" />
                    {availabilityLabel[data.participation.availabilityStatus] ?? "Open to conversations"}
                  </p>
                )}
              </div>
            </motion.section>

            {/* Networking shortcuts (Home secondary navigation, PRD §5) */}
            <section>
              <h2 className="mb-3 font-display text-lg font-semibold">Start networking</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {isLoading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />) : (
                  [
                    { icon: <Compass />, title: "Discover", body: "Browse people here" },
                    { icon: <Wand2 />, title: "Smart Matches", body: "People who fit you" },
                    { icon: <Activity />, title: "Event Pulse", body: "Live activity" },
                    { icon: <Sparkles />, title: "Open to Talk", body: "Set your status" },
                    { icon: <Handshake />, title: "Connections", body: "Requests & contacts" },
                    { icon: <MessageCircle />, title: "Messages", body: "Private chats" },
                  ].map((a, i) => (
                    <motion.div key={a.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                      className="card relative flex flex-col gap-2 p-4 opacity-80" aria-disabled>
                      <span className="grid size-10 place-items-center rounded-xl bg-card-2 text-accent [&>svg]:size-5">{a.icon}</span>
                      <span className="font-medium">{a.title}</span>
                      <span className="text-xs text-text-2">{a.body}</span>
                      <span className="absolute top-3 right-3 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-accent-light">Soon</span>
                    </motion.div>
                  ))
                )}
              </div>
              <p className="mt-3 text-xs text-text-2">Discovery, matching, Event Pulse and messaging are rolling out in the next releases.</p>
            </section>
          </div>

          <aside className="space-y-4">
            {profile && <ProfileStrength profile={profile} />}
            <div className="card p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-card-2 text-accent"><KeyRound className="size-5" /></span>
                <div>
                  <p className="font-medium">Recovery code</p>
                  <p className="text-xs text-text-2">Your way back in on a new device.</p>
                </div>
              </div>
              <Link href="/app/settings#recovery" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-light">Manage <ArrowRight className="size-4" /></Link>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-card-2 text-accent"><Users className="size-5" /></span>
                <div>
                  <p className="font-medium">My events</p>
                  <p className="text-xs text-text-2">One profile, every event.</p>
                </div>
              </div>
              <Link href="/app/events" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-light">View all <ArrowRight className="size-4" /></Link>
            </div>
            <div className="card flex items-center gap-3 p-5 opacity-80">
              <span className="grid size-10 place-items-center rounded-xl bg-card-2 text-accent"><BellRing className="size-5" /></span>
              <div>
                <p className="font-medium">Notifications</p>
                <p className="text-xs text-text-2">Coming with connections.</p>
              </div>
            </div>
          </aside>
        </div>
      </PageContainer>
      <AttendeeNav eventId={eventId} />
    </>
  );
}

function ProfileStrength({ profile }: { profile: OwnProfile }) {
  const checks = [
    { done: !!profile.photo, label: "Add a photo" },
    { done: !!profile.bio, label: "Write a short bio" },
    { done: !!profile.profession, label: "Add your profession" },
    { done: !!profile.lookingForText || profile.lookingForSkills.length > 0, label: "Say what you're looking for" },
    { done: profile.interests.length >= 3, label: "Pick 3+ interests" },
  ];
  const pct = Math.round((checks.filter((c) => c.done).length / checks.length) * 100);
  const next = checks.find((c) => !c.done);
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="font-medium">Profile strength</p>
        <span className="font-display text-lg font-bold text-accent-light">{pct}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-2">
        <motion.div className="h-full rounded-full bg-grad-primary" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
      </div>
      {next ? (
        <Link href="/app/profile/edit" className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent-light"><UserRoundPen className="size-4" />{next.label}</Link>
      ) : (
        <p className="mt-3 text-sm text-success">Looking great — people can find you easily.</p>
      )}
    </div>
  );
}
