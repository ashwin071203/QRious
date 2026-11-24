// Types mirroring the QRious API v1 contracts (docs/05-api-specification.md).

export type NetworkingStatus = "not_open" | "open" | "paused" | "ended" | "archived";

export interface PublicEvent {
  id: string;
  name: string;
  categorySlug: string;
  categoryName: string;
  description: string | null;
  bannerUrl: string | null;
  venueName: string;
  venueAddress: string | null;
  city: string | null;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  website: string | null;
  organizer: { name: string; logoUrl: string | null };
  networkingStatus: NetworkingStatus;
  networkingOpensAt: string;
  joinable: boolean;
  options: { discoverAvailable: boolean; anonymousBrowsing: boolean; createProfileAvailable: boolean };
}

export type QrState = "valid" | "revoked" | "expired" | "disabled" | "event_unavailable";

export interface QrResolution {
  state: QrState;
  code: string;
  event: PublicEvent | null;
}

export interface Photo {
  url: string;
  thumbnailUrl: string;
}

export interface ProfileSummary {
  id: string;
  displayName: string;
  username: string;
  photo: Photo | null;
}

export interface SessionStatus {
  authenticated: boolean;
  profile: ProfileSummary | null;
  isParticipant: boolean | null;
}

export interface Tag {
  id: string;
  name: string;
  group?: string | null;
  suggested?: boolean;
  pending?: boolean;
}

export type TagInput = { id?: string; name?: string };

export type Visibility = "public" | "members" | "connections";

export interface SocialLink {
  id?: string;
  platform: string;
  url: string;
  visibility: Visibility;
}

export interface OwnProfile {
  id: string;
  displayName: string;
  username: string;
  bio: string | null;
  profession: string | null;
  company: string | null;
  location: string | null;
  lookingForText: string | null;
  canOfferText: string | null;
  photo: Photo | null;
  interests: Tag[];
  skills: Tag[];
  lookingForSkills: Tag[];
  socialLinks: SocialLink[];
  privacy: {
    isPublic: boolean;
    anonymousVisibilityConsentedAt: string | null;
    companyVisibility: Visibility;
    locationVisibility: Visibility;
  };
  usernameChangeAvailableAt: string | null;
  createdAt: string;
}

export interface CreateProfileResponse {
  profile: ProfileSummary;
  eventId: string;
  redirectTo: string;
  recoveryCode: string | null;
}

export interface Participation {
  participantId: string;
  status: string;
  discoveryPaused: boolean;
  availabilityStatus: string;
  availabilityVisibility: string;
  joinedAt: string;
}

export interface MyEvent {
  event: PublicEvent;
  participation: Participation;
}

export interface SessionInfo {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  isCurrent: boolean;
}

export interface UsernameAvailability {
  available: boolean;
  normalized: string | null;
  reason: string | null;
  suggestions: string[];
}
