using Microsoft.EntityFrameworkCore;
using QRious.Application.Common;
using QRious.Domain.Taxonomy;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Taxonomy;

public enum TagKind { Interest, Skill }

public sealed record TagInput(Guid? Id, string? Name);

public sealed record TagDto(Guid Id, string Name, string? Group, bool Suggested);

public sealed record CategoryDto(Guid Id, string Slug, string Name, string? Description, string? ImageUrl);

public sealed class TaxonomyService(QRiousDbContext db, TimeProvider clock)
{
    public async Task<IReadOnlyList<CategoryDto>> CategoriesAsync(CancellationToken ct) =>
        await db.EventCategories.AsNoTracking().Where(c => c.IsActive).OrderBy(c => c.SortOrder)
            .Select(c => new CategoryDto(c.Id, c.Slug, c.Name, c.Description, c.ImageUrl)).ToListAsync(ct);

    /// <summary>
    /// Searches approved tags. With no query, returns the event/category suggestions first.
    /// Event-specific suggestions take precedence over category defaults.
    /// </summary>
    public async Task<IReadOnlyList<TagDto>> SearchAsync(TagKind kind, string? q, Guid? eventId, Guid? categoryId, int limit, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 50);
        var normalized = TagNormalizer.Normalize(q);

        var suggestedIds = await SuggestedIdsAsync(kind, eventId, categoryId, ct);
        IQueryable<Tag> source = kind == TagKind.Interest ? db.Interests.AsNoTracking() : db.Skills.AsNoTracking();
        source = source.Where(t => t.Status == TagStatus.Approved);

        List<Tag> tags;
        if (normalized is null)
        {
            var suggested = await source.Where(t => suggestedIds.Contains(t.Id)).ToListAsync(ct);
            tags = suggested.OrderBy(t => suggestedIds.IndexOf(t.Id)).ToList();
            if (tags.Count < limit)
            {
                var more = await source.Where(t => !suggestedIds.Contains(t.Id))
                    .OrderBy(t => t.GroupName).ThenBy(t => t.Name).Take(limit - tags.Count).ToListAsync(ct);
                tags.AddRange(more);
            }
        }
        else
        {
            var pattern = "%" + EscapeLike(normalized) + "%";
            var aliasIds = kind == TagKind.Interest
                ? db.InterestAliases.Where(a => EF.Functions.Like(a.AliasNormalized, pattern)).Select(a => a.InterestId)
                : db.SkillAliases.Where(a => EF.Functions.Like(a.AliasNormalized, pattern)).Select(a => a.SkillId);
            tags = await source
                .Where(t => EF.Functions.Like(t.NormalizedName, pattern) || aliasIds.Contains(t.Id))
                .OrderByDescending(t => t.NormalizedName == normalized)
                .ThenByDescending(t => t.NormalizedName.StartsWith(normalized))
                .ThenBy(t => t.NormalizedName.Length)
                .Take(limit * 2)
                .ToListAsync(ct);
            tags = tags.OrderByDescending(t => t.NormalizedName == normalized)
                .ThenByDescending(t => suggestedIds.Contains(t.Id))
                .ThenByDescending(t => t.NormalizedName.StartsWith(normalized, StringComparison.Ordinal))
                .ToList();
        }

