"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SessionStatus } from "@/lib/types";
import { Avatar } from "@/components/ui/Misc";

/**
 * Recognises a returning attendee from their existing browser session (PRD §3.4) and personalises the
 * Create My Profile option. It never replaces the two options and never exposes a profile by username.
 */
export function ReturningHint({ eventId }: { eventId: string }) {
  const [session, setSession] = useState<SessionStatus | null>(null);

  useEffect(() => {
    api<SessionStatus>(`/me/session?eventId=${eventId}`).then(setSession).catch(() => {});
  }, [eventId]);

  if (!session?.authenticated || !session.profile) return null;
  return (
    <span className="mt-4 flex items-center gap-2.5 rounded-2xl bg-black/25 px-3 py-2 text-sm">
      <Avatar name={session.profile.displayName} src={session.profile.photo?.thumbnailUrl} size={28} />
      <span className="min-w-0 truncate">
        {session.isParticipant ? "You've joined — " : "Continue as "}
        <span className="font-semibold">{session.profile.displayName}</span>
      </span>
    </span>
  );
}
