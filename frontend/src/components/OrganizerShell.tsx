"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLocal, writeLocal } from "@/lib/client-store";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, CreditCard, LayoutDashboard, Loader2, LogOut, Menu, QrCode, Settings2, Shield, UserCog, Users, X } from "lucide-react";
import { Logo } from "@/components/ui/Misc";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import { useOrganizer } from "@/lib/queries";
import type { OrganizerMe } from "@/lib/types";

type OrgCtx = { me: OrganizerMe; orgId: string | null; setOrgId: (id: string) => void };
const Ctx = createContext<OrgCtx | null>(null);
export const useOrg = () => useContext(Ctx)!;
const ORG_KEY = "qrious:orgId";

type NavItem = { href: string; label: string; short?: string; icon: ReactNode };
const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Organizer area guard + shell (PRD §6). Authorization is enforced by the API on every call. */
export function OrganizerShell({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = useOrganizer();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const saved = useLocal(ORG_KEY);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreFor, setMoreFor] = useState(pathname);
  const orgs = data?.organizations ?? [];
  const orgId = (orgs.find((o) => o.id === saved) ?? orgs[0])?.id ?? null;

  // Close the "More" sheet whenever navigation happens (state adjusted during render, no effect needed).
  if (moreFor !== pathname) {
    setMoreFor(pathname);
    setMoreOpen(false);
  }

  useEffect(() => {
    if (data && !data.authenticated) router.replace(`/organizer/login?next=${encodeURIComponent(pathname)}`);
  }, [data, router, pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [moreOpen]);

  const setOrgId = (id: string) => writeLocal(ORG_KEY, id);

  if (isLoading || (data && !data.authenticated)) return <div className="grid min-h-dvh place-items-center text-text-2"><Loader2 className="size-6 animate-spin" /></div>;
  if (isError || !data) return <div className="grid min-h-dvh place-items-center text-text-2"><Button variant="secondary" onClick={() => refetch()}>Try again</Button></div>;

  const nav: NavItem[] = [
    { href: "/organizer/dashboard", label: "Dashboard", short: "Home", icon: <LayoutDashboard className="size-5" /> },
    { href: "/organizer/events", label: "Events", icon: <CalendarDays className="size-5" /> },
    { href: "/organizer/qr", label: "QR Management", short: "QR", icon: <QrCode className="size-5" /> },
    { href: "/organizer/participants", label: "Participants", short: "People", icon: <Users className="size-5" /> },
    { href: "/organizer/networking", label: "Networking", icon: <Settings2 className="size-5" /> },
    { href: "/organizer/organization", label: "Organization", icon: <Building2 className="size-5" /> },
    { href: "/organizer/billing", label: "Billing & Plans", icon: <CreditCard className="size-5" /> },
    { href: "/organizer/account", label: "Account", icon: <UserCog className="size-5" /> },
    ...(data.user?.isAdmin ? [{ href: "/admin", label: "Platform admin", icon: <Shield className="size-5" /> }] : []),
  ];
  const primary = nav.slice(0, 4);
  const secondary = nav.slice(4);
  const current = nav.find((n) => isActive(pathname, n.href));
  const moreActive = secondary.some((n) => isActive(pathname, n.href));
  const orgName = orgs.find((o) => o.id === orgId)?.name;

  async function logout() {
    await api("/organizer/auth/logout", { method: "POST" }).catch(() => {});
    qc.clear();
    router.replace("/organizer/login");
  }

  const orgSelect = orgs.length > 0 && (
    <select aria-label="Organization" value={orgId ?? ""} onChange={(e) => setOrgId(e.target.value)}
      className="h-11 w-full rounded-xl border border-line-strong bg-bg-2 px-3 text-sm">
      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );

  return (
    <Ctx.Provider value={{ me: data, orgId, setOrgId }}>
      <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[260px_1fr]">
        {/* Desktop sidebar */}
        <aside className="hidden border-r border-line bg-gradient-to-b from-[#1d1235] to-bg-2 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
          <div className="px-5 py-5"><Link href="/organizer/dashboard"><Logo /></Link><p className="mt-1 text-xs text-text-2">Organizer</p></div>
          {orgs.length > 0 && <div className="px-4">{orgSelect}</div>}
          <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Organizer">
            {nav.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                  className={cn("relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors", active ? "text-text" : "text-text-2 hover:bg-white/5 hover:text-text")}>
                  {active && <motion.span layoutId="org-side-pill" className="absolute inset-0 rounded-xl bg-primary/20" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  <span className="relative">{n.icon}</span><span className="relative">{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-line p-4">
            <p className="truncate text-sm font-medium">{data.user?.displayName}</p>
            <p className="truncate text-xs text-text-2">{data.user?.email}</p>
            <button onClick={logout} className="mt-3 inline-flex items-center gap-2 text-sm text-text-2 hover:text-text"><LogOut className="size-4" />Sign out</button>
          </div>
        </aside>

        <div className="min-w-0">
          {/* Mobile top bar: where you are + which organization */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-2.5 pt-[max(env(safe-area-inset-top),0.625rem)] backdrop-blur-xl lg:hidden">
            <Link href="/organizer/dashboard" aria-label="QRious organizer home"><Logo className="text-base" /></Link>
            <div className="min-w-0 flex-1 text-right">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p key={current?.label ?? "organizer"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
                  className="truncate text-sm font-medium">{current?.label ?? "Organizer"}</motion.p>
              </AnimatePresence>
              {orgName && <p className="truncate text-xs text-text-2">{orgName}</p>}
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-10">{children}</main>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <nav aria-label="Organizer" className="glass fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-lg">
          {primary.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <li key={n.href} className="flex-1">
                <Link href={n.href} aria-current={active ? "page" : undefined}
                  className={cn("relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors", active ? "text-text" : "text-text-2")}>
                  {active && <motion.span layoutId="org-tab-pill" className="absolute -top-px h-0.5 w-8 rounded-full bg-grad-primary" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  <motion.span animate={{ scale: active ? 1.1 : 1 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>{n.icon}</motion.span>
                  {n.short ?? n.label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} aria-haspopup="dialog"
              className={cn("relative flex w-full flex-col items-center gap-1 py-2.5 text-[11px] font-medium", moreActive || moreOpen ? "text-text" : "text-text-2")}>
              {moreActive && <motion.span layoutId="org-tab-pill" className="absolute -top-px h-0.5 w-8 rounded-full bg-grad-primary" />}
              <Menu className="size-5" />More
            </button>
          </li>
        </ul>
      </nav>

      {/* Mobile "More" sheet */}
      <AnimatePresence>
        {moreOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
            <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMoreOpen(false)} />
            <motion.div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-bg-2 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 40 }}
              drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 500) setMoreOpen(false); }}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
              <div className="mb-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{data.user?.displayName}</p>
                  <p className="truncate text-xs text-text-2">{data.user?.email}</p>
                </div>
                <button type="button" onClick={() => setMoreOpen(false)} aria-label="Close" className="rounded-xl p-2 text-text-2 hover:bg-white/5"><X className="size-5" /></button>
              </div>
              {orgs.length > 1 && <div className="mb-3">{orgSelect}</div>}
              <ul className="grid grid-cols-2 gap-2">
                {secondary.map((n, i) => {
                  const active = isActive(pathname, n.href);
                  return (
                    <motion.li key={n.href} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}>
                      <Link href={n.href} aria-current={active ? "page" : undefined}
                        className={cn("flex items-center gap-3 rounded-2xl border px-3.5 py-3.5 text-sm", active ? "border-primary/60 bg-primary/15 text-text" : "border-line bg-card text-text-2")}>
                        <span className="text-accent-light">{n.icon}</span>{n.label}
                      </Link>
                    </motion.li>
                  );
                })}
              </ul>
              <button onClick={logout} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm text-text-2"><LogOut className="size-4" />Sign out</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
