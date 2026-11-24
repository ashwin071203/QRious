using QRious.Domain.Safety;

namespace QRious.Domain.Platform;

/// <summary>Append-only audit record (PRD §12.4).</summary>
public class AuditLog
{
    public long Id { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public ActorType ActorType { get; set; }
    public Guid? ActorId { get; set; }
    public string Action { get; set; } = "";
    public string? TargetType { get; set; }
    public Guid? TargetId { get; set; }
    public Guid? OrganizationId { get; set; }
    public Guid? EventId { get; set; }
    public byte[]? IpHash { get; set; }
    public string Data { get; set; } = "{}";
}

public class PlatformSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "{}";
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}

public class OutboxMessage
{
    public long Id { get; set; }
    public string Type { get; set; } = "";
    public string Payload { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
    public int Attempts { get; set; }
    public string? Error { get; set; }
}
