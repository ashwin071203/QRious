using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QRious.Api.Controllers;
using QRious.Api.Infrastructure;
using QRious.Api.Security;
using QRious.Application;
using QRious.Application.Seeding;
using QRious.Infrastructure.Persistence;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((ctx, services, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console());

builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 1 * 1024 * 1024);

// ---------- Services ----------
builder.Services.AddApplication(builder.Configuration);
builder.Services.Configure<AttendeeCookieOptions>(builder.Configuration.GetSection(AttendeeCookieOptions.Section));
builder.Services.AddSingleton<AttendeeCookie>();

builder.Services.AddAuthentication(AttendeeClaims.Scheme)
    .AddScheme<AuthenticationSchemeOptions, AttendeeSessionHandler>(AttendeeClaims.Scheme, _ => { });
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.Attendee, p => p
        .AddAuthenticationSchemes(AttendeeClaims.Scheme)
        .RequireClaim(AttendeeClaims.AttendeeId)
        .RequireClaim(AttendeeClaims.Status, "Active"));

builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(o =>
    {
        o.InvalidModelStateResponseFactory = ctx =>
        {
            var problem = new ValidationProblemDetails(ctx.ModelState)
            {
                Status = 400,
                Title = "Invalid request",
                Detail = "One or more fields are invalid.",
            };
            problem.Extensions["code"] = "validation_failed";
            return new BadRequestObjectResult(problem);
        };
    });
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
    ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier);
builder.Services.AddExceptionHandler<AppExceptionHandler>();
builder.Services.AddQRiousRateLimits(builder.Configuration);
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddNpgSql(builder.Configuration.GetConnectionString("Default")!, name: "database", tags: ["ready"]);

var app = builder.Build();

// Refuse to run with insecure cookies outside local development (07 §2.1).
var cookieOptions = app.Configuration.GetSection(AttendeeCookieOptions.Section).Get<AttendeeCookieOptions>() ?? new();
if (!cookieOptions.Secure && !app.Environment.IsDevelopment() && !app.Environment.IsEnvironment("Testing"))
    throw new InvalidOperationException("Auth:Cookie:Secure must be true outside Development.");

// ---------- Database ----------
if (app.Configuration.GetValue("Database:MigrateOnStartup", false))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<QRiousDbContext>();
    await db.Database.MigrateAsync();
    var seeder = scope.ServiceProvider.GetRequiredService<DatabaseSeeder>();
    await seeder.SeedReferenceDataAsync(CancellationToken.None);
    if (app.Configuration.GetValue("Database:SeedDemoData", false))
        await seeder.SeedDemoDataAsync(CancellationToken.None);
}

// ---------- Pipeline ----------
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseSerilogRequestLogging(o => o.GetLevel = (ctx, _, ex) =>
    ex is not null || ctx.Response.StatusCode >= 500 ? Serilog.Events.LogEventLevel.Error
    : ctx.Request.Path.StartsWithSegments("/health") ? Serilog.Events.LogEventLevel.Verbose
    : Serilog.Events.LogEventLevel.Information);

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h.XContentTypeOptions = "nosniff";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h.XFrameOptions = "DENY";
    h.CacheControl = ctx.Request.Path.StartsWithSegments("/api") ? "no-store" : h.CacheControl;
    if (!app.Environment.IsDevelopment()) h.StrictTransportSecurity = "max-age=63072000; includeSubDomains";
    await next();
});

app.UseMiddleware<RequestSecurityMiddleware>();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

if (app.Environment.IsDevelopment() || app.Configuration.GetValue("Api:EnableSwagger", false))
{
    app.MapOpenApi();
    app.UseSwaggerUI(o =>
    {
        o.SwaggerEndpoint("/openapi/v1.json", "QRious API v1");
        o.RoutePrefix = "swagger";
    });
}

// Local-disk media in development (Storage:Provider=local). Staging/production serve media from object storage.
if (app.Services.GetRequiredService<QRious.Infrastructure.Storage.IObjectStorage>() is QRious.Infrastructure.Storage.LocalDiskObjectStorage local)
{
    Directory.CreateDirectory(local.Root);
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(local.Root),
        RequestPath = "/media",
        OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable",
    });
}

app.MapControllers();
app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") });
app.MapGet("/", () => Results.Ok(new { name = "QRious API", version = "v1" })).ExcludeFromDescription();

await app.RunAsync();

public partial class Program;
