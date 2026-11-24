"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell, BellOff, BellRing, Building2, CalendarDays, CheckCheck, CreditCard, Handshake, Megaphone, MessageCircle, QrCode, ShieldCheck, Smartphone, Sparkles,
  Trash2, TrendingUp, UserRound, Users, X,
} from "lucide-react";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/Misc";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Form";
import { ErrorState, Tabs } from "@/components/ui/Overlay";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { cn, relativeTime } from "@/lib/format";
import { disablePush, enablePush, pushSupport, refreshPush, registerServiceWorker, type PushSupport, type Role } from "@/lib/push";

export type NotificationRow = {
  id: string; type: string; category: string; title: string; body: string | null; link: string | null; createdAt: string; readAt: string | null;
  actor: { id: string; displayName: string | null; thumbnailUrl: string | null } | null;
};
const base = (role: Role) => (role === "attendee" ? "/me" : "/organizer");
export const notificationKeys = { list: (role: Role) => ["notifications", role] as const, orgUnread: ["org-unread"] as const };

const ICON: Record<string, React.ReactNode> = {
  messages: <MessageCircle className="size-4" />, groups: <Users className="size-4" />, connections: <Handshake className="size-4" />, events: <CalendarDays className="size-4" />,
  matches: <Sparkles className="size-4" />, billing: <CreditCard className="size-4" />, account: <UserRound className="size-4" />, security: <ShieldCheck className="size-4" />,
  announcements: <Megaphone className="size-4" />, org_participants: <Users className="size-4" />, org_events: <QrCode className="size-4" />, org_engagement: <TrendingUp className="size-4" />,
  org_billing: <CreditCard className="size-4" />, organization: <Building2 className="size-4" />,
};

/** Organizer unread count (attendees get theirs from /me/unread-counts with messages and requests). */
export const useOrgUnread = (enabled = true) =>
  useQuery({ queryKey: notificationKeys.orgUnread, enabled, queryFn: () => api<{ notifications: number }>("/organizer/notifications/unread"), refetchInterval: 20_000, refetchIntervalInBackground: false });

/**
 * Mounted once per signed-in area: registers the service worker, re-binds this device's push subscription to the current
 * session, and refreshes counts/lists the moment a push arrives (real-time without reloading).
 */
export function NotificationBridge({ role }: { role: Role }) {
  const qc = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    void registerServiceWorker().then(() => refreshPush(role));
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const t = (e.data as { type?: string; url?: string } | null)?.type;
      if (t === "qrious:notification") {
        void qc.invalidateQueries({ queryKey: ["notifications"] });
        void qc.invalidateQueries({ queryKey: role === "attendee" ? ["unread"] : notificationKeys.orgUnread });
        if (role === "attendee") void qc.invalidateQueries({ queryKey: ["conversations"] });
      } else if (t === "qrious:navigate" && e.data.url) router.push(e.data.url);
      else if (t === "qrious:resubscribe") void refreshPush(role);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [qc, role, router]);
  return null;
}

