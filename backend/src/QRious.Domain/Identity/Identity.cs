namespace QRious.Domain.Identity;

public enum AttendeeStatus { Active, Suspended, Deactivated, Deleted }

public enum SessionRevokedReason { Logout, UserRevoked, Admin, Suspension, Deletion, Recovery, TokenReuse }

public enum ClientKind { Web, Mobile }

public enum RecoveryCodeStatus { Active, Rotated, Used, Revoked }

/// <summary>Internal attendee identity. Its id is never exposed through public APIs.</summary>
public class Attendee
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public AttendeeStatus Status { get; set; } = AttendeeStatus.Active;
    public string? SuspendedReason { get; set; }
    public DateTimeOffset? LastActiveAt { get; set; }
    public DateTimeOffset? DeactivatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Profiles.UserProfile? Profile { get; set; }
    public List<AttendeeSession> Sessions { get; set; } = [];
}

public class AttendeeSession
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AttendeeId { get; set; }
    public Attendee? Attendee { get; set; }

    public byte[] TokenHash { get; set; } = [];
    public byte[]? PreviousTokenHash { get; set; }
    public DateTimeOffset? PreviousTokenValidUntil { get; set; }
    public DateTimeOffset TokenIssuedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset AbsoluteExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public SessionRevokedReason? RevokedReason { get; set; }
    public ClientKind ClientKind { get; set; } = ClientKind.Web;
    public string? UserAgentSummary { get; set; }

    public bool IsActive(DateTimeOffset now) =>
        RevokedAt is null && ExpiresAt > now && AbsoluteExpiresAt > now;
}

public class AttendeeRecoveryCode
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AttendeeId { get; set; }
    public Attendee? Attendee { get; set; }
    public byte[] CodeHash { get; set; } = [];
    public byte[] Salt { get; set; } = [];
    public RecoveryCodeStatus Status { get; set; } = RecoveryCodeStatus.Active;
    public int FailedAttempts { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
    public DateTimeOffset? RotatedAt { get; set; }
}

/// <summary>Stored responses for idempotent writes (PRD §12.5).</summary>
public class IdempotencyRecord
{
    public string Scope { get; set; } = "";
    public Guid Key { get; set; }
    public byte[] RequestHash { get; set; } = [];
    public Guid? AttendeeId { get; set; }
    public Guid? SessionId { get; set; }
    public int ResponseStatus { get; set; }
    public string ResponseBody { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
