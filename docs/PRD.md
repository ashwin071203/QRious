# UNIVERSAL EVENT NETWORKING PLATFORM
## Complete Product Description, Features & Technical Requirements

**Document Type:** Product Requirements & Application Specification  
**Version:** 1.1 (amended 2026-11-24 with approved decisions D-01, D-05, D-06, D-07, D-08, D-13, D-20 — see `02-decisions-and-conflicts.md`)  
**Status:** Consolidated MVP Specification  
**Design Theme:** Premium Dark Violet  
**Platform Strategy:** Web First, Mobile Ready

---

# 1. PRODUCT OVERVIEW

## 1.1 Product Concept

The Universal Event Networking Platform is a digital networking application that helps people attending the same event discover one another, identify shared interests and complementary skills, build meaningful connections and communicate.

The platform uses QR-based event entry to provide attendees with a simple way to access an event-specific networking environment.

It supports different types of events, including:

- Concerts and music festivals
- Weddings and social gatherings
- College festivals
- Conferences and workshops
- Business meetups
- Art exhibitions
- Cultural festivals
- Community gatherings
- Sports and entertainment events
- Other custom events

The application is not restricted to one industry or event category. It uses one common networking system while adapting interests, skills, intentions and discovery recommendations to the type of event.

## 1.2 Problem Statement

At most events, attendees are surrounded by people who may share their interests, skills, professions or goals. However, they often do not know who is attending or how to approach relevant people.

Examples:

- A musician attending a concert wants to find a guitarist or vocalist.
- A college student wants to meet people with similar interests.
- A business professional wants to find potential partners.
- An artist wants to meet other creative professionals.
- A wedding guest wants to discover and meet other guests.
- A conference attendee wants to connect with people in the same industry.

The platform solves this problem by creating a digital networking environment for every event.

## 1.3 Core Product Statement

"An application that allows people attending the same event to discover one another, find relevant connections and communicate through a simple QR-based networking experience."

## 1.4 Two Main Platform Experiences

**Attendee Networking**
- Create and manage attendee profiles.
- Discover people attending an event.
- Find relevant people through Smart Matching.
- Display networking availability.
- View live event networking activity.
- Send and receive connection requests.
- Communicate privately.

**Event Management**
- Organizer registration and login.
- Organization management.
- Event creation and publishing.
- QR code generation.
- Participant management.
- Networking configuration.
- Event Pulse monitoring.

Both experiences use the same platform and backend.

---

# 2. USER TYPES

## 2.1 Attendees

People who want to discover and connect with other people attending events.

They can:
- Browse public profiles without registering.
- Create a reusable attendee profile.
- Participate in multiple events.
- Discover other participants.
- Search and filter profiles.
- Receive Smart Match recommendations.
- Set networking availability.
- View Event Pulse.
- Send connection requests.
- Chat with accepted connections.
- Manage privacy and profile settings.

## 2.2 Event Organizers

Individuals or organizations that create and manage events.

They can:
- Register and log in.
- Create an organization profile.
- Create and publish events.
- Generate event QR codes.
- Configure networking features.
- View and manage participants.
- Monitor networking activity.
- Manage event settings and reports.

## 2.3 Platform Administrators

Platform administrators manage the overall application.

They can:
- Search and manage users.
- Suspend and restore accounts.
- Search organizations.
- Review and manage events.
- Review user reports.
- Manage predefined interests and skills.
- Manage event categories.
- Monitor basic platform health and logs.

---

# 3. CORE QR ENTRY AND ATTENDEE ONBOARDING

This is a critical part of the application. The approved user flow must be preserved exactly.

## 3.1 QR Code Scanning

Every published event can have a standard event QR code.

Attendees can scan it using:
- Google Lens.
- Chrome Lens.
- Their phone camera.
- Any standard QR scanner.

The QR code opens the event's public landing page in a browser.

App installation must not be required.

The QR code must contain a secure event URL or public event identifier. It must never expose private database information or attendee credentials.

## 3.2 Event Landing Page

The landing page displays:

- Event name.
- Event banner or cover image.
- Event category.
- Date and time.
- Venue.
- Description.
- Organizer information.
- Networking availability status.

It must show exactly two primary options.

### OPTION 1: DISCOVER PEOPLE

**Purpose:** Allow visitors to browse opted-in public attendee profiles without creating an account.

Anonymous visitors can:

- Browse public attendee profiles.
- Search by display name.
- Search by username.
- Explore interests.
- Explore skills.
- View permitted profile information.
- Filter profiles using available public information.

Anonymous visitors cannot:

- Send connection requests.
- Accept connection requests.
- Use personalized Smart Matching.
- Change networking availability.
- Send private messages.
- Access other member-only features.

If an anonymous visitor attempts a restricted action, the application explains that profile creation is required.

Anonymous browsing must never create an attendee identity or event participation record.

### OPTION 2: CREATE MY PROFILE

**Purpose:** Allow a new attendee to create a reusable networking identity.

The form must be simple and must not feel like lengthy registration.

#### Mandatory fields

| Field | Requirement |
|---|---|
| Display name | Mandatory |
| Username | Mandatory and globally unique |
| Interests | Mandatory, at least one |
| Skills | Mandatory, at least one |

#### Optional fields

| Field | Description |
|---|---|
| Profile photo | Upload or take a photo |
| Short bio | Personal introduction |
| Profession/role | Current occupation or role |
| Company/college | Organization or institution |
| Location | City or area |
| What I am looking for | Networking goals and opportunities |
| What I can offer | Skills, services or expertise |
| Social media links | Instagram, LinkedIn, portfolio and others |

#### Profile Photo Functionality

- Upload an image from the device.
- Take a photo using the device camera where supported.
- Preview before saving.
- Replace the selected photo.
- Remove the photo.
- Validate file type and file size.
- Store the image securely.

