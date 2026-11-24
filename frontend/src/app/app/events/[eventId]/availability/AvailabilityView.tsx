"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Check, EyeOff, LogOut } from "lucide-react";
import { AttendeePage } from "@/components/AppShell";
import { AVAILABILITY_OPTIONS } from "@/components/People";
import { Chip, Skeleton } from "@/components/ui/Misc";
import { Button } from "@/components/ui/Button";
import { Select, Toggle } from "@/components/ui/Form";
import { ConfirmDialog, PageHeader } from "@/components/ui/Overlay";
import { useToast } from "@/components/Providers";
import { api, ApiError } from "@/lib/api";
import { keys, LAST_EVENT, useEvent, useRememberEvent } from "@/lib/queries";
import { writeLocal } from "@/lib/client-store";
import { cn } from "@/lib/format";

/** Open to Talk (M08) + event-specific intentions + pause discovery (M04, BR-11, BR-12). */
export function AvailabilityView({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  useRememberEvent(eventId);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useEvent(eventId);
  const [busy, setBusy] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  async function update(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const r = await api(`/events/${eventId}/me`, { method: "PATCH", body });
      qc.setQueryData(keys.event(eventId), r);
      qc.invalidateQueries({ queryKey: ["pulse", eventId] });
      if (ok) toast("success", ok);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Couldn't update.");
    } finally {
      setBusy(false);
    }
  }

  const p = data?.participation;
  const intents = data?.intentions ?? [];

  return (
    <AttendeePage eventId={eventId} title="Open to Talk" className="max-w-2xl">
      <PageHeader title="Open to Talk" subtitle={data ? `Your status at ${data.event.name} only.` : undefined} />
      {isLoading || !p ? <Skeleton className="h-96" /> : (
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="font-display font-semibold">Your status</h2>
            {!data.event.features.availability && <p className="mt-2 text-sm text-warning">The organizer has turned off availability for this event.</p>}
            <div className="mt-4 grid gap-2">
              {AVAILABILITY_OPTIONS.map((o) => {
                const active = p.availabilityStatus === o.value;
                return (
                  <motion.button key={o.value} layout disabled={busy || !data.event.features.availability} onClick={() => update({ availabilityStatus: o.value }, `Status: ${o.label}`)}
                    className={cn("flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-50", active ? "border-primary bg-primary/15" : "border-line bg-bg-2 hover:border-accent/40")}>
                    <span className={cn("size-3 rounded-full", o.tone)} />
                    <span className="flex-1 font-medium">{o.label}</span>
                    {active && <Check className="size-5 text-accent" />}
                  </motion.button>
                );
              })}
            </div>
            <label className="mt-4 block text-sm">
              <span className="mb-1.5 block font-medium">Who can see your status</span>
              <Select className="h-11" value={p.availabilityVisibility} disabled={busy} onChange={(e) => update({ availabilityVisibility: e.target.value }, "Visibility updated")}>
                <option value="members">Everyone at this event</option><option value="connections">Only my connections</option><option value="hidden">No one</option>
              </Select>
            </label>
          </section>

          {intents.length > 0 && (
            <section className="card p-5">
              <h2 className="font-display font-semibold">What brings you here?</h2>
              <p className="mt-1 text-sm text-text-2">Helps Smart Matching and Event Pulse. Specific to this event.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {intents.map((i) => {
                  const on = p.intentionIds.includes(i.id);
                  return <Chip key={i.id} selected={on} onClick={() => update({ intentionIds: on ? p.intentionIds.filter((x) => x !== i.id) : [...p.intentionIds, i.id] })}>{on && <Check className="size-3.5" />}{i.label}</Chip>;
                })}
              </div>
            </section>
          )}

          <section className="card space-y-5 p-5">
            <Toggle checked={p.discoveryPaused} disabled={busy} onChange={(v) => update({ discoveryPaused: v }, v ? "You're hidden from Discover" : "You're discoverable again")}
              label={<span className="inline-flex items-center gap-2"><EyeOff className="size-4 text-accent" />Pause discovery</span>}
              description="Hide yourself from Discover, Smart Matches and new requests at this event. Existing connections keep working." />
            <Toggle checked={p.exportConsent} disabled={busy} onChange={(v) => update({ exportConsent: v }, "Saved")}
              label="Include me in the organizer's attendee list export" description="Shares your display name, username and profession with the organizer. Off by default." />
          </section>

          <section className="card p-5">
            <Button variant="danger" icon={<LogOut className="size-4" />} onClick={() => setLeaveOpen(true)}>Leave this event</Button>
          </section>
          <ConfirmDialog open={leaveOpen} onClose={() => setLeaveOpen(false)} danger confirmLabel="Leave event" busy={busy} title="Leave this event?"
            body="You'll disappear from this event's Discover and Pulse. Your profile, connections and chats stay. You can rejoin by scanning the event QR again."
            onConfirm={async () => {
              setBusy(true);
              try { await api(`/events/${eventId}/participation`, { method: "DELETE" }); writeLocal(LAST_EVENT, null); qc.clear(); router.replace("/app/events"); }
              catch (e) { toast("error", e instanceof ApiError ? e.message : "Couldn't leave."); setBusy(false); }
            }} />
        </div>
      )}
    </AttendeePage>
  );
}
