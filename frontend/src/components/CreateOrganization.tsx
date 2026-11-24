"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { Button } from "@/components/ui/Button";
import { Field, Input, TextArea } from "@/components/ui/Form";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";

export function CreateOrganization() {
  const qc = useQueryClient();
  const toast = useToast();
  const { setOrgId } = useOrg();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await api<{ id: string }>("/organizations", { method: "POST", body: { name, description } });
      setOrgId(org.id);
      await qc.invalidateQueries();
      toast("success", "Organization created");
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors ? Object.values(err.errors)[0]![0]! : err.message) : "Couldn't create the organization.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-6">
        <span className="grid size-12 place-items-center rounded-2xl bg-grad-primary text-white"><Building2 className="size-6" /></span>
        <h1 className="mt-4 font-display text-2xl font-bold">Create your organization</h1>
        <p className="mt-1 text-sm text-text-2">Attendees see this name as the host of your events.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Organization name" required htmlFor="on"><Input id="on" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bangalore Indie Collective" /></Field>
          <Field label="About" optional htmlFor="od"><TextArea id="od" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <Button type="submit" className="w-full" size="lg" loading={busy}>Create organization</Button>
        </form>
      </div>
    </div>
  );
}
