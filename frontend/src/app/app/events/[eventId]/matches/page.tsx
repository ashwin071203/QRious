import { Suspense } from "react";
import { MatchesView } from "./MatchesView";

export default function Page({ params }: { params: Promise<{ eventId: string }> }) {
  return (
    <Suspense>
      <MatchesView params={params} />
    </Suspense>
  );
}
