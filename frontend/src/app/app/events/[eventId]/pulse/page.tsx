import { Suspense } from "react";
import { PulseView } from "./PulseView";

export default function Page({ params }: { params: Promise<{ eventId: string }> }) {
  return (
    <Suspense>
      <PulseView params={params} />
    </Suspense>
  );
}
