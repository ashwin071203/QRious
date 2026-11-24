import { Suspense } from "react";
import { AvailabilityView } from "./AvailabilityView";

export default function Page({ params }: { params: Promise<{ eventId: string }> }) {
  return (
    <Suspense>
      <AvailabilityView params={params} />
    </Suspense>
  );
}
