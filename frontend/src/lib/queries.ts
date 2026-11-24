"use client";

import { useEffect } from "react";
import { useLocal, writeLocal } from "@/lib/client-store";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConversationItem, Entitlements, MyEvent, OrgBilling, OrganizerMe, OwnProfile, SessionStatus, UnreadCounts } from "@/lib/types";

export const keys = {
  session: ["session"] as const,
  profile: ["profile"] as const,
  myEvents: (scope: string) => ["my-events", scope] as const,
  event: (id: string) => ["event", id] as const,
  sessions: ["sessions"] as const,
  recoveryStatus: ["recovery-status"] as const,
  unread: ["unread"] as const,
  conversations: ["conversations"] as const,
  entitlements: ["entitlements"] as const,
  organizer: ["organizer-me"] as const,
};

export const useSession = () => useQuery({ queryKey: keys.session, queryFn: () => api<SessionStatus>("/me/session") });
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: () => api<OwnProfile>("/me/profile") });
export const useMyEvents = (scope = "all") => useQuery({ queryKey: keys.myEvents(scope), queryFn: () => api<MyEvent[]>(`/me/events?scope=${scope}`) });
export const useEvent = (id: string) => useQuery({ queryKey: keys.event(id), queryFn: () => api<MyEvent>(`/events/${id}`), refetchInterval: 60_000 });
export const useEntitlements = () => useQuery({ queryKey: keys.entitlements, queryFn: () => api<Entitlements>("/entitlements") });
export const useOrganizer = () => useQuery({ queryKey: keys.organizer, queryFn: () => api<OrganizerMe>("/organizer/me") });

/** Near-real-time badges: polled while the tab is visible (D-29 — serverless, no WebSockets). */
export const useUnread = (enabled = true) =>
  useQuery({ queryKey: keys.unread, queryFn: () => api<UnreadCounts>("/me/unread-counts"), refetchInterval: 15_000, refetchIntervalInBackground: false, enabled });

export const useConversations = () =>
  useQuery({ queryKey: keys.conversations, queryFn: () => api<ConversationItem[]>("/conversations"), refetchInterval: 8_000, refetchIntervalInBackground: false });

export const LAST_EVENT = "qrious:lastEventId";
/** Remembers the event the attendee last used (per-browser convenience only). */
export function rememberEvent(eventId: string | undefined) {
  if (eventId) writeLocal(LAST_EVENT, eventId);
}
export const useLastEventId = () => useLocal(LAST_EVENT);
export function useRememberEvent(eventId: string | undefined) {
  useEffect(() => rememberEvent(eventId), [eventId]);
}

/** Plan, entitlements and lifetime event allowance of an organization (server-enforced; the UI only mirrors it). */
export const useOrgBilling = (orgId: string | null) =>
  useQuery({ queryKey: ["org-billing", orgId], enabled: !!orgId, queryFn: () => api<OrgBilling>(`/organizations/${orgId}/billing`) });
