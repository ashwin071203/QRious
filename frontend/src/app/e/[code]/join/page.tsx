import { Suspense } from "react";
import type { Metadata } from "next";
import { JoinFlow } from "./JoinFlow";
import { Skeleton } from "@/components/ui/Misc";

export const metadata: Metadata = { title: "Create your profile" };

export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl space-y-4 px-5 pt-24"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64" /></div>}>
      <JoinFlow params={params} />
    </Suspense>
  );
}
