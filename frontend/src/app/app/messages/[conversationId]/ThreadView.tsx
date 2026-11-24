"use client";

import { use, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, CheckCheck, Flag, Info, Loader2, SendHorizontal } from "lucide-react";
import { Avatar, Logo } from "@/components/ui/Misc";
import { ReportDialog } from "@/components/People";
import { GroupAvatar, GroupInfoDialog } from "@/components/messaging/GroupDialogs";
import { useToast } from "@/components/Providers";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import type { ChatMessage, Thread } from "@/lib/types";
import { cn, presenceLabel } from "@/lib/format";

const POLL_MS = 3000;

/** Direct chats and groups (M10). Near-real-time via short polling (D-29); idempotent sends; read receipts; typing; activity status. */
export function ThreadView({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  const qc = useQueryClient();
  const toast = useToast();
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const lastRead = useRef(0);
  const stickToBottom = useRef(true);

  const lastId = messages.filter((m) => !m.pending).at(-1)?.id ?? 0;
  const isGroup = thread?.conversation.kind === "group";

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((cur) => {
      const byClient = new Map(cur.map((m) => [m.clientMessageId, m]));
      for (const m of incoming) byClient.set(m.clientMessageId, m);
      return [...byClient.values()].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || a.id - b.id);
    });
  }, []);

  const load = useCallback(async () => {
    const t = await api<Thread>(`/conversations/${conversationId}/messages`);
    setThread(t);
    merge(t.messages);
    setHasMore(t.hasMore);
  }, [conversationId, merge]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    api<Thread>(`/conversations/${conversationId}/messages`).then((t) => {
      if (cancelled) return;
      setThread(t);
      setMessages(t.messages);
      setHasMore(t.hasMore);
    }).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this conversation."));
    return () => { cancelled = true; };
  }, [conversationId]);

  // Poll for new messages, read receipts, typing, activity and group changes while visible
  useEffect(() => {
    if (!thread) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const t = await api<Thread>(`/conversations/${conversationId}/messages?after=${lastId}`);
        setThread((prev) => (prev ? { ...prev, canSend: t.canSend, otherTyping: t.otherTyping, typingNames: t.typingNames, otherLastReadMessageId: t.otherLastReadMessageId,
          presence: t.presence, group: t.group } : t));
        if (t.messages.length) merge(t.messages);
      } catch (e) {
        // Removed from the group (or blocked): the conversation is gone for this person.
        if (e instanceof ApiError && e.status === 404) setError("You're no longer part of this conversation.");
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [thread, conversationId, lastId, merge]);

  // Mark read when new messages arrive while visible, and when the person comes back to the tab.
  const markNewest = useCallback(() => {
    const newestTheirs = messages.filter((m) => !m.mine && !m.pending).at(-1)?.id ?? 0;
    if (newestTheirs > lastRead.current && document.visibilityState === "visible") {
      lastRead.current = newestTheirs;
      api(`/conversations/${conversationId}/read`, { method: "POST", body: { lastReadMessageId: newestTheirs } })
        .then(() => { qc.invalidateQueries({ queryKey: ["unread"] }); qc.invalidateQueries({ queryKey: ["conversations"] }); }).catch(() => {});
    }
  }, [messages, conversationId, qc]);
  useEffect(() => { markNewest(); }, [markNewest]);
  useEffect(() => {
    const onVis = () => markNewest();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [markNewest]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, thread?.otherTyping]);

  async function loadOlder() {
    const first = messages.find((m) => !m.pending)?.id;
    if (!first) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const t = await api<Thread>(`/conversations/${conversationId}/messages?before=${first}`);
      stickToBottom.current = false;
      merge(t.messages);
      setHasMore(t.messages.length === 50);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(retry?: ChatMessage) {
    const body = retry?.body ?? text.trim();
    if (!body) return;
    const clientMessageId = retry?.clientMessageId ?? newIdempotencyKey();
    if (!retry) setText("");
    stickToBottom.current = true;
    merge([{ id: Number.MAX_SAFE_INTEGER, mine: true, body, removed: false, createdAt: new Date().toISOString(), clientMessageId, pending: true }]);
    try {
      const m = await api<ChatMessage>(`/conversations/${conversationId}/messages`, { method: "POST", body: { body, clientMessageId } });
      merge([m]);
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setMessages((cur) => cur.map((m) => (m.clientMessageId === clientMessageId ? { ...m, body, failed: true } as ChatMessage : m)));
      toast("error", e instanceof ApiError ? e.message : "Message not sent. Tap it to retry.");
    }
  }

  function onType(v: string) {
    setText(v);
    const now = Date.now();
    if (v && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      api(`/conversations/${conversationId}/typing`, { method: "POST" }).catch(() => {});
    }
  }

  if (error) {
    return (
      <main className="ambient grid min-h-dvh place-items-center px-5 text-center">
        <div><p className="text-text-2">{error}</p><Link href="/app/messages" className="mt-4 inline-block text-accent-light">Back to messages</Link></div>
      </main>
    );
  }

  const fmt = (iso: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const status = thread && !isGroup ? presenceLabel(thread.presence) : null;
  const typingText = isGroup && thread?.typingNames.length ? `${thread.typingNames.join(", ")} ${thread.typingNames.length > 1 ? "are" : "is"} typing…` : "typing…";

  return (
    <main className="ambient flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-bg/85 px-3 py-2.5 pt-[max(env(safe-area-inset-top),0.625rem)] backdrop-blur-xl">
        <Link href="/app/messages" className="rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text" aria-label="Back"><ArrowLeft className="size-5" /></Link>
        {thread && isGroup && thread.group ? (
          <button type="button" onClick={() => setInfoOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Group info">
            <GroupAvatar name={thread.group.name} photoUrl={thread.group.photoUrl} size={40} />
            <div className="min-w-0">
              <p className="truncate font-medium">{thread.group.name}</p>
              <p className="truncate text-xs text-text-2">{thread.otherTyping ? <span className="text-accent-light">{typingText}</span>
                : thread.group.members.filter((m) => !m.isMe).map((m) => m.displayName.split(" ")[0]).slice(0, 4).join(", ") + (thread.group.memberCount > 5 ? "…" : "") || `${thread.group.memberCount} members`}</p>
            </div>
          </button>
        ) : thread?.other ? (
          <Link href={`/app/people/${thread.other.profileId}`} className="flex min-w-0 flex-1 items-center gap-3">
            <span className="relative">
              <Avatar name={thread.other.displayName} src={thread.other.thumbnailUrl} size={40} />
              {thread.presence?.active && <span className="absolute right-0 bottom-0 size-3 rounded-full bg-success ring-2 ring-bg" aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{thread.other.displayName}</p>
              <p className="truncate text-xs text-text-2">{thread.otherTyping ? <span className="text-accent-light">typing…</span>
                : status ? <span className={thread.presence?.active ? "text-success" : undefined}>{status}</span> : `Met at ${thread.conversation.originEvent?.name ?? "an event"}`}</p>
            </div>
          </Link>
        ) : <div className="flex-1"><Logo className="text-base" /></div>}
        {thread && (isGroup
          ? <button onClick={() => setInfoOpen(true)} className="rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text" aria-label="Group info"><Info className="size-5" /></button>
          : <button onClick={() => setReportOpen(true)} className="rounded-xl p-2 text-text-2 hover:bg-white/5 hover:text-text" aria-label="Report"><Flag className="size-4" /></button>)}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-3 py-4" aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <div className="mx-auto max-w-2xl space-y-1.5">
          {!thread && <div className="grid place-items-center py-20 text-text-2"><Loader2 className="size-6 animate-spin" /></div>}
          {hasMore && <div className="pb-2 text-center"><button onClick={loadOlder} className="text-sm text-accent-light" disabled={loadingOlder}>{loadingOlder ? "Loading…" : "Load earlier messages"}</button></div>}
          {thread && messages.length === 0 && <p className="py-16 text-center text-sm text-text-2">You&apos;re connected! Say hello 👋</p>}
          <AnimatePresence initial={false}>
            {messages.map((m, i) => {
              if (m.kind === "system") {
                return (
                  <motion.div key={m.clientMessageId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center py-1.5">
                    <p className="rounded-full bg-white/[0.06] px-3 py-1 text-center text-xs text-text-2">{m.body} · {fmt(m.createdAt)}</p>
                  </motion.div>
                );
              }
              const failed = (m as ChatMessage & { failed?: boolean }).failed;
              const read = m.mine && !m.pending && thread && m.id <= thread.otherLastReadMessageId;
              const prev = messages[i - 1];
              const showSender = isGroup && !m.mine && m.sender && (prev?.kind === "system" || prev?.sender?.profileId !== m.sender.profileId);
              return (
                <motion.div key={m.clientMessageId} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={cn("flex items-end gap-2", m.mine ? "justify-end" : "justify-start", showSender && "pt-2")}>
                  {isGroup && !m.mine && (showSender ? <Avatar name={m.sender!.displayName} src={m.sender!.thumbnailUrl} size={28} /> : <span className="w-7 shrink-0" />)}
                  <div className={cn("flex max-w-[80%] flex-col", m.mine ? "items-end" : "items-start")}>
                    {showSender && <p className="mb-0.5 px-1 text-xs font-medium text-accent-light">{m.sender!.displayName}</p>}
                    <Bubble failed={!!failed} onRetry={() => send(m)}
                      className={cn("rounded-2xl px-3.5 py-2 text-left text-[15px] whitespace-pre-wrap break-words",
                        m.mine ? "rounded-br-md bg-grad-primary text-white" : "rounded-bl-md bg-card-2", m.removed && "italic opacity-60", failed && "ring-2 ring-error")}>
                      {m.body}
                      <span className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", m.mine ? "text-white/70" : "text-text-2")}>
                        {failed ? "Not sent · tap to retry" : m.pending ? "Sending…" : fmt(m.createdAt)}
                        {m.mine && !m.pending && !failed && (read ? <CheckCheck className="size-3" aria-label={isGroup ? "Read by everyone" : "Read"} /> : <Check className="size-3" aria-label="Sent" />)}
                      </span>
                    </Bubble>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {thread?.otherTyping && (
            <div className="flex"><div className="flex gap-1 rounded-2xl rounded-bl-md bg-card-2 px-4 py-3" aria-label={typingText}>
              {[0, 1, 2].map((i) => <motion.span key={i} className="size-1.5 rounded-full bg-text-2" animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />)}
            </div></div>
          )}
        </div>
      </div>

      <footer className="border-t border-line bg-bg/85 px-3 py-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] backdrop-blur-xl">
        {thread && !thread.canSend ? (
          <p className="py-2 text-center text-sm text-text-2">You can&apos;t send messages in this conversation anymore.</p>
        ) : (
          <form className="mx-auto flex max-w-2xl items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <textarea value={text} onChange={(e) => onType(e.target.value)} rows={1} maxLength={4000} placeholder={isGroup ? `Message ${thread?.group?.name ?? "the group"}` : "Message"} aria-label="Message"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
              className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-line-strong bg-bg-2 px-4 py-2.5 text-[15px] focus:border-accent focus:outline-none" />
            <button type="submit" disabled={!text.trim() || !thread} aria-label="Send"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-grad-primary text-white transition disabled:opacity-40"><SendHorizontal className="size-5" /></button>
          </form>
        )}
      </footer>
      {thread?.other && <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} profileId={thread.other.profileId} name={thread.other.displayName}
        messageId={messages.filter((m) => !m.mine && !m.pending).at(-1)?.id} />}
      {thread && isGroup && thread.group && <GroupInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} groupId={conversationId} thread={thread}
        onChanged={() => { void load(); qc.invalidateQueries({ queryKey: ["conversations"] }); }} />}
    </main>
  );
}

/** Message bubble: a plain element, or a retry button only when sending failed (accessible semantics). */
function Bubble({ failed, onRetry, className, children }: { failed: boolean; onRetry: () => void; className: string; children: React.ReactNode }) {
  return failed ? <button type="button" onClick={onRetry} className={className}>{children}</button> : <div className={className}>{children}</div>;
}
