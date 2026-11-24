"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, Users } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/Misc";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { CreateGroupDialog, GroupAvatar } from "@/components/messaging/GroupDialogs";
import { useConversations } from "@/lib/queries";
import { relativeTime, cn, presenceLabel } from "@/lib/format";
import type { ConversationItem } from "@/lib/types";

const preview = (c: ConversationItem) => {
  const m = c.lastMessage;
  if (!m) return c.kind === "group" ? "Group created" : "Say hello 👋";
  if (m.system) return m.body;
  return `${m.mine ? "You: " : c.kind === "group" && m.senderName ? `${m.senderName.split(" ")[0]}: ` : ""}${m.body}`;
};

/** Conversations (M10): direct chats and groups, last message, activity status, unread counts. Refreshes every few seconds. */
export default function MessagesPage() {
  const q = useConversations();
  const [creating, setCreating] = useState(false);
  return (
    <AttendeePage title="Messages" className="max-w-3xl">
      <PageHeader title="Messages" subtitle="Private chats and groups with your connections."
        actions={<Button variant="secondary" size="sm" icon={<Users className="size-4" />} onClick={() => setCreating(true)}>New group</Button>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-60" /> : !q.data?.length ? (
        <div className="card"><EmptyState icon={<MessageCircle className="size-7" />} title="No conversations yet" action={<ButtonLink href="/app/connections" variant="secondary">See connections</ButtonLink>}>
          Once someone accepts your connection request, you can chat here.</EmptyState></div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden p-0">
          {q.data.map((c) => {
            const title = c.kind === "group" ? c.group!.name : c.other!.displayName;
            const status = c.kind === "direct" ? presenceLabel(c.presence) : null;
            return (
              <li key={c.id}>
                <Link href={`/app/messages/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-white/[0.03]"
                  aria-label={`${title}${c.unreadCount ? `, ${c.unreadCount} unread` : ""}`}>
                  <span className="relative shrink-0">
                    {c.kind === "group" ? <GroupAvatar name={title} photoUrl={c.group!.photoUrl} size={48} /> : <Avatar name={title} src={c.other!.thumbnailUrl} size={48} />}
                    {c.presence?.active && <span className="absolute right-0.5 bottom-0.5 size-3 rounded-full bg-success ring-2 ring-card" aria-label="Active now" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={cn("truncate", c.unreadCount ? "font-semibold" : "font-medium")}>{title}</p>
                      {c.lastMessageAt && <span className={cn("shrink-0 text-xs", c.unreadCount ? "text-pink" : "text-text-2")}>{relativeTime(c.lastMessageAt)}</span>}
                    </div>
                    <p className={cn("truncate text-sm", c.unreadCount ? "text-text" : "text-text-2", c.lastMessage?.system && "italic")}>{preview(c)}</p>
                    <p className="truncate text-xs text-text-2">
                      {c.kind === "group" ? `Group · ${c.group!.memberCount} members`
                        : <>{status && <span className={c.presence?.active ? "text-success" : undefined}>{status} · </span>}{c.originEvent?.name}{!c.canSend ? " · read-only" : ""}</>}
                    </p>
                  </div>
                  {c.unreadCount > 0 && <span className="grid min-w-6 place-items-center rounded-full bg-pink px-1.5 text-xs font-bold text-bg" aria-hidden>{c.unreadCount > 99 ? "99+" : c.unreadCount}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <CreateGroupDialog open={creating} onClose={() => setCreating(false)} />
    </AttendeePage>
  );
}
