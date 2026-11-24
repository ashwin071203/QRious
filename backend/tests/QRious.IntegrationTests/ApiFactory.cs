using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using QRious.Infrastructure.Persistence;
using Testcontainers.PostgreSql;

[assembly: AssemblyFixture(typeof(QRious.IntegrationTests.ApiFactory))]

namespace QRious.IntegrationTests;

/// <summary>Boots the real API against a disposable PostgreSQL 16 container (migrations + seed data applied).</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string WebOrigin = "http://localhost:3000";
    public const string DemoQr = "DEMO2026QRUS";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("qrious_test")
        .Build();

    public async ValueTask InitializeAsync()
    {
        await _postgres.StartAsync();
        _ = Server; // boot the host: runs migrations and seeding
    }

    public new async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", _postgres.GetConnectionString());
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("Database:SeedDemoData", "true");
        builder.UseSetting("Storage:Provider", "memory");
        builder.UseSetting("Storage:PublicBaseUrl", "https://media.test");
        builder.UseSetting("RateLimiting:Enabled", "false");
        builder.UseSetting("Workers:EventLifecycle", "false");
        builder.UseSetting("Auth:Cookie:Name", "qr_s");
        builder.UseSetting("Auth:Cookie:Secure", "false");
        builder.UseSetting("App:WebOrigins:0", WebOrigin);
        builder.UseSetting("Security:RecoveryPepper", "integration-test-pepper-0123456789");
        builder.UseSetting("Security:IpHashSalt", "integration-test-salt");
        builder.UseSetting("Security:ProxySecret", "integration-test-proxy-secret-0123");
    }

    /// <summary>A browser-like client: keeps cookies and sends the CSRF headers the web app sends.</summary>
    public HttpClient Browser()
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true, AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("Origin", WebOrigin);
        client.DefaultRequestHeaders.Add("X-QRious-Client", "web");
        return client;
    }

    public async Task<T> WithDbAsync<T>(Func<QRiousDbContext, Task<T>> action)
    {
        using var scope = Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<QRiousDbContext>());
    }

    public Task WithDbAsync(Func<QRiousDbContext, Task> action) => WithDbAsync(async db => { await action(db); return 0; });

    public async Task<(int Attendees, int Profiles, int Participants, int Sessions)> CountsAsync() =>
        await WithDbAsync(async db => (
            await db.Attendees.CountAsync(),
            await db.UserProfiles.CountAsync(),
            await db.EventParticipants.CountAsync(),
            await db.AttendeeSessions.CountAsync()));
}

public static class TestData
{
    private static int _counter;

    public static string UniqueUsername(string stem = "user") =>
        $"{stem}{Interlocked.Increment(ref _counter)}_{Random.Shared.Next(1000, 9999)}";

    public static object Profile(string username, string qr = ApiFactory.DemoQr, string? interest = "Indie", bool isPublic = true, bool consent = true) => new
    {
        qrCode = qr,
        displayName = "Test Person",
        username,
        interests = new[] { new { name = interest } },
        skills = new[] { new { name = "Guitar" } },
        isPublic,
        anonymousVisibilityConsent = consent,
        bio = "Hello!",
    };

    public static async Task<HttpResponseMessage> CreateProfileAsync(this HttpClient client, object body, Guid? key = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/onboarding/profile") { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        return await client.SendAsync(request);
    }
}
