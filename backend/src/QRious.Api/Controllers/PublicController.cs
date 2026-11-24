using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using QRious.Api.Infrastructure;
using QRious.Application.Events;
using QRious.Application.Taxonomy;

namespace QRious.Api.Controllers;

/// <summary>Anonymous endpoints. Browsing never creates attendee identity or participation (BR-02).</summary>
[Route("api/v1/public")]
[EnableRateLimiting(RateLimits.PublicRead)]
public sealed class PublicController(EventAccessService events, TaxonomyService taxonomy) : ApiControllerBase
{
    /// <summary>Resolve an event QR code to its landing page data.</summary>
    [HttpGet("qr/{code}")]
    public async Task<QrResolutionDto> ResolveQr(string code, CancellationToken ct) => await events.ResolveQrAsync(code, ct);

    [HttpGet("categories")]
    public async Task<IReadOnlyList<CategoryDto>> Categories(CancellationToken ct) => await taxonomy.CategoriesAsync(ct);
}

[Route("api/v1/taxonomy")]
[EnableRateLimiting(RateLimits.PublicRead)]
public sealed class TaxonomyController(TaxonomyService taxonomy) : ApiControllerBase
{
    [HttpGet("interests")]
    public async Task<IReadOnlyList<TagDto>> Interests([FromQuery] string? q, [FromQuery] Guid? eventId, [FromQuery] Guid? categoryId,
        [FromQuery] int limit = 24, CancellationToken ct = default) =>
        await taxonomy.SearchAsync(TagKind.Interest, q, eventId, categoryId, limit, ct);

    [HttpGet("skills")]
    public async Task<IReadOnlyList<TagDto>> Skills([FromQuery] string? q, [FromQuery] Guid? eventId, [FromQuery] Guid? categoryId,
        [FromQuery] int limit = 24, CancellationToken ct = default) =>
        await taxonomy.SearchAsync(TagKind.Skill, q, eventId, categoryId, limit, ct);
}
