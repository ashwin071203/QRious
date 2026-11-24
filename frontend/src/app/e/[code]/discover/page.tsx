import { Suspense } from "react";
import type { Metadata } from "next";
import { PublicDiscover } from "./PublicDiscover";

export const metadata: Metadata = { title: "Discover people" };

/** Discover People (PRD §3.2 Option 1): anonymous browsing of opted-in public profiles. Never creates identity (BR-02). */
export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense>
      <PublicDiscover params={params} />
    </Suspense>
  );
}
