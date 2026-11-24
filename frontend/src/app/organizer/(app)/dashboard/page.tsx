"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CalendarDays, CalendarPlus, MessageCircle, QrCode, Radio, Users } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { ButtonLink } from "@/components/ui/Button";
import { CreateOrganization } from "@/components/CreateOrganization";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { api } from "@/lib/api";
import { formatEventDate } from "@/lib/format";
import { EVENT_STATUS } from "@/components/EventStatus";

type Dashboard = { totals: { events: number; activeEvents: number; participants: number; openToTalkNow: number | null };
  recentEvents: { id: string; name: string; status: string; startsAt: string; endsAt: string; timeZone: string; participantCount: number; bannerUrl: string | null }[] };

/** Organizer dashboard (PRD §6): totals, active events, participants, live activity, recent events, quick actions. */
export default function DashboardPage() {
  const { me, orgId } = useOrg();
  const q = useQuery({ queryKey: ["dashboard", orgId], enabled: !!orgId, queryFn: () => api<Dashboard>(`/organizations/${orgId}/dashboard`), refetchInterval: 30_000 });
  if (!me.organizations?.length) return <CreateOrganization />;
  const t = q.data?.totals;
  const org = me.organizations.find((o) => o.id === orgId);

  return (
    <>
      <PageHeader title={`Hi, ${me.user?.displayName?.split(" ")[0] ?? "there"}`} subtitle={org?.name}
        actions={<ButtonLink href="/organizer/events/new" icon={<CalendarPlus className="size-4" />}>New event</ButtonLink>} />
      {org?.status === "suspended" && <p className="card mb-4 border-error/30 p-4 text-sm text-error">This organization is suspended. Contact QRious support.</p>}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { icon: <CalendarDays className="size-4" />, label: "Total events", value: t?.events },
              { icon: <Radio className="size-4" />, label: "Live events", value: t?.activeEvents },
              { icon: <Users className="size-4" />, label: "Participants", value: t?.participants },
              { icon: <MessageCircle className="size-4" />, label: "Open to talk now", value: t ? (t.openToTalkNow ?? "<5") : undefined },
            ].map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
                <div className="flex items-center gap-2 text-sm text-text-2">{s.icon}{s.label}</div>
                <p className="mt-2 font-display text-3xl font-bold">{s.value ?? <Skeleton className="h-8 w-12" />}</p>
              </motion.div>
            ))}
          </div>
          <h2 className="mt-8 mb-3 font-display text-lg font-semibold">Recent events</h2>
          {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.recentEvents.length ? (
            <div className="card"><EmptyState icon={<QrCode className="size-7" />} title="Create your first event" action={<ButtonLink href="/organizer/events/new" icon={<CalendarPlus className="size-4" />}>New event</ButtonLink>}>
              Publish it and you&apos;ll get a QR code to print or share. Attendees scan it to start networking.</EmptyState></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {q.data.recentEvents.map((e) => (
                <Link key={e.id} href={`/organizer/events/${e.id}`} className="card overflow-hidden p-0 transition hover:border-accent/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <div className="h-24 bg-card-2">{e.bannerUrl && <img src={e.bannerUrl} alt="" className="size-full object-cover" />}</div>
                  <div className="p-4">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="mt-1 text-sm text-text-2">{formatEventDate(e.startsAt, e.endsAt, e.timeZone)}</p>
                    <div className="mt-2 flex items-center justify-between text-xs"><span className={EVENT_STATUS[e.status]?.className}>{EVENT_STATUS[e.status]?.label ?? e.status}</span><span className="text-text-2">{e.participantCount} joined</span></div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
