"use client";

import { Suspense } from "react";
import { Users } from "lucide-react";
import { EventScopedPage } from "@/components/EventScopedPage";
import { ParticipantsTab } from "../events/[eventId]/EventWorkspace";

/** Participants (PRD §6, M14): search, review, remove and restore participants per event. */
function Participants() {
  return (
    <EventScopedPage title="Participants" subtitle="See who joined each event, search them, and remove or restore participants." icon={<Users className="size-6" />}
      filter={(e) => e.status !== "draft"} emptyHint="Publish an event to start receiving participants.">
      {(e) => <ParticipantsTab eventId={e.id} />}
    </EventScopedPage>
  );
}

export default function Page() {
  return <Suspense><Participants /></Suspense>;
}
