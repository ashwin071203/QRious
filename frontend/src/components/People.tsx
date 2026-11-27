"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { BadgeCheck, Bookmark, BookmarkCheck, Briefcase, Building2, Check, Clock, Flag, Handshake, Link2, MapPin, MessageCircle, ShieldBan, Sparkles, UserCheck, UserPlus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PersonCard } from "@/lib/types";
import { availabilityLabel, cn } from "@/lib/format";
import { Avatar, Chip } from "@/components/ui/Misc";
import { Button } from "@/components/ui/Button";
import { Modal, ConfirmDialog } from "@/components/ui/Overlay";
import { Field, Select, TextArea } from "@/components/ui/Form";
import { useToast } from "@/components/Providers";
import { PLATFORMS } from "@/components/SocialLinksEditor";

export const AVAILABILITY_OPTIONS = [
  { value: "available_now", label: "Available now", tone: "bg-success" },
  { value: "open_to_conversations", label: "Open to conversations", tone: "bg-success" },
  { value: "meet_new_people", label: "Looking to meet new people", tone: "bg-accent" },
  { value: "looking_for_collaborators", label: "Looking for collaborators", tone: "bg-pink" },
  { value: "quick_conversations", label: "Up for quick conversations", tone: "bg-accent-light" },
  { value: "temporarily_unavailable", label: "Temporarily unavailable", tone: "bg-warning" },
  { value: "discovery_paused", label: "Discovery paused", tone: "bg-text-2" },
] as const;

