import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, MapPin, ScanLine, Sparkles, UserPlus, Users } from "lucide-react";
import type { PublicEvent } from "@/lib/types";
import { formatEventDate, formatEventTime, networkingStatusLabel, formatDateTime } from "@/lib/format";
import { Logo, Skeleton, StatusDot } from "@/components/ui/Misc";
import { ReturningHint } from "./ReturningHint";

export function EventLanding({ code, event }: { code: string; event: PublicEvent }) {
  const status = networkingStatusLabel[event.networkingStatus] ?? networkingStatusLabel.not_open;
  const banner = event.bannerUrl ?? `/images/categories/${event.categorySlug}.webp`;

  return (
    <main className="ambient min-h-dvh">
      {/* Hero: large event image with gradient overlay (PRD §9.6) */}
      <section className="relative isolate overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={banner} alt="" fetchPriority="high" className="absolute inset-0 -z-10 size-full object-cover opacity-70" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-bg/30 via-bg/70 to-bg" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_60%_at_20%_100%,rgba(139,92,246,0.35),transparent)]" />

        <div className="mx-auto max-w-3xl px-5 pt-[max(env(safe-area-inset-top),1.25rem)]">
          <div className="flex items-center justify-between py-2">
            <Link href="/" aria-label="QRious home"><Logo /></Link>
            <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium">
              <StatusDot tone={status.tone} />
              {status.label}
            </span>
          </div>

          <div className="pt-20 pb-8 sm:pt-28">
            <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide text-accent-light uppercase">
              <Sparkles className="size-3.5" /> {event.categoryName}
            </span>
            <h1 className="mt-4 font-display text-[2.15rem] leading-[1.08] font-bold tracking-tight text-balance sm:text-5xl">{event.name}</h1>
            <p className="mt-3 text-sm text-text-2">
              Hosted by <span className="font-medium text-text">{event.organizer.name}</span>
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl space-y-6 px-5 pb-[max(env(safe-area-inset-bottom),2.5rem)]">
        {/* Event facts */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact icon={<CalendarDays className="size-4" />} label="Date" value={formatEventDate(event.startsAt, event.endsAt, event.timeZone)} />
          <Fact icon={<Clock className="size-4" />} label="Time" value={formatEventTime(event.startsAt, event.endsAt, event.timeZone)} />
          <Fact icon={<MapPin className="size-4" />} label="Venue" value={[event.venueName, event.city].filter(Boolean).join(", ")} sub={event.venueAddress ?? undefined} />
        </div>

        {event.networkingStatus === "not_open" && (
          <p className="card px-4 py-3 text-sm text-text-2">
            Networking opens <span className="font-medium text-text">{formatDateTime(event.networkingOpensAt, event.timeZone)}</span>.
            You can create your profile now and be ready.
          </p>
        )}

        {/* EXACTLY two primary options (NN-03) */}
        <section aria-label="Choose how to continue" className="grid gap-4 sm:grid-cols-2">
          <OptionCard
            href={`/e/${code}/discover`}
            icon={<Users className="size-6" />}
            title="Discover People"
            body="Browse the public profiles of people at this event. No account needed."
            cta="Start browsing"
            variant="secondary"
          />
          <OptionCard
            href={`/e/${code}/join`}
            icon={<UserPlus className="size-6" />}
            title="Create My Profile"
            body="Takes under a minute. Connect, chat and see who's open to talk."
            cta="Create profile"
            variant="primary"
            hint={<ReturningHint eventId={event.id} />}
          />
        </section>

        {event.description && (
          <section className="card p-5">
            <h2 className="font-display text-lg font-semibold">About this event</h2>
            <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line text-text-2">{event.description}</p>
          </section>
        )}

        <footer className="flex flex-col items-center gap-2 pt-4 text-center text-xs text-text-2">
          <span className="inline-flex items-center gap-1.5"><ScanLine className="size-3.5" /> You opened this page from the event QR code.</span>
          <span>
            Already have a profile on another device? <Link href="/recover" className="text-accent-light underline-offset-4 hover:underline">Recover it</Link>
          </span>
        </footer>
      </div>
    </main>
  );
}

function Fact({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-text-2 uppercase">{icon}{label}</div>
      <p className="mt-1.5 text-[15px] font-medium">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-text-2">{sub}</p>}
    </div>
  );
}

function OptionCard({ href, icon, title, body, cta, variant, hint }: {
  href: string; icon: React.ReactNode; title: string; body: string; cta: string; variant: "primary" | "secondary"; hint?: React.ReactNode;
}) {
  const primary = variant === "primary";
  return (
    <Link
      href={href}
      className={`group relative flex flex-col overflow-hidden rounded-3xl border p-6 transition-all duration-300 hover:-translate-y-1 ${
        primary ? "border-primary/50 bg-gradient-to-br from-primary/30 via-card to-pink/20 shadow-[var(--shadow-glow)]" : "border-line-strong bg-card hover:border-accent/50"
      }`}
    >
      <div className={`grid size-12 place-items-center rounded-2xl ${primary ? "bg-grad-primary text-white" : "bg-card-2 text-accent"}`}>{icon}</div>
      <h2 className="mt-4 font-display text-xl font-bold">{title}</h2>
      <p className="mt-1.5 flex-1 text-sm text-text-2">{body}</p>
      {hint}
      <span className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold ${primary ? "text-white" : "text-accent-light"}`}>
        {cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

const stateCopy: Record<string, { title: string; body: string }> = {
  invalid: { title: "We don't recognise this QR code", body: "Check that you scanned the official event QR code, or ask the organizer for the latest one." },
  revoked: { title: "This QR code has been replaced", body: "The organizer issued a new QR code for this event. Please scan the latest one at the venue." },
  expired: { title: "This QR code has expired", body: "Ask the organizer for the current event QR code." },
  disabled: { title: "QR access is turned off", body: "The organizer has paused QR access for this event. Please check back later." },
  event_unavailable: { title: "This event isn't available", body: "It may have been archived or isn't open to the public yet." },
  unavailable_server: { title: "We're waking up", body: "QRious is starting up. Refresh in a few seconds." },
};

export function QrStateView({ state, event }: { state: string; event?: PublicEvent | null }) {
  const copy = stateCopy[state] ?? stateCopy.invalid;
  return (
    <main className="ambient grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-md text-center">
        <Link href="/" className="inline-block"><Logo /></Link>
        <div className="card mt-8 p-8">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-card-2 text-accent"><ScanLine className="size-8" /></div>
          {event && <p className="mt-5 text-sm text-text-2">{event.name}</p>}
          <h1 className="mt-2 font-display text-2xl font-bold">{copy.title}</h1>
          <p className="mt-3 text-sm text-text-2">{copy.body}</p>
          {state === "unavailable_server" && (
            <a href="" className="mt-6 inline-flex h-11 items-center rounded-2xl bg-grad-primary px-5 font-semibold">Try again</a>
          )}
        </div>
      </div>
    </main>
  );
}

export function LandingSkeleton() {
  return (
    <main className="ambient min-h-dvh">
      <div className="mx-auto max-w-3xl space-y-5 px-5 pt-36">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-12 w-4/5" />
        <Skeleton className="h-4 w-40" />
        <div className="grid gap-3 pt-6 sm:grid-cols-3">
          <Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-52" /><Skeleton className="h-52" />
        </div>
      </div>
    </main>
  );
}