#### Interests and Skills Selection

- Provide searchable predefined options.
- Allow multiple selections.
- Allow custom interest and skill suggestions.
- Prevent duplicate entries through normalization.
- Show suggestions based on event category.
- Make selection simple using interactive chips or tags.

#### Username Rules

- Username is mandatory.
- Username must be globally unique.
- Uniqueness must be case-insensitive.
- Display names do not need to be unique.
- Username must not be used as proof of identity.

#### Anonymous Visibility Consent *(amended — decision D-08)*

- The "Visible to visitors without a profile" setting defaults to ON during profile creation.
- The form clearly explains that opted-in profile information can be viewed by visitors without accounts.
- A prominent setting allows the attendee to disable anonymous visibility at any time.
- Private fields, contact information and social links are never exposed to anonymous visitors unless the attendee separately authorizes each item.

## 3.3 After Successful Profile Creation

The system must:

1. Create an internal attendee ID.
2. Create the attendee's global profile.
3. Save selected interests.
4. Save selected skills.
5. Create event participation for the event whose landing page the attendee used.
6. Establish a secure browser session.
7. Redirect the attendee to the event networking home.

**Critical requirement: Profile creation must never automatically redirect to Discover.**

Discover is a separate feature that attendees choose through the navigation.

## 3.4 Returning Attendee Flow

One attendee must have one reusable global profile across multiple events.

Example:

1. An attendee creates a profile at a college festival.
2. Later, they scan a QR code at a music concert.
3. The application recognizes their existing valid browser session.
4. The attendee does not need to create another profile.
5. Their existing global profile is reused.
6. They can join the new event and access its networking experience.

The new event landing page must still display the two approved options.

- If the attendee chooses Discover People, open public discovery.
- If the attendee chooses Create My Profile and has a valid existing session, recognize the existing identity, avoid duplicate creation and join the new event when appropriate.

Do not expose an existing profile merely because someone knows its username.

Device changes and lost browser data are handled by a secure recovery code *(amended — decision D-13)*:

- A recovery code is displayed once after successful profile creation, and the attendee can save it.
- Only a secure hash of the recovery code is stored.
- Recovery requires the recovery code; a username alone never recovers an account.
- After successful recovery, the recovery code is rotated.

---

# 4. COMPLETE APPLICATION MODULES

The MVP contains 17 core modules.

## MODULE 1 — QR ENTRY

**Purpose:** Provide a simple entry point into an event's networking experience.

Features:
- Scan QR using compatible phone scanners.
- Open the correct event landing page.
- Display event details.
- Display networking status.
- Show Discover People and Create My Profile.
- Handle invalid QR codes.
- Handle expired QR codes.
- Handle disabled or revoked QR codes.
- Redirect to the correct event.
- Allow organizers to revoke QR access.

The QR code identifies the event, not the attendee.

## MODULE 2 — PASSWORDLESS ATTENDEE IDENTITY

**Purpose:** Recognize attendees without traditional email/password registration.

Features:
- Generate internal attendee ID.
- Create secure browser sessions.
- Recognize returning attendees.
- Reuse one attendee identity across events.
- Validate sessions.
- Support session expiration.
- Support session revocation.
- Prevent duplicate attendee creation.
- Recovery code for device change or lost browser data *(amended — D-13)*.
- Session policy: 30-day idle expiration, 180-day absolute lifetime, secure renewal *(amended — D-13)*.

Attendee authentication restrictions for the MVP:

- No attendee email/password registration.
- No Gmail login.
- No social login.
- No OTP.
- No mandatory email verification.
- No traditional forgot-password flow.

This is passwordless attendee identity, not the absence of backend identity security.

Organizer authentication remains separate and uses conventional secure authentication.

## MODULE 3 — USER PROFILES & SETTINGS

**Purpose:** Provide every attendee with a reusable digital networking identity.

Features:
- Profile photo upload and management.
- Edit display name.
- Edit username.
- Edit bio.
- Edit profession and role.
- Edit company or college.
- Edit location.
- Manage interests.
- Manage skills.
- Manage networking preferences.
- Add social media links.
- Add portfolio links.
- Preview profile.
- Configure profile visibility.
- Manage account settings.

One global profile must be reused across events.

Event-specific intentions and availability must be maintained separately.

## MODULE 4 — EVENT PARTICIPATION

**Purpose:** Manage attendee participation in individual events.

Features:
- Automatically join the current event after successful profile creation.
- Join additional events.
- View current events.
- View upcoming events.
- View previous events.
- Leave an event.
- Pause discovery for an event.
- Resume discovery.
- Maintain event-specific networking preferences.
- Maintain event-specific availability.
- Track participation status.

Anonymous browsing must never create event participation.

Joining an event does not automatically prove physical attendance.

## MODULE 5 — DISCOVER

**Purpose:** Help attendees find interesting and relevant people attending the same event.

Features:
- Display eligible attendee profiles.
- Search by display name.
- Search by username.
- Filter by interests.
- Filter by skills.
- Filter by profession.
- Filter by networking intentions.
- Display profile photos.
- Display short bios.
- Highlight common interests.
- Highlight complementary skills.
- Show availability.
- Open detailed profiles.

Two discovery experiences must exist.

**Anonymous discovery**
- Only opted-in public profiles.
- No member-only actions.
- No personalized matching.
- No private information.
- No contact details unless explicitly configured for public visibility.

**Identified attendee discovery**
- Eligible participants of the selected event.
- Respect event-specific privacy settings.
- Allow authorized member actions.
- Exclude blocked or discovery-disabled profiles.

## MODULE 6 — SMART MATCHING

**Purpose:** Recommend people who are relevant to an attendee's interests, skills and networking goals.

