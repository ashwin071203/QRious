namespace QRious.Domain.Notifications;

public enum NotificationType { ConnectionRequest, ConnectionAccepted, Message, EventUpdate, System, Billing }

public class Notification
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AttendeeId { get; set; }
    public NotificationType Type { get; set; }
    public Guid? EventId { get; set; }
    public Guid? ActorProfileId { get; set; }
    public string? EntityType { get; set; }
    public Guid? EntityId { get; set; }
    public string Payload { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
}

public class NotificationPreferences
{
    public Guid AttendeeId { get; set; }
    public bool ConnectionRequests { get; set; } = true;
    public bool ConnectionAccepted { get; set; } = true;
    public bool Messages { get; set; } = true;
    public bool EventUpdates { get; set; } = true;
    public bool Billing { get; set; } = true;
    public DateTimeOffset UpdatedAt { get; set; }
}
