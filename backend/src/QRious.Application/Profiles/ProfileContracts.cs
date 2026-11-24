using QRious.Application.Taxonomy;

namespace QRious.Application.Profiles;

public sealed record SocialLinkInput(string Platform, string Url, string? Visibility);

public sealed record SocialLinkDto(Guid Id, string Platform, string Url, string Visibility);

public sealed record ProfileTagDto(Guid Id, string Name, bool Pending);

public sealed record PhotoDto(string Url, string ThumbnailUrl);

/// <summary>The owner's full view of their own profile, including privacy settings.</summary>
public sealed record OwnProfileDto(
    Guid Id,
    string DisplayName,
    string Username,
    string? Bio,
    string? Profession,
    string? Company,
    string? Location,
    string? LookingForText,
    string? CanOfferText,
    PhotoDto? Photo,
    IReadOnlyList<ProfileTagDto> Interests,
    IReadOnlyList<ProfileTagDto> Skills,
    IReadOnlyList<ProfileTagDto> LookingForSkills,
    IReadOnlyList<SocialLinkDto> SocialLinks,
    PrivacyDto Privacy,
    DateTimeOffset? UsernameChangeAvailableAt,
    DateTimeOffset CreatedAt);

public sealed record PrivacyDto(bool IsPublic, DateTimeOffset? AnonymousVisibilityConsentedAt, string CompanyVisibility, string LocationVisibility);

public sealed record ProfileSummaryDto(Guid Id, string DisplayName, string Username, PhotoDto? Photo);

public sealed record CreateProfileRequest
{
    public string? QrCode { get; init; }
    public string? DisplayName { get; init; }
    public string? Username { get; init; }
    public List<TagInput> Interests { get; init; } = [];
    public List<TagInput> Skills { get; init; } = [];
    public bool IsPublic { get; init; } = true;
    public bool AnonymousVisibilityConsent { get; init; }
    public string? Bio { get; init; }
    public string? Profession { get; init; }
    public string? Company { get; init; }
    public string? Location { get; init; }
    public string? LookingForText { get; init; }
    public string? CanOfferText { get; init; }
    public List<TagInput> LookingForSkills { get; init; } = [];
    public List<SocialLinkInput> SocialLinks { get; init; } = [];
}

public sealed record CreateProfileResponse(ProfileSummaryDto Profile, Guid EventId, string RedirectTo, string? RecoveryCode);

public sealed record UpdateProfileRequest
{
    public string? DisplayName { get; init; }
    public string? Username { get; init; }
    public string? Bio { get; init; }
    public string? Profession { get; init; }
    public string? Company { get; init; }
    public string? Location { get; init; }
    public string? LookingForText { get; init; }
    public string? CanOfferText { get; init; }
}

public sealed record UpdatePrivacyRequest
{
    public bool? IsPublic { get; init; }
    public bool AnonymousVisibilityConsent { get; init; }
    public string? CompanyVisibility { get; init; }
    public string? LocationVisibility { get; init; }
}

public sealed record UsernameAvailabilityDto(bool Available, string? Normalized, string? Reason, IReadOnlyList<string> Suggestions);
