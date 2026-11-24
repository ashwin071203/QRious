using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using QRious.Api.Infrastructure;
using QRious.Api.Security;
using QRious.Application.Common;
using QRious.Application.Identity;
using QRious.Application.Profiles;

namespace QRious.Api.Controllers;

[Route("api/v1/onboarding")]
public sealed class OnboardingController(OnboardingService onboarding, ProfileService profiles, AttendeeCookie cookie) : ApiControllerBase
{
    [HttpGet("username-availability")]
    [EnableRateLimiting(RateLimits.UsernameCheck)]
    public async Task<UsernameAvailabilityDto> UsernameAvailability([FromQuery(Name = "u")] string? username, CancellationToken ct) =>
        await profiles.CheckUsernameAsync(username, IsAttendee ? AttendeeId : null, ct);

    /// <summary>
    /// Create My Profile — atomic identity + profile + participation + session (PRD §12.6).
    /// Requires an <c>Idempotency-Key</c> header (UUID) so retries never create duplicates.
    /// </summary>
    [HttpPost("profile")]
    [EnableRateLimiting(RateLimits.ProfileCreate)]
    [ProducesResponseType<CreateProfileResponse>(StatusCodes.Status201Created)]
    public async Task<IActionResult> CreateProfile([FromBody] CreateProfileRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey, CancellationToken ct)
    {
        if (IsAttendee)
        {
            // Returning attendee with a valid session: never create a duplicate identity (BR-10).
            var ex = AppException.Conflict(ErrorCodes.ExistingIdentity, "You already have a QRious profile on this device.");
            ex.Extensions["profile"] = await profiles.GetSummaryAsync(AttendeeId, ct);
            throw ex;
        }
        if (!Guid.TryParse(idempotencyKey, out var key))
            throw AppException.BadRequest("idempotency_key_required", "An Idempotency-Key header (UUID) is required.");

        var outcome = await onboarding.CreateAsync(request, key, ct);
        cookie.Write(Response, outcome.SessionToken, outcome.SessionExpiresAt);
        return StatusCode(outcome.Replayed ? StatusCodes.Status200OK : StatusCodes.Status201Created, outcome.Response);
    }
}

public sealed record RecoveryRequest(string? Username, string? RecoveryCode);

public sealed record RecoveryResponse(string NewRecoveryCode, string RedirectTo);

[Route("api/v1/recovery")]
public sealed class RecoveryController(RecoveryService recovery, AttendeeCookie cookie) : ApiControllerBase
{
    /// <summary>Recover an account on a new device with username + recovery code (D-13).</summary>
    [HttpPost]
    [EnableRateLimiting(RateLimits.Recovery)]
    public async Task<RecoveryResponse> Recover([FromBody] RecoveryRequest request, CancellationToken ct)
    {
        var result = await recovery.RecoverAsync(request.Username, request.RecoveryCode, ct);
        cookie.Write(Response, result.Session.Token, result.Session.Session.ExpiresAt);
        return new RecoveryResponse(result.NewRecoveryCode, "/app");
    }
}
