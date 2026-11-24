import { Suspense } from "react";
import { EventWorkspace } from "./EventWorkspace";

export default function Page({ params }: { params: Promise<{ eventId: string }> }) {
  return (
    <Suspense>
      <EventWorkspace params={params} />
    </Suspense>
  );
}
