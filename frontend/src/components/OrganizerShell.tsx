"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useLocal, writeLocal } from "@/lib/client-store";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, CreditCard, LayoutDashboard, Loader2, LogOut, QrCode, Settings2, Shield, UserCog, Users } from "lucide-react";
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

/** Organizer area guard + shell (PRD §6). Authorization is enforced by the API on every call. */
export function OrganizerShell({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = useOrganizer();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const saved = useLocal(ORG_KEY);
  const orgs = data?.organizations ?? [];
  const orgId = (orgs.find((o) => o.id === saved) ?? orgs[0])?.id ?? null;

  useEffect(() => {
    if (data && !data.authenticated) router.replace(`/organizer/login?next=${encodeURIComponent(pathname)}`);
  }, [data, router, pathname]);

  const setOrgId = (id: string) => writeLocal(ORG_KEY, id);

  if (isLoading || (data && !data.authenticated)) return <div className="grid min-h-dvh place-items-center text-text-2"><Loader2 className="size-6 animate-spin" /></div>;
  if (isError || !data) return <div className="grid min-h-dvh place-items-center text-text-2"><Button variant="secondary" onClick={() => refetch()}>Try again</Button></div>;

  const nav = [
    { href: "/organizer/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-5" /> },
    { href: "/organizer/events", label: "Events", icon: <CalendarDays className="size-5" /> },
    { href: "/organizer/events?view=qr", label: "QR Management", icon: <QrCode className="size-5" /> },
    { href: "/organizer/events?view=participants", label: "Participants", icon: <Users className="size-5" /> },
    { href: "/organizer/events?view=networking", label: "Networking", icon: <Settings2 className="size-5" /> },
    { href: "/organizer/organization", label: "Organization", icon: <Building2 className="size-5" /> },
    { href: "/organizer/billing", label: "Billing & Plans", icon: <CreditCard className="size-5" /> },
    { href: "/organizer/account", label: "Account", icon: <UserCog className="size-5" /> },
    ...(data.user?.isAdmin ? [{ href: "/admin", label: "Platform admin", icon: <Shield className="size-5" /> }] : []),
  ];

  async function logout() {
    await api("/organizer/auth/logout", { method: "POST" }).catch(() => {});
    qc.clear();
    router.replace("/organizer/login");
  }

  return (
    <Ctx.Provider value={{ me: data, orgId, setOrgId }}>
      <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="hidden border-r border-line bg-gradient-to-b from-[#1d1235] to-bg-2 lg:flex lg:h-dvh lg:flex-col lg:sticky lg:top-0">
          <div className="px-5 py-5"><Link href="/organizer/dashboard"><Logo /></Link><p className="mt-1 text-xs text-text-2">Organizer</p></div>
          {data.organizations && data.organizations.length > 0 && (
            <div className="px-4">
              <select aria-label="Organization" value={orgId ?? ""} onChange={(e) => setOrgId(e.target.value)}
                className="h-10 w-full rounded-xl border border-line-strong bg-bg-2 px-3 text-sm">
                {data.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <nav className="mt-4 flex-1 space-y-0.5 px-3" aria-label="Organizer">
            {nav.map((n) => {
              const active = pathname === n.href.split("?")[0] && (!n.href.includes("?") ? true : false);
              return <Link key={n.label} href={n.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors", active ? "bg-primary/20 text-text" : "text-text-2 hover:bg-white/5 hover:text-text")}>{n.icon}{n.label}</Link>;
            })}
          </nav>
          <div className="border-t border-line p-4">
            <p className="truncate text-sm font-medium">{data.user?.displayName}</p>
            <p className="truncate text-xs text-text-2">{data.user?.email}</p>
            <button onClick={logout} className="mt-3 inline-flex items-center gap-2 text-sm text-text-2 hover:text-text"><LogOut className="size-4" />Sign out</button>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-xl lg:hidden">
            <Link href="/organizer/dashboard"><Logo className="text-base" /></Link>
            <nav className="ml-auto flex gap-1 overflow-x-auto" aria-label="Organizer">
              {nav.slice(0, 2).concat(nav.slice(5)).map((n) => <Link key={n.label} href={n.href} aria-label={n.label} className={cn("rounded-xl p-2", pathname.startsWith(n.href.split("?")[0]!) ? "bg-primary/20 text-text" : "text-text-2")}>{n.icon}</Link>)}
              <button onClick={logout} aria-label="Sign out" className="rounded-xl p-2 text-text-2"><LogOut className="size-5" /></button>
            </nav>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
