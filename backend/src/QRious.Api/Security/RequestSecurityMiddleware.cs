using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using QRious.Application.Common;

namespace QRious.Api.Security;

/// <summary>
/// 1. Resolves the client IP. X-Forwarded-For is trusted ONLY when the request carries the shared proxy
///    secret added by the web origin's same-origin proxy (D-10).
/// 2. CSRF defence for cookie-authenticated writes: the Origin (or Referer) must be an allowed web origin
///    and the custom X-QRious-Client header must be present.
/// </summary>
public sealed class RequestSecurityMiddleware(RequestDelegate next, IOptions<SecurityOptions> security, IOptions<AppOptions> app,
    IOptions<AttendeeCookieOptions> cookieOptions)
{
    public const string ProxyHeader = "X-QRious-Proxy";
    public const string ClientHeader = "X-QRious-Client";
    private static readonly HashSet<string> SafeMethods = new(StringComparer.OrdinalIgnoreCase) { "GET", "HEAD", "OPTIONS", "TRACE" };

    private readonly byte[] _proxySecret = Encoding.UTF8.GetBytes(security.Value.ProxySecret ?? "");
    private readonly HashSet<string> _origins = new(app.Value.WebOrigins.Select(o => o.TrimEnd('/')), StringComparer.OrdinalIgnoreCase);

    public async Task InvokeAsync(HttpContext context, RequestContext request)
    {
        request.ClientIp = ResolveClientIp(context);
        request.UserAgent = context.Request.Headers.UserAgent.ToString();

        if (context.Request.Path.StartsWithSegments("/api") && !SafeMethods.Contains(context.Request.Method) && !IsCsrfSafe(context))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await Results.Problem(statusCode: 403, title: "Request blocked",
                detail: "This request didn't come from the QRious app.",
                extensions: new Dictionary<string, object?> { ["code"] = "csrf_blocked" }).ExecuteAsync(context);
            return;
        }

        await next(context);
    }

    private string ResolveClientIp(HttpContext context)
    {
        var remote = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        if (_proxySecret.Length < 16) return remote;
        var provided = context.Request.Headers[ProxyHeader].ToString();
        if (provided.Length == 0 || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(provided), _proxySecret))
            return remote;
        var forwarded = context.Request.Headers["X-Forwarded-For"].ToString().Split(',')[0].Trim();
        return IPAddress.TryParse(forwarded, out var ip) ? ip.ToString() : remote;
    }

    private bool IsCsrfSafe(HttpContext context)
    {
        var hasCookie = context.Request.Cookies.ContainsKey(cookieOptions.Value.Name);
        var hasBearer = context.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.Ordinal);
        var client = context.Request.Headers[ClientHeader].ToString();

        // Native clients authenticate with bearer tokens, which browsers never attach automatically.
        if (hasBearer && !hasCookie) return client is "mobile" or "web";
        if (client is not ("web" or "mobile")) return false;

        var origin = context.Request.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(origin))
        {
            var referer = context.Request.Headers.Referer.ToString();
            if (Uri.TryCreate(referer, UriKind.Absolute, out var r)) origin = $"{r.Scheme}://{r.Authority}";
        }
        return origin.Length > 0 && _origins.Contains(origin.TrimEnd('/'));
    }
}