The MVP should begin with transparent rule-based matching rather than relying on costly AI services.

Matching signals:
- Shared interests.
- Complementary skills.
- Similar professions.
- Collaboration preferences.
- Networking intentions.
- Event relevance.
- What an attendee is looking for.
- What another attendee can offer.

Features:
- Recommended profiles.
- Match relevance score.
- Explanation of why two people match.
- Shared interest highlights.
- Complementary skill highlights.
- Refresh recommendations.
- Dismiss recommendations.
- Avoid repeatedly showing dismissed profiles.

Example:

A person who has music production skills and is looking for vocalists can receive recommendations for attendees who have singing skills and are interested in music collaboration.

Personalized Smart Matching is available only to identified attendees.

## MODULE 7 — EVENT PULSE

**Purpose:** Show live event-level networking activity.

Event Pulse is a key differentiating feature.

Features:
- Total participating attendees.
- Number of discoverable attendees.
- Number open to conversations.
- Number looking for collaborators.
- Popular interests.
- Popular skills.
- Current networking activity.
- Live updates when availability changes.
- Event-type-specific activity categories.

Examples:

**Music festival**
- Looking for singers.
- Looking for guitarists.
- Looking for jam partners.

**Business conference**
- Looking for partners.
- Interested in professional networking.
- Looking for business collaborations.

**College festival**
- Looking for teammates.
- Interested in meeting new people.
- Looking for project collaborators.

**Wedding**
- Interested in meeting other guests.
- Open to conversations.

Event Pulse must display aggregated activity rather than exposing private conversations or individual private information.

Avoid showing small-group statistics that could reveal individual attendees.

## MODULE 8 — OPEN TO TALK

**Purpose:** Allow attendees to communicate their current networking availability.

Suggested statuses:

- Available Now.
- Open to Conversations.
- Looking to Meet New People.
- Looking for Collaborators.
- Interested in Quick Conversations.
- Temporarily Unavailable.
- Discovery Paused.

Features:
- Change status at any time.
- Maintain event-specific availability.
- Display status on eligible profile cards.
- Update Event Pulse when status changes.
- Respect privacy settings.
- Allow attendees to pause discovery.

## MODULE 9 — CONNECTIONS

**Purpose:** Help attendees establish meaningful connections.

Features:
- Send connection requests.
- Add optional introductory messages.
- Receive requests.
- Accept requests.
- Decline requests.
- Withdraw sent requests.
- View sent requests.
- View received requests.
- View accepted connections.
- Remove connections.
- Block users.
- Report inappropriate profiles.

Rules:
- Prevent duplicate pending requests.
- Prevent requests between blocked users.
- Keep connection requests event-scoped.
- Only accepted connections can start private conversations.
- Apply rate limits to prevent spam.
- Two attendees have one persistent connection relationship; meeting at multiple events does not create duplicate connections *(amended — D-05)*.
- The event through which the connection was originally established is recorded *(amended — D-05)*.
- Accepted connections and their private conversations continue working after an event ends *(amended — D-05)*.
- Organizer settings control whether new connection requests and new conversations can be initiated through their event, but never delete or disable existing accepted connections or conversations *(amended — D-05)*.

## MODULE 10 — PRIVATE MESSAGING

**Purpose:** Allow connected attendees to communicate privately.

Features:
- One-to-one messaging.
- Real-time message delivery.
- Persistent message history.
- Conversation list.
- Last message preview.
- Message timestamps.
- Unread counts.
- Read status.
- Typing indicator.
- Block functionality.
- Report functionality.

Technology:
- SignalR for real-time communication.
- PostgreSQL for persistent message storage.

Security:
- Only accepted connections can message.
- Verify conversation membership on the server.
- Verify block status.
- Prevent unauthorized message access.
- Organizers cannot automatically read private conversations.

Excluded from the MVP:
- Voice calls.
- Video calls.
- Group chats.
- File attachments.

## MODULE 11 — NOTIFICATIONS

**Purpose:** Inform attendees about important networking activity.

Features:
- New connection request.
- Connection request accepted.
- New private message.
- Event updates.
- In-app notification list.
- Unread count.
- Mark individual notification as read.
- Mark all as read.
- Notification preferences.

Push and email notifications can be introduced later.

## MODULE 12 — PRIVACY & SAFETY

**Purpose:** Protect attendees and give them control over their information.

Features:
- Public profile visibility.
- Event discovery visibility.
- Availability visibility.
- Social link visibility.
- Blocked users list.
- Report profile.
- Report inappropriate behaviour.
- Account deletion request.
- Moderation review.
- Rate limiting and abuse prevention.

Important rules:
- Enforce permissions through backend authorization.
- Never expose private profile fields through public APIs.
- Blocked users cannot interact.
- Validate uploaded images.
- Prevent profile scraping.
- Maintain moderation audit records.

## MODULE 13 — ORGANIZER ACCOUNTS

**Purpose:** Allow event organizers to manage events.

Features:
- Organizer registration.
- Secure login and logout.
- Organization profile.
- Organization name.
- Organization description.
- Organization logo.
- Contact details.
- Owned event list.
- Organizer dashboard.
- Basic organization permissions.

The MVP can support a simple organization owner role. Advanced roles can be introduced later.

## MODULE 14 — EVENT MANAGEMENT

**Purpose:** Allow organizers to create and manage events.

Required event fields:
- Event name.
- Event category/type.
- Date.
- Start time.
- End time.
- Venue.

Optional event fields:
- Description.
- Banner image.
- Organization details.
- Website.
- Maximum participant limit.

Features:
- Create event.
- Save draft.
- Edit event.
- Preview event.
- Publish event.
- Unpublish event.
- Pause networking.
- Resume networking.
- End event.
- Archive event.

