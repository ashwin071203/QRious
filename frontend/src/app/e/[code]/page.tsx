import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { resolveQr } from "@/server/modules/events-core";
import { headline } from "@/server/modules/pulse";
import { getDb } from "@/server/db";
import { AppError } from "@/server/core/errors";
import type { PublicEvent } from "@/lib/types";
import { EventLanding, LandingSkeleton, QrStateView } from "./EventLanding";

export const metadata: Metadata = { title: "Event networking" };

/**
 * QR landing page (PRD §3.2, Module 1). Always exactly two primary options: Discover People and Create My Profile.
 * Server-rendered for a fast first paint on phones; no 3D on this route (D-07).
 */
export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<LandingSkeleton />}>
      <Landing params={params} />
    </Suspense>
  );
}

async function Landing({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const { code } = await params;
  let r: Awaited<ReturnType<typeof resolveQr>>;
  try {
    r = await resolveQr(code);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) return <QrStateView state="invalid" />;
    console.error("landing", e);
    return <QrStateView state="unavailable_server" />;
  }
  if (r.state !== "valid" || !r.event || !r.full) return <QrStateView state={r.state} event={r.event as unknown as PublicEvent | null} />;
  const event = JSON.parse(JSON.stringify({ ...r.event, headline: await headline(getDb(), r.full) })) as PublicEvent;
  return <EventLanding code={r.code} event={event} />;
}
