"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Activity, Bell, Compass, Home, Loader2, MessageCircle, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { useLastEventId, useSession, useUnread } from "@/lib/queries";
import { Avatar, Logo } from "@/components/ui/Misc";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";

/** Client-side guard for the attendee app. The API remains the authority on every request. */
export function RequireAttendee({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (data && !data.authenticated) router.replace("/?signin=required");
  }, [data, router]);

  if (isLoading || (data && !data.authenticated)) {
    return <div className="grid min-h-dvh place-items-center text-text-2"><Loader2 className="size-6 animate-spin" aria-label="Loading" /></div>;
  }
  if (isError) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center text-text-2">
        <div>
          <p>We couldn&apos;t reach QRious. Check your connection.</p>
          <Button variant="secondary" className="mt-4" onClick={() => refetch()}>Try again</Button>
        </div>
      </div>
    );
  }
  if (data?.status === "deactivated" && !pathname.startsWith("/app/settings")) return <PendingDeletion />;
  return <>{children}</>;
}

function PendingDeletion() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="card max-w-md p-6 text-center">
        <h1 className="font-display text-xl font-bold">Your account is scheduled for deletion</h1>
        <p className="mt-2 text-sm text-text-2">Your profile is hidden from everyone. Cancel within 14 days of your request to keep your account.</p>
        <Button className="mt-5" loading={busy} onClick={async () => { setBusy(true); await api("/me/deletion-request", { method: "DELETE" }).catch(() => {}); location.reload(); }}>
          Cancel deletion
        </Button>
      </div>
    </div>
  );
}

/** Resolves the event context for global pages (current route → last used event). */
export function useEventContext(eventId?: string) {
  const remembered = useLastEventId();
  return eventId ?? remembered ?? undefined;
}

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return <span aria-hidden className="absolute -top-1 -right-2 min-w-4 rounded-full bg-pink px-1 text-center text-[10px] leading-4 font-bold text-bg">{n > 99 ? "99+" : n}</span>;
}

/** Main attendee navigation (PRD §5): Home · Discover · Event Pulse · Messages · Profile. */
export function AttendeeNav({ eventId }: { eventId?: string }) {
  const pathname = usePathname();
  const ev = useEventContext(eventId);
  const { data: unread } = useUnread();
  const base = ev ? `/app/events/${ev}` : null;
  const items = [
    { href: base ? `${base}/home` : "/app/events", label: "Home", icon: <Home className="size-5" />, active: pathname.endsWith("/home") || pathname === "/app/events" },
    { href: base ? `${base}/discover` : "/app/events", label: "Discover", icon: <Compass className="size-5" />, active: pathname.includes("/discover") || pathname.includes("/matches") },
    { href: base ? `${base}/pulse` : "/app/events", label: "Pulse", icon: <Activity className="size-5" />, active: pathname.includes("/pulse") },
    { href: "/app/messages", label: "Messages", icon: <MessageCircle className="size-5" />, active: pathname.startsWith("/app/messages"), badge: unread?.messages },
    { href: "/app/profile", label: "Profile", icon: <UserRound className="size-5" />, active: pathname.startsWith("/app/profile") || pathname.startsWith("/app/settings") },
  ];
  return (
    <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => (
          <li key={item.label} className="flex-1">
            <Link href={item.href} aria-current={item.active ? "page" : undefined} aria-label={item.badge ? `${item.label}, ${item.badge} unread` : item.label}
              className={cn("relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", item.active ? "text-text" : "text-text-2")}>
              {item.active && <motion.span layoutId="nav-pill" className="absolute -top-px h-0.5 w-8 rounded-full bg-grad-primary" />}
              <span className="relative">{item.icon}<Badge n={item.badge} /></span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function TopBar({ eventId, title }: { eventId?: string; title?: string }) {
  const { data } = useSession();
  const { data: unread } = useUnread();
  const pathname = usePathname();
  const ev = useEventContext(eventId);
  const base = ev ? `/app/events/${ev}` : null;
  const links = [
    { href: base ? `${base}/home` : "/app/events", label: "Home" },
    { href: base ? `${base}/discover` : "/app/events", label: "Discover" },
    { href: base ? `${base}/matches` : "/app/events", label: "Matches" },
    { href: base ? `${base}/pulse` : "/app/events", label: "Pulse" },
    { href: "/app/messages", label: "Messages", badge: unread?.messages },
    { href: "/app/connections", label: "Connections", badge: unread?.requests },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <Link href={base ? `${base}/home` : "/app"} aria-label="QRious home"><Logo className="text-base" /></Link>
        {title && <span className="min-w-0 truncate text-sm text-text-2 md:hidden">{title}</span>}
        <nav className="ml-3 hidden items-center gap-0.5 md:flex" aria-label="Main">
          {links.map((l) => (
            <Link key={l.label} href={l.href} aria-label={l.badge ? `${l.label}, ${l.badge} ${l.label === "Connections" ? "pending" : "unread"}` : l.label}
              className={cn("relative rounded-xl px-3 py-1.5 text-sm transition-colors", pathname === l.href || (l.href !== "/app/events" && pathname.startsWith(l.href)) ? "bg-white/8 text-text" : "text-text-2 hover:text-text")}>
              {l.label}<Badge n={l.badge} />
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link href="/app/connections" className="relative rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text md:hidden" aria-label="Connections">
            <UserRound className="size-5" /><Badge n={unread?.requests} />
          </Link>
          <Link href="/app/notifications" className="relative rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text" aria-label={`Notifications${unread?.notifications ? ` (${unread.notifications} unread)` : ""}`}>
            <Bell className="size-5" /><Badge n={unread?.notifications} />
          </Link>
          {data?.profile && (
            <Link href="/app/profile" aria-label="My profile" className="ml-1"><Avatar name={data.profile.displayName} src={data.profile.photo?.thumbnailUrl} size={32} /></Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("mx-auto max-w-5xl px-4 pt-6 pb-28 md:pb-12", className)}>{children}</main>;
}

/** Standard attendee page frame. */
export function AttendeePage({ eventId, title, children, className }: { eventId?: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <>
      <TopBar eventId={eventId} title={title} />
      <PageContainer className={className}>{children}</PageContainer>
      <AttendeeNav eventId={eventId} />
    </>
  );
}
