using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using QRious.Domain.Events;
using QRious.Domain.Platform;
using QRious.Domain.Safety;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Events;

/// <summary>
/// Automatic event status transitions (D-06):
/// Published → Active 24 hours before the start; Active / Networking Paused → Ended at the end time.
/// </summary>
public sealed class EventLifecycleWorker(IServiceScopeFactory scopes, TimeProvider clock, ILogger<EventLifecycleWorker> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, clock);
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Event lifecycle run failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QRiousDbContext>();
        var now = clock.GetUtcNow();
        var opensBefore = now + Event.NetworkingOpensBefore;

        var toActivate = await db.Events
            .Where(e => e.Status == EventStatus.Published && e.StartsAt <= opensBefore && e.EndsAt > now)
            .ToListAsync(ct);
        foreach (var e in toActivate)
        {
            e.Status = EventStatus.Active;
            e.ActivatedAt = now;
            e.UpdatedAt = now;
            Audit(db, e, "event.networking_opened_auto", now);
        }

        var toEnd = await db.Events
            .Where(e => (e.Status == EventStatus.Active || e.Status == EventStatus.NetworkingPaused || e.Status == EventStatus.Published)
                        && e.EndsAt <= now)
            .ToListAsync(ct);
        foreach (var e in toEnd)
        {
            e.Status = EventStatus.Ended;
            e.EndedAt = now;
            e.UpdatedAt = now;
            Audit(db, e, "event.ended_auto", now);
        }

        var changed = toActivate.Count + toEnd.Count;
        if (changed > 0)
        {
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Event lifecycle: {Activated} activated, {Ended} ended", toActivate.Count, toEnd.Count);
        }
        return changed;
    }

    private static void Audit(QRiousDbContext db, Event e, string action, DateTimeOffset now) =>
        db.AuditLogs.Add(new AuditLog
        {
            OccurredAt = now,
            ActorType = ActorType.System,
            Action = action,
            TargetType = "event",
            TargetId = e.Id,
            OrganizationId = e.OrganizationId,
            EventId = e.Id,
        });
}