export function AvailabilityPill({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null;
  const o = AVAILABILITY_OPTIONS.find((x) => x.value === status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-bg-2 px-2.5 py-1 text-xs font-medium", className)}>
      <span className={cn("size-2 rounded-full", o?.tone ?? "bg-text-2")} />{availabilityLabel[status] ?? status}
    </span>
  );
}

/** Photo-based profile card with shared-interest and complementary-skill highlights (PRD §9.6). */
/** Premium highlight badge (PRD §19.2) — shown only where the event allows Premium highlighting. */
export function PremiumBadge() {
  return <BadgeCheck className="size-[1.1em] shrink-0 text-pink" aria-label="Premium member"><title>Premium member</title></BadgeCheck>;
}

export function PersonCardView({ person, href, index = 0 }: { person: PersonCard; href: string; index?: number }) {
  return (
    <motion.div className="min-w-0" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.03 }}>
      <Link href={href} className="card group flex h-full min-w-0 flex-col overflow-hidden p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40">
        <div className="flex items-start gap-3">
          <Avatar name={person.displayName} src={person.photo?.thumbnailUrl} size={56} />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1.5 font-display font-semibold"><span className="min-w-0 truncate">{person.displayName}</span>{person.premium && <PremiumBadge />}</p>
            <p className="truncate text-sm text-text-2">@{person.username}</p>
            {person.profession && <p className="mt-0.5 truncate text-sm text-text-2">{person.profession}</p>}
          </div>
          {person.connectionState === "connected" && <UserCheck className="size-5 shrink-0 text-success" aria-label="Connected" />}
          {person.saved && <BookmarkCheck className="size-5 shrink-0 text-accent" aria-label="Saved" />}
        </div>
        {person.availability && <AvailabilityPill status={person.availability} className="mt-3 self-start" />}
        {person.bio && <p className="mt-3 line-clamp-2 text-sm break-words text-text-2">{person.bio}</p>}
        {(person.commonInterests?.length || person.complementarySkills?.length) ? (
          <div className="mt-3 space-y-1 text-xs">
            {!!person.complementarySkills?.length && <p className="flex items-start gap-1.5 text-pink"><Sparkles className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 break-words">Has what you&apos;re looking for: {person.complementarySkills.slice(0, 2).join(", ")}</span></p>}
            {!!person.commonInterests?.length && <p className="flex items-center gap-1.5 text-accent-light"><Handshake className="size-3.5 shrink-0" />{person.commonInterests.length} shared interest{person.commonInterests.length > 1 ? "s" : ""}</p>}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {person.skills.slice(0, 4).map((s) => <span key={s.id} className="max-w-full truncate rounded-full bg-bg-2 px-2 py-0.5 text-xs text-text-2">{s.name}</span>)}
        </div>
      </Link>
    </motion.div>
  );
}

export function ProfileDetail({ person, actions }: { person: PersonCard; actions?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden p-0">
        <div className="h-24 bg-[radial-gradient(120%_120%_at_0%_0%,#8b5cf6_0%,#2a1e42_55%,#19112b_100%)]" />
        <div className="-mt-12 px-5 pb-5">
          <Avatar name={person.displayName} src={person.photo?.url} size={96} className="ring-4 ring-card" />
          <h1 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold">{person.displayName}{person.premium && <PremiumBadge />}</h1>
          <p className="text-text-2">@{person.username}</p>
          {person.availability && <AvailabilityPill status={person.availability} className="mt-2" />}
          {person.bio && <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-line">{person.bio}</p>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-text-2">
            {person.profession && <span className="inline-flex items-center gap-1.5"><Briefcase className="size-4" />{person.profession}</span>}
            {person.company && <span className="inline-flex items-center gap-1.5"><Building2 className="size-4" />{person.company}</span>}
            {person.location && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{person.location}</span>}
          </div>
          {actions && <div className="mt-5">{actions}</div>}
        </div>
      </section>
      {(person.complementarySkills?.length || person.commonInterests?.length) ? (
        <section className="card space-y-2 p-5 text-sm">
          {!!person.complementarySkills?.length && <p className="flex gap-2 text-pink"><Sparkles className="size-4 shrink-0" />Has skills you&apos;re looking for: {person.complementarySkills.join(", ")}</p>}
          {!!person.commonInterests?.length && <p className="flex gap-2 text-accent-light"><Handshake className="size-4 shrink-0" />You both like {person.commonInterests.join(", ")}</p>}
        </section>
      ) : null}
      <section className="card p-5">
        <h2 className="font-medium">Interests</h2>
        <div className="mt-3 flex flex-wrap gap-2">{person.interests.map((t) => <Chip key={t.id} selected={person.commonInterests?.includes(t.name)}>{t.name}</Chip>)}</div>
        <h2 className="mt-5 font-medium">Skills</h2>
        <div className="mt-3 flex flex-wrap gap-2">{person.skills.map((t) => <Chip key={t.id}>{t.name}</Chip>)}</div>
      </section>
      {(person.lookingForText || person.lookingForSkills?.length || person.canOfferText) && (
        <section className="card grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <h2 className="font-medium">Looking for</h2>
            {person.lookingForText && <p className="mt-2 text-sm text-text-2">{person.lookingForText}</p>}
            {!!person.lookingForSkills?.length && <div className="mt-2 flex flex-wrap gap-1.5">{person.lookingForSkills.map((t) => <Chip key={t.id}>{t.name}</Chip>)}</div>}
          </div>
          {person.canOfferText && <div><h2 className="font-medium">Can offer</h2><p className="mt-2 text-sm text-text-2">{person.canOfferText}</p></div>}
        </section>
      )}
      {person.socialLinks.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-medium"><Link2 className="size-4 text-accent" />Links</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {person.socialLinks.map((l) => (
              <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-accent-light hover:underline">
                <span className="text-text-2">{PLATFORMS.find((p) => p.value === l.platform)?.label ?? l.platform}: </span>{l.url.replace(/^https:\/\//, "")}
              </a></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const REASONS = [
  { value: "spam", label: "Spam or scam" }, { value: "harassment", label: "Harassment or bullying" }, { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "fake_profile", label: "Fake profile / impersonation" }, { value: "underage", label: "May be underage" }, { value: "other", label: "Something else" },
];

export function ReportDialog({ open, onClose, profileId, eventId, messageId, name }: { open: boolean; onClose: () => void; profileId: string; eventId?: string; messageId?: number; name: string }) {
  const toast = useToast();
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api("/reports", { method: "POST", body: { profileId, eventId, messageId, reason, details: details.trim() || undefined } });
      toast("success", "Thanks — our moderators will review this.");
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't send the report.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Report ${name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Send report</Button></>}>
      <div className="space-y-4">
        <Field label="Reason" htmlFor="reason"><Select id="reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
        <Field label="Details" optional htmlFor="details" counter={{ value: details.length, max: 1000 }}><TextArea id="details" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
        <p className="text-xs text-text-2">Reports are confidential. {messageId ? "The reported message will be attached so moderators can review it." : ""}</p>
      </div>
    </Modal>
  );
}

/** Connect / accept / message / save / block / report — every action re-checked by the API. */
export function PersonActions({ person, eventId, canConnect, canMessage, onChanged }: { person: PersonCard; eventId: string; canConnect: boolean; canMessage: boolean; onChanged: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [introOpen, setIntroOpen] = useState(false);
  const [intro, setIntro] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const state = person.connectionState ?? "none";

  async function run(name: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(name);
    try {
      await fn();
      if (ok) toast("success", ok);
      onChanged();
      qc.invalidateQueries({ queryKey: ["unread"] });
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  if (state === "self") return <Link href="/app/profile" className="text-sm text-accent-light">This is you — edit your profile</Link>;

  return (
    <div className="flex flex-wrap gap-2">
      {state === "none" && (
        <Button icon={<UserPlus className="size-4" />} disabled={!canConnect} onClick={() => setIntroOpen(true)} title={canConnect ? undefined : "Connection requests aren't open for this event"}>Connect</Button>
      )}
      {state === "pending_outgoing" && <Button variant="secondary" icon={<Clock className="size-4" />} loading={busy === "withdraw"} onClick={() => run("withdraw", () => api(`/connections/${person.connectionId}/withdraw`, { method: "POST" }), "Request withdrawn")}>Requested · Withdraw</Button>}
      {state === "pending_incoming" && <>
        <Button icon={<Check className="size-4" />} loading={busy === "accept"} onClick={() => run("accept", () => api(`/connections/${person.connectionId}/accept`, { method: "POST" }), "You're connected!")}>Accept</Button>
        <Button variant="secondary" loading={busy === "decline"} onClick={() => run("decline", () => api(`/connections/${person.connectionId}/decline`, { method: "POST" }))}>Decline</Button>
      </>}
      {state === "connected" && (
        <Button icon={<MessageCircle className="size-4" />} disabled={!canMessage && false} loading={busy === "msg"} onClick={() => run("msg", async () => {
          const r = await api<{ id: string }>("/conversations", { method: "POST", body: { profileId: person.id, eventId } });
          router.push(`/app/messages/${r.id}`);
        })}>Message</Button>
      )}
      <Button variant="secondary" icon={person.saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />} loading={busy === "save"}
        onClick={() => run("save", () => api(`/me/saved-profiles/${person.id}`, { method: person.saved ? "DELETE" : "PUT", body: person.saved ? undefined : { eventId } }), person.saved ? "Removed from saved" : "Saved")}>
        {person.saved ? "Saved" : "Save"}
      </Button>
      <Button variant="ghost" icon={<Flag className="size-4" />} onClick={() => setReportOpen(true)}>Report</Button>
      <Button variant="ghost" icon={<ShieldBan className="size-4" />} onClick={() => setBlockOpen(true)}>Block</Button>

      <Modal open={introOpen} onClose={() => setIntroOpen(false)} title={`Connect with ${person.displayName}`}
        footer={<><Button variant="ghost" onClick={() => setIntroOpen(false)}>Cancel</Button>
          <Button loading={busy === "connect"} onClick={() => run("connect", async () => { await api(`/events/${eventId}/connections`, { method: "POST", body: { profileId: person.id, introMessage: intro.trim() || undefined } }); setIntroOpen(false); setIntro(""); }, "Request sent")}>Send request</Button></>}>
        <Field label="Add a note" optional htmlFor="intro" hint="A short hello helps — e.g. what you'd like to chat about." counter={{ value: intro.length, max: 300 }}>
          <TextArea id="intro" maxLength={300} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Hi! I'm also into indie music — want to jam?" />
        </Field>
      </Modal>
      <ConfirmDialog open={blockOpen} onClose={() => setBlockOpen(false)} danger confirmLabel="Block" busy={busy === "block"} title={`Block ${person.displayName}?`}
        body="They won't be able to find you, connect with you or message you, and you won't see them. Any connection between you is removed. You can unblock them later in Settings."
        onConfirm={() => run("block", async () => { await api(`/me/blocks/${person.id}`, { method: "PUT" }); setBlockOpen(false); router.back(); }, "Blocked")} />
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} profileId={person.id} eventId={eventId} name={person.displayName} />
    </div>
  );
}
