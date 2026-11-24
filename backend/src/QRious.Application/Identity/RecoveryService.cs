using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using QRious.Application.Common;
using QRious.Application.Platform;
using QRious.Application.Profiles;
using QRious.Domain.Identity;
using QRious.Domain.Notifications;
using QRious.Domain.Safety;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Identity;

public sealed record RecoveryResult(IssuedSession Session, string NewRecoveryCode);

/// <summary>Recovery codes: issue once, store hash only, recover with username + code, rotate after use (D-13).</summary>
public sealed class RecoveryService(
    QRiousDbContext db,
    TimeProvider clock,
    IOptions<SecurityOptions> security,
    SessionService sessions,
    AuditService audit)
{
    public const int MaxFailedAttempts = 5;
    public static readonly TimeSpan LockDuration = TimeSpan.FromHours(1);

    /// <summary>Retires any active code and adds a new one (caller saves). Returns the raw code to show once.</summary>
    public async Task<string> IssueAsync(Guid attendeeId, RecoveryCodeStatus retireAs, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var active = await db.AttendeeRecoveryCodes
            .Where(c => c.AttendeeId == attendeeId && c.Status == RecoveryCodeStatus.Active)
            .ToListAsync(ct);
        foreach (var c in active)
        {
            c.Status = retireAs;
            c.RotatedAt = now;
            if (retireAs == RecoveryCodeStatus.Used) c.UsedAt = now;
        }
        if (active.Count > 0)
        {
            // Persist the retirement first so the "one active code" partial unique index is never violated.
            await db.SaveChangesAsync(ct);
        }

        return Add(attendeeId, now);
    }

    /// <summary>Adds a code for a brand-new attendee (no existing code to retire).</summary>
    public string IssueForNewAttendee(Guid attendeeId) => Add(attendeeId, clock.GetUtcNow());

    private string Add(Guid attendeeId, DateTimeOffset now)
    {
        var raw = RecoveryCodes.Generate();
        var salt = RecoveryCodes.NewSalt();
        db.AttendeeRecoveryCodes.Add(new AttendeeRecoveryCode
        {
            AttendeeId = attendeeId,
            Salt = salt,
            CodeHash = RecoveryCodes.Hash(RecoveryCodes.Normalize(raw)!, salt, security.Value.RecoveryPepper),
            CreatedAt = now,
        });
        return raw;
    }

    public async Task<RecoveryResult> RecoverAsync(string? username, string? recoveryCode, CancellationToken ct)
    {
        var failure = AppException.Unauthorized(ErrorCodes.RecoveryFailed,
            "We couldn't recover an account with that username and recovery code.");
        var now = clock.GetUtcNow();

        var normalizedUsername = UsernameRules.Normalize(username);
        var normalizedCode = RecoveryCodes.Normalize(recoveryCode);
        if (normalizedUsername is null) throw failure;

        var profile = await db.UserProfiles.AsNoTracking()
            .Where(p => p.UsernameNormalized == normalizedUsername)
            .Select(p => new { p.AttendeeId, p.Id })
            .FirstOrDefaultAsync(ct);
        if (profile is null)
        {
            // Spend comparable time so unknown usernames aren't distinguishable by timing.
            RecoveryCodes.Hash(normalizedCode ?? "000000000000000000000000", new byte[16], security.Value.RecoveryPepper);
            throw failure;
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var code = (await db.AttendeeRecoveryCodes
            .FromSql($"SELECT * FROM attendee_recovery_codes WHERE attendee_id = {profile.AttendeeId} AND status = 'active' FOR UPDATE")
            .ToListAsync(ct)).FirstOrDefault();
        var attendeeStatus = await db.Attendees.Where(a => a.Id == profile.AttendeeId).Select(a => a.Status).FirstAsync(ct);

        if (code is null || attendeeStatus is AttendeeStatus.Suspended or AttendeeStatus.Deleted)
            throw failure;

        if (code.LockedUntil is { } locked && locked > now)
        {
            audit.Write(ActorType.Attendee, null, "attendee.recovery_locked", "attendee", profile.Id);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            throw failure;
        }

        if (normalizedCode is null ||
            !RecoveryCodes.Verify(normalizedCode, code.Salt, code.CodeHash, security.Value.RecoveryPepper))
        {
            code.FailedAttempts++;
            if (code.FailedAttempts >= MaxFailedAttempts)
            {
                code.LockedUntil = now + LockDuration;
                code.FailedAttempts = 0;
            }
            audit.Write(ActorType.Attendee, null, "attendee.recovery_failed", "attendee", profile.Id);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            throw failure;
        }

        // Success: revoke every existing session, issue a new one, rotate the code, record a notification.
        await sessions.RevokeAllAsync(profile.AttendeeId, SessionRevokedReason.Recovery, null, ct);
        var newCode = await IssueAsync(profile.AttendeeId, RecoveryCodeStatus.Used, ct);
        var issued = sessions.Create(profile.AttendeeId);
        db.Notifications.Add(new Notification
        {
            AttendeeId = profile.AttendeeId,
            Type = NotificationType.System,
            Payload = """{"kind":"account_recovered","message":"Your account was recovered on a new device. Other devices were signed out."}""",
            CreatedAt = now,
        });
        audit.Write(ActorType.Attendee, profile.AttendeeId, "attendee.recovered", "attendee", profile.Id);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new RecoveryResult(issued, newCode);
    }

    public async Task<string> RegenerateAsync(Guid attendeeId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var code = await IssueAsync(attendeeId, RecoveryCodeStatus.Rotated, ct);
        audit.Write(ActorType.Attendee, attendeeId, "attendee.recovery_code_regenerated", "attendee", null);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return code;
    }

    public async Task<DateTimeOffset?> GetActiveCreatedAtAsync(Guid attendeeId, CancellationToken ct) =>
        await db.AttendeeRecoveryCodes.AsNoTracking()
            .Where(c => c.AttendeeId == attendeeId && c.Status == RecoveryCodeStatus.Active)
            .Select(c => (DateTimeOffset?)c.CreatedAt)
            .FirstOrDefaultAsync(ct);
}
