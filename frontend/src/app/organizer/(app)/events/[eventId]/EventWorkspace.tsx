"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Archive, Copy, Download, ExternalLink, Eye, Flag, ImagePlus, Pause, Play, Power, QrCode, RefreshCw, Rocket, Search, Share2, Square, Trash2, Undo2, Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Toggle } from "@/components/ui/Form";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { ConfirmDialog, ErrorState, PageHeader, Tabs, useDebounced } from "@/components/ui/Overlay";
import { EventForm, initialForm } from "@/components/EventForm";
import { EVENT_STATUS } from "@/components/EventStatus";
import { TagPicker, type PickedTag } from "@/components/TagPicker";
import { useToast } from "@/components/Providers";
import { UpgradeHint, useOrgFeature } from "@/components/OrgPlan";
import { api, ApiError } from "@/lib/api";
import { availabilityLabel, cn, formatDateTime, formatEventDate, formatEventTime, relativeTime } from "@/lib/format";
import type { OrgEventDetail, Pulse } from "@/lib/types";

type Tab = "overview" | "edit" | "qr" | "participants" | "networking" | "reports" | "pulse";

export function EventWorkspace({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const search = useSearchParams();
  const router = useRouter();
  const initialTab = (search.get("tab") as Tab) ?? "overview";
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => { setTabState(t); router.replace(`/organizer/events/${eventId}?tab=${t}`, { scroll: false }); };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["org-event", eventId], queryFn: () => api<OrgEventDetail>(`/organizer/events/${eventId}`) });
  const setData = (d: OrgEventDetail) => { qc.setQueryData(["org-event", eventId], d); qc.invalidateQueries({ queryKey: ["org-events"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const e = q.data;

  return (
    <>
      <Link href="/organizer/events" className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ArrowLeft className="size-4" />All events</Link>
      <PageHeader title={e.name} subtitle={<span className="inline-flex flex-wrap items-center gap-2"><span className={EVENT_STATUS[e.status]?.className}>{EVENT_STATUS[e.status]?.label}</span>
        {formatEventDate(e.startsAt, e.endsAt, e.timeZone)} · {e.venueName}{e.moderationStatus === "suspended" && <span className="text-error">Suspended by QRious moderators</span>}</span>} />
      <Tabs value={tab} onChange={setTab} items={[
        { value: "overview", label: "Overview" }, { value: "edit", label: "Edit" }, { value: "qr", label: "QR code" }, { value: "participants", label: "Participants" },
        { value: "networking", label: "Networking" }, { value: "reports", label: "Reports" }, { value: "pulse", label: "Pulse" },
      ]} />
      <div className="mt-6">
        {tab === "overview" && <Overview e={e} onChange={setData} goTo={setTab} />}
        {tab === "edit" && <EditTab e={e} onChange={setData} />}
        {tab === "qr" && <QrTab e={e} onChange={setData} />}
        {tab === "participants" && <ParticipantsTab eventId={eventId} />}
        {tab === "networking" && <NetworkingTab e={e} onChange={setData} />}
        {tab === "reports" && <ReportsTab eventId={eventId} />}
        {tab === "pulse" && <PulseTab eventId={eventId} />}
      </div>
    </>
  );
}

export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function run<T>(name: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(name);
    try { const r = await fn(); if (ok) toast("success", ok); return r; }
    catch (err) { toast("error", err instanceof ApiError ? err.message : "Something went wrong."); }
    finally { setBusy(null); }
  }
  return { busy, run };
}

function Overview({ e, onChange, goTo }: { e: OrgEventDetail; onChange: (d: OrgEventDetail) => void; goTo: (t: Tab) => void }) {
  const { busy, run } = useAction();
  const qc = useQueryClient();
  const router = useRouter();
  const [confirm, setConfirm] = useState<null | { action: string; title: string; body: string }>(null);
  const act = (action: string, ok: string) => run(action, () => api<OrgEventDetail>(`/organizer/events/${e.id}/${action}`, { method: "POST" }), ok).then((d) => d && onChange(d));
  const s = e.status;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <section className="card p-5">
          <h2 className="font-display font-semibold">Event status</h2>
          <p className="mt-1 text-sm text-text-2">
            {s === "draft" && "Only you can see this event. Publish it to get the QR code."}
            {s === "published" && <>Published. Networking opens automatically at <b className="text-text">{formatDateTime(e.networkingOpensAt, e.timeZone)}</b> (24 hours before the start).</>}
            {s === "active" && "Networking is live. Attendees can discover, match, connect and chat."}
            {s === "networking_paused" && "Networking is paused. Attendees can still see the event and keep chatting with existing connections."}
            {s === "ended" && "The event has ended. Existing connections and conversations continue."}
            {s === "archived" && "Archived for your records."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {s === "draft" && <Button icon={<Rocket className="size-4" />} loading={busy === "publish"} onClick={() => act("publish", "Published — your QR code is ready")}>Publish</Button>}
            {s === "published" && <Button icon={<Play className="size-4" />} loading={busy === "start"} onClick={() => act("start", "Networking is live")}>Start networking now</Button>}
            {s === "active" && <Button variant="secondary" icon={<Pause className="size-4" />} loading={busy === "pause"} onClick={() => act("pause", "Networking paused")}>Pause networking</Button>}
            {s === "networking_paused" && <Button icon={<Play className="size-4" />} loading={busy === "resume"} onClick={() => act("resume", "Networking resumed")}>Resume networking</Button>}
            {["published", "active", "networking_paused"].includes(s) && <>
              <Button variant="secondary" icon={<Square className="size-4" />} onClick={() => setConfirm({ action: "end", title: "End this event?", body: "Networking closes for everyone. Existing connections and chats continue." })}>End event</Button>
              <Button variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setConfirm({ action: "unpublish", title: "Unpublish this event?", body: "The landing page and QR code stop working until you publish again. Participants keep their profiles and connections." })}>Unpublish</Button>
            </>}
            {["draft", "ended"].includes(s) && <Button variant="ghost" icon={<Archive className="size-4" />} onClick={() => setConfirm({ action: "archive", title: "Archive this event?", body: "It's kept for your records and the QR code stops working. This can't be undone." })}>Archive</Button>}
            {s === "draft" && !e.publishedAt && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirm({ action: "delete", title: "Delete this draft?", body: "The draft is removed permanently. Deleting an event doesn't give back the event allowance it used." })}>Delete draft</Button>}
          </div>
        </section>
        <section className="card grid gap-4 p-5 sm:grid-cols-2">
          <Info label="When" value={`${formatEventDate(e.startsAt, e.endsAt, e.timeZone)}, ${formatEventTime(e.startsAt, e.endsAt, e.timeZone)}`} />
          <Info label="Where" value={[e.venueName, e.venueAddress, e.city].filter(Boolean).join(", ")} />
          <Info label="Category" value={e.categoryName} />
          <Info label="Participants" value={`${e.participantCount}${e.maxParticipants ? ` / ${e.maxParticipants}` : ""}`} />
        </section>
      </div>
      <aside className="space-y-3">
        <button onClick={() => goTo("qr")} className="card flex w-full items-center gap-3 p-4 text-left hover:border-accent/40"><QrCode className="size-5 text-accent" /><span className="flex-1">QR code &amp; sharing</span></button>
        <button onClick={() => goTo("participants")} className="card flex w-full items-center gap-3 p-4 text-left hover:border-accent/40"><Users className="size-5 text-accent" /><span className="flex-1">Participants</span></button>
        {e.qr && s !== "draft" && <a href={e.qr.url} target="_blank" rel="noopener" className="card flex items-center gap-3 p-4 hover:border-accent/40"><Eye className="size-5 text-accent" /><span className="flex-1">View attendee landing page</span><ExternalLink className="size-4 text-text-2" /></a>}
      </aside>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? ""} body={confirm?.body} danger={confirm?.action !== "end"} busy={!!busy}
        confirmLabel={confirm?.action === "end" ? "End event" : confirm?.action === "archive" ? "Archive" : confirm?.action === "delete" ? "Delete draft" : "Unpublish"}
        onConfirm={async () => {
          if (confirm?.action === "delete") {
            const ok = await run("delete", async () => { await api(`/organizer/events/${e.id}`, { method: "DELETE" }); return true; }, "Draft deleted");
            setConfirm(null);
            if (ok) { await qc.invalidateQueries({ queryKey: ["org-events"] }); router.replace("/organizer/events"); }
            return;
          }
          if (confirm) await act(confirm.action, "Done");
          setConfirm(null);
        }} />
    </div>
  );
}

