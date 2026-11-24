using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using QRious.Api.Infrastructure;
using QRious.Api.Security;
using QRious.Application.Billing;
using QRious.Application.Identity;
using QRious.Application.Participation;
using QRious.Application.Profiles;
using QRious.Application.Taxonomy;
using QRious.Domain.Identity;

namespace QRious.Api.Controllers;

public sealed record SessionStatusDto(bool Authenticated, ProfileSummaryDto? Profile, bool? IsParticipant);

public sealed record RecoveryCodeStatusDto(bool HasActiveCode, DateTimeOffset? CreatedAt);

public sealed record RecoveryCodeDto(string RecoveryCode);

public sealed record TagListRequest(List<TagInput> Items);

public sealed record SocialLinksRequest(List<SocialLinkInput> Links);

public sealed record JoinEventRequest(string? QrCode);

[Route("api/v1/me")]
public sealed class MeController(
    SessionService sessions,
    RecoveryService recovery,
    ProfileService profiles,
    ParticipationService participation,
    AttendeeCookie cookie) : ApiControllerBase
{
    /// <summary>Who am I? Works anonymously (returns authenticated=false). Used for returning-attendee recognition.</summary>
    [HttpGet("session")]
    [EnableRateLimiting(RateLimits.PublicRead)]
    public async Task<SessionStatusDto> Session([FromQuery] Guid? eventId, CancellationToken ct)
    {
        if (!IsAttendee) return new SessionStatusDto(false, null, null);
        var profile = await profiles.GetSummaryAsync(AttendeeId, ct);
        bool? isParticipant = eventId is { } e ? await participation.IsActiveParticipantAsync(AttendeeId, e, ct) : null;
        return new SessionStatusDto(profile is not null, profile, isParticipant);
    }

    [HttpPost("session/logout")]
    [Authorize(Policies.Attendee)]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        await sessions.RevokeAsync(SessionId, AttendeeId, SessionRevokedReason.Logout, ct);
        cookie.Clear(Response);
        return NoContent();
    }

    [HttpGet("sessions")]
    [Authorize(Policies.Attendee)]
    public async Task<IReadOnlyList<SessionDto>> Sessions(CancellationToken ct) => await sessions.ListAsync(AttendeeId, SessionId, ct);

    [HttpDelete("sessions/{sessionId:guid}")]
    [Authorize(Policies.Attendee)]
    public async Task<IActionResult> RevokeSession(Guid sessionId, CancellationToken ct)
    {
        await sessions.RevokeAsync(sessionId, AttendeeId, SessionRevokedReason.UserRevoked, ct);
        if (sessionId == SessionId) cookie.Clear(Response);
        return NoContent();
    }

    [HttpPost("sessions/revoke-others")]
    [Authorize(Policies.Attendee)]
    public async Task<object> RevokeOtherSessions(CancellationToken ct) =>
        new { revoked = await sessions.RevokeAllAsync(AttendeeId, SessionRevokedReason.UserRevoked, SessionId, ct) };

    [HttpGet("recovery-code/status")]
    [Authorize(Policies.Attendee)]
    public async Task<RecoveryCodeStatusDto> RecoveryStatus(CancellationToken ct)
    {
        var created = await recovery.GetActiveCreatedAtAsync(AttendeeId, ct);
        return new RecoveryCodeStatusDto(created is not null, created);
    }

    /// <summary>Invalidates the current recovery code and returns a new one (shown once).</summary>
    [HttpPost("recovery-code/regenerate")]
    [Authorize(Policies.Attendee)]
    [EnableRateLimiting(RateLimits.AttendeeWrite)]
    public async Task<RecoveryCodeDto> RegenerateRecoveryCode(CancellationToken ct) =>
        new(await recovery.RegenerateAsync(AttendeeId, ct));

    // ---------- Profile ----------

    [HttpGet("profile")]
    [Authorize(Policies.Attendee)]
    public async Task<OwnProfileDto> Profile(CancellationToken ct) => await profiles.GetOwnAsync(AttendeeId, ct);

    [HttpPatch("profile")]
    [Authorize(Policies.Attendee)]
    [EnableRateLimiting(RateLimits.AttendeeWrite)]
    public async Task<OwnProfileDto> UpdateProfile([FromBody] UpdateProfileRequest request, CancellationToken ct) =>
        await profiles.UpdateAsync(AttendeeId, request, ct);

    [HttpPut("profile/interests")]
    [Authorize(Policies.Attendee)]
    [EnableRateLimiting(RateLimits.AttendeeWrite)]
    public async Task<OwnProfileDto> ReplaceInterests([FromBody] TagListRequest request, CancellationToken ct) =>
        await profiles.ReplaceTagsAsync(AttendeeId, TagKind.Interest, false, request.Items ?? [], ct);

    [HttpPut("profile/skills")]
    [Authorize(Policies.Attendee)]
    [EnableRateLimiting(RateLimits.AttendeeWrite)]
    public async Task<OwnProfileDto> ReplaceSkills([FromBody] TagListRequest request, CancellationToken ct) =>
        await profiles.ReplaceTagsAsync(AttendeeId, TagKind.Skill, false, request.Items ?? [], ct);

    [HttpPut("profile/looking-for-skills")]
    [Authorize(Policies.Attendee)]
    [EnableRateLimiting(RateLimits.AttendeeWrite)]
    public async Task<OwnProfileDto> ReplaceLookingForSkills([FromBody] TagListRequest request, CancellationToken ct) =>
        await profiles.ReplaceTagsAsync(AttendeeId, TagKind.Skill, true, request.Items ?? [], ct);

    [HttpPut("profile/social-links")]
    [Authorize(Policies.Attendee)]
    [EnableRateLimiting(RateLimits.AttendeeWrite)]
    public async Task<OwnProfileDto> ReplaceSocialLinks([FromBody] SocialLinksRequest request, CancellationToken ct) =>
        await profiles.ReplaceSocialLinksAsync(AttendeeId, request.Links ?? [], ct);

    /// <summary>Upload or replace the profile photo (JPEG, PNG or WebP, max 5 MB). Re-encoded to WebP, metadata stripped.</summary>
    [HttpPut("profile/photo")]
    [Authorize(Policies.Attendee)]
    [EnableRateLimiting(RateLimits.PhotoUpload)]
    [RequestSizeLimit(6 * 1024 * 1024)]
    [Consumes("multipart/form-data")]
    public async Task<PhotoDto> UploadPhoto(IFormFile file, CancellationToken ct)
    {
        await using var stream = file.OpenReadStream();
        return await profiles.SetPhotoAsync(AttendeeId, stream, ct);
    }

    [HttpDelete("profile/photo")]
    [Authorize(Policies.Attendee)]
    public async Task<IActionResult> RemovePhoto(CancellationToken ct)
    {
        await profiles.RemovePhotoAsync(AttendeeId, ct);
        return NoContent();
    }

    [HttpGet("privacy")]
    [Authorize(Policies.Attendee)]
    public async Task<PrivacyDto> Privacy(CancellationToken ct) => (await profiles.GetOwnAsync(AttendeeId, ct)).Privacy;

    [HttpPatch("privacy")]
    [Authorize(Policies.Attendee)]
    [EnableRateLimiting(RateLimits.AttendeeWrite)]
    public async Task<PrivacyDto> UpdatePrivacy([FromBody] UpdatePrivacyRequest request, CancellationToken ct) =>
        (await profiles.UpdatePrivacyAsync(AttendeeId, request, ct)).Privacy;

    // ---------- Events ----------

    /// <summary>My events. scope: current | upcoming | previous | all</summary>
    [HttpGet("events")]
    [Authorize(Policies.Attendee)]
    public async Task<IReadOnlyList<MyEventDto>> MyEvents([FromQuery] string scope = "all", CancellationToken ct = default) =>
        await participation.MyEventsAsync(AttendeeId, scope, ct);
}

[Route("api/v1/events")]
[Authorize(Policies.Attendee)]
public sealed class EventsController(ParticipationService participation) : ApiControllerBase
{
    /// <summary>Event summary and my participation (participants only).</summary>
    [HttpGet("{eventId:guid}")]
    public async Task<MyEventDto> Get(Guid eventId, CancellationToken ct) =>
        await participation.GetForParticipantAsync(AttendeeId, eventId, ct);

    /// <summary>Join an event with my existing global profile (returning attendee flow).</summary>
    [HttpPost("{eventId:guid}/participation")]
    [EnableRateLimiting(RateLimits.Join)]
    public async Task<JoinResult> Join(Guid eventId, [FromBody] JoinEventRequest? request, CancellationToken ct) =>
        await participation.JoinAsync(AttendeeId, eventId, request?.QrCode, ct);
}

[Route("api/v1/entitlements")]
[Authorize(Policies.Attendee)]
public sealed class EntitlementsController(EntitlementService entitlements) : ApiControllerBase
{
    [HttpGet]
    public async Task<EntitlementsDto> Get(CancellationToken ct) => await entitlements.ForAttendeeAsync(AttendeeId, ct);
}
