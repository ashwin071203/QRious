import { Suspense } from "react";
import { ThreadView } from "./ThreadView";

export default function Page({ params }: { params: Promise<{ conversationId: string }> }) {
  return (
    <Suspense>
      <ThreadView params={params} />
    </Suspense>
  );
}
