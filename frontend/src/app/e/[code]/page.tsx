import { Suspense } from "react";
import type { Metadata } from "next";
import { serverApi } from "@/lib/server-api";
import type { QrResolution } from "@/lib/types";
import { EventLanding, LandingSkeleton, QrStateView } from "./EventLanding";

export const metadata: Metadata = { title: "Event networking" };

/**
 * QR landing page (PRD §3.2, Module 1). Always exactly two primary options: Discover People and Create My Profile.
 * Server-rendered for a fast first paint on phones; no 3D, no realtime on this route (D-07).
 */
export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<LandingSkeleton />}>
      <Landing params={params} />
    </Suspense>
  );
}

async function Landing({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { status, data } = await serverApi<QrResolution>(`/public/qr/${encodeURIComponent(code)}`);

  if (status === 404) return <QrStateView state="invalid" />;
  if (!data) return <QrStateView state="unavailable_server" />;
  if (data.state !== "valid" || !data.event) return <QrStateView state={data.state} event={data.event} />;
  return <EventLanding code={code} event={data.event} />;
}
