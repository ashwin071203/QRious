"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Flag, ImagePlus, LogOut, Pencil, Search, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/Misc";
import { ConfirmDialog, Modal } from "@/components/ui/Overlay";
import { ReportDialog } from "@/components/People";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { cn, presenceLabel } from "@/lib/format";
import type { GroupMember, Thread } from "@/lib/types";

type Candidate = { profileId: string; displayName: string; username: string; thumbnailUrl: string | null };

/** Round group avatar: the group photo, or a gradient with the group icon. */
export function GroupAvatar({ name, photoUrl, size = 48 }: { name: string; photoUrl: string | null; size?: number }) {
  return photoUrl ? <Avatar name={name} src={photoUrl} size={size} />
    : <span className="grid shrink-0 place-items-center rounded-full bg-grad-primary text-white" style={{ width: size, height: size }} aria-hidden><Users style={{ width: size * 0.45, height: size * 0.45 }} /></span>;
}

/** Picks accepted connections (the server re-checks every rule: connections only, no blocks, size limit). */
function ConnectionPicker({ groupId, selected, onChange }: { groupId?: string; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const c = useQuery({ queryKey: ["group-candidates", groupId ?? "new"], queryFn: () => api<Candidate[]>(`/conversations/group-candidates${groupId ? `?group=${groupId}` : ""}`) });
  const shown = useMemo(() => (c.data ?? []).filter((p) => !q.trim() || `${p.displayName} ${p.username}`.toLowerCase().includes(q.trim().toLowerCase().replace(/^@/, ""))), [c.data, q]);
  if (c.isLoading) return <Skeleton className="h-48" />;
  if (!c.data?.length) return <EmptyState icon={<Users className="size-7" />} title={groupId ? "Everyone's already here" : "No connections yet"}>
    {groupId ? "All your connections are already in this group." : "You can add people once they accept your connection request."}</EmptyState>;
  return (
    <div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-2" />
        <Input className="pl-10" placeholder="Search your connections" aria-label="Search your connections" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {shown.map((p) => {
          const on = selected.includes(p.profileId);
          return (
            <li key={p.profileId}>
              <button type="button" role="checkbox" aria-checked={on} onClick={() => onChange(on ? selected.filter((x) => x !== p.profileId) : [...selected, p.profileId])}
                className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors", on ? "bg-primary/15" : "hover:bg-white/[0.04]")}>
                <Avatar name={p.displayName} src={p.thumbnailUrl} size={40} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.displayName}</span><span className="block truncate text-xs text-text-2">@{p.username}</span></span>
                <span className={cn("grid size-6 place-items-center rounded-full border", on ? "border-primary bg-primary text-white" : "border-line-strong")}>{on && <Check className="size-4" />}</span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="py-6 text-center text-sm text-text-2">No connections match “{q}”.</li>}
      </ul>
      <p className="mt-2 text-xs text-text-2">Only your accepted connections can be added.</p>
    </div>
  );
}

export function CreateGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ name?: string; members?: string }>({});
  const [busy, setBusy] = useState(false);
  async function create() {
    const e: typeof errors = {};
    if (!name.trim()) e.name = "Give the group a name.";
    if (!selected.length) e.members = "Choose at least one connection.";
    setErrors(e);
    if (e.name || e.members) return;
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/conversations/groups", { method: "POST", body: { name: name.trim(), memberProfileIds: selected } });
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      onClose();
      setName(""); setSelected([]);
      router.push(`/app/messages/${r.id}`);
    } catch (err) {
      if (err instanceof ApiError) setErrors({ name: err.fieldError("name"), members: err.fieldError("members") ?? (err.errors ? undefined : err.message) });
    } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New group" wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={create} icon={<Users className="size-4" />}>Create group{selected.length ? ` (${selected.length + 1})` : ""}</Button></>}>
      <div className="space-y-4">
        <Field label="Group name" required htmlFor="group-name" error={errors.name}>
          <Input id="group-name" value={name} maxLength={60} placeholder="e.g. Hackathon team" onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium">Members</p>
          <ConnectionPicker selected={selected} onChange={setSelected} />
          {errors.members && <p className="mt-2 text-sm text-error" role="alert">{errors.members}</p>}
        </div>
      </div>
    </Modal>
  );
}

