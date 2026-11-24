using QRious.Domain.Identity;
using QRious.Domain.Taxonomy;

namespace QRious.Domain.Profiles;

/// <summary>Audience levels for individually controlled profile items (D-08).</summary>
public enum FieldVisibility { Public, Members, Connections }

public enum SocialPlatform { Instagram, Linkedin, X, Github, Behance, Dribbble, Youtube, Spotify, Soundcloud, Website, Portfolio, Other }

/// <summary>The attendee's single, reusable global profile. <see cref="Id"/> is the public profile id.</summary>
public class UserProfile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AttendeeId { get; set; }
    public Attendee? Attendee { get; set; }

    public string DisplayName { get; set; } = "";
    public string Username { get; set; } = "";
    public string UsernameNormalized { get; set; } = "";
    public DateTimeOffset? UsernameChangedAt { get; set; }

    public string? Bio { get; set; }
    public string? Profession { get; set; }
    public string? ProfessionNormalized { get; set; }
    public string? Company { get; set; }
    public string? Location { get; set; }
    public string? LookingForText { get; set; }
    public string? CanOfferText { get; set; }

    public string? PhotoKey { get; set; }
    public DateTimeOffset? PhotoUpdatedAt { get; set; }

    /// <summary>Visible to visitors without a profile (anonymous discovery). Default ON with consent (D-08).</summary>
    public bool IsPublic { get; set; } = true;
    public DateTimeOffset? AnonymousVisibilityConsentedAt { get; set; }
    public FieldVisibility CompanyVisibility { get; set; } = FieldVisibility.Members;
    public FieldVisibility LocationVisibility { get; set; } = FieldVisibility.Members;
    public bool ShowSavedMe { get; set; }
    public string? PremiumTheme { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public uint Version { get; set; }

    public List<ProfileInterest> Interests { get; set; } = [];
    public List<ProfileSkill> Skills { get; set; } = [];
    public List<ProfileLookingForSkill> LookingForSkills { get; set; } = [];
    public List<SocialLink> SocialLinks { get; set; } = [];
}

public class UsernameHistory
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ProfileId { get; set; }
    public string UsernameNormalized { get; set; } = "";
    public DateTimeOffset ChangedAt { get; set; }
    public DateTimeOffset ReservedUntil { get; set; }
}

public class SocialLink
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ProfileId { get; set; }
    public SocialPlatform Platform { get; set; }
    public string Url { get; set; } = "";
    public FieldVisibility Visibility { get; set; } = FieldVisibility.Members;
    public short SortOrder { get; set; }
}

public class ProfileInterest
{
    public Guid ProfileId { get; set; }
    public Guid InterestId { get; set; }
    public Interest? Interest { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class ProfileSkill
{
    public Guid ProfileId { get; set; }
    public Guid SkillId { get; set; }
    public Skill? Skill { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class ProfileLookingForSkill
{
    public Guid ProfileId { get; set; }
    public Guid SkillId { get; set; }
    public Skill? Skill { get; set; }
}
