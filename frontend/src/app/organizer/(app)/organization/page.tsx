"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ImagePlus, LogOut, Trash2, UserPlus, Users } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { AllowanceMeter, PlanBadge, UpgradeHint } from "@/components/OrgPlan";
import { CreateOrganization } from "@/components/CreateOrganization";
import { Button } from "@/components/ui/Button";
import { Field, Input, TextArea } from "@/components/ui/Form";
import { Avatar, Skeleton } from "@/components/ui/Misc";
import { ConfirmDialog, ErrorState, PageHeader } from "@/components/ui/Overlay";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { keys, useOrgBilling } from "@/lib/queries";

type Org = { id: string; name: string; slug: string; description: string | null; logoUrl: string | null; contactEmail: string | null; contactPhone: string | null; website: string | null; role: string; createdAt: string };
type Members = { myRole: string; canInvite: boolean; membersFeature: boolean; limit: number; members: { userId: string; displayName: string; email: string; role: string; joinedAt: string; isMe: boolean }[] };

/** Organization (M13): profile, logo, contact details, plan & allowance, and team members (Business). */
export default function OrganizationPage() {
  const { orgId, me } = useOrg();
  const q = useQuery({ queryKey: ["org", orgId], enabled: !!orgId, queryFn: () => api<Org>(`/organizations/${orgId}`) });
  if (!me.organizations?.length) return <CreateOrganization />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data || !orgId) return <Skeleton className="h-96" />;
  return (
    <>
      <PageHeader title="Organization" subtitle={q.data.role === "owner" ? "Shown to attendees on your event pages." : "Only the owner can edit these details."} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <OrgForm key={q.data.id} org={q.data} orgId={orgId} />
        <aside className="space-y-5">
          <PlanCard orgId={orgId} />
          <MembersCard orgId={orgId} />
        </aside>
      </div>
    </>
  );
}

function OrgForm({ org, orgId }: { org: Org; orgId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: org.name, description: org.description ?? "", contactEmail: org.contactEmail ?? "", contactPhone: org.contactPhone ?? "", website: org.website ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const owner = org.role === "owner";
  const dirty = f.name !== org.name || f.description !== (org.description ?? "") || f.contactEmail !== (org.contactEmail ?? "") || f.contactPhone !== (org.contactPhone ?? "") || f.website !== (org.website ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!f.name.trim()) local.name = "Enter an organization name.";
    if (f.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.contactEmail.trim())) local.contactEmail = "Enter a valid email.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await api(`/organizations/${orgId}`, { method: "PATCH", body: f });
      await Promise.all([qc.invalidateQueries({ queryKey: ["org", orgId] }), qc.invalidateQueries({ queryKey: keys.organizer })]);
      toast("success", "Organization saved");
    } catch (err) {
      if (err instanceof ApiError && err.errors) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]!])));
      toast("error", err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function logo(file: File | null) {
    try {
      if (file) {
        if (file.size > 4 * 1024 * 1024) return toast("error", "Logos must be 4 MB or smaller.");
        const fd = new FormData();
        fd.append("file", file);
        await api(`/organizations/${orgId}/logo`, { method: "PUT", body: fd });
      } else await api(`/organizations/${orgId}/logo`, { method: "DELETE" });
      await Promise.all([qc.invalidateQueries({ queryKey: ["org", orgId] }), qc.invalidateQueries({ queryKey: keys.organizer })]);
      toast("success", file ? "Logo updated" : "Logo removed");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Couldn't update the logo.");
    }
  }

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      <section className="card flex flex-wrap items-center gap-4 p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {org.logoUrl ? <img src={org.logoUrl} alt="" className="size-20 rounded-2xl object-cover" /> : <span className="grid size-20 place-items-center rounded-2xl bg-card-2 font-display text-2xl">{org.name[0]}</span>}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold">{org.name}</p>
          <p className="text-sm text-text-2">qrious/{org.slug} · You are the {org.role}</p>
        </div>
        {owner && <div className="flex gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-2xl border border-line-strong bg-card-2 px-3.5 text-sm font-semibold hover:border-accent/60"><ImagePlus className="size-4" />Upload logo
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void logo(file); e.target.value = ""; }} /></label>
          {org.logoUrl && <Button type="button" size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => logo(null)}>Remove</Button>}
        </div>}
      </section>
      <section className="card space-y-5 p-5">
        <h2 className="font-display font-semibold">Profile</h2>
        <Field label="Name" required htmlFor="n" error={errors.name}><Input id="n" disabled={!owner} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Description" optional htmlFor="d" error={errors.description} hint={`${f.description.length}/2000`}><TextArea id="d" disabled={!owner} value={f.description} maxLength={2000} rows={4} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </section>
      <section className="card space-y-5 p-5">
        <h2 className="font-display font-semibold">Contact</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Contact email" optional htmlFor="ce" error={errors.contactEmail}><Input id="ce" disabled={!owner} type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
          <Field label="Contact phone" optional htmlFor="cp" error={errors.contactPhone}><Input id="cp" disabled={!owner} type="tel" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
        </div>
        <Field label="Website" optional htmlFor="w" error={errors.website}><Input id="w" disabled={!owner} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" /></Field>
      </section>
      {owner && <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-sm text-text-2">Unsaved changes</span>}
        <Button type="submit" loading={busy} disabled={!dirty}>Save changes</Button>
      </div>}
    </form>
  );
}