Event statuses:

| Status | Description |
|---|---|
| Draft | Event is being created |
| Published | Public event page is available |
| Active | Event networking is running |
| Networking Paused | Networking features are temporarily disabled |
| Ended | Event has finished |
| Archived | Event is retained for historical reference |

Status transitions *(amended — D-06)*:

- Networking automatically becomes active 24 hours before the scheduled event start.
- Networking automatically closes when the event ends.
- Organizers can pause and resume networking manually.

Only authorized organizers can manage their own events.

## MODULE 15 — QR MANAGEMENT

**Purpose:** Allow organizers to generate and manage event QR codes.

Features:
- Generate QR code.
- Preview QR code.
- Download QR image.
- Copy event URL.
- Share event URL.
- Regenerate QR code.
- Revoke old QR code.
- Enable QR access.
- Disable QR access.

The MVP needs one standard event QR code.

Later features:
- Permanent venue QR codes.
- Individual attendee QR cards.
- Restricted session QR codes.

## MODULE 16 — PARTICIPANT MANAGEMENT

**Purpose:** Give organizers visibility and control over event participants.

Features:
- View participants.
- Search participants.
- Filter permitted profile information.
- View participation status.
- Remove participants when necessary.
- View basic participant statistics.
- Review relevant reports.
- Manage participant access.

Organizers must not have access to private messages or private profile fields.

## MODULE 17 — NETWORKING CONFIGURATION

**Purpose:** Allow organizers to customize networking functionality based on event type.

Features:
- Enable or disable Discover.
- Enable or disable anonymous browsing.
- Enable or disable Smart Matching.
- Enable or disable Event Pulse.
- Enable or disable connection requests.
- Enable or disable messaging.
- Enable or disable availability.
- Select suggested interests.
- Select suggested skills.
- Configure networking intentions.
- Use event-type-specific defaults.

Example categories:

| Event type | Suggested networking categories |
|---|---|
| Concert | Musicians, singers, music production, jam partners |
| Wedding | Meeting guests, shared interests, conversations |
| College festival | Students, teams, projects, creative collaboration |
| Conference | Professionals, founders, industry connections |
| Art exhibition | Artists, designers, photographers, creative partnerships |

Organizers should not need to configure every setting manually. The application should provide sensible defaults.

---

# 5. ATTENDEE APPLICATION NAVIGATION

The attendee application should have simple and consistent navigation.

Main navigation:

1. Home
2. Discover
3. Event Pulse
4. Messages
5. Profile

Additional features accessible through Home or secondary navigation:

- Smart Matches.
- Connections.
- Notifications.
- My Events.
- Open to Talk.
- Privacy & Settings.

The application must clearly indicate the event currently being used.

# 6. ORGANIZER APPLICATION NAVIGATION

Organizer dashboard navigation:

1. Dashboard.
2. Events.
3. QR Management.
4. Participants.
5. Networking Configuration.
6. Organization Settings.

Dashboard information:

- Total events.
- Active events.
- Total participants.
- Current networking activity.
- Recent events.
- Quick actions.

# 7. ADMIN PANEL

The platform administrator manages the overall application.

Features:
- Search users.
- Suspend users.
- Restore users.
- Search organizations.
- View events.
- Suspend inappropriate events.
- Review user reports.
- Manage interest categories.
- Manage skill categories.
- Manage event categories.
- View basic system activity.
- Monitor system health and logs.

An advanced analytics dashboard is not required for the first release.

---

# 8. MAIN USER JOURNEYS

## JOURNEY A — ANONYMOUS VISITOR

1. Scan event QR.
2. Open event landing page.
3. Select Discover People.
4. Browse opted-in public profiles.
5. Search and filter profiles.
6. View attendee details.
7. Attempt to connect.
8. See an explanation that profile creation is required.

The visitor can return to the landing page and choose Create My Profile.

## JOURNEY B — NEW ATTENDEE

1. Scan event QR.
2. Open event landing page.
3. Select Create My Profile.
4. Upload optional profile photo.
5. Enter mandatory display name.
6. Enter unique username.
7. Select mandatory interests.
8. Select mandatory skills.
9. Enter optional profile information.
10. Create attendee identity.
11. Create global profile.
12. Automatically join the current event.
13. Establish secure browser session.
14. Enter event networking home.

Do not automatically open Discover.

## JOURNEY C — RETURNING ATTENDEE

1. Scan a QR code for another event.
2. Open its landing page.
3. Select one of the two options.
4. Recognize the existing valid session when available.
5. Reuse the existing global profile.
6. Join the new event if the attendee chooses the member flow.
7. Open the selected experience.
8. Prevent duplicate profile creation.

## JOURNEY D — CONNECTING WITH ANOTHER ATTENDEE

1. Open Discover or Smart Matches.
2. View an attendee profile.
3. Send a connection request.
4. Other attendee receives notification.
5. Other attendee accepts.
6. Private conversation becomes available.
7. Both attendees can communicate.

## JOURNEY E — ORGANIZER CREATES AN EVENT

1. Organizer registers and logs in.
2. Creates organization profile.
3. Creates an event.
4. Enters event information.
5. Uploads event banner.
6. Configures networking features or uses defaults.
7. Publishes the event.
8. Generates QR code.
9. Downloads and shares QR code.
10. Monitors participants and Event Pulse.
11. Manages event settings and reports.

---

# 9. UI/UX DESIGN SYSTEM

## 9.1 Design Direction

The application must use a premium, dynamic and modern dark-violet visual identity.

It should feel like a modern social networking product, not a traditional event management dashboard.

## 9.2 Colour Palette

