"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/Misc";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageHeader } from "@/components/ui/Overlay";
import { useConversations } from "@/lib/queries";
import { relativeTime, cn } from "@/lib/format";

/** Conversation list (M10): last message preview, timestamps, unread counts, origin event. */
export default function MessagesPage() {
  const q = useConversations();
  return (
    <AttendeePage title="Messages" className="max-w-3xl">
      <PageHeader title="Messages" subtitle="Private chats with your connections." />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-60" /> : !q.data?.length ? (
        <div className="card"><EmptyState icon={<MessageCircle className="size-7" />} title="No conversations yet" action={<ButtonLink href="/app/connections" variant="secondary">See connections</ButtonLink>}>
          Once someone accepts your connection request, you can chat here.</EmptyState></div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden p-0">
          {q.data.map((c) => (
            <li key={c.id}>
              <Link href={`/app/messages/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-white/[0.03]">
                <Avatar name={c.other.displayName} src={c.other.thumbnailUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("truncate", c.unreadCount ? "font-semibold" : "font-medium")}>{c.other.displayName}</p>
                    {c.lastMessageAt && <span className="shrink-0 text-xs text-text-2">{relativeTime(c.lastMessageAt)}</span>}
                  </div>
                  <p className={cn("truncate text-sm", c.unreadCount ? "text-text" : "text-text-2")}>
                    {c.lastMessage ? `${c.lastMessage.mine ? "You: " : ""}${c.lastMessage.body}` : "Say hello 👋"}
                  </p>
                  <p className="truncate text-xs text-text-2">{c.originEvent.name}{!c.canSend ? " · read-only" : ""}</p>
                </div>
                {c.unreadCount > 0 && <span className="grid min-w-6 place-items-center rounded-full bg-pink px-1.5 text-xs font-bold text-bg">{c.unreadCount}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AttendeePage>
  );
}
