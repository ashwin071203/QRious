using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using QRious.Domain.Taxonomy;
using SkiaSharp;

namespace QRious.IntegrationTests;

public class ProfileTests(ApiFactory api)
{
    private static async Task<JsonElement> Json(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<HttpClient> SignedInAsync(string stem)
    {
        var client = api.Browser();
        (await client.CreateProfileAsync(TestData.Profile(TestData.UniqueUsername(stem)))).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Profile_fields_can_be_edited_and_cleared()
    {
        var client = await SignedInAsync("Edit");
        var updated = await Json(await client.PatchAsJsonAsync("/api/v1/me/profile",
            new { displayName = "  New Name ", profession = "Music producer", company = "IIT Madras", bio = "" }));

        updated.GetProperty("displayName").GetString().Should().Be("New Name");
        updated.GetProperty("profession").GetString().Should().Be("Music producer");
        updated.GetProperty("bio").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Username_can_change_once_per_30_days_and_old_name_is_held()
    {
        var client = await SignedInAsync("Rename");
        var oldName = (await Json(await client.GetAsync("/api/v1/me/profile"))).GetProperty("username").GetString()!;
        var newName = TestData.UniqueUsername("renamed").ToLowerInvariant();

        (await client.PatchAsJsonAsync("/api/v1/me/profile", new { username = newName })).StatusCode.Should().Be(HttpStatusCode.OK);
        var again = await client.PatchAsJsonAsync("/api/v1/me/profile", new { username = newName + "x" });
        again.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Json(again)).GetProperty("code").GetString().Should().Be("username_change_too_soon");

        var check = await Json(await api.Browser().GetAsync($"/api/v1/onboarding/username-availability?u={oldName}"));
        check.GetProperty("available").GetBoolean().Should().BeFalse("released usernames are held for 30 days");
    }

    [Fact]
    public async Task Interests_and_skills_must_keep_at_least_one_and_dedupe_by_normalization()
    {
        var client = await SignedInAsync("Tags");

        var empty = await client.PutAsJsonAsync("/api/v1/me/profile/interests", new { items = Array.Empty<object>() });
        empty.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var result = await Json(await client.PutAsJsonAsync("/api/v1/me/profile/skills",
            new { items = new object[] { new { name = "vocalist" }, new { name = "SINGING" }, new { name = "  Lo-fi   beats " } } }));
        var skills = result.GetProperty("skills").EnumerateArray().Select(s => s.GetProperty("name").GetString()).ToList();
        skills.Should().BeEquivalentTo(["Singing", "Lo-fi beats"]);

        var custom = await api.WithDbAsync(db => db.Skills.SingleAsync(s => s.NormalizedName == "lo-fi beats"));
        custom.Status.Should().Be(TagStatus.Pending);
    }

    [Fact]
    public async Task Social_links_are_validated_per_platform_and_default_to_members_only()
    {
        var client = await SignedInAsync("Links");
        var bad = await client.PutAsJsonAsync("/api/v1/me/profile/social-links",
            new { links = new[] { new { platform = "instagram", url = "https://evil.example/ashwin" } } });
        bad.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var js = await client.PutAsJsonAsync("/api/v1/me/profile/social-links",
            new { links = new[] { new { platform = "website", url = "javascript:alert(1)" } } });
        js.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var ok = await Json(await client.PutAsJsonAsync("/api/v1/me/profile/social-links",
            new { links = new[] { new { platform = "linkedin", url = "linkedin.com/in/someone" } } }));
        var link = ok.GetProperty("socialLinks")[0];
        link.GetProperty("url").GetString().Should().Be("https://linkedin.com/in/someone");
        link.GetProperty("visibility").GetString().Should().Be("members");
    }

    [Fact]
    public async Task Turning_anonymous_visibility_off_is_immediate_and_on_again_needs_consent()
    {
        var client = await SignedInAsync("Privacy");
        var off = await Json(await client.PatchAsJsonAsync("/api/v1/me/privacy", new { isPublic = false }));
        off.GetProperty("isPublic").GetBoolean().Should().BeFalse();

        var noConsent = await client.PatchAsJsonAsync("/api/v1/me/privacy", new { isPublic = true });
        noConsent.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Json(noConsent)).GetProperty("code").GetString().Should().Be("consent_required");

        var on = await Json(await client.PatchAsJsonAsync("/api/v1/me/privacy", new { isPublic = true, anonymousVisibilityConsent = true }));
        on.GetProperty("isPublic").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Photo_upload_reencodes_to_webp_and_rejects_non_images()
    {
        var client = await SignedInAsync("Photo");

        using var bitmap = new SKBitmap(300, 200);
        using (var canvas = new SKCanvas(bitmap)) canvas.Clear(new SKColor(139, 92, 246));
        using var jpeg = SKImage.FromBitmap(bitmap).Encode(SKEncodedImageFormat.Jpeg, 90);

        var form = new MultipartFormDataContent { { new ByteArrayContent(jpeg.ToArray()), "file", "me.jpg" } };
        var uploaded = await client.PutAsync("/api/v1/me/profile/photo", form);
        uploaded.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Json(uploaded)).GetProperty("url").GetString().Should().StartWith("https://media.test/profiles/").And.EndWith("/512.webp");

        var fake = new MultipartFormDataContent { { new ByteArrayContent("<svg onload=alert(1)>"u8.ToArray()), "file", "me.png" } };
        var rejected = await client.PutAsync("/api/v1/me/profile/photo", fake);
        rejected.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Json(rejected)).GetProperty("code").GetString().Should().Be("image_invalid");

        (await client.DeleteAsync("/api/v1/me/profile/photo")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await Json(await client.GetAsync("/api/v1/me/profile"))).GetProperty("photo").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Taxonomy_search_returns_event_category_suggestions_first_and_matches_aliases()
    {
        var eventId = await api.WithDbAsync(db => db.EventQrCodes.Where(q => q.PublicCode == ApiFactory.DemoQr).Select(q => q.EventId).SingleAsync());
        var suggestions = await Json(await api.Browser().GetAsync($"/api/v1/taxonomy/skills?eventId={eventId}&limit=3"));
        suggestions.EnumerateArray().Should().OnlyContain(s => s.GetProperty("suggested").GetBoolean());

        var alias = await Json(await api.Browser().GetAsync("/api/v1/taxonomy/skills?q=drummer"));
        alias.EnumerateArray().Select(s => s.GetProperty("name").GetString()).Should().Contain("Drums");
    }

    [Fact]
    public async Task Free_plan_entitlements_never_gate_essential_features()
    {
        var client = await SignedInAsync("Plan");
        var ent = await Json(await client.GetAsync("/api/v1/entitlements"));
        ent.GetProperty("planCode").GetString().Should().Be("attendee_free");
        var keys = ent.GetProperty("features").EnumerateArray().Select(f => f.GetProperty("featureKey").GetString()).ToList();
        keys.Should().NotContain(k => k!.Contains("messaging") || k.Contains("connections") || k.Contains("pulse.basic"));
        ent.GetProperty("features").EnumerateArray().Should().OnlyContain(f => f.GetProperty("limit").ValueKind == JsonValueKind.Null);
    }
}
