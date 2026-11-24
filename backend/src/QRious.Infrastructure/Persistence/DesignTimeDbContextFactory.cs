using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace QRious.Infrastructure.Persistence;

/// <summary>Used by `dotnet ef` to create migrations without starting the API.</summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<QRiousDbContext>
{
    public QRiousDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("QRIOUS_DESIGN_CONNECTION")
                 ?? "Host=localhost;Port=5432;Database=qrious;Username=qrious;Password=qrious_dev_password";
        var options = new DbContextOptionsBuilder<QRiousDbContext>()
            .UseNpgsql(cs)
            .UseSnakeCaseNamingConvention()
            .Options;
        return new QRiousDbContext(options);
    }
}
