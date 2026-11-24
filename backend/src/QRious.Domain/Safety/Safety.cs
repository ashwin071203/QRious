namespace QRious.Domain.Safety;

public enum ReportReason { Spam, Harassment, InappropriateContent, FakeProfile, Underage, Other }

public enum ReportStatus { Open, InReview, Actioned, Dismissed }

public enum ActorType { Attendee, Organizer, Admin, System, Gateway }

public enum ModerationTargetType { Attendee, Event, Organization, Interest, Skill, Message, Participant }

public enum ModerationActionType
{
    Suspend, Restore, RemoveParticipant, SuspendEvent, RestoreEvent,
    ApproveTag, RejectTag, MergeTag, DeleteMessage, DismissReport,
}

public class UserBlock
{
    public Guid BlockerAttendeeId { get; set; }
    public Guid BlockedAttendeeId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class UserReport
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? ReporterAttendeeId { get; set; }
    public Guid? ReporterOrganizerUserId { get; set; }
    public Guid ReportedAttendeeId { get; set; }
    public Guid? EventId { get; set; }
    public long? MessageId { get; set; }
    public ReportReason Reason { get; set; }
    public string? Details { get; set; }
    public ReportStatus Status { get; set; } = ReportStatus.Open;
    public Guid? AssignedAdminId { get; set; }
    public string? ResolutionNote { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
}

public class ModerationAction
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public ActorType ActorType { get; set; }
    public Guid? ActorId { get; set; }
    public ModerationTargetType TargetType { get; set; }
    public Guid TargetId { get; set; }
    public ModerationActionType Action { get; set; }
    public string? Reason { get; set; }
    public Guid? ReportId { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
}

public class AccountDeletionRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AttendeeId { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset ScheduledFor { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}