const Info = ({ label, value }: { label: string; value: string }) => <div><p className="text-xs tracking-wide text-text-2 uppercase">{label}</p><p className="mt-1">{value}</p></div>;

function EditTab({ e, onChange }: { e: OrgEventDetail; onChange: (d: OrgEventDetail) => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const branding = useOrgFeature("org.branding").has;
  async function upload(file: File) {
    if (file.size > 4 * 1024 * 1024) return toast("error", "Banner images must be 4 MB or smaller.");
    const fd = new FormData();
    fd.append("file", file);
    const r = await run("banner", () => api<{ bannerUrl: string }>(`/organizer/events/${e.id}/banner`, { method: "PUT", body: fd }), "Banner updated");
    if (r) onChange({ ...e, bannerUrl: r.bannerUrl });
  }
  if (e.status === "archived") return <p className="card p-5 text-sm text-text-2">Archived events can&apos;t be edited.</p>;
  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="font-display font-semibold">Banner</h2>
        <div className="mt-3 aspect-[16/7] overflow-hidden rounded-2xl border border-line bg-card-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.bannerUrl ?? `/images/categories/${e.categorySlug}.webp`} alt="" className="size-full object-cover" />
        </div>
        {branding === false && <UpgradeHint title="Custom event banners" className="mt-3">Upload your own banner for this event. Existing banners are always kept.</UpgradeHint>}
        <div className="mt-3 flex gap-2">
          {branding !== false && <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-2xl border border-line-strong bg-card-2 px-3.5 text-sm font-semibold hover:border-accent/60">
            <ImagePlus className="size-4" />{busy === "banner" ? "Uploading…" : "Upload banner"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void upload(f); ev.target.value = ""; }} />
          </label>}
          {e.bannerUrl && <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => { await run("rm", () => api(`/organizer/events/${e.id}/banner`, { method: "DELETE" }), "Banner removed"); onChange({ ...e, bannerUrl: null }); }}>Remove</Button>}
        </div>
        <p className="mt-2 text-xs text-text-2">Without a banner, attendees see a photo for the event category. Landscape 16:9 works best.</p>
      </section>
      <EventForm initial={initialForm(e)} submitLabel="Save changes" onSubmit={async (body) => {
        const d = await api<OrgEventDetail>(`/organizer/events/${e.id}`, { method: "PATCH", body });
        onChange(d);
        toast("success", "Event saved");
      }} />
    </div>
  );
}