| Purpose | Colour | Hex |
|---|---|---|
| Main background | Deep violet black | #100B1D |
| Secondary background | Dark violet | #19112B |
| Card background | Purple charcoal | #211735 |
| Primary colour | Violet | #8B5CF6 |
| Bright accent | Lavender violet | #A78BFA |
| Light accent | Lavender | #C4B5FD |
| Secondary accent | Pink | #E879F9 |
| Primary text | Soft white | #F8F7FC |
| Secondary text | Muted lavender grey | #A9A0BA |
| Success | Green | #34D399 |
| Error | Red | #F87171 |

Use gradients selectively for primary actions, hero sections and important highlights.

## 9.3 Images and Photography

Use real photographs from free image providers:

- Unsplash: https://unsplash.com/
- Pexels: https://www.pexels.com/
- Pixabay: https://pixabay.com/

Use real photography for:
- Event banners.
- Event categories.
- Networking sections.
- Collaboration sections.
- Venue backgrounds.
- Landing page hero sections.

Profile photographs must come from attendee uploads, not stock photography.

Check image licensing conditions and optimize images using WebP or AVIF where possible. Use PNG when transparent graphics are required.

## 9.4 Interface Style

- Modern rounded cards.
- Consistent spacing.
- Premium typography.
- Subtle borders.
- Soft shadows.
- Selective glassmorphism.
- Consistent Lucide icons.
- Responsive layouts.
- Accessible contrast.
- Clear focus states.
- Reusable components.

## 9.5 Dynamic Interactions

Use Framer Motion or an equivalent library.

Implement:
- Smooth page transitions.
- Card hover and entrance animations.
- Modal transitions.
- Animated Event Pulse statistics.
- Smart Match score presentation.
- Open to Talk status transitions.
- Connection state animations.
- Message arrival animations.
- Typing indicators.
- Interactive skill and interest selection.
- Loading skeletons.
- Polished empty states.

Animations must be smooth and lightweight. Respect reduced-motion preferences.

## 9.6 Screen-Specific Design

| Screen | Design |
|---|---|
| Event landing page | Large event image, gradient overlay, two prominent actions |
| Profile creation | Clean form, photo preview, interactive selection chips |
| Home | Event overview, activity and shortcuts |
| Discover | Photo-based profile cards and filters |
| Smart Matches | Match scores and compatibility explanations |
| Event Pulse | Live counters and activity visualizations |
| Connections | Profile cards and request statuses |
| Messages | Modern dark chat interface |
| Organizer dashboard | Violet sidebar, event cards and statistics |

Maintain one consistent design system across public pages, attendee pages and organizer pages.

---

# 10. TECHNICAL ARCHITECTURE

## 10.1 Architecture Approach

Use a modular monolith architecture for the initial release.

Do not introduce microservices unnecessarily.

The backend should expose shared APIs to:
- Public event pages.
- Attendee web application.
- Organizer dashboard.
- Future mobile application.

## 10.2 Recommended Technology Stack

| Layer | Technology |
|---|---|
| Web frontend | React with Next.js |
| Styling | Tailwind CSS |
| Animation | Framer Motion |
| Icons | Lucide |
| Backend | ASP.NET Core Web API |
| Programming language | C# |
| Framework | .NET 10 LTS |
| Database | PostgreSQL |
| ORM | Entity Framework Core |
| Real-time communication | SignalR |
| Organizer authentication | ASP.NET Core Identity |
| Attendee identity | Secure passwordless sessions |
| API documentation | Swagger / OpenAPI |
| Testing | xUnit |
| Version control | Git and GitHub |
| Future mobile application | React Native with Expo |
| Image storage | S3-compatible object storage |

## 10.3 Architecture Responsibilities

**Frontend**
- Public event landing pages.
- Anonymous discovery.
- Profile creation.
- Attendee application.
- Organizer dashboard.
- Responsive UI.

**Backend**
- Attendee identity.
- Session validation.
- Profile management.
- Event management.
- Participation.
- Discovery.
- Smart Matching.
- Connections.
- Messaging.
- Notifications.
- Privacy and authorization.

**Database**
- Attendee records.
- Profiles.
- Interests and skills.
- Organizations.
- Events.
- Participation.
- Connections.
- Conversations.
- Messages.
- Notifications.
- Safety records.

**SignalR**
- Real-time messaging.
- Event Pulse updates.
- Availability updates.
- Typing indicators.

**Object storage**
- Attendee profile photos.
- Event banners.
- Organization logos.

## 10.4 Development Strategy

Build the web application first.

The mobile application should be developed later using React Native and the same backend APIs.

---

# 11. DATABASE STRUCTURE

The application should use relational database design with foreign keys, constraints and appropriate indexes.

## 11.1 Main Database Entities

| Area | Entities |
|---|---|
| Identity | Attendees, AttendeeSessions |
| Profiles | UserProfiles, SocialLinks |
| Skills and interests | Skills, Interests, ProfileSkills, ProfileInterests |
| Organizations | Organizations, OrganizationMembers, OrganizerUsers |
| Events | Events, EventParticipants, EventQRCodes |
| Networking | EventNetworkingSettings, EventAvailability, EventNetworkingIntentions |
| Discovery | SavedProfiles, MatchDismissals |
| Connections | Connections, ConnectionHistory |
| Messaging | Conversations, ConversationMembers, Messages |
| Notifications | Notifications, NotificationPreferences |
| Privacy | UserBlocks, UserReports, ModerationActions |
| Platform | AuditLogs, PlatformSettings |

## 11.2 Important Database Relationships

- One attendee has one global profile.
- One attendee can participate in multiple events.
- One organization can create multiple events.
- One event can have multiple participants.
- Event-specific availability belongs to an attendee's event participation.
- Networking intentions can differ across events.
- Connections are associated with an event.
- One conversation contains multiple messages.
- Conversation members identify who can access a conversation.
- One attendee can have multiple active or historical sessions according to session policy.

