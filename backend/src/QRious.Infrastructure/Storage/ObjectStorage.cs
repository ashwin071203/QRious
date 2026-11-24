using System.Collections.Concurrent;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace QRious.Infrastructure.Storage;

public sealed class StorageOptions
{
    public const string Section = "Storage";
    /// <summary>"s3" (Cloudflare R2 / Supabase Storage / any S3 API), "local" (development disk) or "memory" (tests).</summary>
    public string Provider { get; set; } = "s3";
    public string LocalPath { get; set; } = ".data/media";
    public string ServiceUrl { get; set; } = "http://localhost:9000";
    public string Region { get; set; } = "auto";
    public string Bucket { get; set; } = "qrious-media";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public bool ForcePathStyle { get; set; } = true;
    /// <summary>Public base URL that serves objects (bucket public URL or CDN).</summary>
    public string PublicBaseUrl { get; set; } = "http://localhost:9000/qrious-media";
}

public interface IObjectStorage
{
    Task PutAsync(string key, Stream content, string contentType, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
    string PublicUrl(string key);
}

public sealed class S3ObjectStorage : IObjectStorage, IDisposable
{
    private readonly AmazonS3Client _client;
    private readonly StorageOptions _options;

    public S3ObjectStorage(IOptions<StorageOptions> options)
    {
        _options = options.Value;
        var config = new AmazonS3Config
        {
            ServiceURL = _options.ServiceUrl,
            ForcePathStyle = _options.ForcePathStyle,
            AuthenticationRegion = _options.Region,
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
        };
        _client = new AmazonS3Client(new BasicAWSCredentials(_options.AccessKey, _options.SecretKey), config);
    }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        await _client.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _options.Bucket,
            Key = key,
            InputStream = content,
            ContentType = contentType,
            Headers = { CacheControl = "public, max-age=31536000, immutable" },
            DisablePayloadSigning = true,
        }, ct);
    }

    public async Task DeleteAsync(string key, CancellationToken ct) =>
        await _client.DeleteObjectAsync(_options.Bucket, key, ct);

    public string PublicUrl(string key) => $"{_options.PublicBaseUrl.TrimEnd('/')}/{key}";

    public void Dispose() => _client.Dispose();
}

/// <summary>Local-disk storage for development. The API serves files from <c>/media</c>.</summary>
public sealed class LocalDiskObjectStorage(IOptions<StorageOptions> options) : IObjectStorage
{
    public string Root { get; } = Path.GetFullPath(options.Value.LocalPath);

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        var path = Resolve(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var file = File.Create(path);
        await content.CopyToAsync(file, ct);
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        var path = Resolve(key);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    public string PublicUrl(string key) => $"{options.Value.PublicBaseUrl.TrimEnd('/')}/{key}";

    private string Resolve(string key)
    {
        var path = Path.GetFullPath(Path.Combine(Root, key));
        if (!path.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new InvalidOperationException("Invalid storage key.");
        return path;
    }
}

/// <summary>In-memory storage for automated tests.</summary>
public sealed class InMemoryObjectStorage(IOptions<StorageOptions> options) : IObjectStorage
{
    public ConcurrentDictionary<string, (byte[] Data, string ContentType)> Objects { get; } = new();

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        await content.CopyToAsync(ms, ct);
        Objects[key] = (ms.ToArray(), contentType);
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        Objects.TryRemove(key, out _);
        return Task.CompletedTask;
    }

    public string PublicUrl(string key) => $"{options.Value.PublicBaseUrl.TrimEnd('/')}/{key}";
}
