using Microsoft.EntityFrameworkCore;
using Npgsql;
using QRious.Application.Common;
using QRious.Application.Platform;
using QRious.Application.Taxonomy;
using QRious.Domain.Profiles;
using QRious.Domain.Safety;
using QRious.Domain.Taxonomy;
using QRious.Infrastructure.Images;
using QRious.Infrastructure.Persistence;
using QRious.Infrastructure.Storage;

namespace QRious.Application.Profiles;

public sealed class ProfileService(
    QRiousDbContext db,
    TimeProvider clock,
    TaxonomyService taxonomy,
    IObjectStorage storage,
    ImageProcessor images,
    AuditService audit)
{
    private static readonly int[] PhotoSizes = [512, 128];

    // ---------- Read ----------

    public async Task<OwnProfileDto> GetOwnAsync(Guid attendeeId, CancellationToken ct)
    {
        var p = await LoadAsync(attendeeId, tracking: false, ct);
        return ToOwnDto(p);
    }

    public async Task<ProfileSummaryDto?> GetSummaryAsync(Guid attendeeId, CancellationToken ct)
    {
        var p = await db.UserProfiles.AsNoTracking().FirstOrDefaultAsync(x => x.AttendeeId == attendeeId, ct);
        return p is null ? null : new ProfileSummaryDto(p.Id, p.DisplayName, p.Username, Photo(p));
    }

    private async Task<UserProfile> LoadAsync(Guid attendeeId, bool tracking, CancellationToken ct)
    {
        IQueryable<UserProfile> q = db.UserProfiles
            .Include(x => x.Interests).ThenInclude(x => x.Interest)
            .Include(x => x.Skills).ThenInclude(x => x.Skill)
            .Include(x => x.LookingForSkills).ThenInclude(x => x.Skill)
            .Include(x => x.SocialLinks)
            .AsSplitQuery();
        if (!tracking) q = q.AsNoTracking();
        return await q.FirstOrDefaultAsync(x => x.AttendeeId == attendeeId, ct)
               ?? throw AppException.NotFound(ErrorCodes.NotFound, "Profile not found.");
    }

    public OwnProfileDto ToOwnDto(UserProfile p) => new(
        p.Id,
        p.DisplayName,
        p.Username,
        p.Bio,
        p.Profession,
        p.Company,
        p.Location,
        p.LookingForText,
        p.CanOfferText,
        Photo(p),
        p.Interests.Where(i => i.Interest is not null).OrderBy(i => i.CreatedAt)
            .Select(i => new ProfileTagDto(i.InterestId, i.Interest!.Name, i.Interest.Status == TagStatus.Pending)).ToList(),
        p.Skills.Where(s => s.Skill is not null).OrderBy(s => s.CreatedAt)
            .Select(s => new ProfileTagDto(s.SkillId, s.Skill!.Name, s.Skill.Status == TagStatus.Pending)).ToList(),
        p.LookingForSkills.Where(s => s.Skill is not null)
            .Select(s => new ProfileTagDto(s.SkillId, s.Skill!.Name, s.Skill.Status == TagStatus.Pending)).ToList(),
        p.SocialLinks.OrderBy(l => l.SortOrder)
            .Select(l => new SocialLinkDto(l.Id, SnakeCaseEnum<SocialPlatform>.ToText(l.Platform), l.Url, SnakeCaseEnum<FieldVisibility>.ToText(l.Visibility))).ToList(),
        new PrivacyDto(p.IsPublic, p.AnonymousVisibilityConsentedAt,
            SnakeCaseEnum<FieldVisibility>.ToText(p.CompanyVisibility), SnakeCaseEnum<FieldVisibility>.ToText(p.LocationVisibility)),
        p.UsernameChangedAt is { } changed ? changed + UsernameRules.ChangeCooldown : null,
        p.CreatedAt);

    public PhotoDto? Photo(UserProfile p) => p.PhotoKey is null
        ? null
        : new PhotoDto(storage.PublicUrl($"{p.PhotoKey}/512.webp"), storage.PublicUrl($"{p.PhotoKey}/128.webp"));

    // ---------- Usernames ----------

    public async Task<UsernameAvailabilityDto> CheckUsernameAsync(string? input, Guid? currentAttendeeId, CancellationToken ct)
    {
        var normalized = UsernameRules.Normalize(input);
        if (UsernameRules.Validate(normalized) is { } error)
            return new UsernameAvailabilityDto(false, normalized, error, []);
        if (await IsUsernameAvailableAsync(normalized!, currentAttendeeId, ct))
            return new UsernameAvailabilityDto(true, normalized, null, []);
        return new UsernameAvailabilityDto(false, normalized, "That username is already taken.", await SuggestUsernamesAsync(normalized!, ct));
    }

    private async Task<bool> IsUsernameAvailableAsync(string normalized, Guid? currentAttendeeId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var owner = await db.UserProfiles.AsNoTracking().Where(p => p.UsernameNormalized == normalized)
            .Select(p => (Guid?)p.AttendeeId).FirstOrDefaultAsync(ct);
        if (owner is not null) return owner == currentAttendeeId;
        var held = await db.UsernameHistory.AsNoTracking()
            .Where(h => h.UsernameNormalized == normalized && h.ReservedUntil > now)
            .Join(db.UserProfiles, h => h.ProfileId, p => p.Id, (h, p) => p.AttendeeId)
            .ToListAsync(ct);
        // A released username is held for its previous owner only (D-16).
        return held.Count == 0 || held.All(a => a == currentAttendeeId);
    }

    public async Task<IReadOnlyList<string>> SuggestUsernamesAsync(string normalized, CancellationToken ct)
    {
        var candidates = UsernameRules.Candidates(normalized).Where(c => UsernameRules.Validate(c) is null).Distinct().ToList();
        var taken = await db.UserProfiles.AsNoTracking().Where(p => candidates.Contains(p.UsernameNormalized))
            .Select(p => p.UsernameNormalized).ToListAsync(ct);
        return candidates.Except(taken).Take(3).ToList();
    }

    // ---------- Update ----------

    public async Task<OwnProfileDto> UpdateAsync(Guid attendeeId, UpdateProfileRequest r, CancellationToken ct)
    {
        var errors = new ProfileValidation.Errors();
        if (r.DisplayName is not null) ProfileValidation.Text(errors, "displayName", r.DisplayName, 60, required: true, label: "Display name");
        string? newUsername = null;
        if (r.Username is not null)
        {
            newUsername = UsernameRules.Normalize(r.Username);
            if (UsernameRules.Validate(newUsername) is { } e) errors.Add("username", e);
        }
        ProfileValidation.Text(errors, "bio", r.Bio, 500, label: "Bio");
        ProfileValidation.Text(errors, "profession", r.Profession, 100, label: "Profession");
        ProfileValidation.Text(errors, "company", r.Company, 100, label: "Company or college");
        ProfileValidation.Text(errors, "location", r.Location, 100, label: "Location");
        ProfileValidation.Text(errors, "lookingForText", r.LookingForText, 500, label: "What you're looking for");
        ProfileValidation.Text(errors, "canOfferText", r.CanOfferText, 500, label: "What you can offer");
        errors.ThrowIfAny();

        var p = await LoadAsync(attendeeId, tracking: true, ct);
        var now = clock.GetUtcNow();

        if (r.DisplayName is not null) p.DisplayName = ProfileValidation.CleanText(r.DisplayName)!;
        // Optional fields: null = unchanged, empty string = clear.
        if (r.Bio is not null) p.Bio = ProfileValidation.CleanText(r.Bio);
        if (r.Profession is not null)
        {
            p.Profession = ProfileValidation.CleanText(r.Profession);
            p.ProfessionNormalized = p.Profession?.ToLowerInvariant();
        }
        if (r.Company is not null) p.Company = ProfileValidation.CleanText(r.Company);
        if (r.Location is not null) p.Location = ProfileValidation.CleanText(r.Location);
        if (r.LookingForText is not null) p.LookingForText = ProfileValidation.CleanText(r.LookingForText);
        if (r.CanOfferText is not null) p.CanOfferText = ProfileValidation.CleanText(r.CanOfferText);

        if (newUsername is not null && newUsername != p.UsernameNormalized)
        {
            if (p.UsernameChangedAt is { } last && now - last < UsernameRules.ChangeCooldown)
            {
                var ex = AppException.Conflict(ErrorCodes.UsernameChangeTooSoon, "You can change your username once every 30 days.");
                ex.Extensions["availableAt"] = last + UsernameRules.ChangeCooldown;
                throw ex;
            }
            if (!await IsUsernameAvailableAsync(newUsername, attendeeId, ct))
            {
                var ex = AppException.Conflict(ErrorCodes.UsernameTaken, "That username is already taken.");
                ex.Extensions["suggestions"] = await SuggestUsernamesAsync(newUsername, ct);
                throw ex;
            }
            db.UsernameHistory.Add(new UsernameHistory
            {
                ProfileId = p.Id,
                UsernameNormalized = p.UsernameNormalized,
                ChangedAt = now,
                ReservedUntil = now + UsernameRules.ReleaseHold,
            });
            audit.Write(ActorType.Attendee, attendeeId, "profile.username_changed", "profile", p.Id,
                new { from = p.UsernameNormalized, to = newUsername });
            p.Username = newUsername;
            p.UsernameNormalized = newUsername;
            p.UsernameChangedAt = now;
        }

        p.UpdatedAt = now;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            throw AppException.Conflict(ErrorCodes.UsernameTaken, "That username is already taken.");
        }
        return ToOwnDto(p);
    }

    public async Task<OwnProfileDto> ReplaceTagsAsync(Guid attendeeId, TagKind kind, bool lookingFor, IReadOnlyList<TagInput> tags, CancellationToken ct)
    {
        var field = lookingFor ? "lookingForSkills" : kind == TagKind.Interest ? "interests" : "skills";
        var errors = new ProfileValidation.Errors();
        ProfileValidation.Tags(errors, field, tags, lookingFor ? 0 : 1,
            lookingFor ? ProfileValidation.MaxLookingForSkills : ProfileValidation.MaxTags, kind == TagKind.Interest ? "interest" : "skill");
        errors.ThrowIfAny();

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var p = await LoadAsync(attendeeId, tracking: true, ct);
        var ids = await taxonomy.ResolveAsync(kind, tags, attendeeId, field, ct);
        var now = clock.GetUtcNow();

        if (lookingFor)
        {
            p.LookingForSkills.RemoveAll(x => !ids.Contains(x.SkillId));
            foreach (var id in ids.Where(id => p.LookingForSkills.All(x => x.SkillId != id)))
                p.LookingForSkills.Add(new ProfileLookingForSkill { ProfileId = p.Id, SkillId = id });
        }
        else if (kind == TagKind.Interest)
        {
            p.Interests.RemoveAll(x => !ids.Contains(x.InterestId));
            foreach (var id in ids.Where(id => p.Interests.All(x => x.InterestId != id)))
                p.Interests.Add(new ProfileInterest { ProfileId = p.Id, InterestId = id, CreatedAt = now });
        }
        else
        {
            p.Skills.RemoveAll(x => !ids.Contains(x.SkillId));
            foreach (var id in ids.Where(id => p.Skills.All(x => x.SkillId != id)))
                p.Skills.Add(new ProfileSkill { ProfileId = p.Id, SkillId = id, CreatedAt = now });
        }
        p.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return await GetOwnAsync(attendeeId, ct);
    }

    public async Task<OwnProfileDto> ReplaceSocialLinksAsync(Guid attendeeId, IReadOnlyList<SocialLinkInput> links, CancellationToken ct)
    {
        var errors = new ProfileValidation.Errors();
        var parsed = ProfileValidation.SocialLinks(errors, links);
        errors.ThrowIfAny();

        var p = await LoadAsync(attendeeId, tracking: true, ct);
        db.SocialLinks.RemoveRange(p.SocialLinks);
        await db.SaveChangesAsync(ct);
        foreach (var link in parsed)
        {
            link.ProfileId = p.Id;
            db.SocialLinks.Add(link);
        }
        p.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return await GetOwnAsync(attendeeId, ct);
    }

    public async Task<OwnProfileDto> UpdatePrivacyAsync(Guid attendeeId, UpdatePrivacyRequest r, CancellationToken ct)
    {
        var errors = new ProfileValidation.Errors();
        FieldVisibility company = default, location = default;
        if (r.CompanyVisibility is not null && !ProfileValidation.TryParseEnum(r.CompanyVisibility, out company))
            errors.Add("companyVisibility", "Choose public, members or connections.");
        if (r.LocationVisibility is not null && !ProfileValidation.TryParseEnum(r.LocationVisibility, out location))
            errors.Add("locationVisibility", "Choose public, members or connections.");
        errors.ThrowIfAny();

        var p = await LoadAsync(attendeeId, tracking: true, ct);
        var now = clock.GetUtcNow();

        if (r.IsPublic is { } isPublic && isPublic != p.IsPublic)
        {
            if (isPublic)
            {
                // Turning anonymous visibility on requires explicit consent (D-08).
                if (!r.AnonymousVisibilityConsent)
                    throw new AppException(400, ErrorCodes.ConsentRequired,
                        "Please confirm you understand that visitors without a profile will be able to see your public profile.");
                p.AnonymousVisibilityConsentedAt = now;
            }
            p.IsPublic = isPublic;
            audit.Write(ActorType.Attendee, attendeeId, isPublic ? "privacy.anonymous_visibility_on" : "privacy.anonymous_visibility_off", "profile", p.Id);
        }
        if (r.CompanyVisibility is not null) p.CompanyVisibility = company;
        if (r.LocationVisibility is not null) p.LocationVisibility = location;
        p.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        return ToOwnDto(p);
    }

    // ---------- Photo ----------

    public async Task<PhotoDto> SetPhotoAsync(Guid attendeeId, Stream content, CancellationToken ct)
    {
        IReadOnlyList<ProcessedImage> processed;
        try
        {
            processed = await images.ProcessSquareAsync(content, PhotoSizes, ct);
        }
        catch (ImageValidationException ex)
        {
            throw new AppException(400, ex.Code, ex.Message);
        }

        var p = await db.UserProfiles.FirstOrDefaultAsync(x => x.AttendeeId == attendeeId, ct)
                ?? throw AppException.NotFound(ErrorCodes.NotFound, "Profile not found.");

        // A new random key per upload: unguessable URLs, and no stale CDN cache after replacement.
        var key = $"profiles/{Identity.SecureTokens.Base64Url(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16))}";
        foreach (var image in processed)
        {
            using var ms = new MemoryStream(image.Data);
            await storage.PutAsync($"{key}/{image.Size}.webp", ms, "image/webp", ct);
        }

        var oldKey = p.PhotoKey;
        p.PhotoKey = key;
        p.PhotoUpdatedAt = clock.GetUtcNow();
        p.UpdatedAt = p.PhotoUpdatedAt.Value;
        await db.SaveChangesAsync(ct);
        if (oldKey is not null) await DeletePhotoObjectsAsync(oldKey, ct);
        return Photo(p)!;
    }

    public async Task RemovePhotoAsync(Guid attendeeId, CancellationToken ct)
    {
        var p = await db.UserProfiles.FirstOrDefaultAsync(x => x.AttendeeId == attendeeId, ct)
                ?? throw AppException.NotFound(ErrorCodes.NotFound, "Profile not found.");
        if (p.PhotoKey is null) return;
        var oldKey = p.PhotoKey;
        p.PhotoKey = null;
        p.PhotoUpdatedAt = clock.GetUtcNow();
        p.UpdatedAt = p.PhotoUpdatedAt.Value;
        await db.SaveChangesAsync(ct);
        await DeletePhotoObjectsAsync(oldKey, ct);
    }

    private async Task DeletePhotoObjectsAsync(string key, CancellationToken ct)
    {
        foreach (var size in PhotoSizes)
        {
            try { await storage.DeleteAsync($"{key}/{size}.webp", ct); }
            catch { /* Orphans are tolerated; a cleanup job can remove them later. */ }
        }
    }
}