## 11.3 Important Database Constraints

- Username must be globally unique regardless of letter case.
- Display names can be duplicated.
- Prevent duplicate attendee participation in the same event.
- Prevent duplicate pending connection requests.
- Session token hashes must be unique.
- Messages must reference valid conversations.
- Organizer access must be restricted to authorized organizations and events.

---

# 12. SECURITY AND RELIABILITY REQUIREMENTS

Security must be part of the initial implementation.

## 12.1 Attendee Identity Security

- Generate cryptographically secure random session tokens.
- Store only token hashes on the backend.
- Use Secure, HttpOnly and SameSite cookies.
- Implement session expiration.
- Implement session revocation.
- Do not expose credentials in public URLs.
- Do not store session tokens in ordinary localStorage.
- Never identify an attendee using only their username.

## 12.2 Profile and Discovery Security

- Enforce profile visibility on the backend.
- Anonymous visitors can access only public profile fields.
- Paginate discovery results.
- Rate-limit public browsing.
- Prevent large-scale profile scraping.
- Validate uploaded image content.
- Restrict uploaded file sizes.

## 12.3 Connection and Messaging Security

- Verify event eligibility.
- Verify accepted connection status.
- Check block status.
- Verify conversation membership.
- Prevent unauthorized message access.
- Recheck authorization for sensitive operations.

## 12.4 Organizer Security

- Use secure organizer authentication.
- Enforce organization-level data isolation.
- Verify event ownership.
- Apply role-based authorization.
- Record sensitive organizer actions in audit logs.

## 12.5 Application Reliability

- Use database transactions for profile creation.
- Prevent duplicate profile creation through idempotency and database constraints.
- Handle retries and network failures safely.
- Store timestamps in UTC.
- Display event-local times.
- Back up the database.
- Use HTTPS in production.
- Store secrets securely.
- Maintain logs and error monitoring.

## 12.6 Atomic Profile Creation

The following operations must be handled as one reliable transaction:

1. Validate required profile fields.
2. Check username availability.
3. Create attendee identity.
4. Create global profile.
5. Save interests.
6. Save skills.
7. Create event participation.
8. Establish secure session.

If the operation fails, it must not leave a partially created attendee account.

---

# 13. DEVELOPMENT ROADMAP

Development should proceed module by module. Each phase must be completed and tested before moving to the next.

## PHASE 1 — FOUNDATION

- Backend project setup.
- Frontend project setup.
- PostgreSQL configuration.
- Entity Framework Core.
- Database migrations.
- Attendee identity.
- Secure sessions.
- Profile management.
- Skills and interests.

## PHASE 2 — ORGANIZER AND EVENT MANAGEMENT

- Organizer registration and login.
- Organization profiles.
- Event creation.
- Event editing.
- Event publishing.
- Event participation.

## PHASE 3 — QR ENTRY AND ONBOARDING

- QR generation.
- Public event landing page.
- Discover People entry.
- Create My Profile entry.
- Anonymous browsing.
- Profile creation flow.
- Returning attendee recognition.

## PHASE 4 — DISCOVERY

- Public profile browsing.
- Identified attendee discovery.
- Search.
- Filters.
- Profile details.
- Privacy enforcement.

## PHASE 5 — NETWORKING

- Smart Matching.
- Open to Talk.
- Event-specific preferences.
- Match explanations.
- Recommendation dismissal.

## PHASE 6 — EVENT PULSE

- Event statistics.
- Live networking activity.
- SignalR updates.
- Interest and skill trends.

## PHASE 7 — CONNECTIONS AND MESSAGING

- Connection requests.
- Acceptance and decline.
- Connection history.
- Private conversations.
- Real-time messaging.
- Notifications.

## PHASE 8 — ORGANIZER AND SAFETY FEATURES

- Participant management.
- Networking configuration.
- Privacy settings.
- Blocking.
- Reporting.
- Moderation.
- Admin controls.

## PHASE 8B — SUBSCRIPTION AND BILLING *(amended — D-01)*

- Razorpay integration in test mode.
- Webhook verification and idempotent processing.
- Attendee and organizer billing screens.
- Invoices and payment history.
- Admin subscription and revenue tools.
- Live activation only after business verification and production approval.

## PHASE 9 — TESTING AND DEPLOYMENT

- Functional testing.
- API testing.
- Backend security testing.
- QR flow testing.
- Anonymous browsing tests.
- Session security tests.
- Real-time communication tests.
- Database backup configuration.
- Production hosting.
- HTTPS.
- Monitoring and logs.

## PHASE 10 — MOBILE APPLICATION

- React Native setup.
- Android application.
- iOS application.
- Reuse existing backend APIs.
- Mobile-specific QR scanning.
- Push notifications.

---

# 14. FEATURES EXCLUDED FROM THE INITIAL MVP

To keep development manageable, do not implement the following in the first release:

- AI-powered matching.
- AI networking assistant.
- Voice calls.
- Video calls.
- Group messaging.
- Chat file attachments.
- Networking circles.
- Communities.
- Games and gamification.
- Advanced polls.
- Recurring session management.
- Individual attendee QR cards.
- Advanced organizer roles.
- Attendee email/password authentication.
- Advanced analytics.

*(Amended — D-01)* Payment gateway and subscription system are no longer excluded. Subscription plans, feature entitlements and billing database structures are part of the initial architecture. Payment gateway integration is implemented in Phase 8B, starting with Razorpay test mode. Live payment activation happens only after business verification and production approval.

These can be evaluated after the core platform has been launched and validated.

---

# 15. MVP ACCEPTANCE CRITERIA

The application must be tested against the following requirements before release.

