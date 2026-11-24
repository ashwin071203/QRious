using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using QRious.Application.Taxonomy;
using QRious.Domain.Billing;
using QRious.Domain.Events;
using QRious.Domain.Organizations;
using QRious.Domain.Taxonomy;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Seeding;

/// <summary>Idempotent seeding of reference data (all environments) and demo data (development/staging only).</summary>
public sealed class DatabaseSeeder(QRiousDbContext db, TimeProvider clock, ILogger<DatabaseSeeder> logger)
{
    public const string DemoQrCode = "DEMO2026QRUS";
    public const string DemoOrganizationSlug = "qrious-demo";

    public async Task SeedReferenceDataAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();

        // Interests & skills
        var interests = await db.Interests.ToDictionaryAsync(t => t.NormalizedName, ct);
        foreach (var (group, names) in SeedData.Interests)
            foreach (var name in names)
            {
                var n = TagNormalizer.Normalize(name)!;
                if (interests.ContainsKey(n)) continue;
                var tag = new Interest { Name = name, NormalizedName = n, GroupName = group, Status = TagStatus.Approved, CreatedAt = now };
                db.Interests.Add(tag);
                interests[n] = tag;
            }

        var skills = await db.Skills.ToDictionaryAsync(t => t.NormalizedName, ct);
        foreach (var (group, names) in SeedData.Skills)
            foreach (var name in names)
            {
                var n = TagNormalizer.Normalize(name)!;
                if (skills.ContainsKey(n)) continue;
                var tag = new Skill { Name = name, NormalizedName = n, GroupName = group, Status = TagStatus.Approved, CreatedAt = now };
                db.Skills.Add(tag);
                skills[n] = tag;
            }

        var interestAliases = await db.InterestAliases.Select(a => a.AliasNormalized).ToListAsync(ct);
        var skillAliases = await db.SkillAliases.Select(a => a.AliasNormalized).ToListAsync(ct);
        foreach (var (alias, canonical, isSkill) in SeedData.Aliases)
        {
            var a = TagNormalizer.Normalize(alias)!;
            var c = TagNormalizer.Normalize(canonical)!;
            if (isSkill && !skillAliases.Contains(a) && skills.TryGetValue(c, out var s))
                db.SkillAliases.Add(new SkillAlias { AliasNormalized = a, SkillId = s.Id });
            if (!isSkill && !interestAliases.Contains(a) && interests.TryGetValue(c, out var i))
                db.InterestAliases.Add(new InterestAlias { AliasNormalized = a, InterestId = i.Id });
        }

        // Categories, suggestions, intentions
        var categories = await db.EventCategories.ToDictionaryAsync(c => c.Slug, ct);
        var intentions = await db.NetworkingIntentions.ToListAsync(ct);
        var interestSuggestions = await db.CategoryInterestSuggestions.ToListAsync(ct);
        var skillSuggestions = await db.CategorySkillSuggestions.ToListAsync(ct);

        short order = 0;
        foreach (var (slug, label, group) in SeedData.Global)
        {
            if (intentions.Any(x => x.CategoryId == null && x.Slug == slug)) continue;
            var intention = new NetworkingIntention { Slug = slug, Label = label, PulseGroup = ParseGroup(group), SortOrder = order++ };
            db.NetworkingIntentions.Add(intention);
            intentions.Add(intention);
        }

