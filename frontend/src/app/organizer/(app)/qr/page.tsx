"use client";

import { Suspense } from "react";
import { QrCode } from "lucide-react";
import { EventScopedPage } from "@/components/EventScopedPage";
import { QrTab } from "../events/[eventId]/EventWorkspace";

/** QR Management (PRD §6): view, download, regenerate, revoke and pause the QR code of any event. */
function QrManagement() {
  return (
    <EventScopedPage title="QR Management" subtitle="Download, share, pause, regenerate or revoke each event's QR code." icon={<QrCode className="size-6" />}
      filter={(e) => e.status !== "archived"} emptyHint="Archived events don't have QR codes to manage.">
      {(e, onChange) => <QrTab e={e} onChange={onChange} />}
    </EventScopedPage>
  );
}

export default function Page() {
  return <Suspense><QrManagement /></Suspense>;
}