| Area | Required result |
|---|---|
| QR entry | Correct event landing page opens |
| Landing page | Two independent options work |
| Anonymous browsing | Public profiles can be viewed without registration |
| Profile creation | Optional photo and required profile fields work |
| Identity | Secure session and duplicate prevention work |
| Participation | Profile creation joins the current event |
| Returning users | Existing global profile is reused |
| Discover | Search, filters and privacy rules work |
| Smart Matching | Relevant recommendations are displayed |
| Event Pulse | Live event-level statistics update |
| Open to Talk | Event-specific availability works |
| Connections | Requests, acceptance, decline and blocking work |
| Messaging | Only eligible accepted connections can communicate |
| Notifications | Important activities generate notifications |
| Organizer | Events can be created, published and managed |
| QR management | QR codes can be generated, downloaded and revoked |
| Participant management | Organizers can manage permitted information |
| Privacy | Private information is protected by backend authorization |
| Deployment | Application is publicly accessible with HTTPS and persistent storage |

---

# 16. NON-NEGOTIABLE PRODUCT PRINCIPLES

The following rules must never be changed during development without an explicit product decision.

1. The platform must support multiple event types, not only music events.
2. One attendee must have one global profile across events.
3. QR landing pages must have exactly two independent options: Discover People and Create My Profile.
4. Anonymous visitors must be able to browse opted-in public profiles.
5. Display name, username, interests and skills are mandatory for profile creation.
6. Profile photo and all additional profile details are optional.
7. Username must be globally unique and case-insensitive.
8. Display names do not need to be unique.
9. Profile creation automatically joins the current event.
10. Profile creation redirects to event networking home, never automatically to Discover.
11. Event-specific intentions and availability must be stored separately.
12. Users must control their own discovery visibility and availability.
13. Event Pulse must remain a core platform feature.
14. Organizers should be able to publish an event and share its QR code easily.
15. Backend authorization must enforce every sensitive permission.
16. Anonymous browsing must never create attendee identity or participation.
17. Private messages must not be automatically accessible to organizers.
18. The browser experience must work without requiring app installation.

---

# 17. FINAL PRODUCT DESCRIPTION

## One Event. Many Connections.

The Universal Event Networking Platform transforms ordinary events into opportunities for meaningful human connections.

Attendees scan an event QR code and enter a digital networking environment where they can browse public profiles or create a reusable attendee profile.

They can discover people, find collaborators, receive relevant recommendations, communicate their availability, view live event networking activity, send connection requests and chat privately.

Event organizers can create events, generate QR codes, configure networking features and manage participants through a dedicated dashboard.

From concerts and weddings to college festivals, conferences and exhibitions, the platform helps people discover one another and build connections wherever they meet.

**The central purpose of the application is event-based people discovery and networking, supported by the management tools organizers need to operate it.**

It is not primarily a ticketing application or a replacement for full event management software.

The networking experience is the core product.

---

# 18. IMPLEMENTATION GUIDANCE

Before writing application code, establish three supporting implementation documents:

**1. Product Requirements Document (PRD)**
- Complete functional requirements.
- User roles.
- User journeys.
- Module behaviour.
- Business rules.
- Acceptance criteria.

**2. Technical Design Document (TDD)**
- Database schema.
- API endpoints.
- Backend architecture.
- Authorization rules.
- Session security.
- Real-time communication.
- Deployment architecture.

**3. Claude Code Master Instructions**
- Project structure.
- Development phases.
- Design system.
- Coding standards.
- Testing requirements.
- Security requirements.
- Approved product flows.
- Strict instructions not to change the established requirements without approval.

These documents should work together to guide implementation module by module while preserving the approved product design and behaviour.

19. SUBSCRIPTION & MONETIZATION SYSTEM
New core module
Revenue generation
19.1 Business Model
The application will operate using three revenue channels:
Free attendee accounts.
Premium attendee subscriptions.
Paid organizer subscriptions.
₹0
Free attendee plan
Essential networking features for everyone.
₹99/month
Premium attendee plan
Advanced discovery and networking capabilities.
₹499/month
Organizer Pro plan
Advanced event management and networking tools.
Suggested introductory prices in India. You can adjust them after testing with real users and organizers.
19.2 Attendee Subscription Plans
FREE
Default
₹0
Create attendee profile.
Upload profile photo.
Join multiple events.
Discover public attendee profiles.
Search and filter people.
Basic Smart Matching.
Set Open to Talk status.
View Event Pulse.
Send connection requests.
Chat with accepted connections.
Manage profile and privacy.
PREMIUM
Paid subscription
₹99/month
Suggested annual plan: ₹799/year
Everything in Free, plus:
Advanced Smart Matching recommendations.
Detailed compatibility insights.
Advanced discovery filters.
See who has saved your profile, subject to privacy settings.
Unlimited saved profiles.
Advanced networking preference filters.
Premium profile customization.
Profile highlight badge.
Enhanced networking analytics.
Personalized connection suggestions.
Priority profile visibility, only where event discovery settings allow it.
Premium must never override another attendee's privacy, blocking or discovery preferences.

