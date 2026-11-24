"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { CreateOrganization } from "@/components/CreateOrganization";
import { Button } from "@/components/ui/Button";
import { Field, Input, TextArea } from "@/components/ui/Form";
import { Skeleton } from "@/components/ui/Misc";
import { PageHeader } from "@/components/ui/Overlay";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";

type Org = { id: string; name: string; description: string | null; logoUrl: string | null; contactEmail: string | null; contactPhone: string | null; website: string | null; role: string };

/** Organization profile (M13): name, description, logo, contact details. Owners edit; members view. */
export default function OrganizationPage() {
  const { orgId, me } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["org", orgId], enabled: !!orgId, queryFn: () => api<Org>(`/organizations/${orgId}`) });
  if (!me.organizations?.length) return <CreateOrganization />;
  if (!q.data || !orgId) return <Skeleton className="h-96" />;
  return <OrgForm key={q.data.id} org={q.data} orgId={orgId} onSaved={() => qc.invalidateQueries()} toast={toast} />;
}

function OrgForm({ org, orgId, onSaved, toast }: { org: Org; orgId: string; onSaved: () => Promise<unknown>; toast: ReturnType<typeof useToast> }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: org.name, description: org.description ?? "", contactEmail: org.contactEmail ?? "", contactPhone: org.contactPhone ?? "", website: org.website ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const owner = org.role === "owner";
  const q = { data: org };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api(`/organizations/${orgId}`, { method: "PATCH", body: f });
      await onSaved();
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
        const fd = new FormData();
        fd.append("file", file);
        await api(`/organizations/${orgId}/logo`, { method: "PUT", body: fd });
      } else await api(`/organizations/${orgId}/logo`, { method: "DELETE" });
      await qc.invalidateQueries();
      toast("success", file ? "Logo updated" : "Logo removed");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Couldn't update the logo.");
    }
  }

  return (
    <>
      <PageHeader title="Organization" subtitle={owner ? "Shown to attendees on your event pages." : "Only the owner can edit these details."} />
      <form onSubmit={save} className="max-w-2xl space-y-5">
        <section className="card flex items-center gap-4 p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {q.data.logoUrl ? <img src={q.data.logoUrl} alt="" className="size-20 rounded-2xl object-cover" /> : <span className="grid size-20 place-items-center rounded-2xl bg-card-2 font-display text-2xl">{q.data.name[0]}</span>}
          {owner && <div className="flex gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-2xl border border-line-strong bg-card-2 px-3.5 text-sm font-semibold"><ImagePlus className="size-4" />Upload logo
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void logo(file); e.target.value = ""; }} /></label>
            {q.data.logoUrl && <Button type="button" size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => logo(null)}>Remove</Button>}
          </div>}
        </section>
        <section className="card space-y-5 p-5">
          <Field label="Name" required htmlFor="n" error={errors.name}><Input id="n" disabled={!owner} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Description" optional htmlFor="d" error={errors.description}><TextArea id="d" disabled={!owner} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Contact email" optional htmlFor="ce" error={errors.contactEmail}><Input id="ce" disabled={!owner} type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
            <Field label="Contact phone" optional htmlFor="cp" error={errors.contactPhone}><Input id="cp" disabled={!owner} value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
          </div>
          <Field label="Website" optional htmlFor="w" error={errors.website}><Input id="w" disabled={!owner} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" /></Field>
        </section>
        {owner && <div className="flex justify-end"><Button type="submit" loading={busy}>Save</Button></div>}
      </form>
    </>
  );
}
