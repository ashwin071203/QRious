"use client";

import Link from "next/link";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, CheckCheck, CreditCard, Handshake, MessageCircle, ShieldCheck } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/Misc";
import { Button } from "@/components/ui/Button";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { api } from "@/lib/api";
import { cn, relativeTime } from "@/lib/format";
import type { NotificationItem } from "@/lib/types";

const ICON: Record<string, React.ReactNode> = {
  connection_request: <Handshake className="size-4" />, connection_accepted: <Handshake className="size-4" />, message: <MessageCircle className="size-4" />,
  event_update: <CalendarDays className="size-4" />, system: <ShieldCheck className="size-4" />, billing: <CreditCard className="size-4" />,
};

function target(n: NotificationItem) {
  if (n.type === "connection_request") return "/app/connections";
  if (n.type === "connection_accepted") return "/app/connections";
  if (n.type === "message" && n.entityId) return `/app/messages/${n.entityId}`;
  if (n.type === "event_update" && n.eventId) return `/app/events/${n.eventId}/home`;
  if (n.type === "billing") return "/app/premium";
  return "/app/settings";
}

/** In-app notifications (M11). */
export default function NotificationsPage() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ["notifications"], initialPageParam: "", refetchInterval: 20_000,
    queryFn: ({ pageParam }) => api<{ items: NotificationItem[]; nextCursor: string | null }>(`/me/notifications${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  async function readAll() {
    await api("/me/notifications/read-all", { method: "POST" });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["unread"] });
  }
  async function read(n: NotificationItem) {
    if (n.readAt) return;
    await api(`/me/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["unread"] });
  }

  return (
    <AttendeePage title="Notifications" className="max-w-3xl">
      <PageHeader title="Notifications" actions={items.some((n) => !n.readAt) && <Button variant="secondary" size="sm" icon={<CheckCheck className="size-4" />} onClick={readAll}>Mark all read</Button>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-60" /> : !items.length ? (
        <div className="card"><EmptyState icon={<Bell className="size-7" />} title="You're all caught up">Connection requests, messages and event updates will show up here.</EmptyState></div>
      ) : (
        <>
          <ul className="card divide-y divide-line overflow-hidden p-0">
            {items.map((n) => (
              <li key={n.id}>
                <Link href={target(n)} onClick={() => read(n)} className={cn("flex gap-3 px-4 py-3.5 transition hover:bg-white/[0.03]", !n.readAt && "bg-primary/[0.06]")}>
                  {n.actor ? <Avatar name={n.actor.displayName ?? "?"} src={n.actor.thumbnailUrl} size={40} />
                    : <span className="grid size-10 shrink-0 place-items-center rounded-full bg-card-2 text-accent">{ICON[n.type]}</span>}
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.readAt && "font-medium")}>{n.payload.message ?? "Update"}</p>
                    {(n.payload.intro || n.payload.preview) && <p className="mt-0.5 line-clamp-2 text-sm text-text-2">{n.payload.intro ?? n.payload.preview}</p>}
                    <p className="mt-1 text-xs text-text-2">{relativeTime(n.createdAt)}{n.payload.eventName ? ` · ${n.payload.eventName}` : ""}</p>
                  </div>
                  {!n.readAt && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-pink" aria-label="Unread" />}
                </Link>
              </li>
            ))}
          </ul>
          {q.hasNextPage && <div className="mt-4 text-center"><Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Older</Button></div>}
        </>
      )}
    </AttendeePage>
  );
}