*(Amended — D-20)* The essential networking experience must remain free. Free attendees always have profile creation, multiple event participation, Discover, basic Smart Matching, Event Pulse, Open to Talk, connection requests, private messaging and privacy controls. Premium provides additional advanced features and convenience only. Numerical usage limits are not final until reviewed and approved.
19.3 Organizer Subscription Plans
Organizers are potentially your strongest paying customers because your application helps them provide additional value to event attendees.
STARTER — Free
₹0
Create an organization.
Create and publish basic events.
Generate standard event QR codes.
Basic participant management.
Basic Discover functionality.
Basic Event Pulse.
Basic networking configuration.
PRO — Paid
₹499/month
Everything in Starter.
Multiple active events.
Advanced Event Pulse analytics.
Detailed participant statistics.
Advanced networking configuration.
Event-specific branding.
Custom event banners and themes.
Exportable participant reports, subject to attendee consent.
Advanced event engagement insights.
Priority organizer support.
BUSINESS — Higher tier
₹1,499/month
Everything in Pro.
Multiple organization members.
Advanced organization dashboard.
Cross-event analytics.
Custom branding options.
Advanced event management controls.
Multiple event management.
Organization-level reports.
Higher usage limits.
You can also introduce an individual event purchase option for organizers who do not want a monthly subscription.
For example, ₹199–₹499 per event, depending on event size and features.
This is useful for wedding organizers, college festivals and one-time event organizers.
19.4 Subscription Management Screen
Add a new Upgrade to Premium section inside the attendee profile/settings area.
Free and customizable desktop prototype templates | Canva
canva.com
The subscription screen should include:
Current subscription plan.
Premium feature comparison.
Monthly/yearly billing toggle.
Upgrade button.
Payment status.
Subscription renewal date.
Billing history.
Cancel subscription.
Restore subscription.
Upgrade or downgrade plan.
Payment failure notifications.
For organizers, add a separate Billing & Plans section in the organizer dashboard.
19.5 Payment Integration
For Indian customers, integrate a payment gateway such as:
Razorpay — UPI, cards and other supported payment methods.
Cashfree Payments — online payment processing and supported recurring payment options.
The payment system should support:
Customer selects a subscription.
Backend creates a payment order or subscription.
Customer completes payment.
Gateway sends a payment confirmation webhook.
Backend verifies the webhook signature.
Subscription becomes active only after verified confirmation.
Premium entitlements are activated.
Renewal and payment status are tracked.
Failed payments trigger appropriate notifications.
Cancellation updates access according to the billing policy.
Never activate Premium merely because the frontend reports successful payment.
19.6 Subscription Rules
Free users retain their essential networking features.
Premium features require an active subscription.
Expired subscriptions automatically revert to Free.
Users can cancel subscriptions.
Cancellation must not unexpectedly delete user profiles or messages.
Existing paid access remains available according to the applicable billing terms.
Payment retries must not create duplicate subscriptions.
Refunds must update subscription entitlements.
Users must be able to view their billing history.
Organizers must not be able to access attendee private information by purchasing a higher plan.
20. NEW MODULE — SUBSCRIPTION & BILLING MANAGEMENT
This becomes the 18th core module.
Purpose: Manage monetization, subscription purchases, billing and premium feature access.
Attendee functionality
View available plans.
Purchase Premium.
Change billing cycle.
View subscription status.
Cancel subscription.
View payment history.
Access premium features.
Organizer functionality
View organizer plans.
Upgrade organization subscription.
Purchase individual event packages.
Manage billing.
View invoices.
Manage subscription renewals.
Platform administrator functionality
View subscriptions.
View payment transactions.
Manage subscription plans.
Grant promotional access.
Revoke promotional access.
Handle refund records.
View revenue statistics.
Track failed payments.
20.1 Additional Database Entities
Add these tables to the existing PostgreSQL database:
Entity
Purpose
SubscriptionPlans
Available subscription plans
Subscriptions
Active and historical subscriptions
Payments
Payment transaction records
PaymentWebhooks
Verified gateway event processing
SubscriptionInvoices
Billing records
SubscriptionFeatures
Features included in each plan
UserEntitlements
Attendee premium permissions
OrganizationEntitlements
Organizer plan permissions
PromotionalAccess
Free trial and promotional access

Important constraints:
Payment gateway transaction IDs must be unique.
Webhooks must be processed idempotently.
Subscription ownership must be validated.
Subscription status must be verified server-side.
Expired subscriptions must lose premium entitlements.
Never store card numbers, UPI PINs or payment credentials.
20.2 Additional Backend APIs
API
Purpose
GET /api/plans
List available plans
GET /api/subscriptions/current
Current subscription
POST /api/subscriptions/checkout
Initiate checkout
POST /api/subscriptions/cancel
Cancel subscription
GET /api/payments/history
Payment history
POST /api/payments/webhook
Payment gateway webhook
GET /api/entitlements
Current premium permissions
GET /api/admin/revenue
Admin revenue dashboard

These are proposed endpoints; the final API design should follow the backend architecture.
21. REVENUE DASHBOARD
The administrator should have a dedicated revenue dashboard.
Lindy Build: The first AI App Builder that tests its work | Lindy
lindy.ai
Display:
Total revenue.
Monthly recurring revenue (MRR).
Annual recurring revenue (ARR).
Total Premium attendees.
Total paid organizations.
Active subscriptions.
Cancelled subscriptions.
Failed payments.
Subscription conversion rate.
Monthly revenue trends.
Most popular subscription plans.
All revenue calculations should be based on verified payment records, excluding refunded transactions and clearly accounting for taxes and gateway fees.

A premium futuristic 3D dark-violet UI featuring floating glassmorphism cards, glowing purple gradients, immersive 3D elements, smooth parallax scrolling, scroll-triggered animations, interactive profile cards, and dynamic transitions.
The entire application should feel modern, visually rich and interactive, with real photographs from free sources like Unsplash and Pexels. Use Three.js, React Three Fiber and Framer Motion for 3D effects and animations.
Goal: Create an immersive, visually stunning networking experience that feels like a next-generation application, while remaining smooth, responsive and easy to use.

*(Amended — D-07)* Three.js and React Three Fiber are used selectively on the marketing homepage and organizer login experience only. QR landing pages, profile creation and attendee networking pages remain lightweight, fast and mobile-friendly, using Framer Motion for lightweight interactions. Reduced-motion preferences are respected.

