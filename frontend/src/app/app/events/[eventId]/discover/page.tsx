import { Suspense } from "react";
import { DiscoverView } from "./DiscoverView";

export default function Page({ params }: { params: Promise<{ eventId: string }> }) {
  return (
    <Suspense>
      <DiscoverView params={params} />
    </Suspense>
  );
}
