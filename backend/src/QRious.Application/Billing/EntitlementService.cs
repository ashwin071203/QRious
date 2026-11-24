using Microsoft.EntityFrameworkCore;
using QRious.Domain.Billing;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Billing;

public sealed record EntitlementDto(string FeatureKey, bool Enabled, int? Limit);

public sealed record EntitlementsDto(string PlanCode, string PlanName, IReadOnlyList<EntitlementDto> Features);

/// <summary>
/// Feature entitlements (D-01). Essential networking (D-20) is never modelled as a gated feature.
/// Effective entitlements = the default plan's features overlaid with active per-user grants
/// (subscriptions, promotional access — Phase 8B). Limits are null (unlimited) until approved.
/// </summary>
public sealed class EntitlementService(QRiousDbContext db, TimeProvider clock)
{
    public async Task<EntitlementsDto> ForAttendeeAsync(Guid attendeeId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var plan = await db.SubscriptionPlans.AsNoTracking().Include(p => p.Features)
            .FirstOrDefaultAsync(p => p.Audience == PlanAudience.Attendee && p.IsDefault, ct);

        var features = (plan?.Features ?? []).ToDictionary(f => f.FeatureKey, f => new EntitlementDto(f.FeatureKey, f.Enabled, f.LimitValue));

        var grants = await db.UserEntitlements.AsNoTracking()
            .Where(e => e.AttendeeId == attendeeId && e.ValidFrom <= now && (e.ValidUntil == null || e.ValidUntil > now))
            .ToListAsync(ct);
        foreach (var g in grants)
        {
            features.TryGetValue(g.FeatureKey, out var existing);
            features[g.FeatureKey] = new EntitlementDto(g.FeatureKey,
                (existing?.Enabled ?? false) || g.Enabled,
                existing is null ? g.LimitValue : MaxLimit(existing.Limit, g.LimitValue));
        }

        var planCode = plan?.Code ?? "attendee_free";
        var planName = plan?.Name ?? "Free";
        if (grants.Any(g => g.SourceType is EntitlementSource.Subscription or EntitlementSource.Promo))
        {
            planCode = "attendee_premium";
            planName = "Premium";
        }
        return new EntitlementsDto(planCode, planName, features.Values.OrderBy(f => f.FeatureKey).ToList());
    }

    public async Task<bool> HasAsync(Guid attendeeId, string featureKey, CancellationToken ct) =>
        (await ForAttendeeAsync(attendeeId, ct)).Features.Any(f => f.FeatureKey == featureKey && f.Enabled);

    private static int? MaxLimit(int? a, int? b) => a is null || b is null ? null : Math.Max(a.Value, b.Value);
}
