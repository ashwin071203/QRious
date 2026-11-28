"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, Handshake, MessageCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { AttendeePage } from "@/components/AppShell";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/Misc";
import { Button } from "@/components/ui/Button";
import { ErrorState, PageHeader, Tabs } from "@/components/ui/Overlay";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useUnread } from "@/lib/queries";
import type { ConnectionItem } from "@/lib/types";

type Kind = "accepted" | "received" | "sent";

/** Connections (M09): accepted connections, received and sent requests. */
export default function ConnectionsPage() {
  const [kind, setKind] = useState<Kind>("accepted");
  const { data: unread } = useUnread();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["connections", kind], queryFn: () => api<ConnectionItem[]>(`/me/connections?kind=${kind}`), refetchInterval: 20_000 });

  async function act(id: string, action: "accept" | "decline" | "withdraw" | "remove") {
    setBusy(id + action);
    try {
      const r = await api<{ conversationId?: string | null }>(action === "remove" ? `/connections/${id}` : `/connections/${id}/${action}`, { method: action === "remove" ? "DELETE" : "POST" });
      toast("success", { accept: "You're connected!", decline: "Request declined", withdraw: "Request withdrawn", remove: "Connection removed" }[action]);
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["unread"] });
      if (action === "accept" && r?.conversationId) router.push(`/app/messages/${r.conversationId}`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function message(profileId: string, eventId: string) {
    try {
      const r = await api<{ id: string }>("/conversations", { method: "POST", body: { profileId, eventId } });
      router.push(`/app/messages/${r.id}`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't open the conversation.");
    }
  }

  return (
    <AttendeePage title="Connections" className="max-w-5xl">
      <PageHeader title="Connections" subtitle="One connection per person, across every event." />
      <Tabs value={kind} onChange={setKind} items={[
        { value: "accepted", label: "Connections" },
        { value: "received", label: <>Received{unread?.requests ? <span className="ml-1.5 rounded-full bg-pink px-1.5 text-[10px] font-bold text-bg">{unread.requests}</span> : null}</> },
        { value: "sent", label: "Sent" },
      ]} />
      <div className="mt-5">
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? (
          <div className="card"><EmptyState icon={<Handshake className="size-7" />} title={kind === "accepted" ? "No connections yet" : kind === "received" ? "No pending requests" : "No sent requests"}>
            {kind === "accepted" ? "Find people in Discover or Smart Matches and send a request." : kind === "received" ? "Requests people send you will appear here." : "Requests you send will appear here until answered."}</EmptyState></div>
        ) : (
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {q.data.map((c) => (
                <motion.li key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className="card p-4">
                  <div className="flex items-center gap-3">
                    <Link href={kind === "accepted" ? `/app/people/${c.profile.id}` : `/app/events/${c.originEvent.id}/people/${c.profile.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar name={c.profile.displayName} src={c.profile.photo?.thumbnailUrl} size={48} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.profile.displayName}</p>
                        <p className="truncate text-sm text-text-2">@{c.profile.username}{c.profile.profession ? ` · ${c.profile.profession}` : ""}</p>
                        <p className="truncate text-xs text-text-2">Met at {c.originEvent.name} · {relativeTime(c.respondedAt ?? c.requestedAt)}</p>
                      </div>
                    </Link>
                    <div className="flex shrink-0 gap-2">
                      {kind === "received" && <>
                        <Button size="sm" icon={<Check className="size-4" />} loading={busy === c.id + "accept"} onClick={() => act(c.id, "accept")}>Accept</Button>
                        <Button size="sm" variant="ghost" aria-label="Decline" loading={busy === c.id + "decline"} onClick={() => act(c.id, "decline")}><X className="size-4" /></Button>
                      </>}
                      {kind === "sent" && <Button size="sm" variant="secondary" loading={busy === c.id + "withdraw"} onClick={() => act(c.id, "withdraw")}>Withdraw</Button>}
                      {kind === "accepted" && <Button size="sm" variant="secondary" icon={<MessageCircle className="size-4" />} onClick={() => message(c.profile.id, c.originEvent.id)}>Message</Button>}
                    </div>
                  </div>
                  {c.introMessage && <p className="mt-3 rounded-xl bg-bg-2 px-3 py-2 text-sm text-text-2">&ldquo;{c.introMessage}&rdquo;</p>}
                  {kind === "accepted" && <button className="mt-2 text-xs text-text-2 hover:text-error" onClick={() => act(c.id, "remove")}>Remove connection</button>}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </AttendeePage>
  );
}
