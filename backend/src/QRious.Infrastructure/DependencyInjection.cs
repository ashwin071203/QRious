using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using QRious.Infrastructure.Images;
using QRious.Infrastructure.Persistence;
using QRious.Infrastructure.Storage;

namespace QRious.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.");

        services.AddDbContext<QRiousDbContext>(options => options
            .UseNpgsql(connectionString, npgsql =>
            {
                npgsql.MigrationsAssembly(typeof(QRiousDbContext).Assembly.FullName);
            })
            .UseSnakeCaseNamingConvention());

        services.Configure<StorageOptions>(configuration.GetSection(StorageOptions.Section));
        var provider = configuration[$"{StorageOptions.Section}:Provider"] ?? "s3";
        if (provider.Equals("memory", StringComparison.OrdinalIgnoreCase))
            services.AddSingleton<IObjectStorage, InMemoryObjectStorage>();
        else if (provider.Equals("local", StringComparison.OrdinalIgnoreCase))
            services.AddSingleton<IObjectStorage, LocalDiskObjectStorage>();
        else
            services.AddSingleton<IObjectStorage, S3ObjectStorage>();

        services.AddSingleton<ImageProcessor>();
        return services;
    }
}
