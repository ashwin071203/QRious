using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace QRious.IntegrationTests;

public class SessionAndRecoveryTests(ApiFactory api)
{
    private static async Task<JsonElement> Json(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<(HttpClient Client, string Username, string RecoveryCode, Guid ProfileId)> NewAttendeeAsync(string stem)
    {
        var client = api.Browser();
        var username = TestData.UniqueUsername(stem).ToLowerInvariant();
        var body = await Json(await client.CreateProfileAsync(TestData.Profile(username)));
        return (client, username, body.GetProperty("recoveryCode").GetString()!,
            Guid.Parse(body.GetProperty("profile").GetProperty("id").GetString()!));
    }

    private Task<Guid> AttendeeIdAsync(Guid profileId) =>
        api.WithDbAsync(db => db.UserProfiles.Where(p => p.Id == profileId).Select(p => p.AttendeeId).SingleAsync());

    [Fact]
    public async Task Recovery_signs_in_on_a_new_device_rotates_the_code_and_revokes_other_sessions()
    {
        var (oldDevice, username, code, _) = await NewAttendeeAsync("Recover");
        var newDevice = api.Browser();

        var response = await newDevice.PostAsJsonAsync("/api/v1/recovery",
            new { username = "@" + username.ToUpperInvariant(), recoveryCode = code.ToLowerInvariant().Replace("-", " ") });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var newCode = (await Json(response)).GetProperty("newRecoveryCode").GetString();
        newCode.Should().NotBe(code);
        (await newDevice.GetAsync("/api/v1/me/profile")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await oldDevice.GetAsync("/api/v1/me/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // The used code no longer works; the new one does.
        (await api.Browser().PostAsJsonAsync("/api/v1/recovery", new { username, recoveryCode = code }))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await api.Browser().PostAsJsonAsync("/api/v1/recovery", new { username, recoveryCode = newCode }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Username_alone_never_recovers_and_errors_do_not_reveal_whether_the_username_exists()
    {
        var (_, username, _, _) = await NewAttendeeAsync("NoCode");

        var known = await api.Browser().PostAsJsonAsync("/api/v1/recovery", new { username, recoveryCode = "" });
        var unknown = await api.Browser().PostAsJsonAsync("/api/v1/recovery", new { username = "no_such_user_xyz", recoveryCode = "QRS-0000-0000-0000-0000-0000-0000" });

        known.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        unknown.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await Json(known)).GetProperty("detail").GetString().Should().Be((await Json(unknown)).GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Five_wrong_codes_lock_recovery_even_for_the_correct_code()
    {
        var (_, username, code, _) = await NewAttendeeAsync("Lock");
        for (var i = 0; i < 5; i++)
            (await api.Browser().PostAsJsonAsync("/api/v1/recovery", new { username, recoveryCode = "QRS-0000-0000-0000-0000-0000-0000" }))
                .StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        (await api.Browser().PostAsJsonAsync("/api/v1/recovery", new { username, recoveryCode = code }))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Regenerating_the_recovery_code_invalidates_the_previous_one()
    {
        var (client, username, code, _) = await NewAttendeeAsync("Regen");
        var regenerated = (await Json(await client.PostAsync("/api/v1/me/recovery-code/regenerate", null)))
            .GetProperty("recoveryCode").GetString();

        (await api.Browser().PostAsJsonAsync("/api/v1/recovery", new { username, recoveryCode = code }))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await api.Browser().PostAsJsonAsync("/api/v1/recovery", new { username, recoveryCode = regenerated }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Idle_expired_and_absolute_expired_sessions_are_rejected()
    {
        var (idle, _, _, idleProfile) = await NewAttendeeAsync("Idle");
        var (absolute, _, _, absoluteProfile) = await NewAttendeeAsync("Absolute");
        var idleAttendee = await AttendeeIdAsync(idleProfile);
        var absoluteAttendee = await AttendeeIdAsync(absoluteProfile);

        await api.WithDbAsync(db => db.AttendeeSessions.Where(s => s.AttendeeId == idleAttendee)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1))));
        await api.WithDbAsync(db => db.AttendeeSessions.Where(s => s.AttendeeId == absoluteAttendee)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.AbsoluteExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1))));

        (await idle.GetAsync("/api/v1/me/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await absolute.GetAsync("/api/v1/me/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Session_lifetimes_follow_policy_30_day_idle_and_180_day_absolute()
    {
        var (_, _, _, profileId) = await NewAttendeeAsync("Policy");
        var attendeeId = await AttendeeIdAsync(profileId);
        var session = await api.WithDbAsync(db => db.AttendeeSessions.SingleAsync(s => s.AttendeeId == attendeeId));

        (session.ExpiresAt - session.CreatedAt).Should().BeCloseTo(TimeSpan.FromDays(30), TimeSpan.FromMinutes(1));
        (session.AbsoluteExpiresAt - session.CreatedAt).Should().BeCloseTo(TimeSpan.FromDays(180), TimeSpan.FromMinutes(1));
    }

    private Task<string> IssueTokenAsync(Guid attendeeId, QRious.Domain.Identity.ClientKind kind = QRious.Domain.Identity.ClientKind.Web) =>
        api.WithDbAsync(async db =>
        {
            var (t, h) = QRious.Application.Identity.SecureTokens.NewSessionToken();
            db.AttendeeSessions.Add(new QRious.Domain.Identity.AttendeeSession
            {
                AttendeeId = attendeeId, TokenHash = h, TokenIssuedAt = DateTimeOffset.UtcNow, CreatedAt = DateTimeOffset.UtcNow,
                LastSeenAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30),
                AbsoluteExpiresAt = DateTimeOffset.UtcNow.AddDays(180), ClientKind = kind,
            });
            await db.SaveChangesAsync();
            return t;
        });

    [Fact]
    public async Task Tokens_rotate_after_24_hours_with_a_short_grace_window_and_replay_after_grace_revokes()
    {
        var (_, _, _, profileId) = await NewAttendeeAsync("Rotate");
        var attendeeId = await AttendeeIdAsync(profileId);
        var oldToken = await IssueTokenAsync(attendeeId);
        var oldHash = QRious.Application.Identity.SecureTokens.Hash(oldToken);

        await api.WithDbAsync(db => db.AttendeeSessions.Where(s => s.TokenHash == oldHash)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.TokenIssuedAt, DateTimeOffset.UtcNow.AddHours(-25))));

        var rotated = await Send(oldToken);
        rotated.StatusCode.Should().Be(HttpStatusCode.OK);
        var newToken = CookieValue(rotated);
        newToken.Should().NotBe(oldToken);

        (await Send(oldToken)).StatusCode.Should().Be(HttpStatusCode.OK, "the previous token is accepted during the grace window");
        (await Send(newToken)).StatusCode.Should().Be(HttpStatusCode.OK);

        await api.WithDbAsync(db => db.AttendeeSessions.Where(s => s.PreviousTokenHash == oldHash)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.PreviousTokenValidUntil, DateTimeOffset.UtcNow.AddMinutes(-1))));

        (await Send(oldToken)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await Send(newToken)).StatusCode.Should().Be(HttpStatusCode.Unauthorized, "replaying a rotated-out token revokes the session");
    }

    private async Task<HttpResponseMessage> Send(string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me/profile");
        request.Headers.Add("Cookie", $"qr_s={token}");
        return await api.CreateClient(new() { HandleCookies = false }).SendAsync(request);
    }

    private static string CookieValue(HttpResponseMessage response) =>
        response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("qr_s=")).Split(';')[0]["qr_s=".Length..];

