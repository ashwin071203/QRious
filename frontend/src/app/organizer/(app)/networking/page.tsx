"use client";

import { Suspense } from "react";
import { Settings2 } from "lucide-react";
import { EventScopedPage } from "@/components/EventScopedPage";
import { NetworkingTab } from "../events/[eventId]/EventWorkspace";

/** Networking configuration (PRD §6, M15): which networking features each event offers. */
function Networking() {
  return (
    <EventScopedPage title="Networking" subtitle="Choose which networking features each event offers its attendees." icon={<Settings2 className="size-6" />}
      filter={(e) => e.status !== "archived"} emptyHint="Archived events can't be reconfigured.">
      {(e, onChange) => <NetworkingTab e={e} onChange={onChange} />}
    </EventScopedPage>
  );
}

export default function Page() {
  return <Suspense><Networking /></Suspense>;
}
