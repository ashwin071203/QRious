import { Suspense } from "react";
import { PersonView } from "./PersonView";

export default function Page({ params }: { params: Promise<{ eventId: string; profileId: string }> }) {
  return (
    <Suspense>
      <PersonView params={params} />
    </Suspense>
  );
}
