using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace QRious.Application.Taxonomy;

/// <summary>
/// Normalizes interest/skill names so duplicates collapse (PRD §3.2, D-18):
/// Unicode NFKC, trimmed, single spaces, invariant lowercase.
/// </summary>
public static partial class TagNormalizer
{
    public const int MinLength = 2;
    public const int MaxLength = 50;

    // Deliberately small; admin moderation (D-18) is the real control. Matched as whole words.
    private static readonly string[] Blocked =
    [
        "fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "slut", "whore", "rape", "porn", "dick", "pussy",
        "chutiya", "madarchod", "bhenchod", "behenchod", "randi", "gandu",
    ];

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"^[\p{L}\p{N}][\p{L}\p{N}\p{M} &+#./'’\-]*$")]
    private static partial Regex AllowedChars();

    /// <summary>Display form: NFKC, trimmed, collapsed whitespace, first letter capitalized if typed all-lowercase.</summary>
    public static string? Clean(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var s = Whitespace().Replace(input.Normalize(NormalizationForm.FormKC).Trim(), " ");
        if (s.Length > 0 && s == s.ToLowerInvariant() && char.IsLetter(s[0]))
            s = char.ToUpper(s[0], CultureInfo.InvariantCulture) + s[1..];
        return s;
    }

    public static string? Normalize(string? input) => Clean(input)?.ToLowerInvariant();

    /// <summary>Returns an error message or null.</summary>
    public static string? Validate(string? cleaned)
    {
        if (string.IsNullOrEmpty(cleaned)) return "Enter a name.";
        if (cleaned.Length < MinLength) return $"Must be at least {MinLength} characters.";
        if (cleaned.Length > MaxLength) return $"Must be at most {MaxLength} characters.";
        if (!AllowedChars().IsMatch(cleaned)) return "Use letters, numbers, spaces and & + # . / - ' only.";
        var lower = cleaned.ToLowerInvariant();
        var words = lower.Split([' ', '-', '.', '/', '&', '+'], StringSplitOptions.RemoveEmptyEntries);
        if (words.Any(w => Blocked.Contains(w))) return "Please choose a different name.";
        return null;
    }
}
