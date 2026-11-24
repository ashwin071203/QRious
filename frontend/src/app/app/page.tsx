"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useMyEvents } from "@/lib/queries";

/** Sends the attendee to their most relevant event home, or to My Events. */
export default function AppIndex() {
  const router = useRouter();
  const { data, isError } = useMyEvents("all");

  useEffect(() => {
    if (isError) router.replace("/app/events");
    if (!data) return;
    const current = data.find((e) => e.event.networkingStatus === "open" || e.event.networkingStatus === "paused") ?? data[0];
    router.replace(current ? `/app/events/${current.event.id}/home` : "/app/events");
  }, [data, isError, router]);

  return <div className="grid min-h-dvh place-items-center text-text-2"><Loader2 className="size-6 animate-spin" /></div>;
}