export function QrTab({ e, onChange }: { e: OrgEventDetail; onChange: (d: OrgEventDetail) => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"regenerate" | "revoke" | null>(null);
  if (e.status === "draft") return <div className="card"><EmptyState icon={<QrCode className="size-7" />} title="Publish to get your QR code">Your event&apos;s QR code is created when you publish it.</EmptyState></div>;
  const img = `/api/v1/organizer/events/${e.id}/qr/image`;
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <section className="card p-5 text-center">
        {e.qr ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${img}?size=720&v=${e.qr.code}`} alt={`QR code for ${e.name}`} className="mx-auto aspect-square w-full max-w-[300px] rounded-2xl bg-white p-2" />
          <p className="mt-3 font-mono text-sm break-all text-text-2">{e.qr.url}</p>
          {!e.qrAccessEnabled && <p className="mt-2 text-sm text-warning">QR access is turned off — scans show a “paused” message.</p>}
        </> : <EmptyState icon={<QrCode className="size-7" />} title="No active QR code">Generate a new one to share this event.</EmptyState>}
      </section>
      <section className="card space-y-5 p-5">
        <div className="flex flex-wrap gap-2">
          {e.qr && <>
            <a href={`${img}?format=png&size=2048&download=1`} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-grad-primary px-5 font-semibold text-white"><Download className="size-4" />PNG (print)</a>
            <a href={`${img}?format=svg&download=1`} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-line-strong bg-card-2 px-5 font-semibold"><Download className="size-4" />SVG</a>
            <Button variant="secondary" icon={<Copy className="size-4" />} onClick={async () => { await navigator.clipboard.writeText(e.qr!.url).catch(() => {}); toast("success", "Link copied"); }}>Copy link</Button>
            {typeof navigator !== "undefined" && "share" in navigator && <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={() => navigator.share({ title: e.name, url: e.qr!.url }).catch(() => {})}>Share</Button>}
          </>}
        </div>
        <Toggle checked={e.qrAccessEnabled} disabled={busy === "access"} label="QR access enabled" description="Turn off to temporarily stop new people entering through the QR code."
          onChange={async (v) => { const d = await run("access", () => api<OrgEventDetail>(`/organizer/events/${e.id}/qr/access`, { method: "PUT", body: { enabled: v } }), v ? "QR access on" : "QR access off"); if (d) onChange(d); }} />
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => setConfirm("regenerate")}>Regenerate QR</Button>
          {e.qr && <Button variant="danger" icon={<Power className="size-4" />} onClick={() => setConfirm("revoke")}>Revoke QR</Button>}
        </div>
        <p className="text-xs text-text-2">Regenerating replaces the code: old prints stop working and show “this QR code has been replaced”. The QR identifies the event only — never an attendee.</p>
      </section>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger busy={!!busy} title={confirm === "regenerate" ? "Regenerate the QR code?" : "Revoke the QR code?"}
        body={confirm === "regenerate" ? "Printed copies of the current QR code will stop working." : "Nobody will be able to join through the current code until you generate a new one."}
        confirmLabel={confirm === "regenerate" ? "Regenerate" : "Revoke"}
        onConfirm={async () => { const d = await run(confirm!, () => api<OrgEventDetail>(`/organizer/events/${e.id}/qr/${confirm}`, { method: "POST" }), "Done"); if (d) onChange(d); setConfirm(null); }} />
    </div>
  );
}

export type ParticipantRow = { id: string; status: string; discoveryPaused: boolean; joinedAt: string; removalReason: string | null; displayName: string; username: string; profession: string | null; thumbnailUrl: string | null; availability: string | null };

export function ParticipantsTab({ eventId }: { eventId: string }) {
  const { busy, run } = useAction();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const dq = useDebounced(q);
  const stats = useQuery({ queryKey: ["p-stats", eventId], queryFn: () => api<Record<string, number | null> & { detailed?: boolean }>(`/organizer/events/${eventId}/participants/stats`) });
  const list = useQuery({ queryKey: ["participants", eventId, dq, status], queryFn: () => api<{ items: ParticipantRow[] }>(`/organizer/events/${eventId}/participants?q=${encodeURIComponent(dq)}&status=${status}`) });
  const refresh = () => { list.refetch(); stats.refetch(); };
  const toast = useToast();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["active", "Active"], ["today", "Joined (24h)"], ["paused", "Paused discovery"], ["connections", "Connections made"], ["removed", "Removed"]].map(([k, l]) => (
          <div key={k} className="card p-4"><p className="text-xs text-text-2">{l}</p><p className="mt-1 font-display text-2xl font-bold">{stats.data?.[k!] ?? "–"}</p></div>
        ))}
      </div>
      {stats.data?.detailed === false && <UpgradeHint title="Detailed participant statistics">See who joined in the last 24 hours, paused discovery and connections made.</UpgradeHint>}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" /><Input className="pl-10" placeholder="Search name or @username" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Tabs value={status} onChange={setStatus} items={[{ value: "active", label: "Active" }, { value: "left", label: "Left" }, { value: "removed", label: "Removed" }]} />
        <Button variant="secondary" icon={<Download className="size-4" />} onClick={async () => {
          const res = await fetch(`/api/v1/organizer/events/${eventId}/participants/export`, { headers: { "X-QRious-Client": "web" } });
          if (!res.ok) { const b = await res.json().catch(() => ({})); return toast("error", b.detail ?? "Export unavailable."); }
          const url = URL.createObjectURL(await res.blob());
          Object.assign(document.createElement("a"), { href: url, download: "participants.csv" }).click();
          URL.revokeObjectURL(url);
        }}>Export (consenting)</Button>
      </div>
      {list.isLoading ? <Skeleton className="h-48" /> : !list.data?.items.length ? (
        <div className="card"><EmptyState icon={<Users className="size-7" />} title="No participants here yet">Share the QR code to get people in.</EmptyState></div>
      ) : (
        <ul className="card divide-y divide-line p-0">
          {list.data.items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" className="size-10 rounded-full object-cover" /> : <span className="grid size-10 place-items-center rounded-full bg-card-2 text-sm">{p.displayName[0]}</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.displayName} <span className="font-normal text-text-2">@{p.username}</span></p>
                <p className="truncate text-xs text-text-2">{p.profession ? `${p.profession} · ` : ""}joined {relativeTime(p.joinedAt)}{p.availability ? ` · ${availabilityLabel[p.availability] ?? ""}` : ""}{p.removalReason ? ` · removed: ${p.removalReason}` : ""}</p>
              </div>
              {p.status === "removed" ? <Button size="sm" variant="secondary" loading={busy === p.id} onClick={async () => { await run(p.id, () => api(`/organizer/events/${eventId}/participants/${p.id}/restore`, { method: "POST" }), "Access restored"); refresh(); }}>Restore</Button>
                : p.status === "active" && <Button size="sm" variant="ghost" onClick={() => { setRemoveId(p.id); setReason(""); }}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-2">You see only member-level profile details. Private messages and private fields are never visible to organizers.</p>
      <ConfirmDialog open={!!removeId} onClose={() => setRemoveId(null)} danger busy={!!busy} title="Remove participant?" confirmLabel="Remove"
        body={<div className="space-y-3"><p>They&apos;ll lose access to this event&apos;s networking and can&apos;t rejoin unless you restore them. Their connections elsewhere aren&apos;t affected.</p>
          <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>}
        onConfirm={async () => { await run("remove", () => api(`/organizer/events/${eventId}/participants/${removeId}/remove`, { method: "POST", body: { reason } }), "Participant removed"); setRemoveId(null); refresh(); }} />
    </div>
  );
}

export const TOGGLES: [string, string, string][] = [
  ["discoverEnabled", "Discover", "Attendees can browse each other."], ["anonymousBrowsingEnabled", "Anonymous browsing", "Visitors without a profile can browse opted-in public profiles."],
  ["smartMatchingEnabled", "Smart Matching", "Personalized recommendations."], ["pulseEnabled", "Event Pulse", "Live aggregate activity."],
  ["connectionsEnabled", "Connection requests", "New requests through this event."], ["messagingEnabled", "Messaging", "New conversations through this event (existing ones always continue)."],
  ["availabilityEnabled", "Open to Talk", "Attendees can set their availability."], ["premiumHighlightingEnabled", "Premium highlighting", "Allow Premium profile badges in Discover."],
];

export function NetworkingTab({ e, onChange }: { e: OrgEventDetail; onChange: (d: OrgEventDetail) => void }) {
  const { busy, run } = useAction();
  const [interests, setInterests] = useState<PickedTag[]>(e.suggestions.interests);
  const [skills, setSkills] = useState<PickedTag[]>(e.suggestions.skills);
  const [intents, setIntents] = useState<string[]>(e.suggestions.intentionIds);
  const advanced = useOrgFeature("org.networking.advanced").has;
  const set = async (k: string, v: boolean) => { const d = await run(k, () => api<OrgEventDetail>(`/organizer/events/${e.id}/networking-settings`, { method: "PUT", body: { [k]: v } })); if (d) onChange(d); };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-5 p-5">
        <h2 className="font-display font-semibold">Features</h2>
        {TOGGLES.map(([k, l, d]) => <Toggle key={k} checked={!!e.settings[k]} disabled={busy === k} onChange={(v) => set(k, v)} label={l} description={d} />)}
        <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={busy === "reset"} onClick={async () => { const d = await run("reset", () => api<OrgEventDetail>(`/organizer/events/${e.id}/networking-settings/reset-defaults`, { method: "POST" }), "Defaults restored"); if (d) { onChange(d); setInterests([]); setSkills([]); setIntents(d.suggestions.intentionIds); } }}>Reset to {e.categoryName} defaults</Button>
      </section>
      <section className="card space-y-5 p-5">
        <h2 className="font-display font-semibold">Suggestions for attendees</h2>
        <p className="text-sm text-text-2">Shown first when attendees pick interests and skills. Leave empty to use the {e.categoryName.toLowerCase()} defaults.</p>
        {advanced === false ? <UpgradeHint title="Custom suggestions">Pick the interests, skills and networking goals attendees see first. Until then, the {e.categoryName.toLowerCase()} defaults are used.</UpgradeHint> : <>
        <div><p className="mb-2 text-sm font-medium">Interests</p><TagPicker kind="interests" value={interests} onChange={(v) => setInterests(v.filter((t) => t.id))} max={30} /></div>
        <div><p className="mb-2 text-sm font-medium">Skills</p><TagPicker kind="skills" value={skills} onChange={(v) => setSkills(v.filter((t) => t.id))} max={30} /></div>
        <div>
          <p className="mb-2 text-sm font-medium">Networking goals</p>
          <div className="flex flex-wrap gap-2">
            {e.intentionOptions.map((i) => <button key={i.id} type="button" onClick={() => setIntents(intents.includes(i.id) ? intents.filter((x) => x !== i.id) : [...intents, i.id])}
              className={cn("rounded-full border px-3 py-1.5 text-sm", intents.includes(i.id) ? "border-primary bg-primary/20" : "border-line-strong text-text-2")}>{i.label}</button>)}
          </div>
        </div>
        <Button loading={busy === "sugg"} onClick={async () => { const d = await run("sugg", () => api<OrgEventDetail>(`/organizer/events/${e.id}/suggestions`, { method: "PUT", body: { interestIds: interests.map((t) => t.id), skillIds: skills.map((t) => t.id), intentionIds: intents } }), "Suggestions saved"); if (d) onChange(d); }}>Save suggestions</Button>
        </>}
      </section>
    </div>
  );
}

type ReportRow = { id: string; reason: string; details: string | null; status: string; escalated: boolean; createdAt: string; messageExcerpt: string | null; reported: { displayName: string; username: string; participantId: string | null } };

function ReportsTab({ eventId }: { eventId: string }) {
  const { busy, run } = useAction();
  const q = useQuery({ queryKey: ["org-reports", eventId], queryFn: () => api<ReportRow[]>(`/organizer/events/${eventId}/reports`) });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (!q.data?.length) return <div className="card"><EmptyState icon={<Flag className="size-7" />} title="No reports">Reports attendees file about people at this event appear here.</EmptyState></div>;
  return (
    <ul className="space-y-3">
      {q.data.map((r) => (
        <li key={r.id} className="card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-medium">{r.reported.displayName} <span className="text-text-2">@{r.reported.username}</span></p>
              <p className="text-sm text-text-2">{r.reason.replace(/_/g, " ")} · {relativeTime(r.createdAt)} · {r.status.replace("_", " ")}</p></div>
            {r.escalated ? <span className="text-xs text-accent-light">Escalated to QRious</span>
              : <Button size="sm" variant="secondary" loading={busy === r.id} onClick={async () => { await run(r.id, () => api(`/organizer/events/${eventId}/reports/${r.id}/escalate`, { method: "POST" }), "Escalated"); q.refetch(); }}>Escalate</Button>}
          </div>
          {r.details && <p className="mt-2 text-sm">{r.details}</p>}
          {r.messageExcerpt && <p className="mt-2 rounded-xl bg-bg-2 px-3 py-2 text-sm text-text-2">Attached message: &ldquo;{r.messageExcerpt}&rdquo;</p>}
        </li>
      ))}
    </ul>
  );
}

function PulseTab({ eventId }: { eventId: string }) {
  const q = useQuery({ queryKey: ["org-pulse", eventId], queryFn: () => api<Pulse>(`/organizer/events/${eventId}/pulse`), refetchInterval: 15_000 });
  const p = q.data;
  if (!p) return <Skeleton className="h-60" />;
  const v = (n: number | null) => (n === null ? `<${p.threshold}` : n);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Participating", p.totals.participants], ["Discoverable", p.totals.discoverable], ["Open to talk", p.totals.openToTalk], ["Want collaborators", p.totals.lookingForCollaborators]].map(([l, n]) => (
          <div key={l as string} className="card p-4"><p className="text-sm text-text-2">{l}</p><p className="mt-1 font-display text-3xl font-bold">{v(n as number | null)}</p></div>
        ))}
      </div>
      {(p as Pulse & { advanced?: boolean }).advanced === false ? <UpgradeHint title="Advanced Event Pulse">See which networking goals, interests and skills are most common at this event.</UpgradeHint> : <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5"><h2 className="font-display font-semibold">Goals</h2><ul className="mt-3 space-y-1 text-sm">{p.byIntention.length ? p.byIntention.map((i) => <li key={i.id} className="flex justify-between"><span>{i.label}</span><span>{i.count}</span></li>) : <li className="text-text-2">Not enough people yet.</li>}</ul></section>
        <section className="card p-5"><h2 className="font-display font-semibold">Top interests</h2><ul className="mt-3 space-y-1 text-sm">{p.topInterests.length ? p.topInterests.map((i) => <li key={i.name} className="flex justify-between"><span>{i.name}</span><span>{i.count}</span></li>) : <li className="text-text-2">Not enough people yet.</li>}</ul></section>
      </div>}
      <p className="text-xs text-text-2">Aggregates only; groups smaller than {p.threshold} are hidden to protect attendees.</p>
    </div>
  );
}
