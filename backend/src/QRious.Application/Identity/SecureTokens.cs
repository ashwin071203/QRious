using System.Security.Cryptography;
using System.Text;

namespace QRious.Application.Identity;

public static class SecureTokens
{
    /// <summary>A 256-bit random token (base64url) and its SHA-256 hash. Only the hash is stored.</summary>
    public static (string Token, byte[] Hash) NewSessionToken()
    {
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        return (token, Hash(token));
    }

    public static byte[] Hash(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));

    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Random base62 string, e.g. for QR public codes.</summary>
    public static string RandomBase62(int length)
    {
        const string alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        return RandomNumberGenerator.GetString(alphabet, length);
    }
}

/// <summary>
/// Recovery codes (D-13): 120 random bits, Crockford base32, formatted QRS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX.
/// Stored only as HMAC-SHA-256(pepper, salt ‖ normalized code).
/// </summary>
public static class RecoveryCodes
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
    private const int CodeChars = 24; // 24 × 5 bits = 120 bits
    public const string Prefix = "QRS";

    public static string Generate()
    {
        var bytes = RandomNumberGenerator.GetBytes(15);
        var chars = new char[CodeChars];
        int buffer = 0, bits = 0, index = 0;
        foreach (var b in bytes)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                chars[index++] = Alphabet[(buffer >> (bits - 5)) & 31];
                bits -= 5;
            }
        }
        var body = new string(chars);
        return $"{Prefix}-{string.Join('-', Enumerable.Range(0, 6).Select(i => body.Substring(i * 4, 4)))}";
    }

    /// <summary>Uppercases, removes separators and the optional prefix, and maps confusable letters (I/L→1, O→0).</summary>
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var sb = new StringBuilder(32);
        foreach (var raw in input.Trim().ToUpperInvariant())
        {
            var c = raw switch { 'I' or 'L' => '1', 'O' => '0', _ => raw };
            if (c is '-' or ' ' or '_') continue;
            sb.Append(c);
        }
        var s = sb.ToString();
        if (s.Length == CodeChars + Prefix.Length && s.StartsWith(Prefix, StringComparison.Ordinal)) s = s[Prefix.Length..];
        if (s.Length != CodeChars || s.Any(c => !Alphabet.Contains(c))) return null;
        return s;
    }

    public static byte[] NewSalt() => RandomNumberGenerator.GetBytes(16);

    public static byte[] Hash(string normalizedCode, byte[] salt, string pepper)
    {
        var key = Encoding.UTF8.GetBytes(pepper);
        var message = new byte[salt.Length + normalizedCode.Length];
        salt.CopyTo(message, 0);
        Encoding.ASCII.GetBytes(normalizedCode).CopyTo(message, salt.Length);
        return HMACSHA256.HashData(key, message);
    }

    public static bool Verify(string normalizedCode, byte[] salt, byte[] expectedHash, string pepper) =>
        CryptographicOperations.FixedTimeEquals(Hash(normalizedCode, salt, pepper), expectedHash);
}