        order = 0;
        foreach (var c in SeedData.Categories)
        {
            if (!categories.TryGetValue(c.Slug, out var category))
            {
                category = new EventCategory { Slug = c.Slug, Name = c.Name, Description = c.Description, ImageUrl = c.Image, SortOrder = order };
                db.EventCategories.Add(category);
                categories[c.Slug] = category;
            }
            order++;

            short rank = 0;
            foreach (var name in c.Interests)
            {
                var tag = interests[TagNormalizer.Normalize(name)!];
                if (!interestSuggestions.Any(s => s.CategoryId == category.Id && s.InterestId == tag.Id))
                    db.CategoryInterestSuggestions.Add(new CategoryInterestSuggestion { CategoryId = category.Id, InterestId = tag.Id, Rank = rank });
                rank++;
            }
            rank = 0;
            foreach (var name in c.Skills)
            {
                var tag = skills[TagNormalizer.Normalize(name)!];
                if (!skillSuggestions.Any(s => s.CategoryId == category.Id && s.SkillId == tag.Id))
                    db.CategorySkillSuggestions.Add(new CategorySkillSuggestion { CategoryId = category.Id, SkillId = tag.Id, Rank = rank });
                rank++;
            }
            short iOrder = 0;
            foreach (var (slug, label, group) in c.Intentions)
            {
                if (!intentions.Any(x => x.CategoryId == category.Id && x.Slug == slug))
                {
                    var intention = new NetworkingIntention { CategoryId = category.Id, Slug = slug, Label = label, PulseGroup = ParseGroup(group), SortOrder = iOrder };
                    db.NetworkingIntentions.Add(intention);
                    intentions.Add(intention);
                }
                iOrder++;
            }
        }

