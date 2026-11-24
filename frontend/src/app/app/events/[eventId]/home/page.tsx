import { Suspense } from "react";
import { EventHome } from "./EventHome";

export default function Page({ params }: { params: Promise<{ eventId: string }> }) {
  return (
    <Suspense>
      <EventHome params={params} />
    </Suspense>
  );
}
