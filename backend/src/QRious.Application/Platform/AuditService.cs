using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using QRious.Application.Common;
using QRious.Domain.Platform;
using QRious.Domain.Safety;
using QRious.Infrastructure.Persistence;

namespace QRious.Application.Platform;

/// <summary>Append-only audit trail (PRD §12.4). Adds entries to the current unit of work; the caller saves.</summary>
public sealed class AuditService(QRiousDbContext db, TimeProvider clock, RequestContext request, IOptions<SecurityOptions> security)
{
    public void Write(ActorType actorType, Guid? actorId, string action, string? targetType, Guid? targetId,
        object? data = null, Guid? organizationId = null, Guid? eventId = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            OccurredAt = clock.GetUtcNow(),
            ActorType = actorType,
            ActorId = actorId,
            Action = action,
            TargetType = targetType,
            TargetId = targetId,
            OrganizationId = organizationId,
            EventId = eventId,
            IpHash = HashIp(request.ClientIp),
            Data = data is null ? "{}" : JsonSerializer.Serialize(data),
        });
    }

    private byte[] HashIp(string ip)
    {
        // Monthly-rotating salt: IPs can be correlated within a month for abuse investigation, not beyond.
        var month = clock.GetUtcNow().ToString("yyyy-MM");
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(security.Value.IpHashSalt + month), Encoding.UTF8.GetBytes(ip));
    }
}
