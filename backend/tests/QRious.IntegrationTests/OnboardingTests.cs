using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using QRious.Domain.Events;
using QRious.Domain.Participation;

namespace QRious.IntegrationTests;

public class OnboardingTests(ApiFactory api)
{
    private static async Task<JsonElement> Json(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    [Fact]
    public async Task Create_profile_creates_identity_profile_participation_session_and_recovery_code_atomically()
    {
        var client = api.Browser();
        var username = TestData.UniqueUsername("Atomic");

        var response = await client.CreateProfileAsync(TestData.Profile(username));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await Json(response);
        body.GetProperty("redirectTo").GetString().Should().EndWith("/home").And.NotContain("discover");
        body.GetProperty("recoveryCode").GetString().Should().MatchRegex("^QRS(-[0-9A-Z]{4}){6}$");
        body.GetProperty("profile").GetProperty("username").GetString().Should().Be(username.ToLowerInvariant());

        var cookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("qr_s="));
        cookie.Should().Contain("httponly").And.Contain("samesite=lax").And.Contain("path=/").And.NotContain("domain=");

        var profileId = Guid.Parse(body.GetProperty("profile").GetProperty("id").GetString()!);
        await api.WithDbAsync(async db =>
        {
            var profile = await db.UserProfiles.Include(p => p.Interests).Include(p => p.Skills).SingleAsync(p => p.Id == profileId);
            profile.Interests.Should().HaveCount(1);
            profile.Skills.Should().HaveCount(1);
            profile.IsPublic.Should().BeTrue();
            profile.AnonymousVisibilityConsentedAt.Should().NotBeNull();
            (await db.EventParticipants.Include(p => p.Availability).SingleAsync(p => p.AttendeeId == profile.AttendeeId))
                .Availability.Should().NotBeNull();
            (await db.AttendeeSessions.CountAsync(s => s.AttendeeId == profile.AttendeeId)).Should().Be(1);
            var code = await db.AttendeeRecoveryCodes.SingleAsync(c => c.AttendeeId == profile.AttendeeId);
            code.CodeHash.Should().HaveCount(32); // only a hash is stored
        });

        // The browser is now signed in and recognised as a participant.
        var me = await Json(await client.GetAsync("/api/v1/me/session"));
        me.GetProperty("authenticated").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Anonymous_browsing_never_creates_identity_session_or_participation()
    {
        var client = api.Browser();
        var responses = new List<HttpResponseMessage>
        {
            await client.GetAsync($"/api/v1/public/qr/{ApiFactory.DemoQr}"),
            await client.GetAsync("/api/v1/taxonomy/interests?q=ind"),
            await client.GetAsync("/api/v1/onboarding/username-availability?u=somebody"),
            await client.GetAsync("/api/v1/me/session"),
        };
        responses.Should().OnlyContain(r => r.StatusCode == HttpStatusCode.OK);
        // No identity is ever established: no session cookie is issued by any browsing endpoint.
        responses.Should().OnlyContain(r => !r.Headers.Contains("Set-Cookie"));
        (await Json(responses[3])).GetProperty("authenticated").GetBoolean().Should().BeFalse();
        (await client.GetAsync("/api/v1/me/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var restricted = await client.PostAsJsonAsync("/api/v1/events/" + Guid.NewGuid() + "/participation", new { });
        restricted.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await Json(restricted)).GetProperty("code").GetString().Should().Be("profile_required");
    }

    [Fact]
    public async Task Username_uniqueness_is_case_insensitive()
    {
        var username = TestData.UniqueUsername("Case");
        (await api.Browser().CreateProfileAsync(TestData.Profile(username))).StatusCode.Should().Be(HttpStatusCode.Created);

        var duplicate = await api.Browser().CreateProfileAsync(TestData.Profile(username.ToUpperInvariant()));

        duplicate.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var body = await Json(duplicate);
        body.GetProperty("code").GetString().Should().Be("username_taken");
        body.GetProperty("suggestions").GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Concurrent_requests_for_the_same_username_create_exactly_one_profile()
    {
        var username = TestData.UniqueUsername("Race");
        var responses = await Task.WhenAll(Enumerable.Range(0, 8)
            .Select(_ => api.Browser().CreateProfileAsync(TestData.Profile(username))));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(1);
        responses.Where(r => r.StatusCode != HttpStatusCode.Created).Should().OnlyContain(r => r.StatusCode == HttpStatusCode.Conflict);
        (await api.WithDbAsync(db => db.UserProfiles.CountAsync(p => p.UsernameNormalized == username.ToLowerInvariant()))).Should().Be(1);
    }

    [Fact]
    public async Task Retrying_with_the_same_idempotency_key_returns_the_same_profile_and_never_the_recovery_code_again()
    {
        var key = Guid.NewGuid();
        var body = TestData.Profile(TestData.UniqueUsername("Retry"));

        var first = await api.Browser().CreateProfileAsync(body, key);
        var retryClient = api.Browser(); // e.g. the first response was lost in transit
        var second = await retryClient.CreateProfileAsync(body, key);

        first.StatusCode.Should().Be(HttpStatusCode.Created);
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        var a = await Json(first);
        var b = await Json(second);
        b.GetProperty("profile").GetProperty("id").GetString().Should().Be(a.GetProperty("profile").GetProperty("id").GetString());
        b.GetProperty("recoveryCode").ValueKind.Should().Be(JsonValueKind.Null);

        // The retrying browser is signed in to the same identity.
        var me = await Json(await retryClient.GetAsync("/api/v1/me/session"));
        me.GetProperty("profile").GetProperty("id").GetString().Should().Be(a.GetProperty("profile").GetProperty("id").GetString());

        // Reusing the key with a different payload is rejected.
        var other = await api.Browser().CreateProfileAsync(TestData.Profile(TestData.UniqueUsername("Other")), key);
        other.StatusCode.Should().Be((HttpStatusCode)422);
    }

    [Fact]
    public async Task A_failure_part_way_through_leaves_no_partial_account()
    {
        var username = TestData.UniqueUsername("Partial");
        // "x" fails tag validation AFTER the attendee and profile rows are written inside the transaction.
        var response = await api.Browser().CreateProfileAsync(TestData.Profile(username, interest: "x"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Json(response)).GetProperty("code").GetString().Should().Be("validation_failed");
        (await api.WithDbAsync(db => db.UserProfiles.AnyAsync(p => p.UsernameNormalized == username.ToLowerInvariant()))).Should().BeFalse();
    }

    [Fact]
    public async Task Mandatory_fields_are_enforced()
    {
        var response = await api.Browser().CreateProfileAsync(new
        {
            qrCode = ApiFactory.DemoQr, displayName = "", username = "ok_name",
            interests = Array.Empty<object>(), skills = Array.Empty<object>(), isPublic = false,
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var errors = (await Json(response)).GetProperty("errors");
        errors.TryGetProperty("displayName", out _).Should().BeTrue();
        errors.TryGetProperty("interests", out _).Should().BeTrue();
        errors.TryGetProperty("skills", out _).Should().BeTrue();
    }

    [Fact]
    public async Task Public_visibility_requires_consent()
    {
        var response = await api.Browser().CreateProfileAsync(TestData.Profile(TestData.UniqueUsername("Consent"), consent: false));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Json(response)).GetProperty("errors").TryGetProperty("anonymousVisibilityConsent", out _).Should().BeTrue();

        // Opting out needs no consent.
        (await api.Browser().CreateProfileAsync(TestData.Profile(TestData.UniqueUsername("Private"), isPublic: false, consent: false)))
            .StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task A_browser_with_a_valid_session_cannot_create_a_second_identity()
    {
        var client = api.Browser();
        (await client.CreateProfileAsync(TestData.Profile(TestData.UniqueUsername("Once")))).StatusCode.Should().Be(HttpStatusCode.Created);

        var second = await client.CreateProfileAsync(TestData.Profile(TestData.UniqueUsername("Twice")));

        second.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Json(second)).GetProperty("code").GetString().Should().Be("existing_identity");
    }

    [Fact]
    public async Task Full_event_rejects_new_profiles_without_creating_anything()
    {
        var qr = "FULL" + Random.Shared.Next(10000000, 99999999);
        await api.WithDbAsync(async db =>
        {
            var template = await db.Events.AsNoTracking().FirstAsync();
            var ev = new Event
            {
                OrganizationId = template.OrganizationId, CategoryId = template.CategoryId, Name = "Tiny event", VenueName = "Room 1",
                StartsAt = DateTimeOffset.UtcNow.AddHours(-1), EndsAt = DateTimeOffset.UtcNow.AddHours(5), Status = EventStatus.Active,
                MaxParticipants = 1, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
                NetworkingSettings = new EventNetworkingSettings(),
            };
            ev.NetworkingSettings.EventId = ev.Id;
            db.Events.Add(ev);
            db.EventQrCodes.Add(new EventQrCode { EventId = ev.Id, PublicCode = qr, CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        });

        (await api.Browser().CreateProfileAsync(TestData.Profile(TestData.UniqueUsername("First"), qr))).StatusCode.Should().Be(HttpStatusCode.Created);
        var username = TestData.UniqueUsername("Second");
        var rejected = await api.Browser().CreateProfileAsync(TestData.Profile(username, qr));

        rejected.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Json(rejected)).GetProperty("code").GetString().Should().Be("event_full");
        (await api.WithDbAsync(db => db.UserProfiles.AnyAsync(p => p.UsernameNormalized == username.ToLowerInvariant()))).Should().BeFalse();
    }

    [Fact]
    public async Task Invalid_and_revoked_qr_codes_are_reported()
    {
        (await api.Browser().GetAsync("/api/v1/public/qr/NOPE12345678")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        var qr = "REVK" + Random.Shared.Next(10000000, 99999999);
        await api.WithDbAsync(async db =>
        {
            var ev = await db.Events.AsNoTracking().FirstAsync();
            db.EventQrCodes.Add(new EventQrCode { EventId = ev.Id, PublicCode = qr, Status = QrCodeStatus.Revoked, CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        });
        var state = await Json(await api.Browser().GetAsync($"/api/v1/public/qr/{qr}"));
        state.GetProperty("state").GetString().Should().Be("revoked");

        (await api.Browser().CreateProfileAsync(TestData.Profile(TestData.UniqueUsername("Revoked"), qr)))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Returning_attendee_joins_another_event_with_the_same_global_profile()
    {
        var client = api.Browser();
        var created = await Json(await client.CreateProfileAsync(TestData.Profile(TestData.UniqueUsername("Return"))));
        var profileId = created.GetProperty("profile").GetProperty("id").GetString();

        var qr = "NEXT" + Random.Shared.Next(10000000, 99999999);
        var eventId = await api.WithDbAsync(async db =>
        {
            var template = await db.Events.AsNoTracking().FirstAsync();
            var ev = new Event
            {
                OrganizationId = template.OrganizationId, CategoryId = template.CategoryId, Name = "Second event", VenueName = "Hall",
                StartsAt = DateTimeOffset.UtcNow.AddDays(3), EndsAt = DateTimeOffset.UtcNow.AddDays(4), Status = EventStatus.Published,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow, NetworkingSettings = new EventNetworkingSettings(),
            };
            ev.NetworkingSettings.EventId = ev.Id;
            db.Events.Add(ev);
            db.EventQrCodes.Add(new EventQrCode { EventId = ev.Id, PublicCode = qr, CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
            return ev.Id;
        });

        var join = await client.PostAsJsonAsync($"/api/v1/events/{eventId}/participation", new { qrCode = qr });
        join.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Json(join)).GetProperty("redirectTo").GetString().Should().Be($"/app/events/{eventId}/home");

        // Joining again is idempotent; still one global profile.
        (await Json(await client.PostAsJsonAsync($"/api/v1/events/{eventId}/participation", new { qrCode = qr })))
            .GetProperty("alreadyJoined").GetBoolean().Should().BeTrue();
        var events = await Json(await client.GetAsync("/api/v1/me/events"));
        events.GetArrayLength().Should().Be(2);
        (await Json(await client.GetAsync("/api/v1/me/profile"))).GetProperty("id").GetString().Should().Be(profileId);

        var upcoming = await Json(await client.GetAsync("/api/v1/me/events?scope=upcoming"));
        upcoming.EnumerateArray().Single().GetProperty("event").GetProperty("networkingStatus").GetString().Should().Be("not_open");
        (await api.WithDbAsync(db => db.EventParticipants.CountAsync(p => p.EventId == eventId && p.Status == ParticipantStatus.Active))).Should().Be(1);
    }
}
