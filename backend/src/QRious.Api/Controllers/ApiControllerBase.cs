using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using QRious.Api.Security;
using QRious.Application.Common;

namespace QRious.Api.Controllers;

[ApiController]
[Produces("application/json")]
public abstract class ApiControllerBase : ControllerBase
{
    protected bool IsAttendee => User.FindFirstValue(AttendeeClaims.AttendeeId) is not null;

    protected Guid AttendeeId => Guid.TryParse(User.FindFirstValue(AttendeeClaims.AttendeeId), out var id)
        ? id
        : throw AppException.Unauthorized(ErrorCodes.ProfileRequired, "Create your QRious profile to use this feature.");

    protected Guid SessionId => Guid.Parse(User.FindFirstValue(AttendeeClaims.SessionId)!);
}

public static class Policies
{
    public const string Attendee = "Attendee";
}
