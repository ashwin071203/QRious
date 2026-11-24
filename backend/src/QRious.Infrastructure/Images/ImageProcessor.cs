using SkiaSharp;

namespace QRious.Infrastructure.Images;

public sealed record ProcessedImage(string Size, byte[] Data);

public sealed class ImageValidationException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>
/// Validates uploads by decoding them (never trusting extension or MIME type), then re-encodes to WebP.
/// Re-encoding produces a fresh file, so EXIF/GPS and all other metadata are dropped (D-17, PRD §12.2).
/// Uses SkiaSharp (MIT).
/// </summary>
public sealed class ImageProcessor
{
    public const long MaxBytes = 5 * 1024 * 1024;
    private const int MaxDimension = 4096;
    private const long MaxPixels = 16_000_000;

    private static readonly SKEncodedImageFormat[] AllowedFormats =
        [SKEncodedImageFormat.Jpeg, SKEncodedImageFormat.Png, SKEncodedImageFormat.Webp];

    public async Task<IReadOnlyList<ProcessedImage>> ProcessSquareAsync(Stream input, int[] sizes, CancellationToken ct)
    {
        var bytes = await ReadLimitedAsync(input, MaxBytes, ct);

        using var data = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(data)
            ?? throw new ImageValidationException("image_invalid", "The file is not a supported image (JPEG, PNG or WebP).");

        if (!AllowedFormats.Contains(codec.EncodedFormat))
            throw new ImageValidationException("image_invalid", "The file is not a supported image (JPEG, PNG or WebP).");

        var (w, h) = (codec.Info.Width, codec.Info.Height);
        if (w > MaxDimension || h > MaxDimension || (long)w * h > MaxPixels)
            throw new ImageValidationException("image_too_large", $"Images must be at most {MaxDimension}×{MaxDimension} pixels.");
        if (w < 64 || h < 64)
            throw new ImageValidationException("image_too_small", "Images must be at least 64×64 pixels.");

        var info = new SKImageInfo(w, h, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var decoded = new SKBitmap(info);
        var result = codec.GetPixels(info, decoded.GetPixels());
        if (result is not (SKCodecResult.Success or SKCodecResult.IncompleteInput))
            throw new ImageValidationException("image_invalid", "The image could not be read.");

        using var oriented = ApplyOrientation(decoded, codec.EncodedOrigin);
        var side = Math.Min(oriented.Width, oriented.Height);
        var src = SKRect.Create((oriented.Width - side) / 2f, (oriented.Height - side) / 2f, side, side);

        using var sourceImage = SKImage.FromBitmap(oriented);
        var outputs = new List<ProcessedImage>(sizes.Length);
        foreach (var size in sizes)
        {
            var target = Math.Min(size, side);
            using var surface = SKSurface.Create(new SKImageInfo(target, target, SKColorType.Rgba8888, SKAlphaType.Premul));
            surface.Canvas.Clear(SKColors.White);
            surface.Canvas.DrawImage(sourceImage, src, SKRect.Create(0, 0, target, target),
                new SKSamplingOptions(SKCubicResampler.Mitchell));
            using var snapshot = surface.Snapshot();
            using var encoded = snapshot.Encode(SKEncodedImageFormat.Webp, 82)
                ?? throw new ImageValidationException("image_invalid", "The image could not be processed.");
            outputs.Add(new ProcessedImage(size.ToString(), encoded.ToArray()));
        }
        return outputs;
    }

    private static SKBitmap ApplyOrientation(SKBitmap bitmap, SKEncodedOrigin origin)
    {
        if (origin == SKEncodedOrigin.TopLeft) return bitmap.Copy();

        var swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var (w, h) = swap ? (bitmap.Height, bitmap.Width) : (bitmap.Width, bitmap.Height);
        var rotated = new SKBitmap(new SKImageInfo(w, h, bitmap.ColorType, bitmap.AlphaType));
        using var canvas = new SKCanvas(rotated);
        switch (origin)
        {
            case SKEncodedOrigin.TopRight: canvas.Scale(-1, 1, w / 2f, 0); break;
            case SKEncodedOrigin.BottomRight: canvas.RotateDegrees(180, w / 2f, h / 2f); break;
            case SKEncodedOrigin.BottomLeft: canvas.Scale(1, -1, 0, h / 2f); break;
            case SKEncodedOrigin.LeftTop: canvas.RotateDegrees(90); canvas.Scale(1, -1); break;
            case SKEncodedOrigin.RightTop: canvas.Translate(w, 0); canvas.RotateDegrees(90); break;
            case SKEncodedOrigin.RightBottom: canvas.Translate(w, h); canvas.Scale(1, -1); canvas.RotateDegrees(90); break;
            case SKEncodedOrigin.LeftBottom: canvas.Translate(0, h); canvas.RotateDegrees(270); break;
        }
        canvas.DrawBitmap(bitmap, 0, 0);
        return rotated;
    }

    private static async Task<byte[]> ReadLimitedAsync(Stream input, long limit, CancellationToken ct)
    {
        using var output = new MemoryStream();
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await input.ReadAsync(buffer, ct)) > 0)
        {
            total += read;
            if (total > limit)
                throw new ImageValidationException("image_too_large", "Images must be 5 MB or smaller.");
            await output.WriteAsync(buffer.AsMemory(0, read), ct);
        }
        if (total == 0)
            throw new ImageValidationException("image_invalid", "The file is empty.");
        return output.ToArray();
    }
}
