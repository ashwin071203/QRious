using Microsoft.AspNetCore.Identity;

namespace QRious.Domain.Organizations;

public enum OrganizerStatus { Active, Suspended }

public enum OrganizationStatus { Active, Suspended }

public enum OrganizationRole { Owner, Member }

public class OrganizerUser : IdentityUser<Guid>
{
    public OrganizerUser() => Id = Guid.CreateVersion7();
    public string DisplayName { get; set; } = "";
    public OrganizerStatus Status { get; set; } = OrganizerStatus.Active;
    public DateTimeOffset CreatedAt { get; set; }
}

public class OrganizerRole : IdentityRole<Guid>
{
    public const string PlatformAdmin = "PlatformAdmin";
    public OrganizerRole() => Id = Guid.CreateVersion7();
}

public class Organization
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public string? Description { get; set; }
    public string? LogoKey { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string? Website { get; set; }
    public OrganizationStatus Status { get; set; } = OrganizationStatus.Active;
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class OrganizationMember
{
    public Guid OrganizationId { get; set; }
    public Guid OrganizerUserId { get; set; }
    public OrganizationRole Role { get; set; }
    public Guid? InvitedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
