using System.Text.RegularExpressions;

namespace QRious.Application.Profiles;

/// <summary>
/// Username rules (PRD §3.2, D-16): 3–30 chars, a–z 0–9 _ ., starts with a letter or digit,
/// no consecutive or trailing dots, case-insensitive uniqueness, reserved words blocked.
/// </summary>
public static partial class UsernameRules
{
    public const int MinLength = 3;
    public const int MaxLength = 30;
    public static readonly TimeSpan ChangeCooldown = TimeSpan.FromDays(30);
    public static readonly TimeSpan ReleaseHold = TimeSpan.FromDays(30);

    private static readonly HashSet<string> Reserved = new(StringComparer.Ordinal)
    {
        "admin", "administrator", "root", "system", "support", "help", "qrious", "qrious_team", "official",
        "api", "app", "www", "mail", "security", "moderator", "mod", "staff", "organizer", "organiser",
        "settings", "profile", "discover", "pulse", "messages", "events", "event", "me", "null", "undefined",
        "anonymous", "everyone", "billing", "premium", "recovery", "login", "logout", "signup", "register",
    };

    [GeneratedRegex(@"^[a-z0-9](?:[a-z0-9_]|\.(?!\.)){1,28}[a-z0-9_]$", RegexOptions.CultureInvariant)]
    private static partial Regex FormatRegex();

    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var s = input.Trim();
        if (s.StartsWith('@')) s = s[1..];
        return s.ToLowerInvariant();
    }

    /// <summary>Returns an error message, or null when the normalized username is acceptable.</summary>
    public static string? Validate(string? normalized)
    {
        if (string.IsNullOrEmpty(normalized)) return "Username is required.";
        if (normalized.Length < MinLength) return $"Username must be at least {MinLength} characters.";
        if (normalized.Length > MaxLength) return $"Username must be at most {MaxLength} characters.";
        if (!FormatRegex().IsMatch(normalized))
            return "Use lowercase letters, numbers, underscores and single dots. Start with a letter or number and don't end with a dot.";
        if (Reserved.Contains(normalized) || normalized.StartsWith("qrious", StringComparison.Ordinal))
            return "This username is reserved.";
        return null;
    }

    /// <summary>Candidate alternatives for a taken username.</summary>
    public static IEnumerable<string> Candidates(string normalized)
    {
        var stem = normalized.Length > 24 ? normalized[..24].TrimEnd('.') : normalized.TrimEnd('.');
        yield return $"{stem}_";
        if (stem.Length + 4 <= MaxLength) yield return $"the.{stem}";
        foreach (var n in new[] { 1, 7, 11, 22, 99, 2026 })
            yield return $"{stem}{n}";
        yield return $"{stem}_{Random.Shared.Next(100, 999)}";
        yield return $"{stem}{Random.Shared.Next(1000, 9999)}";
    }
}