        return tags.Take(limit).Select(t => new TagDto(t.Id, t.Name, t.GroupName, suggestedIds.Contains(t.Id))).ToList();
    }

    private async Task<List<Guid>> SuggestedIdsAsync(TagKind kind, Guid? eventId, Guid? categoryId, CancellationToken ct)
    {
        if (eventId is { } eid)
        {
            var eventIds = kind == TagKind.Interest
                ? await db.EventSuggestedInterests.Where(s => s.EventId == eid).OrderBy(s => s.SortOrder).Select(s => s.InterestId).ToListAsync(ct)
                : await db.EventSuggestedSkills.Where(s => s.EventId == eid).OrderBy(s => s.SortOrder).Select(s => s.SkillId).ToListAsync(ct);
            if (eventIds.Count > 0) return eventIds;
            categoryId ??= await db.Events.Where(e => e.Id == eid).Select(e => (Guid?)e.CategoryId).FirstOrDefaultAsync(ct);
        }
        if (categoryId is not { } cid) return [];
        return kind == TagKind.Interest
            ? await db.CategoryInterestSuggestions.Where(s => s.CategoryId == cid).OrderBy(s => s.Rank).Select(s => s.InterestId).ToListAsync(ct)
            : await db.CategorySkillSuggestions.Where(s => s.CategoryId == cid).OrderBy(s => s.Rank).Select(s => s.SkillId).ToListAsync(ct);
    }

    /// <summary>
    /// Resolves chosen tags to ids. Existing tags are matched by id, normalized name or alias;
    /// new custom tags are created as <c>pending</c> (usable on the creator's profile immediately, D-18).
    /// Duplicates collapse via normalization. Must run inside the caller's transaction.
    /// </summary>
    public async Task<List<Guid>> ResolveAsync(TagKind kind, IReadOnlyList<TagInput> inputs, Guid attendeeId, string field, CancellationToken ct)
    {
        var result = new List<Guid>();

        foreach (var input in inputs)
        {
            Guid? id = null;
            if (input.Id is { } given)
            {
                var tag = kind == TagKind.Interest
                    ? await db.Interests.AsNoTracking().Where(t => t.Id == given).Select(t => new { t.Id, t.Status, t.MergedIntoId }).FirstOrDefaultAsync(ct)
                    : await db.Skills.AsNoTracking().Where(t => t.Id == given).Select(t => new { t.Id, t.Status, t.MergedIntoId }).FirstOrDefaultAsync(ct);
                if (tag is null || tag.Status == TagStatus.Rejected)
                    throw AppException.Validation(field, "One of the selected items is no longer available.");
                id = tag.Status == TagStatus.Merged && tag.MergedIntoId is { } merged ? merged : tag.Id;
            }
            else
            {
                var cleaned = TagNormalizer.Clean(input.Name);
                var error = TagNormalizer.Validate(cleaned);
                if (error is not null) throw AppException.Validation(field, $"\"{input.Name}\": {error}");
                var normalized = cleaned!.ToLowerInvariant();

                id = await FindExistingAsync(kind, normalized, ct);
                if (id is null)
                {
                    var newId = Guid.CreateVersion7();
                    var now = clock.GetUtcNow();
                    // ON CONFLICT handles two attendees creating the same custom tag concurrently.
                    if (kind == TagKind.Interest)
                        await db.Database.ExecuteSqlAsync(
                            $"INSERT INTO interests (id, name, normalized_name, status, created_by_attendee_id, created_at) VALUES ({newId}, {cleaned}, {normalized}, 'pending', {attendeeId}, {now}) ON CONFLICT (normalized_name) DO NOTHING", ct);
                    else
                        await db.Database.ExecuteSqlAsync(
                            $"INSERT INTO skills (id, name, normalized_name, status, created_by_attendee_id, created_at) VALUES ({newId}, {cleaned}, {normalized}, 'pending', {attendeeId}, {now}) ON CONFLICT (normalized_name) DO NOTHING", ct);
                    id = await FindExistingAsync(kind, normalized, ct);
                    if (id is null) throw new InvalidOperationException("Tag creation failed.");
                }
                else
                {
                    var status = kind == TagKind.Interest
                        ? await db.Interests.Where(t => t.Id == id).Select(t => t.Status).FirstAsync(ct)
                        : await db.Skills.Where(t => t.Id == id).Select(t => t.Status).FirstAsync(ct);
                    if (status == TagStatus.Rejected)
                        throw AppException.Validation(field, $"\"{cleaned}\" isn't available. Please choose a different name.");
                }
            }

            if (!result.Contains(id.Value)) result.Add(id.Value);
        }
        return result;
    }

    private async Task<Guid?> FindExistingAsync(TagKind kind, string normalized, CancellationToken ct)
    {
        if (kind == TagKind.Interest)
        {
            var tag = await db.Interests.AsNoTracking().Where(t => t.NormalizedName == normalized)
                .Select(t => new { t.Id, t.Status, t.MergedIntoId }).FirstOrDefaultAsync(ct);
            if (tag is not null) return tag.Status == TagStatus.Merged && tag.MergedIntoId is { } m ? m : tag.Id;
            return await db.InterestAliases.Where(a => a.AliasNormalized == normalized).Select(a => (Guid?)a.InterestId).FirstOrDefaultAsync(ct);
        }
        else
        {
            var tag = await db.Skills.AsNoTracking().Where(t => t.NormalizedName == normalized)
                .Select(t => new { t.Id, t.Status, t.MergedIntoId }).FirstOrDefaultAsync(ct);
            if (tag is not null) return tag.Status == TagStatus.Merged && tag.MergedIntoId is { } m ? m : tag.Id;
            return await db.SkillAliases.Where(a => a.AliasNormalized == normalized).Select(a => (Guid?)a.SkillId).FirstOrDefaultAsync(ct);
        }
    }

    private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
