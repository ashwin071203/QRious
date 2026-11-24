using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using QRious.Api.Security;
using QRious.Application.Common;

namespace QRious.Api.Infrastructure;

/// <summary>Rate-limit policies (07 §5). Partitioned by client IP (resolved via the trusted proxy) or attendee.</summary>
public static class RateLimits
{
    public const string PublicRead = "public-read";
    public const string UsernameCheck = "username-check";
    public const string ProfileCreate = "profile-create";
    public const string Recovery = "recovery";
    public const string AttendeeWrite = "attendee-write";
    public const string PhotoUpload = "photo-upload";
    public const string Join = "join";

    public static IServiceCollection AddQRiousRateLimits(this IServiceCollection services, IConfiguration config)
    {
        var enabled = config.GetValue("RateLimiting:Enabled", true);
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.OnRejected = async (ctx, ct) =>
            {
                if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
                    ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString();
                await Results.Problem(statusCode: 429, title: "Too many requests",
                    detail: "You're doing that too often. Please wait a moment and try again.",
                    extensions: new Dictionary<string, object?> { ["code"] = "rate_limited" }).ExecuteAsync(ctx.HttpContext);
            };

            o.AddPolicy(PublicRead, ctx => ByIp(ctx, enabled, 120, TimeSpan.FromMinutes(1)));
            o.AddPolicy(UsernameCheck, ctx => ByIp(ctx, enabled, 30, TimeSpan.FromMinutes(1)));
            o.AddPolicy(ProfileCreate, ctx => ByIp(ctx, enabled, 5, TimeSpan.FromHours(1)));
            o.AddPolicy(Recovery, ctx => ByIp(ctx, enabled, 5, TimeSpan.FromMinutes(15)));
            o.AddPolicy(AttendeeWrite, ctx => ByAttendee(ctx, enabled, 120, TimeSpan.FromMinutes(1)));
            o.AddPolicy(PhotoUpload, ctx => ByAttendee(ctx, enabled, 10, TimeSpan.FromHours(1)));
            o.AddPolicy(Join, ctx => ByAttendee(ctx, enabled, 20, TimeSpan.FromHours(1)));
        });
        return services;
    }

    private static RateLimitPartition<string> ByIp(HttpContext ctx, bool enabled, int limit, TimeSpan window)
    {
        if (!enabled) return RateLimitPartition.GetNoLimiter("off");
        var ip = ctx.RequestServices.GetRequiredService<RequestContext>().ClientIp;
        return Fixed($"ip:{ip}", limit, window);
    }

    private static RateLimitPartition<string> ByAttendee(HttpContext ctx, bool enabled, int limit, TimeSpan window)
    {
        if (!enabled) return RateLimitPartition.GetNoLimiter("off");
        var id = ctx.User.FindFirstValue(AttendeeClaims.AttendeeId)
                 ?? "ip:" + ctx.RequestServices.GetRequiredService<RequestContext>().ClientIp;
        return Fixed($"att:{id}", limit, window);
    }

    private static RateLimitPartition<string> Fixed(string key, int limit, TimeSpan window) =>
        RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = limit,
            Window = window,
            QueueLimit = 0,
            AutoReplenishment = true,
        });
}
