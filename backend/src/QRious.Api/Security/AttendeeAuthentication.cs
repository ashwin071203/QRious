using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using QRious.Application.Identity;

namespace QRious.Api.Security;

public static class AttendeeClaims
{
    public const string Scheme = "AttendeeSession";
    public const string AttendeeId = "qr:aid";
    public const string SessionId = "qr:sid";
    public const string Status = "qr:status";
}

public sealed class AttendeeCookieOptions
{
    public const string Section = "Auth:Cookie";
    /// <summary>"__Host-qr_s" in production: host-only, Secure, Path=/ (same-site arrangement, D-10).</summary>
    public string Name { get; set; } = "__Host-qr_s";
    public bool Secure { get; set; } = true;
}

/// <summary>Writes and clears the attendee session cookie. The cookie never carries a Domain attribute.</summary>
public sealed class AttendeeCookie(IOptions<AttendeeCookieOptions> options)
{
    private readonly AttendeeCookieOptions _o = options.Value;

    public string Name => _o.Name;

    public void Write(HttpResponse response, string token, DateTimeOffset expiresAt) =>
        response.Cookies.Append(_o.Name, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = _o.Secure,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = expiresAt,
            IsEssential = true,
        });

    public void Clear(HttpResponse response) =>
        response.Cookies.Delete(_o.Name, new CookieOptions { HttpOnly = true, Secure = _o.Secure, SameSite = SameSiteMode.Lax, Path = "/" });
}

/// <summary>
/// Authenticates attendees from the opaque session cookie (web) or a bearer token (future mobile app).
/// Handles sliding renewal and 24 h token rotation by rewriting the cookie (D-13).
/// </summary>
public sealed class AttendeeSessionHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    SessionService sessions,
    AttendeeCookie cookie)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        string? token = null;
        var fromCookie = false;
        if (Request.Cookies.TryGetValue(cookie.Name, out var c) && !string.IsNullOrEmpty(c))
        {
            token = c;
            fromCookie = true;
        }
        else if (Request.Headers.Authorization.ToString() is { Length: > 7 } auth && auth.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            token = auth[7..].Trim();
        }
        if (token is null) return AuthenticateResult.NoResult();

        var result = await sessions.ValidateAsync(token, Context.RequestAborted);
        if (result is null)
        {
            if (fromCookie) cookie.Clear(Response);
            return AuthenticateResult.NoResult();
        }

        if (fromCookie && result.NewToken is { } newToken && !Response.HasStarted)
            cookie.Write(Response, newToken, result.ExpiresAt);

        var identity = new ClaimsIdentity(
        [
            new Claim(AttendeeClaims.AttendeeId, result.AttendeeId.ToString()),
            new Claim(AttendeeClaims.SessionId, result.SessionId.ToString()),
            new Claim(AttendeeClaims.Status, result.Status.ToString()),
        ], AttendeeClaims.Scheme);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), AttendeeClaims.Scheme));
    }

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        await Results.Problem(
            statusCode: 401,
            title: "Profile required",
            detail: "Create your QRious profile to use this feature.",
            extensions: new Dictionary<string, object?> { ["code"] = "profile_required" }).ExecuteAsync(Context);
    }

    protected override async Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        await Results.Problem(statusCode: 403, title: "Forbidden", detail: "You don't have access to this.",
            extensions: new Dictionary<string, object?> { ["code"] = "forbidden" }).ExecuteAsync(Context);
    }
}
