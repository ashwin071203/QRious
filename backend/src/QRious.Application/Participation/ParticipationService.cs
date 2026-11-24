using Microsoft.EntityFrameworkCore;
using QRious.Application.Common;
using QRious.Application.Events;
using QRious.Domain.Events;
using QRious.Domain.Participation;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Participation;

public sealed record MyParticipationDto(
    Guid ParticipantId,
    string Status,
    bool DiscoveryPaused,
    string AvailabilityStatus,
    string AvailabilityVisibility,
    DateTimeOffset JoinedAt);

public sealed record MyEventDto(PublicEventDto Event, MyParticipationDto Participation);

public sealed record JoinResult(Guid EventId, bool AlreadyJoined, string RedirectTo);

public sealed class ParticipationService(QRiousDbContext db, TimeProvider clock, EventAccessService events)
{
    public static string EventHomePath(Guid eventId) => $"/app/events/{eventId}/home";

    /// <summary>
    /// Joins an event inside the caller's transaction. Locks the event row so the participant limit holds
    /// under concurrency (D-22). Idempotent for active participants; anonymous browsing never reaches this.
    /// </summary>
    public async Task<JoinResult> JoinInTransactionAsync(Guid attendeeId, Guid eventId, Guid? qrCodeId, CancellationToken ct)
    {
        var ev = (await db.Events.FromSql($"SELECT *, xmin FROM events WHERE id = {eventId} FOR UPDATE").ToListAsync(ct)).FirstOrDefault()
            ?? throw AppException.NotFound(ErrorCodes.NotFound, "Event not found.");
        if (!ev.IsJoinable)
            throw AppException.Conflict(ErrorCodes.EventNotJoinable, "This event isn't accepting new participants.");

        var now = clock.GetUtcNow();
        var existing = await db.EventParticipants.FirstOrDefaultAsync(p => p.EventId == eventId && p.AttendeeId == attendeeId, ct);
        if (existing is { Status: ParticipantStatus.Active })
            return new JoinResult(eventId, true, EventHomePath(eventId));
        if (existing is { Status: ParticipantStatus.Removed })
            throw AppException.Forbidden(ErrorCodes.ParticipantRemoved, "The organizer has removed you from this event.");

        if (ev.MaxParticipants is { } max && ev.ParticipantCount >= max)
            throw AppException.Conflict(ErrorCodes.EventFull, "This event has reached its participant limit.");

        if (existing is not null)
        {
            existing.Status = ParticipantStatus.Active;
            existing.LeftAt = null;
            existing.JoinedAt = now;
            existing.JoinedViaQrCodeId = qrCodeId ?? existing.JoinedViaQrCodeId;
        }
        else
        {
            var participant = new EventParticipant
            {
                EventId = eventId,
                AttendeeId = attendeeId,
                JoinedAt = now,
                JoinedViaQrCodeId = qrCodeId,
            };
            participant.Availability = new EventAvailability
            {
                ParticipantId = participant.Id,
                Status = AvailabilityStatus.OpenToConversations,
                Visibility = AvailabilityVisibility.Members,
                UpdatedAt = now,
            };
            db.EventParticipants.Add(participant);
        }

        ev.ParticipantCount++;
        ev.UpdatedAt = now;
        await RecordActivityAsync(eventId, ActivityKind.Join, now, ct);
        return new JoinResult(eventId, false, EventHomePath(eventId));
    }

    public async Task<JoinResult> JoinAsync(Guid attendeeId, Guid eventId, string? qrCode, CancellationToken ct)
    {
        Guid? qrId = null;
        if (!string.IsNullOrWhiteSpace(qrCode))
        {
            var (ev, id) = await events.RequireJoinableByQrAsync(qrCode, ct);
            if (ev.Id != eventId) throw AppException.BadRequest(ErrorCodes.QrInvalid, "This QR code belongs to a different event.");
            qrId = id;
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var result = await JoinInTransactionAsync(attendeeId, eventId, qrId, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return result;
    }

    public async Task<MyEventDto> GetForParticipantAsync(Guid attendeeId, Guid eventId, CancellationToken ct)
    {
        var participant = await db.EventParticipants.AsNoTracking().Include(p => p.Availability)
            .FirstOrDefaultAsync(p => p.EventId == eventId && p.AttendeeId == attendeeId && p.Status == ParticipantStatus.Active, ct)
            ?? throw AppException.Forbidden(ErrorCodes.NotParticipant, "Join this event to see it.");
        var ev = await events.LoadEventAsync(eventId, ct) ?? throw AppException.NotFound(ErrorCodes.NotFound, "Event not found.");
        return new MyEventDto(events.ToPublicDto(ev), ToDto(participant));
    }

    public async Task<bool> IsActiveParticipantAsync(Guid attendeeId, Guid eventId, CancellationToken ct) =>
        await db.EventParticipants.AnyAsync(p => p.EventId == eventId && p.AttendeeId == attendeeId && p.Status == ParticipantStatus.Active, ct);

    /// <summary>scope: current | upcoming | previous | all</summary>
    public async Task<IReadOnlyList<MyEventDto>> MyEventsAsync(Guid attendeeId, string scope, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var rows = await db.EventParticipants.AsNoTracking()
            .Include(p => p.Availability)
            .Include(p => p.Event!).ThenInclude(e => e.Category)
            .Include(p => p.Event!).ThenInclude(e => e.Organization)
            .Include(p => p.Event!).ThenInclude(e => e.NetworkingSettings)
            .Where(p => p.AttendeeId == attendeeId && p.Status == ParticipantStatus.Active)
            .ToListAsync(ct);

        IEnumerable<EventParticipant> filtered = scope switch
        {
            "current" => rows.Where(p => p.Event!.Status is EventStatus.Active or EventStatus.NetworkingPaused),
            "upcoming" => rows.Where(p => p.Event!.Status == EventStatus.Published),
            "previous" => rows.Where(p => p.Event!.Status is EventStatus.Ended or EventStatus.Archived || p.Event.EndsAt <= now),
            _ => rows,
        };
        return filtered
            .OrderByDescending(p => p.Event!.Status is EventStatus.Active or EventStatus.NetworkingPaused)
            .ThenBy(p => Math.Abs((p.Event!.StartsAt - now).TotalMinutes))
            .Select(p => new MyEventDto(events.ToPublicDto(p.Event!), ToDto(p)))
            .ToList();
    }

    private async Task RecordActivityAsync(Guid eventId, ActivityKind kind, DateTimeOffset now, CancellationToken ct)
    {
        var bucket = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, now.Minute / 5 * 5, 0, TimeSpan.Zero);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO event_activity_counters (event_id, bucket_start, kind, count) VALUES ({eventId}, {bucket}, {Infrastructure.Persistence.SnakeCaseEnum<ActivityKind>.ToText(kind)}, 1)
            ON CONFLICT (event_id, bucket_start, kind) DO UPDATE SET count = event_activity_counters.count + 1
            """, ct);
    }

    private static MyParticipationDto ToDto(EventParticipant p) => new(
        p.Id,
        SnakeCaseEnum<ParticipantStatus>.ToText(p.Status),
        p.DiscoveryPaused,
        SnakeCaseEnum<AvailabilityStatus>.ToText(p.Availability?.Status ?? AvailabilityStatus.OpenToConversations),
        SnakeCaseEnum<AvailabilityVisibility>.ToText(p.Availability?.Visibility ?? AvailabilityVisibility.Members),
        p.JoinedAt);
}
