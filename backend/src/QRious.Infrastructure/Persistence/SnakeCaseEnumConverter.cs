using System.Text;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace QRious.Infrastructure.Persistence;

/// <summary>Stores enums as snake_case text (e.g. NetworkingPaused → "networking_paused").</summary>
public sealed class SnakeCaseEnumConverter<TEnum>() : ValueConverter<TEnum, string>(
    v => SnakeCaseEnum<TEnum>.ToText(v),
    v => SnakeCaseEnum<TEnum>.FromText(v))
    where TEnum : struct, Enum;

public static class SnakeCaseEnum<TEnum> where TEnum : struct, Enum
{
    private static readonly Dictionary<TEnum, string> ToMap =
        Enum.GetValues<TEnum>().ToDictionary(v => v, v => Naming.ToSnakeCase(v.ToString()));

    private static readonly Dictionary<string, TEnum> FromMap =
        ToMap.ToDictionary(kv => kv.Value, kv => kv.Key);

    public static IReadOnlyCollection<string> AllValues => ToMap.Values;

    public static string ToText(TEnum value) => ToMap[value];

    public static TEnum FromText(string value) => FromMap[value];
}

public static class Naming
{
    public static string ToSnakeCase(string name)
    {
        var sb = new StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0 && (char.IsLower(name[i - 1]) || (i + 1 < name.Length && char.IsLower(name[i + 1]) && char.IsUpper(name[i - 1]))))
                    sb.Append('_');
                sb.Append(char.ToLowerInvariant(c));
            }
            else
            {
                sb.Append(c);
            }
        }
        return sb.ToString();
    }
}
