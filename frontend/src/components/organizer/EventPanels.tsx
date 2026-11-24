"use client";

/**
 * Desktop & tablet (≥ 768px) panels for QR Management, Participants and Networking. Phones keep the original
 * components from EventWorkspace untouched; these reuse the same APIs and server-enforced entitlements.
 */
import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Check, Copy, Download, ExternalLink, FileImage, Link2, Lock, MessageCircle, PauseCircle, Power, Printer, QrCode, RefreshCw, Search, Share2, ShieldAlert, Sparkles, UserCheck, UserMinus,
  Users, UserX, Zap,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input, Toggle } from "@/components/ui/Form";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/Misc";
import { ConfirmDialog, Tabs, useDebounced } from "@/components/ui/Overlay";
import { TagPicker, type PickedTag } from "@/components/TagPicker";
import { UpgradeHint, useOrgFeature } from "@/components/OrgPlan";
import { useToast } from "@/components/Providers";
import { TOGGLES, useAction, type ParticipantRow } from "@/app/organizer/(app)/events/[eventId]/EventWorkspace";
import { api } from "@/lib/api";
import { availabilityLabel, cn, relativeTime } from "@/lib/format";
import type { OrgEventDetail } from "@/lib/types";

const panel = "rounded-[1.25rem] border border-line bg-card";
const PanelHeader = ({ title, subtitle, right, icon }: { title: string; subtitle?: string; right?: React.ReactNode; icon?: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
    <div className="flex min-w-0 items-start gap-3">
      {icon && <span className="mt-0.5 text-accent-light">{icon}</span>}
      <div className="min-w-0"><h3 className="font-display font-semibold">{title}</h3>{subtitle && <p className="mt-0.5 text-sm text-text-2">{subtitle}</p>}</div>
    </div>
    {right}
  </div>
);

// ---------------------------------------------------------------- QR Management
export function QrDesktop({ e, onChange }: { e: OrgEventDetail; onChange: (d: OrgEventDetail) => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"regenerate" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);
  if (e.status === "draft")
    return (
      <div className={panel}>
        <EmptyState icon={<QrCode className="size-7" />} title="Publish to get your QR code" action={<ButtonLink href={`/organizer/events/${e.id}`} icon={<Zap className="size-4" />}>Go to publish</ButtonLink>}>
          A unique QR code is created the moment you publish this event.
        </EmptyState>
      </div>
    );
  const img = `/api/v1/organizer/events/${e.id}/qr/image`;
  const state = !e.qr ? { label: "Revoked", tone: "bg-error/15 text-error" } : e.qrAccessEnabled ? { label: "Active", tone: "bg-success/15 text-success" } : { label: "Paused", tone: "bg-warning/15 text-warning" };
  const copy = async () => { await navigator.clipboard.writeText(e.qr!.url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); toast("success", "Link copied"); };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className={panel}>
        <PanelHeader title="Event QR code" subtitle="Print it or put it on screen at the venue." icon={<QrCode className="size-5" />}
          right={<span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", state.tone)}>{state.label}</span>} />
        <div className="p-5">
          {e.qr ? (
            <>
              <div className="relative mx-auto w-full max-w-[320px]">
                <div className="absolute -inset-3 rounded-[2rem] bg-grad-primary opacity-25 blur-2xl" aria-hidden />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${img}?size=720&v=${e.qr.code}`} alt={`QR code for ${e.name}`} className={cn("relative aspect-square w-full rounded-3xl bg-white p-3 shadow-xl", !e.qrAccessEnabled && "opacity-60 grayscale")} />
              </div>
              <div className="mt-5 flex items-center gap-2 rounded-2xl border border-line bg-bg-2 p-1.5 pl-3">
                <Link2 className="size-4 shrink-0 text-text-2" />
                <input readOnly value={e.qr.url} aria-label="Event link" className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text-2 outline-none" onFocus={(ev) => ev.target.select()} />
                <Button size="sm" variant="secondary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
              </div>
              <p className="mt-2 text-xs text-text-2">Code created {relativeTime(e.qr.createdAt)}. The QR identifies the event only — never an attendee.</p>
              {!e.qrAccessEnabled && <p className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">QR access is paused — scans show a “paused” message.</p>}
            </>
          ) : (
            <EmptyState icon={<QrCode className="size-7" />} title="No active QR code"
              action={<Button icon={<RefreshCw className="size-4" />} onClick={() => setConfirm("regenerate")}>Generate a new code</Button>}>The previous code was revoked. Generate a new one to share this event.</EmptyState>
          )}
        </div>
      </section>

      <div className="space-y-5">
        {e.qr && (
          <section className={panel}>
            <PanelHeader title="Download" subtitle="High-contrast codes that scan reliably." icon={<Download className="size-5" />} />
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              {[
                { href: `${img}?format=png&size=2048&download=1`, icon: <Printer className="size-5" />, title: "Print", meta: "PNG · 2048px" },
                { href: `${img}?format=png&size=1024&download=1`, icon: <FileImage className="size-5" />, title: "Screen", meta: "PNG · 1024px" },
                { href: `${img}?format=svg&download=1`, icon: <Sparkles className="size-5" />, title: "Vector", meta: "SVG · scalable" },
              ].map((d) => (
                <a key={d.title} href={d.href} className="group rounded-2xl border border-line bg-bg-2 p-4 transition-colors hover:border-accent/50 hover:bg-primary/[0.06]">
                  <span className="text-accent-light">{d.icon}</span>
                  <p className="mt-3 font-semibold">{d.title}</p>
                  <p className="text-xs whitespace-nowrap text-text-2">{d.meta}</p>
                  <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent-light opacity-80 group-hover:opacity-100"><Download className="size-3.5" />Download</p>
                </a>
              ))}
            </div>
          </section>
        )}

        <section className={panel}>
          <PanelHeader title="Sharing & access" icon={<Share2 className="size-5" />} />
          <div className="space-y-5 p-5">
            {e.qr && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<Copy className="size-4" />} onClick={copy}>Copy link</Button>
                {typeof navigator !== "undefined" && "share" in navigator && <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={() => navigator.share({ title: e.name, url: e.qr!.url }).catch(() => {})}>Share</Button>}
                <a href={e.qr.url} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-2 rounded-2xl px-4 font-semibold text-text-2 hover:bg-white/5 hover:text-text"><ExternalLink className="size-4" />Landing page</a>
              </div>
            )}
            <Toggle checked={e.qrAccessEnabled} disabled={busy === "access"} label="QR access enabled" description="Turn off to temporarily stop new people entering through the QR code."
              onChange={async (v) => { const d = await run("access", () => api<OrgEventDetail>(`/organizer/events/${e.id}/qr/access`, { method: "PUT", body: { enabled: v } }), v ? "QR access on" : "QR access off"); if (d) onChange(d); }} />
          </div>
        </section>

        <section className={cn(panel, "border-error/25")}>
          <PanelHeader title="Replace or revoke" subtitle="Use these if a code leaked or was printed by mistake." icon={<ShieldAlert className="size-5" />} />
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div><p className="font-medium">Regenerate</p><p className="text-sm text-text-2">Issue a new code. Old prints show “this QR code has been replaced”.</p></div>
              <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => setConfirm("regenerate")}>Regenerate</Button>
            </div>
            {e.qr && (
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div><p className="font-medium">Revoke</p><p className="text-sm text-text-2">Stop the current code. Nobody can join through it.</p></div>
                <Button variant="danger" icon={<Power className="size-4" />} onClick={() => setConfirm("revoke")}>Revoke</Button>
              </div>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger busy={!!busy} title={confirm === "regenerate" ? "Regenerate the QR code?" : "Revoke the QR code?"}
        body={confirm === "regenerate" ? "Printed copies of the current QR code will stop working." : "Nobody will be able to join through the current code until you generate a new one."}
        confirmLabel={confirm === "regenerate" ? "Regenerate" : "Revoke"}
        onConfirm={async () => { const d = await run(confirm!, () => api<OrgEventDetail>(`/organizer/events/${e.id}/qr/${confirm}`, { method: "POST" }), "Done"); if (d) onChange(d); setConfirm(null); }} />
    </div>
  );
}

// ---------------------------------------------------------------- Participants
const PSTATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-success/15 text-success" }, left: { label: "Left", tone: "bg-white/5 text-text-2" }, removed: { label: "Removed", tone: "bg-error/15 text-error" },
};

export function ParticipantsDesktop({ eventId }: { eventId: string }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const exportable = useOrgFeature("org.reports.export").has;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const dq = useDebounced(q);
  const stats = useQuery({ queryKey: ["p-stats", eventId], queryFn: () => api<Record<string, number | null> & { detailed?: boolean }>(`/organizer/events/${eventId}/participants/stats`) });
  const list = useInfiniteQuery({
    queryKey: ["participants-desktop", eventId, dq, status],
    initialPageParam: "0",
    queryFn: ({ pageParam }) => api<{ items: ParticipantRow[]; nextCursor: string | null }>(`/organizer/events/${eventId}/participants?q=${encodeURIComponent(dq)}&status=${status}&cursor=${pageParam}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const refresh = () => { list.refetch(); stats.refetch(); };
  const s = stats.data;
  const cards: { k: string; label: string; icon: React.ReactNode; pro?: boolean }[] = [
    { k: "active", label: "Active", icon: <UserCheck className="size-4" /> },
    { k: "today", label: "Joined (24h)", icon: <Zap className="size-4" />, pro: true },
    { k: "paused", label: "Paused discovery", icon: <PauseCircle className="size-4" />, pro: true },
    { k: "connections", label: "Connections made", icon: <MessageCircle className="size-4" />, pro: true },
    { k: "removed", label: "Removed", icon: <UserX className="size-4" /> },
  ];

  async function exportCsv() {
    const res = await fetch(`/api/v1/organizer/events/${eventId}/participants/export`, { headers: { "X-QRious-Client": "web" } });
    if (!res.ok) { const b = await res.json().catch(() => ({})); return toast("error", b.detail ?? "Export unavailable."); }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: "participants.csv" }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-5 gap-3">
        {cards.map((c) => {
          const locked = c.pro && s?.detailed === false;
          return (
            <div key={c.k} className={cn(panel, "p-4")}>
              <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-text-2" title={c.label}><span className="shrink-0 text-accent-light">{c.icon}</span><span className="truncate">{c.label}</span></p>
              <p className="mt-2 font-display text-2xl font-bold tabular-nums">{!s ? "–" : locked ? <Lock className="size-5 text-text-2" aria-label="Pro" /> : (s[c.k] ?? "–")}</p>
            </div>
          );
        })}
      </div>
      {s?.detailed === false && <UpgradeHint title="Detailed participant statistics">See who joined in the last 24 hours, paused discovery and connections made.</UpgradeHint>}

      <section className={panel}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative w-full max-w-[15rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" />
            <Input className="h-10 pl-10" placeholder="Search name or @username" aria-label="Search participants" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Tabs value={status} onChange={setStatus} items={[{ value: "active", label: "Active" }, { value: "left", label: "Left" }, { value: "removed", label: "Removed" }]} />
          <div className="ml-auto flex items-center gap-3">
          <span className="text-sm whitespace-nowrap text-text-2 tabular-nums">{list.isLoading ? "" : `${rows.length}${list.hasNextPage ? "+" : ""} shown`}</span>
          {exportable === false
            ? <ButtonLink href="/organizer/billing" size="sm" variant="secondary" icon={<Lock className="size-4" />}>Export · Pro</ButtonLink>
            : <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv} title="Exports only participants who consented">Export CSV</Button>}
          </div>
        </div>
        {list.isLoading ? <div className="p-4"><Skeleton className="h-48" /></div> : !rows.length ? (
          <EmptyState icon={<Users className="size-7" />} title={dq ? "No matches" : "No participants here yet"}>{dq ? "Try a different name or username." : "Share the QR code to get people in."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs tracking-wide text-text-2 uppercase">
                <tr className="border-b border-line">
                  <th className="px-5 py-3 font-medium">Participant</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Profession</th>
                  <th className="px-4 py-3 font-medium">Availability</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={p.displayName} src={p.thumbnailUrl} size={36} />
                        <div className="min-w-0"><p className="truncate font-medium">{p.displayName}</p><p className="truncate text-xs text-text-2">@{p.username}</p></div>
                      </div>
                    </td>
                    <td className="hidden max-w-[220px] truncate px-4 py-3 text-text-2 lg:table-cell">{p.profession ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-2">{p.discoveryPaused ? "Discovery paused" : p.availability ? availabilityLabel[p.availability] ?? "—" : "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-text-2" title={new Date(p.joinedAt).toLocaleString()}>{relativeTime(p.joinedAt)}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", PSTATUS[p.status]?.tone)}>{PSTATUS[p.status]?.label ?? p.status}</span>
                      {p.removalReason && <p className="mt-1 max-w-[200px] truncate text-xs text-text-2" title={p.removalReason}>{p.removalReason}</p>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {p.status === "removed"
                        ? <Button size="sm" variant="secondary" loading={busy === p.id} onClick={async () => { await run(p.id, () => api(`/organizer/events/${eventId}/participants/${p.id}/restore`, { method: "POST" }), "Access restored"); refresh(); }}>Restore</Button>
                        : p.status === "active" && <Button size="sm" variant="ghost" icon={<UserMinus className="size-4" />} onClick={() => { setRemoveId(p.id); setReason(""); }}>Remove</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && <div className="border-t border-line p-3 text-center"><Button size="sm" variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button></div>}
      </section>
      <p className="text-xs text-text-2">You see only member-level profile details. Private messages and private fields are never visible to organizers.</p>
      <ConfirmDialog open={!!removeId} onClose={() => setRemoveId(null)} danger busy={!!busy} title="Remove participant?" confirmLabel="Remove"
        body={<div className="space-y-3"><p>They&apos;ll lose access to this event&apos;s networking and can&apos;t rejoin unless you restore them. Their connections elsewhere aren&apos;t affected.</p>
          <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>}
        onConfirm={async () => { await run("remove", () => api(`/organizer/events/${eventId}/participants/${removeId}/remove`, { method: "POST", body: { reason } }), "Participant removed"); setRemoveId(null); refresh(); }} />
    </div>
  );
}

// ---------------------------------------------------------------- Networking
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Discovery", keys: ["discoverEnabled", "anonymousBrowsingEnabled", "smartMatchingEnabled"] },
  { title: "Conversations", keys: ["connectionsEnabled", "messagingEnabled"] },
  { title: "Presence & insights", keys: ["availabilityEnabled", "pulseEnabled", "premiumHighlightingEnabled"] },
];
const TOGGLE = Object.fromEntries(TOGGLES.map(([k, label, description]) => [k, { label, description }]));

export function NetworkingDesktop({ e, onChange }: { e: OrgEventDetail; onChange: (d: OrgEventDetail) => void }) {
  const { busy, run } = useAction();
  const advanced = useOrgFeature("org.networking.advanced").has;
  const [interests, setInterests] = useState<PickedTag[]>(e.suggestions.interests);
  const [skills, setSkills] = useState<PickedTag[]>(e.suggestions.skills);
  const [intents, setIntents] = useState<string[]>(e.suggestions.intentionIds);
  const on = TOGGLES.filter(([k]) => !!e.settings[k]).length;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const dirty = !same(interests.map((t) => t.id!), e.suggestions.interests.map((t) => t.id)) || !same(skills.map((t) => t.id!), e.suggestions.skills.map((t) => t.id))
    || !same([...intents].sort(), [...e.suggestions.intentionIds].sort());
  const set = async (k: string, v: boolean) => { const d = await run(k, () => api<OrgEventDetail>(`/organizer/events/${e.id}/networking-settings`, { method: "PUT", body: { [k]: v } })); if (d) onChange(d); };
  const reset = async () => {
    const d = await run("reset", () => api<OrgEventDetail>(`/organizer/events/${e.id}/networking-settings/reset-defaults`, { method: "POST" }), "Defaults restored");
    if (d) { onChange(d); setInterests([]); setSkills([]); setIntents(d.suggestions.intentionIds); }
  };
  const discard = () => { setInterests(e.suggestions.interests); setSkills(e.suggestions.skills); setIntents(e.suggestions.intentionIds); };
  const save = async () => {
    const d = await run("sugg", () => api<OrgEventDetail>(`/organizer/events/${e.id}/suggestions`, { method: "PUT", body: { interestIds: interests.map((t) => t.id), skillIds: skills.map((t) => t.id), intentionIds: intents } }), "Suggestions saved");
    if (d) onChange(d);
  };

  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <section className={panel}>
        <PanelHeader title="Networking features" subtitle="What attendees can do at this event." icon={<Zap className="size-5" />}
          right={<span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-accent-light tabular-nums">{on} of {TOGGLES.length} on</span>} />
        <div className="divide-y divide-line">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-4 px-5 py-4">
              <p className="text-xs font-semibold tracking-wide text-text-2 uppercase">{g.title}</p>
              {g.keys.map((k) => <Toggle key={k} checked={!!e.settings[k]} disabled={busy === k} onChange={(v) => set(k, v)} label={TOGGLE[k]!.label} description={TOGGLE[k]!.description} />)}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p className="text-xs text-text-2">Existing conversations always continue, whatever you switch off.</p>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={busy === "reset"} onClick={reset}>Reset to {e.categoryName} defaults</Button>
        </div>
      </section>

      <section className={panel}>
        <PanelHeader title="Suggestions for attendees" subtitle={`Shown first when attendees build their profile. Empty means the ${e.categoryName.toLowerCase()} defaults.`} icon={<Sparkles className="size-5" />} />
        {advanced === false ? (
          <div className="p-5"><UpgradeHint title="Custom suggestions">Pick the interests, skills and networking goals attendees see first. Until then, the {e.categoryName.toLowerCase()} defaults are used.</UpgradeHint></div>
        ) : (
          <>
            <div className="space-y-6 p-5">
              <div><p className="mb-2 flex justify-between text-sm font-medium">Interests<span className="text-xs font-normal text-text-2">{interests.length}/30</span></p><TagPicker kind="interests" value={interests} onChange={(v) => setInterests(v.filter((t) => t.id))} max={30} /></div>
              <div><p className="mb-2 flex justify-between text-sm font-medium">Skills<span className="text-xs font-normal text-text-2">{skills.length}/30</span></p><TagPicker kind="skills" value={skills} onChange={(v) => setSkills(v.filter((t) => t.id))} max={30} /></div>
              <div>
                <p className="mb-2 text-sm font-medium">Networking goals</p>
                <div className="flex flex-wrap gap-2">
                  {e.intentionOptions.map((i) => {
                    const picked = intents.includes(i.id);
                    return <button key={i.id} type="button" aria-pressed={picked} onClick={() => setIntents(picked ? intents.filter((x) => x !== i.id) : [...intents, i.id])}
                      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors", picked ? "border-primary bg-primary/20" : "border-line-strong text-text-2 hover:text-text")}>
                      {picked && <Check className="size-3.5" />}{i.label}</button>;
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 rounded-b-[1.25rem] border-t border-line bg-bg-2/60 px-5 py-3">
              {dirty && <span className="mr-auto text-sm text-warning">Unsaved changes</span>}
              <Button size="sm" variant="ghost" disabled={!dirty} onClick={discard}>Discard</Button>
              <Button size="sm" loading={busy === "sugg"} disabled={!dirty} onClick={save}>Save suggestions</Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