function PlanCard({ orgId }: { orgId: string }) {
  const b = useOrgBilling(orgId);
  if (!b.data) return <Skeleton className="h-48" />;
  const sub = b.data.subscription;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-semibold">Plan</h2>
        <PlanBadge tier={b.data.tier} />
      </div>
      {sub && ["active", "pending"].includes(sub.status) && <p className="mt-1 text-sm text-text-2">{sub.cancelAtPeriodEnd ? "Ends" : "Renews"} {sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}</p>}
      {b.data.promotion && <p className="mt-1 text-sm text-text-2">{b.data.promotion.planName} (promotional) until {new Date(b.data.promotion.endsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>}
      <AllowanceMeter a={b.data.allowance} className="mt-4" />
      <Link href="/organizer/billing" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent-light hover:underline">Billing & Plans<ArrowRight className="size-4" /></Link>
    </section>
  );
}

function MembersCard({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const q = useQuery({ queryKey: ["org-members", orgId], queryFn: () => api<Members>(`/organizations/${orgId}/members`) });
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<Members["members"][number] | null>(null);
  if (!q.data) return <Skeleton className="h-40" />;
  const d = q.data;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError("Enter a valid email.");
    setBusy(true);
    try {
      await api(`/organizations/${orgId}/members`, { method: "POST", body: { email: email.trim() } });
      setEmail("");
      toast("success", "Member added");
      await q.refetch();
    } catch (err) {
      if (err instanceof ApiError) setError(err.fieldError("email") ?? err.message);
    } finally { setBusy(false); }
  }

  async function confirmRemove() {
    if (!remove) return;
    setBusy(true);
    try {
      await api(`/organizations/${orgId}/members/${remove.userId}`, { method: "DELETE" });
      if (remove.isMe) {
        toast("success", "You left the organization");
        await qc.invalidateQueries();
        router.replace("/organizer/dashboard");
      } else {
        toast("success", "Member removed");
        await q.refetch();
      }
      setRemove(null);
    } catch (err) { toast("error", err instanceof ApiError ? err.message : "Couldn't remove."); }
    finally { setBusy(false); }
  }

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-display font-semibold"><Users className="size-4 text-accent-light" />Team <span className="text-sm font-normal text-text-2">{d.members.length}/{d.limit}</span></h2>
      <ul className="mt-3 divide-y divide-line">
        {d.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 py-2.5">
            <Avatar name={m.displayName} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.displayName}{m.isMe && <span className="text-text-2"> (you)</span>}</p>
              <p className="truncate text-xs text-text-2">{m.email} · {m.role === "owner" ? "Owner" : "Member"}</p>
            </div>
            {m.role !== "owner" && (d.myRole === "owner" || m.isMe) && (
              <button type="button" onClick={() => setRemove(m)} className="rounded-lg p-1.5 text-text-2 hover:bg-white/5 hover:text-error" aria-label={m.isMe ? "Leave organization" : `Remove ${m.displayName}`}>
                {m.isMe ? <LogOut className="size-4" /> : <Trash2 className="size-4" />}
              </button>
            )}
          </li>
        ))}
      </ul>
      {d.canInvite ? (
        <form onSubmit={add} className="mt-3 space-y-2" noValidate>
          <Field label="Add a member" htmlFor="member-email" error={error} hint="They need a QRious organizer account.">
            <div className="flex gap-2">
              <Input id="member-email" type="email" placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button type="submit" variant="secondary" icon={<UserPlus className="size-4" />} loading={busy} aria-label="Add member" />
            </div>
          </Field>
        </form>
      ) : !d.membersFeature && d.myRole === "owner" ? (
        <UpgradeHint plan="Business" title="Add team members" className="mt-3">Invite other organizers to manage events together.</UpgradeHint>
      ) : null}
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} danger busy={busy} title={remove?.isMe ? "Leave this organization?" : `Remove ${remove?.displayName}?`}
        confirmLabel={remove?.isMe ? "Leave" : "Remove"}
        body={remove?.isMe ? "You'll lose access to its events. The owner can add you again." : "They'll lose access to this organization's events. Events they created are kept."}
        onConfirm={confirmRemove} />
    </section>
  );
}
