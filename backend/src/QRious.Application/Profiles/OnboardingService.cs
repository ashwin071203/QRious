using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using QRious.Application.Common;
using QRious.Application.Events;
using QRious.Application.Identity;
using QRious.Application.Participation;
using QRious.Application.Platform;
using QRious.Application.Taxonomy;
using QRious.Domain.Identity;
using QRious.Domain.Notifications;
using QRious.Domain.Profiles;
using QRious.Domain.Safety;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Profiles;

public sealed record OnboardingOutcome(CreateProfileResponse Response, string SessionToken, DateTimeOffset SessionExpiresAt, bool Replayed);

/// <summary>
/// Atomic "Create My Profile" (PRD §3.3, §12.6): attendee, global profile, interests, skills,
/// event participation, session and recovery code are created in ONE transaction, or nothing is.
/// </summary>
public sealed class OnboardingService(
    QRiousDbContext db,
    TimeProvider clock,
    EventAccessService events,
    ParticipationService participation,
    TaxonomyService taxonomy,
    SessionService sessions,
    RecoveryService recovery,
    ProfileService profiles,
    AuditService audit)
{
    private const string IdempotencyScope = "onboarding.create_profile";
    private static readonly TimeSpan IdempotencyWindow = TimeSpan.FromHours(24);
    private static readonly TimeSpan ReplayCookieWindow = TimeSpan.FromMinutes(15);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<OnboardingOutcome> CreateAsync(CreateProfileRequest request, Guid idempotencyKey, CancellationToken ct)
    {
        var requestHash = SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, Json)));

        var replay = await TryReplayAsync(idempotencyKey, requestHash, ct);
        if (replay is not null) return replay;

        // 1. Validate required profile fields.
        var (displayName, usernameNormalized, socialLinks) = Validate(request);

        // 2. Resolve the event from the QR code (BR-09: join the event whose landing page was used).
        var (ev, qrCodeId) = await events.RequireJoinableByQrAsync(request.QrCode, ct);

        var now = clock.GetUtcNow();
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);

            // Claim the idempotency key first: a concurrent duplicate request blocks here until we commit.
            var record = new IdempotencyRecord
            {
                Scope = IdempotencyScope,
                Key = idempotencyKey,
                RequestHash = requestHash,
                CreatedAt = now,
                ExpiresAt = now + IdempotencyWindow,
                ResponseStatus = 201,
            };
            db.IdempotencyKeys.Add(record);

            // 3–4. Attendee identity + global profile (username uniqueness enforced by a unique index).
            var attendee = new Attendee { CreatedAt = now, LastActiveAt = now };
            var profile = new UserProfile
            {
                AttendeeId = attendee.Id,
                DisplayName = displayName,
                Username = usernameNormalized,
                UsernameNormalized = usernameNormalized,
                Bio = ProfileValidation.CleanText(request.Bio),
                Profession = ProfileValidation.CleanText(request.Profession),
                ProfessionNormalized = ProfileValidation.CleanText(request.Profession)?.ToLowerInvariant(),
                Company = ProfileValidation.CleanText(request.Company),
                Location = ProfileValidation.CleanText(request.Location),
                LookingForText = ProfileValidation.CleanText(request.LookingForText),
                CanOfferText = ProfileValidation.CleanText(request.CanOfferText),
                IsPublic = request.IsPublic,
                AnonymousVisibilityConsentedAt = request.IsPublic ? now : null,
                CreatedAt = now,
                UpdatedAt = now,
            };
            foreach (var link in socialLinks) { link.ProfileId = profile.Id; profile.SocialLinks.Add(link); }
            db.Attendees.Add(attendee);
            db.UserProfiles.Add(profile);
            db.NotificationPreferences.Add(new NotificationPreferences { AttendeeId = attendee.Id, UpdatedAt = now });
            await db.SaveChangesAsync(ct);

            // 5–6. Interests and skills (custom entries normalized and deduplicated).
            var interestIds = await taxonomy.ResolveAsync(TagKind.Interest, request.Interests, attendee.Id, "interests", ct);
            var skillIds = await taxonomy.ResolveAsync(TagKind.Skill, request.Skills, attendee.Id, "skills", ct);
            var lookingForIds = await taxonomy.ResolveAsync(TagKind.Skill, request.LookingForSkills, attendee.Id, "lookingForSkills", ct);
            db.ProfileInterests.AddRange(interestIds.Select(id => new ProfileInterest { ProfileId = profile.Id, InterestId = id, CreatedAt = now }));
            db.ProfileSkills.AddRange(skillIds.Select(id => new ProfileSkill { ProfileId = profile.Id, SkillId = id, CreatedAt = now }));
            db.ProfileLookingForSkills.AddRange(lookingForIds.Select(id => new ProfileLookingForSkill { ProfileId = profile.Id, SkillId = id }));

            // 7. Event participation (locks the event row; enforces participant limit).
            var join = await participation.JoinInTransactionAsync(attendee.Id, ev.Id, qrCodeId, ct);

            // 8. Secure session + one-time recovery code (D-13).
            var issued = sessions.Create(attendee.Id);
            var recoveryCode = recovery.IssueForNewAttendee(attendee.Id);

            audit.Write(ActorType.Attendee, attendee.Id, "attendee.profile_created", "profile", profile.Id, eventId: ev.Id);

            var summary = new ProfileSummaryDto(profile.Id, profile.DisplayName, profile.Username, null);
            var response = new CreateProfileResponse(summary, ev.Id, join.RedirectTo, recoveryCode);
            record.AttendeeId = attendee.Id;
            record.SessionId = issued.Session.Id;
            // The stored snapshot never contains the raw recovery code.
            record.ResponseBody = JsonSerializer.Serialize(response with { RecoveryCode = null }, Json);

            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            return new OnboardingOutcome(response, issued.Token, issued.Session.ExpiresAt, false);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg)
        {
            db.ChangeTracker.Clear();
            // A concurrent duplicate of this same request may have committed first: replay its result.
            var concurrent = await TryReplayAsync(idempotencyKey, requestHash, ct);
            if (concurrent is not null) return concurrent;
            if (pg.ConstraintName == "ix_user_profiles_username_normalized")
                throw await UsernameTakenAsync(usernameNormalized, ct);
            throw;
        }
    }

    private (string DisplayName, string Username, List<SocialLink> Links) Validate(CreateProfileRequest r)
    {
        var errors = new ProfileValidation.Errors();
        ProfileValidation.Text(errors, "displayName", r.DisplayName, 60, required: true, label: "Display name");
        var username = UsernameRules.Normalize(r.Username);
        if (UsernameRules.Validate(username) is { } usernameError) errors.Add("username", usernameError);
        ProfileValidation.Tags(errors, "interests", r.Interests, 1, ProfileValidation.MaxTags, "interest");
        ProfileValidation.Tags(errors, "skills", r.Skills, 1, ProfileValidation.MaxTags, "skill");
        ProfileValidation.Tags(errors, "lookingForSkills", r.LookingForSkills, 0, ProfileValidation.MaxLookingForSkills, "skill");
        ProfileValidation.Text(errors, "bio", r.Bio, 500, label: "Bio");
        ProfileValidation.Text(errors, "profession", r.Profession, 100, label: "Profession");
        ProfileValidation.Text(errors, "company", r.Company, 100, label: "Company or college");
        ProfileValidation.Text(errors, "location", r.Location, 100, label: "Location");
        ProfileValidation.Text(errors, "lookingForText", r.LookingForText, 500, label: "What you're looking for");
        ProfileValidation.Text(errors, "canOfferText", r.CanOfferText, 500, label: "What you can offer");
        if (r.IsPublic && !r.AnonymousVisibilityConsent)
            errors.Add("anonymousVisibilityConsent", "Please confirm you understand who can see your profile, or turn visibility off.");
        var links = ProfileValidation.SocialLinks(errors, r.SocialLinks);
        if (string.IsNullOrWhiteSpace(r.QrCode)) errors.Add("qrCode", "Open this page from an event QR code.");
        errors.ThrowIfAny();
        return (ProfileValidation.CleanText(r.DisplayName)!, username!, links);
    }

    private async Task<OnboardingOutcome?> TryReplayAsync(Guid key, byte[] requestHash, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var record = await db.IdempotencyKeys.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Scope == IdempotencyScope && r.Key == key && r.ExpiresAt > now, ct);
        if (record is null) return null;
        if (!record.RequestHash.AsSpan().SequenceEqual(requestHash))
            throw new AppException(422, ErrorCodes.IdempotencyMismatch, "This request key was already used for a different request.");

        var response = JsonSerializer.Deserialize<CreateProfileResponse>(record.ResponseBody, Json)!;

        // The original response may have been lost in transit. Within a short window, re-issue a cookie for the
        // same session so the retrying browser is signed in (the raw token can't be recovered: only its hash is stored).
        if (record.SessionId is { } sessionId && now - record.CreatedAt <= ReplayCookieWindow)
        {
            var session = await db.AttendeeSessions.FirstOrDefaultAsync(s => s.Id == sessionId, ct);
            if (session is not null && session.IsActive(now))
            {
                var (token, hash) = SecureTokens.NewSessionToken();
                session.PreviousTokenHash = session.TokenHash;
                session.PreviousTokenValidUntil = now + TimeSpan.FromMinutes(2);
                session.TokenHash = hash;
                session.TokenIssuedAt = now;
                await db.SaveChangesAsync(ct);
                return new OnboardingOutcome(response, token, session.ExpiresAt, true);
            }
        }
        throw AppException.Conflict(ErrorCodes.ExistingIdentity,
            "This profile was already created. Use your recovery code to sign in on this device.");
    }

    private async Task<AppException> UsernameTakenAsync(string username, CancellationToken ct)
    {
        var ex = AppException.Conflict(ErrorCodes.UsernameTaken, "That username is already taken.");
        ex.Extensions["suggestions"] = await profiles.SuggestUsernamesAsync(username, ct);
        return ex;
    }
}
