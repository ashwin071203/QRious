using QRious.Application.Common;
using QRious.Application.Identity;
using QRious.Application.Profiles;
using QRious.Application.Taxonomy;
using QRious.Infrastructure.Persistence;

namespace QRious.UnitTests;

public class UsernameRulesTests
{
    [Theory]
    [InlineData("Ashwin", "ashwin")]
    [InlineData("  @Ashwin.S ", "ashwin.s")]
    [InlineData("DJ_Neo", "dj_neo")]
    public void Normalize_lowercases_and_strips_at_sign(string input, string expected) =>
        UsernameRules.Normalize(input).Should().Be(expected);

    [Theory]
    [InlineData("abc")]
    [InlineData("ashwin.s")]
    [InlineData("a_b.c_d")]
    [InlineData("user_")]
    [InlineData("x23456789012345678901234567890")]
    public void Valid_usernames_pass(string username) => UsernameRules.Validate(username).Should().BeNull();

    [Theory]
    [InlineData("ab")]                              // too short
    [InlineData("x234567890123456789012345678901")] // 31 chars
    [InlineData(".abc")]                            // starts with a dot
    [InlineData("_abc")]                            // starts with underscore
    [InlineData("abc.")]                            // trailing dot
    [InlineData("a..b")]                            // consecutive dots
    [InlineData("ab cd")]                           // space
    [InlineData("ab-cd")]                           // hyphen
    [InlineData("admin")]                           // reserved
    [InlineData("qrious_support")]                  // reserved prefix
    [InlineData("ñandu")]                           // non-ascii
    public void Invalid_usernames_fail(string username) => UsernameRules.Validate(username).Should().NotBeNull();

    [Fact]
    public void Candidates_are_valid_and_distinct_from_original()
    {
        var candidates = UsernameRules.Candidates("ashwin").ToList();
        candidates.Should().NotContain("ashwin");
        candidates.Where(c => UsernameRules.Validate(c) is null).Should().HaveCountGreaterThan(3);
    }
}

public class TagNormalizerTests
{
    [Theory]
    [InlineData("  music   production ", "music production")]
    [InlineData("MUSIC Production", "music production")]
    [InlineData("Ｍｕｓｉｃ", "music")] // full-width → NFKC
    public void Normalize_collapses_variants(string input, string expected) =>
        TagNormalizer.Normalize(input).Should().Be(expected);

    [Fact]
    public void Clean_capitalizes_all_lowercase_input() => TagNormalizer.Clean("synthwave").Should().Be("Synthwave");

    [Fact]
    public void Clean_preserves_intentional_casing() => TagNormalizer.Clean("UI/UX design").Should().Be("UI/UX design");

    [Theory]
    [InlineData("x")]
    [InlineData("<script>")]
    [InlineData("fuck this")]
    public void Validate_rejects_bad_tags(string input) => TagNormalizer.Validate(TagNormalizer.Clean(input)).Should().NotBeNull();

    [Theory]
    [InlineData("C#")]
    [InlineData("Rock & Roll")]
    [InlineData("Carnatic music")]
    [InlineData("संगीत")]
    public void Validate_accepts_reasonable_tags(string input) => TagNormalizer.Validate(TagNormalizer.Clean(input)).Should().BeNull();
}

public class RecoveryCodeTests
{
    private const string Pepper = "unit-test-pepper";

    [Fact]
    public void Generated_codes_have_expected_format_and_are_unique()
    {
        var codes = Enumerable.Range(0, 200).Select(_ => RecoveryCodes.Generate()).ToList();
        codes.Should().OnlyHaveUniqueItems();
        codes.Should().AllSatisfy(c => c.Should().MatchRegex("^QRS(-[0-9A-HJKMNP-TV-Z]{4}){6}$"));
    }

    [Fact]
    public void Normalize_accepts_lowercase_missing_dashes_and_confusables()
    {
        var code = RecoveryCodes.Generate();
        var expected = RecoveryCodes.Normalize(code);
        expected.Should().NotBeNull().And.HaveLength(24);
        RecoveryCodes.Normalize(code.ToLowerInvariant().Replace("-", "")).Should().Be(expected);
        RecoveryCodes.Normalize(code[4..]).Should().Be(expected); // without prefix
        RecoveryCodes.Normalize("QRS-0000-0000-0000-0000-0000-000O").Should().Be(new string('0', 24));
    }

    [Theory]
    [InlineData("")]
    [InlineData("QRS-1234")]
    [InlineData("QRS-UUUU-UUUU-UUUU-UUUU-UUUU-UUUU")] // U isn't in the alphabet
    public void Normalize_rejects_malformed(string input) => RecoveryCodes.Normalize(input).Should().BeNull();

    [Fact]
    public void Hash_verifies_only_with_same_code_salt_and_pepper()
    {
        var code = RecoveryCodes.Normalize(RecoveryCodes.Generate())!;
        var salt = RecoveryCodes.NewSalt();
        var hash = RecoveryCodes.Hash(code, salt, Pepper);

        RecoveryCodes.Verify(code, salt, hash, Pepper).Should().BeTrue();
        RecoveryCodes.Verify(code, salt, hash, "other-pepper").Should().BeFalse();
        RecoveryCodes.Verify(code, RecoveryCodes.NewSalt(), hash, Pepper).Should().BeFalse();
        RecoveryCodes.Verify(RecoveryCodes.Normalize(RecoveryCodes.Generate())!, salt, hash, Pepper).Should().BeFalse();
    }

    [Fact]
    public void Session_tokens_are_random_and_hashed()
    {
        var (t1, h1) = SecureTokens.NewSessionToken();
        var (t2, _) = SecureTokens.NewSessionToken();
        t1.Should().NotBe(t2);
        t1.Length.Should().BeGreaterThanOrEqualTo(43);
        h1.Should().HaveCount(32).And.Equal(SecureTokens.Hash(t1));
    }
}

public class MiscTests
{
    [Theory]
    [InlineData("NetworkingPaused", "networking_paused")]
    [InlineData("X", "x")]
    [InlineData("AvailableNow", "available_now")]
    [InlineData("OneTime", "one_time")]
    public void Snake_case_matches_database_convention(string input, string expected) =>
        Naming.ToSnakeCase(input).Should().Be(expected);

    [Theory]
    [InlineData("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Chrome on Android")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "Safari on iOS")]
    [InlineData(null, null)]
    public void User_agent_summary_is_coarse(string? ua, string? expected) => RequestContext.Summarize(ua).Should().Be(expected);
}
