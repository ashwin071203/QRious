// Types mirroring the QRious API v1 (docs/05-api-specification.md).

export type NetworkingStatus = "not_open" | "open" | "paused" | "ended" | "archived";
export type Visibility = "public" | "members" | "connections";

export interface PublicEvent {
  id: string; name: string; categorySlug: string; categoryName: string; description: string | null; bannerUrl: string | null;
  venueName: string; venueAddress: string | null; city: string | null; timeZone: string; startsAt: string; endsAt: string; website: string | null;
  organizer: { name: string; logoUrl: string | null }; networkingStatus: NetworkingStatus; networkingOpensAt: string; joinable: boolean;
  features: { discover: boolean; anonymousBrowsing: boolean; smartMatching: boolean; pulse: boolean; connections: boolean; messaging: boolean; availability: boolean };
  options: { discoverAvailable: boolean; anonymousBrowsing: boolean; createProfileAvailable: boolean };
  headline?: string | null;
}

export type QrState = "valid" | "revoked" | "expired" | "disabled" | "event_unavailable";
export interface QrResolution { state: QrState; code: string; event: PublicEvent | null }

export interface Photo { url: string; thumbnailUrl: string }
export interface ProfileSummary { id: string; displayName: string; username: string; photo: Photo | null }
export interface SessionStatus { authenticated: boolean; status: string | null; profile: ProfileSummary | null; isParticipant: boolean | null }

export interface Tag { id: string; name: string; group?: string | null; suggested?: boolean; pending?: boolean }
export type TagInput = { id?: string; name?: string };
export interface SocialLink { id?: string; platform: string; url: string; visibility: Visibility }

export interface OwnProfile {
  id: string; displayName: string; username: string; bio: string | null; profession: string | null; company: string | null; location: string | null;
  lookingForText: string | null; canOfferText: string | null; photo: Photo | null; interests: Tag[]; skills: Tag[]; lookingForSkills: Tag[];
  socialLinks: SocialLink[];
  privacy: { isPublic: boolean; anonymousVisibilityConsentedAt: string | null; companyVisibility: Visibility; locationVisibility: Visibility };
  usernameChangeAvailableAt: string | null; createdAt: string;
}

export interface CreateProfileResponse { profile: ProfileSummary; eventId: string; redirectTo: string; recoveryCode: string | null }

export interface Participation {
  participantId: string; status: string; discoveryPaused: boolean; availabilityStatus: string; availabilityVisibility: string;
  intentionIds: string[]; exportConsent: boolean; joinedAt: string;
}
export interface Intention { id: string; slug: string; label: string; group: string }
export interface MyEvent { event: PublicEvent; participation: Participation; intentions?: Intention[] }

export interface PersonCard {
  id: string; displayName: string; username: string; bio: string | null; profession: string | null; photo: Photo | null;
  interests: { id: string; name: string }[]; skills: { id: string; name: string }[]; company: string | null; location: string | null;
  socialLinks: { platform: string; url: string }[]; audience: "public" | "member" | "connection";
  lookingForText?: string | null; canOfferText?: string | null; lookingForSkills?: { id: string; name: string }[]; availability?: string | null;
  commonInterests?: string[]; complementarySkills?: string[]; saved?: boolean;
  connectionState?: "none" | "pending_outgoing" | "pending_incoming" | "connected" | "self"; connectionId?: string | null; eventId?: string | null;
}
export interface Page<T> { items: T[]; nextCursor: string | null; advancedFilters?: boolean }

export interface MatchItem {
  profile: { id: string; displayName: string; username: string; profession: string | null; bio: string | null; photo: Photo | null; availability: string | null };
  score: number; reasons: string[]; breakdown: { signal: string; points: number }[] | null;
}

export interface Pulse {
  generatedAt: string; threshold: number;
  totals: { participants: number | null; discoverable: number | null; openToTalk: number | null; lookingForCollaborators: number | null };
  byStatus: { status: string; count: number }[]; byIntention: { id: string; label: string; group: string; count: number }[];
  topInterests: { name: string; count: number }[]; topSkills: { name: string; count: number }[]; activityLastHour: Record<string, number | null>;
}

export interface ConnectionItem {
  id: string; status: string; direction: "sent" | "received"; introMessage: string | null; requestedAt: string; respondedAt: string | null;
  originEvent: { id: string; name: string }; profile: { id: string; displayName: string; username: string; profession: string | null; photo: Photo | null };
}

export interface ConversationItem {
  id: string; lastMessageAt: string | null; unreadCount: number; canSend: boolean; lastMessage: { body: string; mine: boolean } | null;
  originEvent: { id: string; name: string }; other: { profileId: string; displayName: string; username: string; thumbnailUrl: string | null };
}
export interface ChatMessage { id: number; mine: boolean; body: string; removed: boolean; createdAt: string; clientMessageId: string; pending?: boolean }
export interface Thread {
  conversation: { id: string; originEvent: { id: string; name: string } };
  other: { profileId: string; displayName: string; username: string; thumbnailUrl: string | null };
  canSend: boolean; otherLastReadMessageId: number; otherTyping: boolean; messages: ChatMessage[]; hasMore: boolean;
}

export interface NotificationItem {
  id: string; type: string; payload: { message?: string; intro?: string | null; preview?: string; eventName?: string; kind?: string };
  eventId: string | null; entityId: string | null; createdAt: string; readAt: string | null; actor: { id: string; displayName: string | null; thumbnailUrl: string | null } | null;
}
export interface UnreadCounts { notifications: number; requests: number; messages: number }

export interface SessionInfo { id: string; device: string; createdAt: string; lastSeenAt: string; expiresAt: string; absoluteExpiresAt: string; isCurrent: boolean }
export interface UsernameAvailability { available: boolean; normalized: string | null; reason: string | null; suggestions: string[] }

export interface Entitlements { planCode: string; planName: string; features: { featureKey: string; enabled: boolean; limit: number | null }[] }
export interface Plan { code: string; name: string; description: string | null; billingPeriod: string; priceMinor: number; currency: string; isDefault: boolean; features: string[] }

// Organizer
export interface OrganizerMe {
  authenticated: boolean;
  user?: { id: string; displayName: string; email: string; isAdmin: boolean; mfaEnrolled: boolean; mfaVerified: boolean };
  organizations?: { id: string; name: string; slug: string; logoUrl: string | null; status: string; role: string }[];
}
export interface OrgEventRow { id: string; name: string; categoryName: string; status: string; moderationStatus: string; startsAt: string; endsAt: string; timeZone: string; venueName: string; city: string | null; participantCount: number; bannerUrl: string | null }
export interface OrgEventDetail extends PublicEvent {
  status: string; moderationStatus: string; organizationId: string; categoryId: string; maxParticipants: number | null; participantCount: number; qrAccessEnabled: boolean;
  settings: Record<string, boolean | string | null>;
  qr: { code: string; url: string; createdAt: string } | null;
  suggestions: { interests: { id: string; name: string }[]; skills: { id: string; name: string }[]; intentionIds: string[] };
  intentionOptions: { id: string; label: string; group: string }[];
}
export interface Category { id: string; slug: string; name: string; description: string | null; imageUrl: string | null }
