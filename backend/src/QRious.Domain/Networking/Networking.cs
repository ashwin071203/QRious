namespace QRious.Domain.Networking;

public enum ConnectionStatus { Pending, Accepted, Declined, Withdrawn, Removed }

public enum ConnectionAction { Requested, Accepted, Declined, Withdrawn, Removed }

public class SavedProfile
{
    public Guid AttendeeId { get; set; }
    public Guid SavedProfileId { get; set; }
    public Guid? EventId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class MatchDismissal
{
    public Guid AttendeeId { get; set; }
    public Guid EventId { get; set; }
    public Guid DismissedProfileId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>One persistent relationship per pair of attendees (D-05).</summary>
public class Connection
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid RequesterAttendeeId { get; set; }
    public Guid AddresseeAttendeeId { get; set; }
    public Guid AttendeeLowId { get; set; }
    public Guid AttendeeHighId { get; set; }
    /// <summary>The event through which the connection was originally established.</summary>
    public Guid OriginEventId { get; set; }
    public ConnectionStatus Status { get; set; } = ConnectionStatus.Pending;
    public string? IntroMessage { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? RespondedAt { get; set; }
    public DateTimeOffset? RemovedAt { get; set; }
    public Guid? RemovedBy { get; set; }
}

public class ConnectionHistory
{
    public long Id { get; set; }
    public Guid ConnectionId { get; set; }
    public Guid ActorAttendeeId { get; set; }
    public ConnectionAction Action { get; set; }
    public ConnectionStatus? FromStatus { get; set; }
    public ConnectionStatus ToStatus { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class Conversation
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? ConnectionId { get; set; }
    public Guid AttendeeLowId { get; set; }
    public Guid AttendeeHighId { get; set; }
    /// <summary>The event through which the conversation was initiated.</summary>
    public Guid OriginEventId { get; set; }
    public long? LastMessageId { get; set; }
    public DateTimeOffset? LastMessageAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class ConversationMember
{
    public Guid ConversationId { get; set; }
    public Guid AttendeeId { get; set; }
    public long LastReadMessageId { get; set; }
    public DateTimeOffset? LastReadAt { get; set; }
    public bool Muted { get; set; }
    public DateTimeOffset JoinedAt { get; set; }
}

public class Message
{
    public long Id { get; set; }
    public Guid ConversationId { get; set; }
    public Guid SenderAttendeeId { get; set; }
    public Guid ClientMessageId { get; set; }
    public string Body { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}
