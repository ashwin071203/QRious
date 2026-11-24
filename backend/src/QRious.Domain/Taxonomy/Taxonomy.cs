namespace QRious.Domain.Taxonomy;

public enum TagStatus { Approved, Pending, Rejected, Merged }

public enum PulseGroup { Collaboration, Social, Professional, Creative, Other }

public class EventCategory
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string? ImageUrl { get; set; }
    public short SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

/// <summary>Common shape for interests and skills.</summary>
public abstract class Tag
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string Name { get; set; } = "";
    public string NormalizedName { get; set; } = "";
    public TagStatus Status { get; set; } = TagStatus.Approved;
    public Guid? MergedIntoId { get; set; }
    public string? GroupName { get; set; }
    public Guid? CreatedByAttendeeId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class Interest : Tag;

public class Skill : Tag;

public class InterestAlias
{
    public string AliasNormalized { get; set; } = "";
    public Guid InterestId { get; set; }
}

public class SkillAlias
{
    public string AliasNormalized { get; set; } = "";
    public Guid SkillId { get; set; }
}

public class CategoryInterestSuggestion
{
    public Guid CategoryId { get; set; }
    public Guid InterestId { get; set; }
    public short Rank { get; set; }
}

public class CategorySkillSuggestion
{
    public Guid CategoryId { get; set; }
    public Guid SkillId { get; set; }
    public short Rank { get; set; }
}

public class NetworkingIntention
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? CategoryId { get; set; }
    public string Slug { get; set; } = "";
    public string Label { get; set; } = "";
    public PulseGroup PulseGroup { get; set; } = PulseGroup.Other;
    public bool IsActive { get; set; } = true;
    public short SortOrder { get; set; }
}