    [Fact]
    public async Task Logout_revokes_the_session()
    {
        var (client, _, _, _) = await NewAttendeeAsync("Logout");
        (await client.PostAsync("/api/v1/me/session/logout", null)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await client.GetAsync("/api/v1/me/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Writes_without_the_app_header_or_from_another_origin_are_blocked()
    {
        var (client, _, _, _) = await NewAttendeeAsync("Csrf");

        var noHeader = new HttpRequestMessage(HttpMethod.Post, "/api/v1/me/session/logout");
        noHeader.Headers.Add("Origin", ApiFactory.WebOrigin);
        client.DefaultRequestHeaders.Remove("X-QRious-Client");
        (await client.SendAsync(noHeader)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        client.DefaultRequestHeaders.Add("X-QRious-Client", "web");
        client.DefaultRequestHeaders.Remove("Origin");
        var evil = new HttpRequestMessage(HttpMethod.Post, "/api/v1/me/session/logout");
        evil.Headers.Add("Origin", "https://evil.example");
        (await client.SendAsync(evil)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Still signed in: nothing was changed.
        (await client.GetAsync("/api/v1/me/profile")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Bearer_tokens_work_for_native_clients()
    {
        var (_, _, _, profileId) = await NewAttendeeAsync("Bearer");
        var attendeeId = await AttendeeIdAsync(profileId);
        var token = await IssueTokenAsync(attendeeId, QRious.Domain.Identity.ClientKind.Mobile);
        var client = api.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        (await client.GetAsync("/api/v1/me/profile")).StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
