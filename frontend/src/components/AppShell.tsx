"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Activity, CalendarDays, Compass, Home, Loader2, MessageCircle, Settings, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { useSession } from "@/lib/queries";
import { Avatar, Logo } from "@/components/ui/Misc";
import { cn } from "@/lib/format";

/** Client-side guard for the attendee app. The API remains the authority on every request. */
export function RequireAttendee({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (data && !data.authenticated) router.replace("/?signin=required");
  }, [data, router]);

  if (isLoading || (data && !data.authenticated)) {
    return <div className="grid min-h-dvh place-items-center text-text-2"><Loader2 className="size-6 animate-spin" /></div>;
  }
  if (isError) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center text-text-2">
        <div>
          <p>We couldn&apos;t reach QRious. The server may be waking up.</p>
          <button className="mt-4 text-accent-light underline" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

type NavItem = { href?: string; label: string; icon: ReactNode; match?: (p: string) => boolean; soon?: boolean };

/** Main attendee navigation (PRD §5): Home · Discover · Event Pulse · Messages · Profile. */
export function AttendeeNav({ eventId }: { eventId?: string }) {
  const pathname = usePathname();
  const items: NavItem[] = [
    { href: eventId ? `/app/events/${eventId}/home` : "/app", label: "Home", icon: <Home className="size-5" />, match: (p) => p.endsWith("/home") || p === "/app" },
    { label: "Discover", icon: <Compass className="size-5" />, soon: true },
    { label: "Pulse", icon: <Activity className="size-5" />, soon: true },
    { label: "Messages", icon: <MessageCircle className="size-5" />, soon: true },
    { href: "/app/profile", label: "Profile", icon: <UserRound className="size-5" />, match: (p) => p.startsWith("/app/profile") || p.startsWith("/app/settings") },
  ];

  return (
    <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] sm:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = item.href && item.match?.(pathname);
          const content = (
            <span className={cn("relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active ? "text-text" : "text-text-2", item.soon && "opacity-45")}>
              {active && <motion.span layoutId="nav-pill" className="absolute -top-px h-0.5 w-8 rounded-full bg-grad-primary" />}
              {item.icon}
              {item.label}
              {item.soon && <span className="absolute top-1 right-2 rounded-full bg-card-2 px-1 text-[9px] leading-tight text-accent-light">soon</span>}
            </span>
          );
          return (
            <li key={item.label} className="flex-1">
              {item.href ? <Link href={item.href} aria-current={active ? "page" : undefined}>{content}</Link>
                : <span aria-disabled title={`${item.label} is coming in an upcoming release`}>{content}</span>}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop header with the same destinations. */
export function TopBar({ eventId, title }: { eventId?: string; title?: string }) {
  const { data } = useSession();
  const pathname = usePathname();
  const links = [
    { href: eventId ? `/app/events/${eventId}/home` : "/app", label: "Home", icon: <Home className="size-4" /> },
    { href: "/app/events", label: "My events", icon: <CalendarDays className="size-4" /> },
    { href: "/app/profile", label: "Profile", icon: <UserRound className="size-4" /> },
    { href: "/app/settings", label: "Settings", icon: <Settings className="size-4" /> },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/app" aria-label="QRious"><Logo className="text-base" /></Link>
        {title && <span className="truncate text-sm text-text-2 sm:hidden">{title}</span>}
        <nav className="ml-4 hidden items-center gap-1 sm:flex" aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-colors", pathname === l.href ? "bg-white/8 text-text" : "text-text-2 hover:text-text")}>
              {l.icon}{l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/app/settings" className="rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text sm:hidden" aria-label="Settings"><Settings className="size-5" /></Link>
          {data?.profile && (
            <Link href="/app/profile" aria-label="My profile"><Avatar name={data.profile.displayName} src={data.profile.photo?.thumbnailUrl} size={32} /></Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("mx-auto max-w-5xl px-4 pt-6 pb-28 sm:pb-12", className)}>{children}</main>;
}
