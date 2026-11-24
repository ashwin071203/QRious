using QRious.Domain.Events;
using QRious.Domain.Identity;

namespace QRious.Domain.Participation;

public enum ParticipantStatus { Active, Left, Removed }

/// <summary>Open to Talk statuses (PRD M08).</summary>
public enum AvailabilityStatus
{
    AvailableNow,
    OpenToConversations,
    MeetNewPeople,
    LookingForCollaborators,
    QuickConversations,
    TemporarilyUnavailable,
    DiscoveryPaused,
}

public enum AvailabilityVisibility { Members, Connections, Hidden }

public enum ActivityKind { Join, StatusChange, ConnectionAccepted, MessageSent }

public class EventParticipant
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid EventId { get; set; }
    public Event? Event { get; set; }
    public Guid AttendeeId { get; set; }
    public Attendee? Attendee { get; set; }
    public ParticipantStatus Status { get; set; } = ParticipantStatus.Active;
    public bool DiscoveryPaused { get; set; }
    public Guid? JoinedViaQrCodeId { get; set; }
    public DateTimeOffset JoinedAt { get; set; }
    public DateTimeOffset? LeftAt { get; set; }
    public DateTimeOffset? RemovedAt { get; set; }
    public Guid? RemovedBy { get; set; }
    public string? RemovalReason { get; set; }
    public bool ExportConsent { get; set; }

    public EventAvailability? Availability { get; set; }
}

public class EventAvailability
{
    public Guid ParticipantId { get; set; }
    public AvailabilityStatus Status { get; set; } = AvailabilityStatus.OpenToConversations;
    public AvailabilityVisibility Visibility { get; set; } = AvailabilityVisibility.Members;
    public DateTimeOffset UpdatedAt { get; set; }
}

public class EventParticipantIntention
{
    public Guid ParticipantId { get; set; }
    public Guid IntentionId { get; set; }
}

public class EventActivityCounter
{
    public Guid EventId { get; set; }
    public DateTimeOffset BucketStart { get; set; }
    public ActivityKind Kind { get; set; }
    public int Count { get; set; }
}
