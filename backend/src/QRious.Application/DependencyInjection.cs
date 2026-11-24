using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using QRious.Application.Billing;
using QRious.Application.Common;
using QRious.Application.Events;
using QRious.Application.Identity;
using QRious.Application.Participation;
using QRious.Application.Platform;
using QRious.Application.Profiles;
using QRious.Application.Seeding;
using QRious.Application.Taxonomy;
using QRious.Infrastructure;

namespace QRious.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddInfrastructure(configuration);

        services.Configure<SecurityOptions>(configuration.GetSection(SecurityOptions.Section));
        services.Configure<SessionPolicyOptions>(configuration.GetSection(SessionPolicyOptions.Section));
        services.Configure<AppOptions>(configuration.GetSection(AppOptions.Section));
        services.AddSingleton(TimeProvider.System);

        services.AddScoped<RequestContext>();
        services.AddScoped<AuditService>();
        services.AddScoped<SessionService>();
        services.AddScoped<RecoveryService>();
        services.AddScoped<TaxonomyService>();
        services.AddScoped<EventAccessService>();
        services.AddScoped<ParticipationService>();
        services.AddScoped<ProfileService>();
        services.AddScoped<OnboardingService>();
        services.AddScoped<EntitlementService>();
        services.AddScoped<DatabaseSeeder>();

        if (configuration.GetValue("Workers:EventLifecycle", true))
            services.AddHostedService<EventLifecycleWorker>();

        return services;
    }
}