        await SeedPlansAsync(now, ct);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Reference data seeded");
    }

    /// <summary>
    /// Plans and features (D-01). Prices follow PRD §19. Every numeric limit is null (unlimited) until the
    /// D-20 values are approved. Per-event packages are inactive until their price is decided.
    /// </summary>
    private async Task SeedPlansAsync(DateTimeOffset now, CancellationToken ct)
    {
        var existing = await db.SubscriptionPlans.Select(p => p.Code).ToListAsync(ct);
        string[] premiumFeatures =
        [
            FeatureKeys.AdvancedFilters, FeatureKeys.DetailedMatching, FeatureKeys.ProfileBadge,
            FeatureKeys.PremiumCustomization, FeatureKeys.SavedByVisibility, FeatureKeys.NetworkingAnalytics,
        ];
        string[] proFeatures = [FeatureKeys.OrgAdvancedPulse, FeatureKeys.OrgReportsExport, FeatureKeys.OrgBranding];
        string[] businessFeatures = [.. proFeatures, FeatureKeys.OrgMembers, FeatureKeys.OrgCrossEventAnalytics];

        void Add(string code, PlanAudience audience, string name, string description, BillingPeriod period, int price, bool isDefault,
            bool active, string[] enabled, string[] disabled, string[] limits, short sort)
        {
            if (existing.Contains(code)) return;
            var plan = new SubscriptionPlan
            {
                Code = code, Audience = audience, Name = name, Description = description, BillingPeriod = period,
                PriceMinor = price, IsDefault = isDefault, IsActive = active, SortOrder = sort, CreatedAt = now,
            };
            foreach (var f in enabled) plan.Features.Add(new SubscriptionFeature { FeatureKey = f, Enabled = true });
            foreach (var f in disabled) plan.Features.Add(new SubscriptionFeature { FeatureKey = f, Enabled = false });
            foreach (var f in limits) plan.Features.Add(new SubscriptionFeature { FeatureKey = f, Enabled = true, LimitValue = null });
            db.SubscriptionPlans.Add(plan);
        }

        string[] attendeeLimits = [FeatureKeys.SavedProfilesLimit];
        string[] orgLimits = [FeatureKeys.OrgActiveEventsLimit, FeatureKeys.OrgParticipantsLimit];

        Add("attendee_free", PlanAudience.Attendee, "Free", "Essential networking for everyone.", BillingPeriod.None, 0, true, true, [], premiumFeatures, attendeeLimits, 0);
        Add("attendee_premium_monthly", PlanAudience.Attendee, "Premium (monthly)", "Advanced discovery and networking.", BillingPeriod.Month, 9900, false, true, premiumFeatures, [], attendeeLimits, 1);
        Add("attendee_premium_yearly", PlanAudience.Attendee, "Premium (yearly)", "Advanced discovery and networking.", BillingPeriod.Year, 79900, false, true, premiumFeatures, [], attendeeLimits, 2);
        Add("org_starter", PlanAudience.Organization, "Starter", "Create and publish events with QR networking.", BillingPeriod.None, 0, true, true, [], businessFeatures, orgLimits, 10);
        Add("org_pro_monthly", PlanAudience.Organization, "Pro", "Advanced event management and networking tools.", BillingPeriod.Month, 49900, false, true, proFeatures,
            [FeatureKeys.OrgMembers, FeatureKeys.OrgCrossEventAnalytics], orgLimits, 11);
        Add("org_business_monthly", PlanAudience.Organization, "Business", "Multi-member organizations and cross-event insights.", BillingPeriod.Month, 149900, false, true, businessFeatures, [], orgLimits, 12);
        Add("org_event_package", PlanAudience.Organization, "Single event package", "One-time purchase for a single event (price to be confirmed).", BillingPeriod.OneTime, 19900, false, false, proFeatures, [], orgLimits, 13);
        await Task.CompletedTask;
    }

    /// <summary>Demo organization + live demo event with QR code <see cref="DemoQrCode"/> (development/staging only).</summary>
    public async Task SeedDemoDataAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var org = await db.Organizations.FirstOrDefaultAsync(o => o.Slug == DemoOrganizationSlug, ct);
        if (org is null)
        {
            org = new Organization
            {
                Name = "QRious Community",
                Slug = DemoOrganizationSlug,
                Description = "The team behind QRious, hosting demo events so you can try event networking.",
                Website = "https://example.com",
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Organizations.Add(org);
        }

        var qr = await db.EventQrCodes.Include(q => q.Event).FirstOrDefaultAsync(q => q.PublicCode == DemoQrCode, ct);
        if (qr is null)
        {
            var category = await db.EventCategories.FirstAsync(c => c.Slug == "concert", ct);
            var ev = new Event
            {
                OrganizationId = org.Id,
                CategoryId = category.Id,
                Name = "Indie Nights Live — QRious Demo",
                Description = "An evening of independent music, open jams and new connections. Meet musicians, producers, " +
                              "photographers and music lovers in the crowd — scan, create your profile, and start networking.",
                BannerKey = "/images/events/indie-nights.webp",
                VenueName = "The Courtyard",
                VenueAddress = "100 Feet Road, Indiranagar",
                City = "Bengaluru",
                TimeZone = "Asia/Kolkata",
                StartsAt = now.AddHours(-2),
                EndsAt = now.AddDays(90),
                Status = EventStatus.Active,
                PublishedAt = now,
                ActivatedAt = now,
                CreatedAt = now,
                UpdatedAt = now,
                NetworkingSettings = new EventNetworkingSettings { UpdatedAt = now },
            };
            ev.NetworkingSettings.EventId = ev.Id;
            db.Events.Add(ev);
            db.EventQrCodes.Add(new EventQrCode { EventId = ev.Id, PublicCode = DemoQrCode, CreatedAt = now });

            var intentions = await db.NetworkingIntentions
                .Where(i => i.CategoryId == category.Id || i.CategoryId == null)
                .OrderBy(i => i.CategoryId == null).ThenBy(i => i.SortOrder).ToListAsync(ct);
            short sort = 0;
            foreach (var i in intentions) db.EventIntentions.Add(new EventIntention { EventId = ev.Id, IntentionId = i.Id, SortOrder = sort++ });
            logger.LogInformation("Demo event created with QR code {Code}", DemoQrCode);
        }
        else if (qr.Event is { } ev && ev.EndsAt <= now.AddDays(7))
        {
            // Keep the demo event live on long-running staging environments.
            ev.EndsAt = now.AddDays(90);
            ev.Status = EventStatus.Active;
            ev.UpdatedAt = now;
        }
        await db.SaveChangesAsync(ct);
    }

    private static PulseGroup ParseGroup(string group) => group switch
    {
        "collaboration" => PulseGroup.Collaboration,
        "social" => PulseGroup.Social,
        "professional" => PulseGroup.Professional,
        "creative" => PulseGroup.Creative,
        _ => PulseGroup.Other,
    };
}
