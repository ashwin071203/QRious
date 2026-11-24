namespace QRious.Application.Common;

public sealed class SecurityOptions
{
    public const string Section = "Security";
    /// <summary>Server-side secret mixed into recovery-code hashes (D-13). Never stored in the database.</summary>
    public string RecoveryPepper { get; set; } = "";
    /// <summary>Salt for hashing IP addresses in audit logs.</summary>
    public string IpHashSalt { get; set; } = "";
    /// <summary>Shared secret the web proxy sends so forwarded client IPs can be trusted.</summary>
    public string ProxySecret { get; set; } = "";
}

/// <summary>Attendee session policy (D-13).</summary>
public sealed class SessionPolicyOptions
{
    public const string Section = "Auth:Session";
    public TimeSpan IdleTimeout { get; set; } = TimeSpan.FromDays(30);
    public TimeSpan AbsoluteLifetime { get; set; } = TimeSpan.FromDays(180);
    public TimeSpan RotationInterval { get; set; } = TimeSpan.FromHours(24);
    public TimeSpan RotationGrace { get; set; } = TimeSpan.FromMinutes(2);
    /// <summary>Minimum time between idle-expiry renewals (limits DB writes).</summary>
    public TimeSpan RenewalThrottle { get; set; } = TimeSpan.FromHours(1);
}

public sealed class AppOptions
{
    public const string Section = "App";
    public string[] WebOrigins { get; set; } = [];
    public string PublicWebUrl { get; set; } = "http://localhost:3000";
}
