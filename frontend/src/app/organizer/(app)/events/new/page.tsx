"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "@/components/OrganizerShell";
import { EventForm, initialForm } from "@/components/EventForm";
import { PageHeader } from "@/components/ui/Overlay";
import { CreateOrganization } from "@/components/CreateOrganization";
import { api } from "@/lib/api";

export default function NewEventPage() {
  const { orgId, me } = useOrg();
  const router = useRouter();
  const qc = useQueryClient();
  if (!me.organizations?.length) return <CreateOrganization />;
  return (
    <>
      <PageHeader title="New event" subtitle="Saved as a draft. Publish it when you're ready to share the QR code." />
      <EventForm initial={initialForm()} submitLabel="Create draft" onSubmit={async (body) => {
        const r = await api<{ id: string }>(`/organizations/${orgId}/events`, { method: "POST", body });
        await qc.invalidateQueries({ queryKey: ["org-events"] });
        router.push(`/organizer/events/${r.id}`);
      }} />
    </>
  );
}
