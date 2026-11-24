using QRious.Domain.Organizations;
using QRious.Domain.Taxonomy;

namespace QRious.Domain.Events;

public enum EventStatus { Draft, Published, Active, NetworkingPaused, Ended, Archived }

public enum EventModerationStatus { Ok, Suspended }

public enum QrCodeStatus { Active, Revoked }

public class Event
{
    /// <summary>Networking opens automatically this long before the start (D-06).</summary>
    public static readonly TimeSpan NetworkingOpensBefore = TimeSpan.FromHours(24);

    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid OrganizationId { get; set; }
    public Organization? Organization { get; set; }
    public Guid CategoryId { get; set; }
    public EventCategory? Category { get; set; }

    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string? BannerKey { get; set; }
    public string VenueName { get; set; } = "";
    public string? VenueAddress { get; set; }
    public string? City { get; set; }
    public string TimeZone { get; set; } = "Asia/Kolkata";
    public DateTimeOffset StartsAt { get; set; }
    public DateTimeOffset EndsAt { get; set; }
    public string? Website { get; set; }
    public int? MaxParticipants { get; set; }

    public EventStatus Status { get; set; } = EventStatus.Draft;
    public EventModerationStatus ModerationStatus { get; set; } = EventModerationStatus.Ok;
    public bool QrAccessEnabled { get; set; } = true;
    public string? Branding { get; set; }
    public int ParticipantCount { get; set; }

    public DateTimeOffset? PublishedAt { get; set; }
    public DateTimeOffset? ActivatedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }

    public EventNetworkingSettings? NetworkingSettings { get; set; }

    /// <summary>Attendees may create profiles and join (D-06).</summary>
    public bool IsJoinable =>
        ModerationStatus == EventModerationStatus.Ok &&
        Status is EventStatus.Published or EventStatus.Active or EventStatus.NetworkingPaused;

    /// <summary>Networking features are live (subject to per-feature toggles).</summary>
    public bool IsNetworkingOpen =>
        ModerationStatus == EventModerationStatus.Ok && Status == EventStatus.Active;
}

public class EventQrCode
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid EventId { get; set; }
    public Event? Event { get; set; }
    public string PublicCode { get; set; } = "";
    public QrCodeStatus Status { get; set; } = QrCodeStatus.Active;
    public DateTimeOffset? ExpiresAt { get; set; }
    public Guid? CreatedBy { get; set; }
    public Guid? RevokedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}

public class EventNetworkingSettings
{
    public Guid EventId { get; set; }
    public bool DiscoverEnabled { get; set; } = true;
    public bool AnonymousBrowsingEnabled { get; set; } = true;
    public bool SmartMatchingEnabled { get; set; } = true;
    public bool PulseEnabled { get; set; } = true;
    public bool ConnectionsEnabled { get; set; } = true;
    public bool MessagingEnabled { get; set; } = true;
    public bool AvailabilityEnabled { get; set; } = true;
    public bool PremiumHighlightingEnabled { get; set; } = true;
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}

public class EventSuggestedInterest
{
    public Guid EventId { get; set; }
    public Guid InterestId { get; set; }
    public short SortOrder { get; set; }
}

public class EventSuggestedSkill
{
    public Guid EventId { get; set; }
    public Guid SkillId { get; set; }
    public short SortOrder { get; set; }
}

public class EventIntention
{
    public Guid EventId { get; set; }
    public Guid IntentionId { get; set; }
    public short SortOrder { get; set; }
}
