"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MyEvent, OwnProfile, SessionStatus } from "@/lib/types";

export const keys = {
  session: ["session"] as const,
  profile: ["profile"] as const,
  myEvents: (scope: string) => ["my-events", scope] as const,
  event: (id: string) => ["event", id] as const,
  sessions: ["sessions"] as const,
  recoveryStatus: ["recovery-status"] as const,
};

export const useSession = () => useQuery({ queryKey: keys.session, queryFn: () => api<SessionStatus>("/me/session") });
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: () => api<OwnProfile>("/me/profile") });
export const useMyEvents = (scope = "all") => useQuery({ queryKey: keys.myEvents(scope), queryFn: () => api<MyEvent[]>(`/me/events?scope=${scope}`) });
export const useEvent = (id: string) => useQuery({ queryKey: keys.event(id), queryFn: () => api<MyEvent>(`/events/${id}`) });
