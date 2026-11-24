using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using QRious.Application.Common;
using QRious.Domain.Identity;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Identity;

public sealed record IssuedSession(AttendeeSession Session, string Token);

/// <summary>Result of validating a session token. <see cref="NewToken"/> is set when the cookie must be rewritten.</summary>
public sealed record SessionValidation(Guid AttendeeId, Guid SessionId, AttendeeStatus Status, DateTimeOffset ExpiresAt, string? NewToken);

/// <summary>Passwordless attendee sessions (M02, PRD §12.1, D-13).</summary>
public sealed class SessionService(
    QRiousDbContext db,
    TimeProvider clock,
    IOptions<SessionPolicyOptions> policy,
    RequestContext request)
{
    private readonly SessionPolicyOptions _policy = policy.Value;

    /// <summary>Creates a session entity (added to the context; caller saves).</summary>
    public IssuedSession Create(Guid attendeeId, ClientKind clientKind = ClientKind.Web)
    {
        var now = clock.GetUtcNow();
        var (token, hash) = SecureTokens.NewSessionToken();
        var absolute = now + _policy.AbsoluteLifetime;
        var session = new AttendeeSession
        {
            AttendeeId = attendeeId,
            TokenHash = hash,
            TokenIssuedAt = now,
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = Min(now + _policy.IdleTimeout, absolute),
            AbsoluteExpiresAt = absolute,
            ClientKind = clientKind,
            UserAgentSummary = request.UserAgentSummary,
        };
        db.AttendeeSessions.Add(session);
        return new IssuedSession(session, token);
    }

    public async Task<SessionValidation?> ValidateAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 100) return null;
        var hash = SecureTokens.Hash(token);
        var now = clock.GetUtcNow();

        var session = await db.AttendeeSessions
            .Include(s => s.Attendee)
            .FirstOrDefaultAsync(s => s.TokenHash == hash || s.PreviousTokenHash == hash, ct);
        if (session is null) return null;

        var usedPrevious = !session.TokenHash.AsSpan().SequenceEqual(hash);
        if (usedPrevious)
        {
            if (session.RevokedAt is null && session.PreviousTokenValidUntil is { } until && until > now)
            {
                // In-flight request racing a rotation: accept without rewriting the cookie.
                return session.IsActive(now)
                    ? new SessionValidation(session.AttendeeId, session.Id, session.Attendee!.Status, session.ExpiresAt, null)
                    : null;
            }
            // A rotated-out token was replayed after its grace window: treat as possible theft.
            if (session.RevokedAt is null)
            {
                session.RevokedAt = now;
                session.RevokedReason = SessionRevokedReason.TokenReuse;
                await db.SaveChangesAsync(ct);
            }
            return null;
        }

        if (!session.IsActive(now)) return null;
        if (session.Attendee!.Status is AttendeeStatus.Suspended or AttendeeStatus.Deleted) return null;

        string? newToken = null;
        var changed = false;

        if (now - session.TokenIssuedAt >= _policy.RotationInterval)
        {
            var (t, h) = SecureTokens.NewSessionToken();
            session.PreviousTokenHash = session.TokenHash;
            session.PreviousTokenValidUntil = now + _policy.RotationGrace;
            session.TokenHash = h;
            session.TokenIssuedAt = now;
            newToken = t;
            changed = true;
        }

        if (now - session.LastSeenAt >= _policy.RenewalThrottle || changed)
        {
            session.LastSeenAt = now;
            session.ExpiresAt = Min(now + _policy.IdleTimeout, session.AbsoluteExpiresAt);
            session.Attendee.LastActiveAt = now;
            changed = true;
            // Renewing idle expiry means the cookie Max-Age must be refreshed as well.
            newToken ??= token;
        }

        if (changed)
        {
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // A concurrent request rotated first; this request is still valid.
                db.ChangeTracker.Clear();
                newToken = null;
            }
        }

        return new SessionValidation(session.AttendeeId, session.Id, session.Attendee.Status, session.ExpiresAt, newToken);
    }

    public async Task RevokeAsync(Guid sessionId, Guid attendeeId, SessionRevokedReason reason, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        await db.AttendeeSessions
            .Where(s => s.Id == sessionId && s.AttendeeId == attendeeId && s.RevokedAt == null)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.RevokedAt, now).SetProperty(s => s.RevokedReason, reason), ct);
    }

    public async Task<int> RevokeAllAsync(Guid attendeeId, SessionRevokedReason reason, Guid? exceptSessionId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        return await db.AttendeeSessions
            .Where(s => s.AttendeeId == attendeeId && s.RevokedAt == null && s.Id != exceptSessionId)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.RevokedAt, now).SetProperty(s => s.RevokedReason, reason), ct);
    }

    public async Task<IReadOnlyList<SessionDto>> ListAsync(Guid attendeeId, Guid currentSessionId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var sessions = await db.AttendeeSessions.AsNoTracking()
            .Where(s => s.AttendeeId == attendeeId && s.RevokedAt == null && s.ExpiresAt > now && s.AbsoluteExpiresAt > now)
            .OrderByDescending(s => s.LastSeenAt)
            .ToListAsync(ct);
        return sessions.Select(s => new SessionDto(s.Id, s.UserAgentSummary ?? "Unknown device", s.CreatedAt, s.LastSeenAt,
            s.ExpiresAt, s.AbsoluteExpiresAt, s.Id == currentSessionId)).ToList();
    }

    private static DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;
}

public sealed record SessionDto(Guid Id, string Device, DateTimeOffset CreatedAt, DateTimeOffset LastSeenAt,
    DateTimeOffset ExpiresAt, DateTimeOffset AbsoluteExpiresAt, bool IsCurrent);
