import { Suspense } from "react";
import { ConnectionProfileView } from "./ConnectionProfileView";

export default function Page({ params }: { params: Promise<{ profileId: string }> }) {
  return (
    <Suspense>
      <ConnectionProfileView params={params} />
    </Suspense>
  );
}
