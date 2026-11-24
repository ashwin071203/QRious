using QRious.Application.Common;
using QRious.Application.Taxonomy;
using QRious.Domain.Profiles;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Profiles;

/// <summary>Server-side validation for profile input (authoritative; the frontend mirrors these rules).</summary>
public static class ProfileValidation
{
    public const int MaxTags = 20;
    public const int MaxLookingForSkills = 10;
    public const int MaxSocialLinks = 10;

    private static readonly Dictionary<SocialPlatform, string[]> PlatformHosts = new()
    {
        [SocialPlatform.Instagram] = ["instagram.com"],
        [SocialPlatform.Linkedin] = ["linkedin.com"],
        [SocialPlatform.X] = ["x.com", "twitter.com"],
        [SocialPlatform.Github] = ["github.com"],
        [SocialPlatform.Behance] = ["behance.net"],
        [SocialPlatform.Dribbble] = ["dribbble.com"],
        [SocialPlatform.Youtube] = ["youtube.com", "youtu.be"],
        [SocialPlatform.Spotify] = ["spotify.com"],
        [SocialPlatform.Soundcloud] = ["soundcloud.com"],
    };

    public sealed class Errors
    {
        private readonly Dictionary<string, List<string>> _errors = new();
        public void Add(string field, string message)
        {
            if (!_errors.TryGetValue(field, out var list)) _errors[field] = list = [];
            list.Add(message);
        }
        public void ThrowIfAny()
        {
            if (_errors.Count > 0) throw AppException.Validation(_errors.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray()));
        }
    }

    public static string? CleanText(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim().Normalize(System.Text.NormalizationForm.FormC);

    public static void Text(Errors errors, string field, string? value, int max, bool required = false, string? label = null)
    {
        var cleaned = CleanText(value);
        if (cleaned is null)
        {
            if (required) errors.Add(field, $"{label ?? field} is required.");
            return;
        }
        if (cleaned.Length > max) errors.Add(field, $"{label ?? field} must be at most {max} characters.");
        if (cleaned.Any(c => char.IsControl(c) && c is not '\n' and not '\r'))
            errors.Add(field, $"{label ?? field} contains invalid characters.");
    }

    public static void Tags(Errors errors, string field, IReadOnlyList<TagInput>? tags, int min, int max, string label)
    {
        var count = tags?.Count ?? 0;
        if (count < min) errors.Add(field, min == 1 ? $"Choose at least one {label}." : $"Choose at least {min} {label}.");
        if (count > max) errors.Add(field, $"Choose at most {max}.");
        if (tags is null) return;
        foreach (var t in tags)
        {
            if (t.Id is null && string.IsNullOrWhiteSpace(t.Name)) errors.Add(field, "Each item needs an id or a name.");
        }
    }

    public static List<SocialLink> SocialLinks(Errors errors, IReadOnlyList<SocialLinkInput>? inputs)
    {
        var result = new List<SocialLink>();
        if (inputs is null) return result;
        if (inputs.Count > MaxSocialLinks) errors.Add("socialLinks", $"Add at most {MaxSocialLinks} links.");

        short order = 0;
        foreach (var input in inputs.Take(MaxSocialLinks))
        {
            if (!TryParseEnum<SocialPlatform>(input.Platform, out var platform))
            {
                errors.Add("socialLinks", $"Unknown platform \"{input.Platform}\".");
                continue;
            }
            var visibility = FieldVisibility.Members;
            if (input.Visibility is not null && !TryParseEnum(input.Visibility, out visibility))
            {
                errors.Add("socialLinks", "Visibility must be public, members or connections.");
                continue;
            }
            var url = input.Url?.Trim() ?? "";
            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                url = "https://" + url;
            if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) url = "https://" + url[7..];

            if (url.Length > 500 || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps
                || string.IsNullOrEmpty(uri.Host) || !uri.Host.Contains('.') || !string.IsNullOrEmpty(uri.UserInfo))
            {
                errors.Add("socialLinks", $"\"{input.Url}\" isn't a valid web address.");
                continue;
            }
            if (PlatformHosts.TryGetValue(platform, out var hosts) &&
                !hosts.Any(h => uri.Host.Equals(h, StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith("." + h, StringComparison.OrdinalIgnoreCase)))
            {
                errors.Add("socialLinks", $"That doesn't look like a {platform} link.");
                continue;
            }
            if (result.Any(l => l.Url.Equals(uri.AbsoluteUri, StringComparison.OrdinalIgnoreCase))) continue;
            result.Add(new SocialLink { Platform = platform, Url = uri.AbsoluteUri, Visibility = visibility, SortOrder = order++ });
        }
        return result;
    }

    public static bool TryParseEnum<T>(string? text, out T value) where T : struct, Enum
    {
        value = default;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var normalized = text.Trim().ToLowerInvariant().Replace('-', '_');
        foreach (var candidate in Enum.GetValues<T>())
        {
            if (SnakeCaseEnum<T>.ToText(candidate) == normalized) { value = candidate; return true; }
        }
        return false;
    }
}
