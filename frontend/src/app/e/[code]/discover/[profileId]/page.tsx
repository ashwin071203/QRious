import { Suspense } from "react";
import { PublicPerson } from "./PublicPerson";

export default function Page({ params }: { params: Promise<{ code: string; profileId: string }> }) {
  return (
    <Suspense>
      <PublicPerson params={params} />
    </Suspense>
  );
}
