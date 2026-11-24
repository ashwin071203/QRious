"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Infinity as InfinityIcon, Sparkles, Ticket } from "lucide-react";
import { useOrg } from "@/components/OrganizerShell";
import { EventForm, initialForm } from "@/components/EventForm";
import { AllowanceMeter } from "@/components/OrgPlan";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Misc";
import { PageHeader } from "@/components/ui/Overlay";
import { CreateOrganization } from "@/components/CreateOrganization";
import { api, ApiError } from "@/lib/api";
import { useOrgBilling } from "@/lib/queries";

export default function NewEventPage() {
  const { orgId, me } = useOrg();
  const router = useRouter();
  const qc = useQueryClient();
  const b = useOrgBilling(orgId);
  if (!me.organizations?.length) return <CreateOrganization />;
  if (!b.data) return <Skeleton className="h-96" />;
  const a = b.data.allowance;

  if (!a.canCreateEvent) {
    return (
      <>
        <PageHeader title="New event" />
        <section className="card max-w-2xl p-6">
          <h2 className="font-display text-xl font-semibold">You&apos;ve used your 3 free events</h2>
          <p className="mt-2 text-sm text-text-2">Every organization gets 3 free events for life. To create more, choose a plan or buy a single event. Your existing events and data are always kept.</p>
          <AllowanceMeter a={a} className="mt-5" />
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href="/organizer/billing" icon={<Sparkles className="size-4" />}>Upgrade to Pro — ₹499/month</ButtonLink>
            <ButtonLink href="/organizer/billing" variant="secondary" icon={<Ticket className="size-4" />}>Buy one event — ₹199</ButtonLink>
          </div>
        </section>
      </>
    );
  }

  const uses = a.freeRemaining > 0
    ? { icon: <CreditCard className="size-4" />, text: `Uses 1 of your ${a.freeRemaining} remaining free event${a.freeRemaining === 1 ? "" : "s"}. Deleting an event doesn't give it back.` }
    : a.unlimited ? { icon: <InfinityIcon className="size-4" />, text: "Included in your plan — unlimited events." }
    : { icon: <Ticket className="size-4" />, text: `Uses 1 Single Event credit (${a.credits} available).` };

  return (
    <>
      <PageHeader title="New event" subtitle="Saved as a draft. Publish it when you're ready to share the QR code." />
      <p className="mb-5 flex items-center gap-2 rounded-2xl border border-line bg-card px-4 py-3 text-sm text-text-2"><span className="text-accent-light">{uses.icon}</span>{uses.text}</p>
      <EventForm initial={initialForm()} submitLabel="Create draft" onSubmit={async (body) => {
        try {
          const r = await api<{ id: string }>(`/organizations/${orgId}/events`, { method: "POST", body });
          await Promise.all([qc.invalidateQueries({ queryKey: ["org-events"] }), qc.invalidateQueries({ queryKey: ["org-billing", orgId] }), qc.invalidateQueries({ queryKey: ["dashboard"] })]);
          router.push(`/organizer/events/${r.id}`);
        } catch (err) {
          // Another member may have used the last free event in the meantime; the server is the source of truth.
          if (err instanceof ApiError && err.status === 402) await qc.invalidateQueries({ queryKey: ["org-billing", orgId] });
          throw err;
        }
      }} />
    </>
  );
}