function AddMembersDialog({ open, onClose, groupId, onDone }: { open: boolean; onClose: () => void; groupId: string; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!selected.length) return setError("Choose at least one connection.");
    setBusy(true);
    try {
      await api(`/conversations/${groupId}/members`, { method: "POST", body: { memberProfileIds: selected } });
      toast("success", selected.length === 1 ? "Member added" : `${selected.length} members added`);
      setSelected([]); setError(undefined);
      await qc.invalidateQueries({ queryKey: ["group-candidates", groupId] });
      onDone(); onClose();
    } catch (err) { setError(err instanceof ApiError ? err.fieldError("members") ?? err.message : "Couldn't add members."); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add members"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={add} icon={<UserPlus className="size-4" />}>Add{selected.length ? ` ${selected.length}` : ""}</Button></>}>
      <ConnectionPicker groupId={groupId} selected={selected} onChange={setSelected} />
      {error && <p className="mt-2 text-sm text-error" role="alert">{error}</p>}
    </Modal>
  );
}

/** Group info: name & photo (admins), members with roles and activity, add/remove/promote (admins), report, leave. */
export function GroupInfoDialog({ open, onClose, groupId, thread, onChanged }: { open: boolean; onClose: () => void; groupId: string; thread: Thread; onChanged: () => void }) {
  const g = thread.group!;
  const admin = g.myRole === "admin";
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(g.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: "leave" } | { kind: "remove"; m: GroupMember }>(null);
  const [report, setReport] = useState<GroupMember | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try { await fn(); if (ok) toast("success", ok); onChanged(); return true; }
    catch (err) { toast("error", err instanceof ApiError ? err.fieldError("name") ?? err.message : "Something went wrong."); return false; }
    finally { setBusy(null); }
  }
  const photo = (file: File | null) => run("photo", async () => {
    if (file) {
      if (file.size > 4 * 1024 * 1024) throw new ApiError(400, "too_large", "Photos must be 4 MB or smaller.");
      const fd = new FormData(); fd.append("file", file);
      await api(`/conversations/${groupId}/group/photo`, { method: "PUT", body: fd });
    } else await api(`/conversations/${groupId}/group/photo`, { method: "DELETE" });
  }, file ? "Group photo updated" : "Group photo removed");

  return (
    <Modal open={open} onClose={onClose} title="Group info" wide>
      <div className="space-y-5">
        <section className="flex flex-wrap items-center gap-4">
          <GroupAvatar name={g.name} photoUrl={g.photoUrl} size={72} />
          <div className="min-w-0 flex-1">
            {editing ? (
              <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run("name", () => api(`/conversations/${groupId}/group`, { method: "PATCH", body: { name } }), "Group renamed")) setEditing(false); }}>
                <Input aria-label="Group name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
                <Button size="sm" type="submit" loading={busy === "name"}>Save</Button>
              </form>
            ) : (
              <p className="flex items-center gap-2 font-display text-xl font-semibold">
                <span className="truncate">{g.name}</span>
                {admin && <button type="button" onClick={() => { setName(g.name); setEditing(true); }} className="rounded-lg p-1 text-text-2 hover:bg-white/5 hover:text-text" aria-label="Rename group"><Pencil className="size-4" /></button>}
              </p>
            )}
            <p className="text-sm text-text-2">{g.memberCount} member{g.memberCount === 1 ? "" : "s"} · {admin ? "You're an admin" : "Admins manage this group"}</p>
          </div>
          {admin && (
            <div className="flex gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-2xl border border-line-strong bg-card-2 px-3.5 text-sm font-semibold hover:border-accent/60">
                <ImagePlus className="size-4" />{busy === "photo" ? "Uploading…" : "Photo"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void photo(f); e.target.value = ""; }} />
              </label>
              {g.photoUrl && <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => photo(null)} aria-label="Remove group photo" />}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium">Members</h3>
            {admin && <Button size="sm" variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Add members</Button>}
          </div>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {g.members.map((m) => {
              const status = presenceLabel(m.presence);
              return (
                <li key={m.profileId ?? m.displayName} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="relative">
                    <Avatar name={m.displayName} src={m.thumbnailUrl} size={40} />
                    {m.presence?.active && <span className="absolute right-0 bottom-0 size-3 rounded-full bg-success ring-2 ring-card" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">{m.displayName}{m.isMe && <span className="text-text-2">(you)</span>}
                      {m.role === "admin" && <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-light"><Crown className="size-3" />Admin</span>}</p>
                    <p className={cn("truncate text-xs", m.presence?.active ? "text-success" : "text-text-2")}>{m.isMe ? `@${m.username}` : status ?? (m.username ? `@${m.username}` : "")}</p>
                  </div>
                  {!m.isMe && m.profileId && (
                    <div className="flex items-center gap-1">
                      {admin && <Button size="sm" variant="ghost" loading={busy === `role:${m.profileId}`}
                        onClick={() => run(`role:${m.profileId}`, () => api(`/conversations/${groupId}/members/${m.profileId}/admin`, { method: "PUT", body: { admin: m.role !== "admin" } }), m.role === "admin" ? "Admin removed" : "Made admin")}>
                        {m.role === "admin" ? "Remove admin" : "Make admin"}</Button>}
                      {admin && <button type="button" onClick={() => setConfirm({ kind: "remove", m })} className="rounded-lg p-2 text-text-2 hover:bg-white/5 hover:text-error" aria-label={`Remove ${m.displayName}`}><UserMinus className="size-4" /></button>}
                      <button type="button" onClick={() => setReport(m)} className="rounded-lg p-2 text-text-2 hover:bg-white/5 hover:text-text" aria-label={`Report ${m.displayName}`}><Flag className="size-4" /></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-text-2">Activity status shows only for your connections who share theirs. People you&apos;ve blocked (or who blocked you) are hidden.</p>
        </section>

        <Button variant="danger" className="w-full" icon={<LogOut className="size-4" />} onClick={() => setConfirm({ kind: "leave" })}>Leave group</Button>
      </div>

      <AddMembersDialog open={adding} onClose={() => setAdding(false)} groupId={groupId} onDone={onChanged} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger busy={!!busy}
        title={confirm?.kind === "leave" ? "Leave this group?" : `Remove ${confirm && "m" in confirm ? confirm.m.displayName : ""}?`}
        confirmLabel={confirm?.kind === "leave" ? "Leave" : "Remove"}
        body={confirm?.kind === "leave" ? "You'll stop receiving messages from this group. An admin can add you back." : "They'll stop receiving messages from this group."}
        onConfirm={async () => {
          if (!confirm) return;
          if (confirm.kind === "leave") {
            if (await run("leave", () => api(`/conversations/${groupId}/leave`, { method: "POST" }), "You left the group")) {
              await qc.invalidateQueries({ queryKey: ["conversations"] }); await qc.invalidateQueries({ queryKey: ["unread"] });
              router.replace("/app/messages");
            }
          } else await run("remove", () => api(`/conversations/${groupId}/members/${confirm.m.profileId}`, { method: "DELETE" }), "Member removed");
          setConfirm(null);
        }} />
      {report?.profileId && <ReportDialog open onClose={() => setReport(null)} profileId={report.profileId} name={report.displayName}
        messageId={thread.messages.filter((m) => m.sender?.profileId === report.profileId && !m.pending).at(-1)?.id} />}
    </Modal>
  );
}
