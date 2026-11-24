namespace QRious.Application.Common;

/// <summary>Per-request information about the caller, populated by the API layer.</summary>
public sealed class RequestContext
{
    public string ClientIp { get; set; } = "unknown";
    public string? UserAgent { get; set; }

    /// <summary>Short, privacy-preserving device description, e.g. "Chrome on Android".</summary>
    public string? UserAgentSummary => Summarize(UserAgent);

    public static string? Summarize(string? ua)
    {
        if (string.IsNullOrWhiteSpace(ua)) return null;
        string browser =
            ua.Contains("Edg/") ? "Edge" :
            ua.Contains("OPR/") ? "Opera" :
            ua.Contains("SamsungBrowser") ? "Samsung Internet" :
            ua.Contains("Firefox/") || ua.Contains("FxiOS") ? "Firefox" :
            ua.Contains("CriOS") || ua.Contains("Chrome/") ? "Chrome" :
            ua.Contains("Safari/") ? "Safari" : "Browser";
        string os =
            ua.Contains("Android") ? "Android" :
            ua.Contains("iPhone") || ua.Contains("iPad") ? "iOS" :
            ua.Contains("Windows") ? "Windows" :
            ua.Contains("Mac OS X") ? "macOS" :
            ua.Contains("Linux") ? "Linux" : "device";
        return $"{browser} on {os}";
    }
}
