using Microsoft.EntityFrameworkCore;
using QRious.Application.Common;
using QRious.Domain.Events;
using QRious.Infrastructure.Persistence;
using QRious.Infrastructure.Storage;

namespace QRious.Application.Events;

public sealed record OrganizerSummaryDto(string Name, string? LogoUrl);

public sealed record LandingOptionsDto(bool DiscoverAvailable, bool AnonymousBrowsing, bool CreateProfileAvailable);

public sealed record PublicEventDto(
    Guid Id,
    string Name,
    string CategorySlug,
    string CategoryName,
    string? Description,
    string? BannerUrl,
    string VenueName,
    string? VenueAddress,
    string? City,
    string TimeZone,
    DateTimeOffset StartsAt,
    DateTimeOffset EndsAt,
    string? Website,
    OrganizerSummaryDto Organizer,
    /// <summary>not_open | open | paused | ended | archived</summary>
    string NetworkingStatus,
    DateTimeOffset NetworkingOpensAt,
    bool Joinable,
    LandingOptionsDto Options);

/// <summary>valid | revoked | expired | disabled | event_unavailable</summary>
public sealed record QrResolutionDto(string State, string Code, PublicEventDto? Event);

public sealed class EventAccessService(QRiousDbContext db, TimeProvider clock, IObjectStorage storage)
{
    public async Task<QrResolutionDto> ResolveQrAsync(string code, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > 16 || !code.All(char.IsAsciiLetterOrDigit))
            throw AppException.NotFound(ErrorCodes.QrInvalid, "This QR code isn't recognised.");

        var qr = await db.EventQrCodes.AsNoTracking().FirstOrDefaultAsync(q => q.PublicCode == code, ct)
            ?? throw AppException.NotFound(ErrorCodes.QrInvalid, "This QR code isn't recognised.");

        var ev = await LoadEventAsync(qr.EventId, ct);
        var now = clock.GetUtcNow();

        if (ev is null || ev.Status == EventStatus.Draft || ev.ModerationStatus != EventModerationStatus.Ok)
            return new QrResolutionDto("event_unavailable", code, null);
        if (qr.Status == QrCodeStatus.Revoked)
            return new QrResolutionDto("revoked", code, null);
        if (qr.ExpiresAt is { } exp && exp <= now)
            return new QrResolutionDto("expired", code, null);
        if (!ev.QrAccessEnabled)
            return new QrResolutionDto("disabled", code, ToPublicDto(ev));
        if (ev.Status == EventStatus.Archived)
            return new QrResolutionDto("event_unavailable", code, ToPublicDto(ev));

        return new QrResolutionDto("valid", code, ToPublicDto(ev));
    }

    /// <summary>Resolves a QR code to a joinable event, or throws a client-facing error.</summary>
    public async Task<(Event Event, Guid QrCodeId)> RequireJoinableByQrAsync(string? code, CancellationToken ct)
    {
        var resolution = await ResolveQrAsync(code ?? "", ct);
        if (resolution.State != "valid" || resolution.Event is null)
            throw AppException.Conflict(ErrorCodes.EventNotJoinable, resolution.State switch
            {
                "revoked" => "This QR code has been replaced by the organizer. Please scan the latest event QR code.",
                "expired" => "This QR code has expired.",
                "disabled" => "The organizer has turned off QR access for this event.",
                _ => "This event isn't accepting new participants.",
            });
        if (!resolution.Event.Joinable)
            throw AppException.Conflict(ErrorCodes.EventNotJoinable, "This event isn't accepting new participants.");

        var qrId = await db.EventQrCodes.Where(q => q.PublicCode == code).Select(q => q.Id).FirstAsync(ct);
        var ev = await db.Events.AsNoTracking().FirstAsync(e => e.Id == resolution.Event.Id, ct);
        return (ev, qrId);
    }

    public async Task<Event?> LoadEventAsync(Guid eventId, CancellationToken ct) =>
        await db.Events.AsNoTracking()
            .Include(e => e.Category)
            .Include(e => e.Organization)
            .Include(e => e.NetworkingSettings)
            .FirstOrDefaultAsync(e => e.Id == eventId, ct);

    public PublicEventDto ToPublicDto(Event ev)
    {
        var settings = ev.NetworkingSettings ?? new EventNetworkingSettings();
        var networkingStatus = ev.Status switch
        {
            EventStatus.Active => "open",
            EventStatus.NetworkingPaused => "paused",
            EventStatus.Ended => "ended",
            EventStatus.Archived => "archived",
            _ => "not_open",
        };
        var open = ev.IsNetworkingOpen;
        return new PublicEventDto(
            ev.Id,
            ev.Name,
            ev.Category?.Slug ?? "other",
            ev.Category?.Name ?? "Event",
            ev.Description,
            ev.BannerKey is null ? null : ResolveImage(ev.BannerKey),
            ev.VenueName,
            ev.VenueAddress,
            ev.City,
            ev.TimeZone,
            ev.StartsAt,
            ev.EndsAt,
            ev.Website,
            new OrganizerSummaryDto(ev.Organization?.Name ?? "Organizer",
                ev.Organization?.LogoKey is { } logo ? ResolveImage(logo) : null),
            networkingStatus,
            ev.StartsAt - Event.NetworkingOpensBefore,
            ev.IsJoinable,
            new LandingOptionsDto(
                DiscoverAvailable: open && settings.DiscoverEnabled,
                AnonymousBrowsing: open && settings.DiscoverEnabled && settings.AnonymousBrowsingEnabled,
                CreateProfileAvailable: ev.IsJoinable));
    }

    /// <summary>Banner/logo keys may be absolute URLs (seeded stock photography) or storage keys.</summary>
    private string ResolveImage(string keyOrUrl) =>
        keyOrUrl.StartsWith("http", StringComparison.Ordinal) || keyOrUrl.StartsWith('/') ? keyOrUrl : storage.PublicUrl(keyOrUrl);
}