/** The notification centre: unread/all, open (marks read), clear, mark everything read. */
export function NotificationCenter({ role }: { role: Role }) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const q = useInfiniteQuery({
    queryKey: [...notificationKeys.list(role), filter],
    initialPageParam: "",
    queryFn: ({ pageParam }) => api<{ items: NotificationRow[]; nextCursor: string | null; unread: number }>(`${base(role)}/notifications?filter=${filter}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 20_000,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["notifications"] }), qc.invalidateQueries({ queryKey: role === "attendee" ? ["unread"] : notificationKeys.orgUnread })]);

  async function open(n: NotificationRow) {
    if (!n.readAt) await api(`${base(role)}/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
    void refresh();
    if (n.link) router.push(n.link);
  }
  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast("success", ok); } catch (e) { toast("error", e instanceof ApiError ? e.message : "Something went wrong."); }
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={filter} onChange={setFilter} items={[{ value: "all", label: "All" }, { value: "unread", label: unread ? `Unread (${unread})` : "Unread" }]} />
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" icon={<CheckCheck className="size-4" />} disabled={!unread} onClick={() => run(() => api(`${base(role)}/notifications/read-all`, { method: "POST" }), "All marked as read")}>Mark all read</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} disabled={!items.some((n) => n.readAt)} onClick={() => run(() => api(`${base(role)}/notifications`, { method: "DELETE" }), "Read notifications cleared")}>Clear read</Button>
        </div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-60" /> : !items.length ? (
        <div className="card"><EmptyState icon={<Bell className="size-7" />} title={filter === "unread" ? "You're all caught up" : "No notifications yet"}>
          {role === "attendee" ? "Messages, connection requests, event updates and more appear here." : "Registrations, event and QR activity, billing and team updates appear here."}</EmptyState></div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden p-0">
          {items.map((n) => (
            <li key={n.id} className={cn("group relative flex items-start gap-3 px-4 py-3.5 transition hover:bg-white/[0.03]", !n.readAt && "bg-primary/[0.06]")}>
              <button type="button" onClick={() => open(n)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-label={`${n.title}${n.readAt ? "" : " (unread)"}`}>
                {n.actor?.displayName ? <Avatar name={n.actor.displayName} src={n.actor.thumbnailUrl} size={40} />
                  : <span className="grid size-10 shrink-0 place-items-center rounded-full bg-card-2 text-accent-light">{ICON[n.category] ?? <Bell className="size-4" />}</span>}
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[15px]", !n.readAt ? "font-semibold text-text" : "text-text")}>{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-text-2">{n.body}</span>}
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-text-2"><span className="text-accent-light">{ICON[n.category]}</span>{relativeTime(n.createdAt)}</span>
                </span>
                {!n.readAt && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-pink" aria-hidden />}
              </button>
              <button type="button" aria-label="Clear notification" onClick={() => run(() => api(`${base(role)}/notifications/${n.id}`, { method: "DELETE" }), "Cleared")}
                className="rounded-lg p-1.5 text-text-2 opacity-60 hover:bg-white/5 hover:text-text hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><X className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && <div className="text-center"><Button variant="ghost" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>}
    </div>
  );
}

type Settings = { push: { available: boolean; devices: number }; categories: { key: string; label: string; description: string; locked: boolean; inApp: boolean; push: boolean }[] };

/** Per-category in-app/push choices and this device's push permission. */
export function NotificationSettingsPanel({ role }: { role: Role }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["notification-settings", role], queryFn: () => api<Settings>(`${base(role)}/notification-settings`) });
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushSupport().then(setSupport); }, []);

  async function save(key: string, patch: { inApp?: boolean; push?: boolean }) {
    const c = q.data?.categories.find((x) => x.key === key);
    if (!c) return;
    try { await api(`${base(role)}/notification-settings`, { method: "PUT", body: { categories: [{ key, inApp: patch.inApp ?? c.inApp, push: patch.push ?? c.push }] } }); await q.refetch(); }
    catch (e) { toast("error", e instanceof ApiError ? e.message : "Couldn't save."); }
  }
  async function toggleDevice(on: boolean) {
    setBusy(true);
    try {
      if (on) { await enablePush(role); toast("success", "Push notifications are on for this device"); }
      else { await disablePush(role); toast("success", "Push notifications are off for this device"); }
    } catch (e) { toast("error", e instanceof Error ? e.message : "Couldn't change push notifications."); }
    finally { setSupport(await pushSupport()); await q.refetch(); setBusy(false); }
  }

  if (!q.data) return <Skeleton className="h-64" />;
  const s = support?.state;
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-bg-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 text-accent-light">{s === "enabled" ? <BellRing className="size-5" /> : s === "denied" ? <BellOff className="size-5" /> : <Smartphone className="size-5" />}</span>
            <div className="min-w-0">
              <p className="font-medium">Push notifications on this device</p>
              <p className="text-sm text-text-2">
                {!q.data.push.available ? "Push notifications aren't available yet."
                  : s === "enabled" ? "On — you'll be notified even when QRious isn't open."
                  : s === "denied" ? "Blocked in your browser settings. Allow notifications for this site, then try again."
                  : s === "ios_install" ? "On iPhone and iPad: tap Share → Add to Home Screen, open QRious from there, then turn this on (iOS 16.4 or later)."
                  : s === "unsupported" ? "This browser doesn't support push notifications. You'll still see everything in the app."
                  : "Off. Turn on to get notified when QRious isn't open."}
              </p>
            </div>
          </div>
          {q.data.push.available && (s === "available" || s === "enabled") && (
            <Button size="sm" variant={s === "enabled" ? "secondary" : "primary"} loading={busy} onClick={() => toggleDevice(s !== "enabled")}>{s === "enabled" ? "Turn off" : "Turn on"}</Button>
          )}
        </div>
        {q.data.push.devices > 0 && <p className="mt-2 text-xs text-text-2">{q.data.push.devices} device{q.data.push.devices === 1 ? "" : "s"} registered for push.</p>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-line bg-bg-2/60 px-4 py-2 text-xs font-medium tracking-wide text-text-2 uppercase">
          <span>Category</span><span className="w-12 text-center">In app</span><span className="w-12 text-center">Push</span>
        </div>
        <ul className="divide-y divide-line">
          {q.data.categories.map((c) => (
            <li key={c.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-3">
              <div className="min-w-0"><p className="flex items-center gap-2 text-sm font-medium"><span className="text-accent-light">{ICON[c.key]}</span>{c.label}</p><p className="text-xs text-text-2">{c.description}</p></div>
              <div className="flex w-12 justify-center"><Toggle checked={c.inApp} disabled={c.locked} onChange={(v) => save(c.key, { inApp: v, push: v ? c.push : false })} label={`${c.label} in app`} hideLabel /></div>
              <div className="flex w-12 justify-center"><Toggle checked={c.push && c.inApp} disabled={!c.inApp} onChange={(v) => save(c.key, { push: v })} label={`${c.label} push`} hideLabel /></div>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-text-2">Notifications never include anything from people you&apos;ve blocked. Push is sent once per device and replaced, not repeated, when there&apos;s more of the same.</p>
    </div>
  );
}
