using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using QRious.Domain.Billing;
using QRious.Domain.Events;
using QRious.Domain.Identity;
using QRious.Domain.Networking;
using QRious.Domain.Notifications;
using QRious.Domain.Organizations;
using QRious.Domain.Participation;
using QRious.Domain.Platform;
using QRious.Domain.Profiles;
using QRious.Domain.Safety;
using QRious.Domain.Taxonomy;

namespace QRious.Infrastructure.Persistence;

public class QRiousDbContext(DbContextOptions<QRiousDbContext> options)
    : IdentityDbContext<OrganizerUser, OrganizerRole, Guid>(options)
{
    // Identity
    public DbSet<Attendee> Attendees => Set<Attendee>();
    public DbSet<AttendeeSession> AttendeeSessions => Set<AttendeeSession>();
    public DbSet<AttendeeRecoveryCode> AttendeeRecoveryCodes => Set<AttendeeRecoveryCode>();
    public DbSet<IdempotencyRecord> IdempotencyKeys => Set<IdempotencyRecord>();

    // Profiles
    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();
    public DbSet<UsernameHistory> UsernameHistory => Set<UsernameHistory>();
    public DbSet<SocialLink> SocialLinks => Set<SocialLink>();
    public DbSet<ProfileInterest> ProfileInterests => Set<ProfileInterest>();
    public DbSet<ProfileSkill> ProfileSkills => Set<ProfileSkill>();
    public DbSet<ProfileLookingForSkill> ProfileLookingForSkills => Set<ProfileLookingForSkill>();

    // Taxonomy
    public DbSet<EventCategory> EventCategories => Set<EventCategory>();
    public DbSet<Interest> Interests => Set<Interest>();
    public DbSet<Skill> Skills => Set<Skill>();
    public DbSet<InterestAlias> InterestAliases => Set<InterestAlias>();
    public DbSet<SkillAlias> SkillAliases => Set<SkillAlias>();
    public DbSet<CategoryInterestSuggestion> CategoryInterestSuggestions => Set<CategoryInterestSuggestion>();
    public DbSet<CategorySkillSuggestion> CategorySkillSuggestions => Set<CategorySkillSuggestion>();
    public DbSet<NetworkingIntention> NetworkingIntentions => Set<NetworkingIntention>();

    // Organizations
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<OrganizationMember> OrganizationMembers => Set<OrganizationMember>();

    // Events
    public DbSet<Event> Events => Set<Event>();
    public DbSet<EventQrCode> EventQrCodes => Set<EventQrCode>();
    public DbSet<EventNetworkingSettings> EventNetworkingSettings => Set<EventNetworkingSettings>();
    public DbSet<EventSuggestedInterest> EventSuggestedInterests => Set<EventSuggestedInterest>();
    public DbSet<EventSuggestedSkill> EventSuggestedSkills => Set<EventSuggestedSkill>();
    public DbSet<EventIntention> EventIntentions => Set<EventIntention>();

    // Participation
    public DbSet<EventParticipant> EventParticipants => Set<EventParticipant>();
    public DbSet<EventAvailability> EventAvailability => Set<EventAvailability>();
    public DbSet<EventParticipantIntention> EventParticipantIntentions => Set<EventParticipantIntention>();
    public DbSet<EventActivityCounter> EventActivityCounters => Set<EventActivityCounter>();

    // Discovery / connections / messaging
    public DbSet<SavedProfile> SavedProfiles => Set<SavedProfile>();
    public DbSet<MatchDismissal> MatchDismissals => Set<MatchDismissal>();
    public DbSet<Connection> Connections => Set<Connection>();
    public DbSet<ConnectionHistory> ConnectionHistory => Set<ConnectionHistory>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMember> ConversationMembers => Set<ConversationMember>();
    public DbSet<Message> Messages => Set<Message>();

    // Notifications
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationPreferences> NotificationPreferences => Set<NotificationPreferences>();

    // Safety
    public DbSet<UserBlock> UserBlocks => Set<UserBlock>();
    public DbSet<UserReport> UserReports => Set<UserReport>();
    public DbSet<ModerationAction> ModerationActions => Set<ModerationAction>();
    public DbSet<AccountDeletionRequest> AccountDeletionRequests => Set<AccountDeletionRequest>();

    // Platform
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<PlatformSetting> PlatformSettings => Set<PlatformSetting>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    // Billing
    public DbSet<SubscriptionPlan> SubscriptionPlans => Set<SubscriptionPlan>();
    public DbSet<SubscriptionFeature> SubscriptionFeatures => Set<SubscriptionFeature>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<PaymentWebhook> PaymentWebhooks => Set<PaymentWebhook>();
    public DbSet<SubscriptionInvoice> SubscriptionInvoices => Set<SubscriptionInvoice>();
    public DbSet<EventPurchase> EventPurchases => Set<EventPurchase>();
    public DbSet<UserEntitlement> UserEntitlements => Set<UserEntitlement>();
    public DbSet<OrganizationEntitlement> OrganizationEntitlements => Set<OrganizationEntitlement>();
    public DbSet<PromotionalAccess> PromotionalAccess => Set<PromotionalAccess>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        b.HasPostgresExtension("pg_trgm");

        ConfigureIdentityTables(b);
        ConfigureAttendeeIdentity(b);
        ConfigureProfiles(b);
        ConfigureTaxonomy(b);
        ConfigureOrganizations(b);
        ConfigureEvents(b);
        ConfigureParticipation(b);
        ConfigureNetworking(b);
        ConfigureNotificationsAndSafety(b);
        ConfigurePlatform(b);
        ConfigureBilling(b);

        ApplyEnumConventions(b);
    }

    private static void ConfigureIdentityTables(ModelBuilder b)
    {
        b.Entity<OrganizerUser>(e =>
        {
            e.ToTable("organizer_users");
            e.Property(x => x.DisplayName).HasMaxLength(100);
        });
        b.Entity<OrganizerRole>().ToTable("organizer_roles");
        b.Entity<Microsoft.AspNetCore.Identity.IdentityUserRole<Guid>>().ToTable("organizer_user_roles");
        b.Entity<Microsoft.AspNetCore.Identity.IdentityUserClaim<Guid>>().ToTable("organizer_user_claims");
        b.Entity<Microsoft.AspNetCore.Identity.IdentityUserLogin<Guid>>().ToTable("organizer_user_logins");
        b.Entity<Microsoft.AspNetCore.Identity.IdentityUserToken<Guid>>().ToTable("organizer_user_tokens");
        b.Entity<Microsoft.AspNetCore.Identity.IdentityRoleClaim<Guid>>().ToTable("organizer_role_claims");
    }

    private static void ConfigureAttendeeIdentity(ModelBuilder b)
    {
        b.Entity<Attendee>(e =>
        {
            e.Property(x => x.SuspendedReason).HasMaxLength(500);
            e.HasOne(x => x.Profile).WithOne(x => x.Attendee).HasForeignKey<UserProfile>(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AttendeeSession>(e =>
        {
            e.Property(x => x.TokenHash).HasMaxLength(32);
            e.Property(x => x.PreviousTokenHash).HasMaxLength(32);
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.PreviousTokenHash).IsUnique();
            e.HasIndex(x => x.AttendeeId).HasFilter("revoked_at IS NULL").HasDatabaseName("ix_attendee_sessions_active");
            e.Property(x => x.UserAgentSummary).HasMaxLength(100);
            e.HasOne(x => x.Attendee).WithMany(x => x.Sessions).HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AttendeeRecoveryCode>(e =>
        {
            e.Property(x => x.CodeHash).HasMaxLength(32);
            e.Property(x => x.Salt).HasMaxLength(16);
            e.HasIndex(x => x.AttendeeId).IsUnique().HasFilter("status = 'active'").HasDatabaseName("ux_recovery_codes_one_active");
            e.HasOne(x => x.Attendee).WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<IdempotencyRecord>(e =>
        {
            e.ToTable("idempotency_keys");
            e.HasKey(x => new { x.Scope, x.Key });
            e.Property(x => x.Scope).HasMaxLength(64);
            e.Property(x => x.ResponseBody).HasColumnType("jsonb");
            e.HasIndex(x => x.ExpiresAt);
        });
    }

    private static void ConfigureProfiles(ModelBuilder b)
    {
        b.Entity<UserProfile>(e =>
        {
            e.Property(x => x.DisplayName).HasMaxLength(60);
            e.Property(x => x.Username).HasMaxLength(30);
            e.Property(x => x.UsernameNormalized).HasMaxLength(30);
            e.HasIndex(x => x.UsernameNormalized).IsUnique();
            e.HasIndex(x => x.AttendeeId).IsUnique();
            e.Property(x => x.Bio).HasMaxLength(500);
            e.Property(x => x.Profession).HasMaxLength(100);
            e.Property(x => x.ProfessionNormalized).HasMaxLength(100);
            e.HasIndex(x => x.ProfessionNormalized);
            e.Property(x => x.Company).HasMaxLength(100);
            e.Property(x => x.Location).HasMaxLength(100);
            e.Property(x => x.LookingForText).HasMaxLength(500);
            e.Property(x => x.CanOfferText).HasMaxLength(500);
            e.Property(x => x.PhotoKey).HasMaxLength(200);
            e.Property(x => x.IsPublic).HasDefaultValue(true);
            e.Property(x => x.PremiumTheme).HasColumnType("jsonb");
            e.Property(x => x.Version).IsRowVersion();
            e.HasIndex(x => x.DisplayName, "ix_user_profiles_display_name_trgm").HasMethod("gin").HasOperators("gin_trgm_ops").HasDatabaseName("ix_user_profiles_display_name_trgm");
            e.HasIndex(x => x.UsernameNormalized, "ix_user_profiles_username_trgm").HasMethod("gin").HasOperators("gin_trgm_ops").HasDatabaseName("ix_user_profiles_username_trgm");
            e.ToTable(t =>
            {
                t.HasCheckConstraint("ck_user_profiles_display_name_not_blank", "length(btrim(display_name)) > 0");
                t.HasCheckConstraint("ck_user_profiles_username_format",
                    "username_normalized ~ '^[a-z0-9]([a-z0-9_]|\\.(?!\\.)){1,28}[a-z0-9_]$'");
            });
            e.HasMany(x => x.Interests).WithOne().HasForeignKey(x => x.ProfileId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Skills).WithOne().HasForeignKey(x => x.ProfileId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.LookingForSkills).WithOne().HasForeignKey(x => x.ProfileId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.SocialLinks).WithOne().HasForeignKey(x => x.ProfileId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<UsernameHistory>(e =>
        {
            e.ToTable("username_history");
            e.Property(x => x.UsernameNormalized).HasMaxLength(30);
            e.HasIndex(x => new { x.UsernameNormalized, x.ReservedUntil });
            e.HasOne<UserProfile>().WithMany().HasForeignKey(x => x.ProfileId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SocialLink>(e =>
        {
            e.Property(x => x.Url).HasMaxLength(500);
            e.HasIndex(x => new { x.ProfileId, x.Url }).IsUnique();
            e.ToTable(t => t.HasCheckConstraint("ck_social_links_https", "url ~ '^https://'"));
        });

        b.Entity<ProfileInterest>(e =>
        {
            e.HasKey(x => new { x.ProfileId, x.InterestId });
            e.HasIndex(x => x.InterestId);
            e.HasOne(x => x.Interest).WithMany().HasForeignKey(x => x.InterestId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ProfileSkill>(e =>
        {
            e.HasKey(x => new { x.ProfileId, x.SkillId });
            e.HasIndex(x => x.SkillId);
            e.HasOne(x => x.Skill).WithMany().HasForeignKey(x => x.SkillId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ProfileLookingForSkill>(e =>
        {
            e.HasKey(x => new { x.ProfileId, x.SkillId });
            e.HasOne(x => x.Skill).WithMany().HasForeignKey(x => x.SkillId).OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureTaxonomy(ModelBuilder b)
    {
        b.Entity<EventCategory>(e =>
        {
            e.Property(x => x.Slug).HasMaxLength(50);
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Description).HasMaxLength(300);
            e.Property(x => x.ImageUrl).HasMaxLength(300);
        });

        b.Entity<Interest>(e => ConfigureTag(e, "interests"));
        b.Entity<Skill>(e => ConfigureTag(e, "skills"));

        b.Entity<InterestAlias>(e =>
        {
            e.HasKey(x => x.AliasNormalized);
            e.Property(x => x.AliasNormalized).HasMaxLength(50);
            e.HasOne<Interest>().WithMany().HasForeignKey(x => x.InterestId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SkillAlias>(e =>
        {
            e.HasKey(x => x.AliasNormalized);
            e.Property(x => x.AliasNormalized).HasMaxLength(50);
            e.HasOne<Skill>().WithMany().HasForeignKey(x => x.SkillId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CategoryInterestSuggestion>(e =>
        {
            e.HasKey(x => new { x.CategoryId, x.InterestId });
            e.HasOne<EventCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Interest>().WithMany().HasForeignKey(x => x.InterestId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<CategorySkillSuggestion>(e =>
        {
            e.HasKey(x => new { x.CategoryId, x.SkillId });
            e.HasOne<EventCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Skill>().WithMany().HasForeignKey(x => x.SkillId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<NetworkingIntention>(e =>
        {
            e.Property(x => x.Slug).HasMaxLength(60);
            e.Property(x => x.Label).HasMaxLength(80);
            e.HasIndex(x => new { x.CategoryId, x.Slug }).IsUnique().AreNullsDistinct(false);
            e.HasOne<EventCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureTag<T>(Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<T> e, string table) where T : Tag
    {
        e.ToTable(table);
        e.Property(x => x.Name).HasMaxLength(50);
        e.Property(x => x.NormalizedName).HasMaxLength(50);
        e.HasIndex(x => x.NormalizedName).IsUnique();
        e.Property(x => x.GroupName).HasMaxLength(50);
        e.HasIndex(x => x.NormalizedName, $"ix_{table}_name_trgm").HasMethod("gin").HasOperators("gin_trgm_ops").HasDatabaseName($"ix_{table}_name_trgm");
        e.HasOne<T>().WithMany().HasForeignKey(x => x.MergedIntoId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.CreatedByAttendeeId).OnDelete(DeleteBehavior.SetNull);
    }

    private static void ConfigureOrganizations(ModelBuilder b)
    {
        b.Entity<Organization>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Slug).HasMaxLength(120);
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Description).HasMaxLength(2000);
            e.Property(x => x.LogoKey).HasMaxLength(200);
            e.Property(x => x.ContactEmail).HasMaxLength(254);
            e.Property(x => x.ContactPhone).HasMaxLength(30);
            e.Property(x => x.Website).HasMaxLength(300);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.CreatedBy).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<OrganizationMember>(e =>
        {
            e.HasKey(x => new { x.OrganizationId, x.OrganizerUserId });
            e.HasIndex(x => x.OrganizerUserId);
            e.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.OrganizerUserId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureEvents(ModelBuilder b)
    {
        b.Entity<Event>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(150);
            e.Property(x => x.Description).HasMaxLength(5000);
            e.Property(x => x.BannerKey).HasMaxLength(200);
            e.Property(x => x.VenueName).HasMaxLength(150);
            e.Property(x => x.VenueAddress).HasMaxLength(300);
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.TimeZone).HasMaxLength(64);
            e.Property(x => x.Website).HasMaxLength(300);
            e.Property(x => x.Branding).HasColumnType("jsonb");
            e.Property(x => x.Version).IsRowVersion();
            e.HasIndex(x => new { x.OrganizationId, x.Status });
            e.HasIndex(x => new { x.Status, x.StartsAt });
            e.ToTable(t =>
            {
                t.HasCheckConstraint("ck_events_time_order", "ends_at > starts_at");
                t.HasCheckConstraint("ck_events_max_participants", "max_participants IS NULL OR max_participants > 0");
                t.HasCheckConstraint("ck_events_participant_count", "participant_count >= 0");
            });
            e.HasOne(x => x.Organization).WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.CreatedBy).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.NetworkingSettings).WithOne().HasForeignKey<EventNetworkingSettings>(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<EventQrCode>(e =>
        {
            e.Property(x => x.PublicCode).HasMaxLength(16);
            e.HasIndex(x => x.PublicCode).IsUnique();
            e.HasIndex(x => x.EventId).IsUnique().HasFilter("status = 'active'").HasDatabaseName("ux_event_qr_codes_one_active");
            e.HasOne(x => x.Event).WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.CreatedBy).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.RevokedBy).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<EventNetworkingSettings>(e => e.HasKey(x => x.EventId));

        b.Entity<EventSuggestedInterest>(e =>
        {
            e.HasKey(x => new { x.EventId, x.InterestId });
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Interest>().WithMany().HasForeignKey(x => x.InterestId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<EventSuggestedSkill>(e =>
        {
            e.HasKey(x => new { x.EventId, x.SkillId });
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Skill>().WithMany().HasForeignKey(x => x.SkillId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<EventIntention>(e =>
        {
            e.HasKey(x => new { x.EventId, x.IntentionId });
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<NetworkingIntention>().WithMany().HasForeignKey(x => x.IntentionId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureParticipation(ModelBuilder b)
    {
        b.Entity<EventParticipant>(e =>
        {
            e.HasIndex(x => new { x.EventId, x.AttendeeId }).IsUnique();
            e.HasIndex(x => new { x.AttendeeId, x.Status });
            e.HasIndex(x => new { x.EventId, x.Status }).HasFilter("discovery_paused = false").HasDatabaseName("ix_event_participants_discoverable");
            e.Property(x => x.RemovalReason).HasMaxLength(500);
            e.HasOne(x => x.Event).WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Attendee).WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<EventQrCode>().WithMany().HasForeignKey(x => x.JoinedViaQrCodeId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.RemovedBy).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Availability).WithOne().HasForeignKey<EventAvailability>(x => x.ParticipantId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<EventAvailability>(e =>
        {
            e.ToTable("event_availability");
            e.HasKey(x => x.ParticipantId);
            e.HasIndex(x => x.Status);
        });

        b.Entity<EventParticipantIntention>(e =>
        {
            e.HasKey(x => new { x.ParticipantId, x.IntentionId });
            e.HasOne<EventParticipant>().WithMany().HasForeignKey(x => x.ParticipantId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<NetworkingIntention>().WithMany().HasForeignKey(x => x.IntentionId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<EventActivityCounter>(e =>
        {
            e.HasKey(x => new { x.EventId, x.BucketStart, x.Kind });
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureNetworking(ModelBuilder b)
    {
        b.Entity<SavedProfile>(e =>
        {
            e.HasKey(x => new { x.AttendeeId, x.SavedProfileId });
            e.HasIndex(x => x.SavedProfileId);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<UserProfile>().WithMany().HasForeignKey(x => x.SavedProfileId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<MatchDismissal>(e =>
        {
            e.HasKey(x => new { x.AttendeeId, x.EventId, x.DismissedProfileId });
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<UserProfile>().WithMany().HasForeignKey(x => x.DismissedProfileId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Connection>(e =>
        {
            e.Property(x => x.IntroMessage).HasMaxLength(300);
            e.HasIndex(x => new { x.AttendeeLowId, x.AttendeeHighId }).IsUnique()
                .HasFilter("status IN ('pending','accepted')").HasDatabaseName("ux_connections_live_pair");
            e.HasIndex(x => new { x.AddresseeAttendeeId, x.Status });
            e.HasIndex(x => new { x.RequesterAttendeeId, x.Status });
            e.ToTable(t =>
            {
                t.HasCheckConstraint("ck_connections_not_self", "requester_attendee_id <> addressee_attendee_id");
                t.HasCheckConstraint("ck_connections_pair_order", "attendee_low_id < attendee_high_id");
            });
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.RequesterAttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AddresseeAttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.OriginEventId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<ConnectionHistory>(e =>
        {
            e.ToTable("connection_history");
            e.Property(x => x.Id).UseIdentityAlwaysColumn();
            e.HasOne<Connection>().WithMany().HasForeignKey(x => x.ConnectionId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Conversation>(e =>
        {
            e.HasIndex(x => x.ConnectionId).IsUnique();
            e.HasIndex(x => new { x.AttendeeLowId, x.AttendeeHighId }).IsUnique();
            e.ToTable(t => t.HasCheckConstraint("ck_conversations_pair_order", "attendee_low_id < attendee_high_id"));
            e.HasOne<Connection>().WithMany().HasForeignKey(x => x.ConnectionId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.OriginEventId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<ConversationMember>(e =>
        {
            e.HasKey(x => new { x.ConversationId, x.AttendeeId });
            e.HasIndex(x => x.AttendeeId);
            e.HasOne<Conversation>().WithMany().HasForeignKey(x => x.ConversationId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Message>(e =>
        {
            e.Property(x => x.Id).UseIdentityAlwaysColumn();
            e.Property(x => x.Body).HasMaxLength(4000);
            e.HasIndex(x => new { x.ConversationId, x.ClientMessageId }).IsUnique();
            e.HasIndex(x => new { x.ConversationId, x.Id }).IsDescending(false, true);
            e.ToTable(t => t.HasCheckConstraint("ck_messages_body_not_blank", "length(btrim(body)) > 0"));
            e.HasOne<Conversation>().WithMany().HasForeignKey(x => x.ConversationId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.SenderAttendeeId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureNotificationsAndSafety(ModelBuilder b)
    {
        b.Entity<Notification>(e =>
        {
            e.Property(x => x.EntityType).HasMaxLength(50);
            e.Property(x => x.Payload).HasColumnType("jsonb");
            e.HasIndex(x => new { x.AttendeeId, x.CreatedAt }).IsDescending(false, true);
            e.HasIndex(x => x.AttendeeId).HasFilter("read_at IS NULL").HasDatabaseName("ix_notifications_unread");
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<NotificationPreferences>(e =>
        {
            e.HasKey(x => x.AttendeeId);
            e.HasOne<Attendee>().WithOne().HasForeignKey<NotificationPreferences>(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<UserBlock>(e =>
        {
            e.HasKey(x => new { x.BlockerAttendeeId, x.BlockedAttendeeId });
            e.HasIndex(x => x.BlockedAttendeeId);
            e.ToTable(t => t.HasCheckConstraint("ck_user_blocks_not_self", "blocker_attendee_id <> blocked_attendee_id"));
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.BlockerAttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.BlockedAttendeeId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<UserReport>(e =>
        {
            e.Property(x => x.Details).HasMaxLength(1000);
            e.Property(x => x.ResolutionNote).HasMaxLength(1000);
            e.HasIndex(x => new { x.Status, x.CreatedAt });
            e.HasIndex(x => new { x.EventId, x.Status });
            e.ToTable(t => t.HasCheckConstraint("ck_user_reports_one_reporter",
                "(reporter_attendee_id IS NOT NULL)::int + (reporter_organizer_user_id IS NOT NULL)::int = 1"));
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.ReporterAttendeeId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.ReporterOrganizerUserId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.ReportedAttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Message>().WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.AssignedAdminId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<ModerationAction>(e =>
        {
            e.Property(x => x.Reason).HasMaxLength(1000);
            e.Property(x => x.Metadata).HasColumnType("jsonb");
            e.HasIndex(x => new { x.TargetType, x.TargetId });
            e.HasOne<UserReport>().WithMany().HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<AccountDeletionRequest>(e =>
        {
            e.HasIndex(x => x.ScheduledFor).HasFilter("completed_at IS NULL AND cancelled_at IS NULL");
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigurePlatform(ModelBuilder b)
    {
        b.Entity<AuditLog>(e =>
        {
            e.Property(x => x.Id).UseIdentityAlwaysColumn();
            e.Property(x => x.Action).HasMaxLength(100);
            e.Property(x => x.TargetType).HasMaxLength(50);
            e.Property(x => x.IpHash).HasMaxLength(32);
            e.Property(x => x.Data).HasColumnType("jsonb");
            e.HasIndex(x => new { x.OrganizationId, x.OccurredAt });
            e.HasIndex(x => new { x.TargetType, x.TargetId });
        });

        b.Entity<PlatformSetting>(e =>
        {
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(100);
            e.Property(x => x.Value).HasColumnType("jsonb");
        });

        b.Entity<OutboxMessage>(e =>
        {
            e.Property(x => x.Id).UseIdentityAlwaysColumn();
            e.Property(x => x.Type).HasMaxLength(100);
            e.Property(x => x.Payload).HasColumnType("jsonb");
            e.HasIndex(x => x.Id).HasFilter("processed_at IS NULL").HasDatabaseName("ix_outbox_messages_pending");
        });
    }

    private static void ConfigureBilling(ModelBuilder b)
    {
        b.Entity<SubscriptionPlan>(e =>
        {
            e.Property(x => x.Code).HasMaxLength(60);
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Description).HasMaxLength(500);
            e.Property(x => x.Currency).HasMaxLength(3).IsFixedLength();
            e.Property(x => x.GatewayPlanId).HasMaxLength(100);
            e.ToTable(t => t.HasCheckConstraint("ck_subscription_plans_price", "price_minor >= 0"));
            e.HasMany(x => x.Features).WithOne().HasForeignKey(x => x.PlanId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SubscriptionFeature>(e =>
        {
            e.HasKey(x => new { x.PlanId, x.FeatureKey });
            e.Property(x => x.FeatureKey).HasMaxLength(80);
        });

        b.Entity<Subscription>(e =>
        {
            e.Property(x => x.Gateway).HasMaxLength(30);
            e.Property(x => x.GatewaySubscriptionId).HasMaxLength(100);
            e.HasIndex(x => x.GatewaySubscriptionId).IsUnique();
            e.HasIndex(x => x.AttendeeId).IsUnique()
                .HasFilter("attendee_id IS NOT NULL AND status IN ('created','authenticated','active','pending')")
                .HasDatabaseName("ux_subscriptions_attendee_live");
            e.HasIndex(x => x.OrganizationId).IsUnique()
                .HasFilter("organization_id IS NOT NULL AND status IN ('created','authenticated','active','pending')")
                .HasDatabaseName("ux_subscriptions_org_live");
            e.ToTable(t => t.HasCheckConstraint("ck_subscriptions_subscriber",
                "(subscriber_type = 'attendee' AND attendee_id IS NOT NULL AND organization_id IS NULL) OR " +
                "(subscriber_type = 'organization' AND organization_id IS NOT NULL AND attendee_id IS NULL)"));
            e.HasOne<SubscriptionPlan>().WithMany().HasForeignKey(x => x.PlanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<EventPurchase>(e =>
        {
            e.HasIndex(x => new { x.EventId, x.PlanId }).IsUnique().HasFilter("status = 'paid'").HasDatabaseName("ux_event_purchases_paid");
            e.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<SubscriptionPlan>().WithMany().HasForeignKey(x => x.PlanId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Payment>(e =>
        {
            e.Property(x => x.Gateway).HasMaxLength(30);
            e.Property(x => x.GatewayOrderId).HasMaxLength(100);
            e.Property(x => x.GatewayPaymentId).HasMaxLength(100);
            e.HasIndex(x => x.GatewayOrderId).IsUnique();
            e.HasIndex(x => x.GatewayPaymentId).IsUnique();
            e.Property(x => x.Currency).HasMaxLength(3).IsFixedLength();
            e.Property(x => x.FailureCode).HasMaxLength(100);
            e.Property(x => x.FailureReason).HasMaxLength(500);
            e.Property(x => x.Method).HasMaxLength(30);
            e.ToTable(t => t.HasCheckConstraint("ck_payments_amounts", "amount_minor >= 0 AND refunded_minor >= 0 AND refunded_minor <= amount_minor"));
            e.HasOne<Subscription>().WithMany().HasForeignKey(x => x.SubscriptionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<EventPurchase>().WithMany().HasForeignKey(x => x.EventPurchaseId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<PaymentWebhook>(e =>
        {
            e.Property(x => x.Gateway).HasMaxLength(30);
            e.Property(x => x.GatewayEventId).HasMaxLength(100);
            e.HasIndex(x => x.GatewayEventId).IsUnique();
            e.Property(x => x.EventType).HasMaxLength(100);
            e.Property(x => x.Payload).HasColumnType("jsonb");
        });

        b.Entity<SubscriptionInvoice>(e =>
        {
            e.Property(x => x.InvoiceNumber).HasMaxLength(40);
            e.HasIndex(x => x.InvoiceNumber).IsUnique();
            e.Property(x => x.GatewayInvoiceId).HasMaxLength(100);
            e.HasIndex(x => x.GatewayInvoiceId).IsUnique();
            e.Property(x => x.BillingName).HasMaxLength(150);
            e.Property(x => x.BillingGstin).HasMaxLength(15);
            e.HasOne<Subscription>().WithMany().HasForeignKey(x => x.SubscriptionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Payment>().WithMany().HasForeignKey(x => x.PaymentId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<UserEntitlement>(e =>
        {
            e.HasKey(x => new { x.AttendeeId, x.FeatureKey, x.SourceType, x.SourceId });
            e.Property(x => x.FeatureKey).HasMaxLength(80);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<OrganizationEntitlement>(e =>
        {
            e.HasKey(x => new { x.OrganizationId, x.FeatureKey, x.SourceType, x.SourceId });
            e.Property(x => x.FeatureKey).HasMaxLength(80);
            e.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<PromotionalAccess>(e =>
        {
            e.Property(x => x.Reason).HasMaxLength(500);
            e.ToTable(t => t.HasCheckConstraint("ck_promotional_access_period", "ends_at > starts_at"));
            e.HasOne<SubscriptionPlan>().WithMany().HasForeignKey(x => x.PlanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Attendee>().WithMany().HasForeignKey(x => x.AttendeeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<OrganizerUser>().WithMany().HasForeignKey(x => x.GrantedBy).OnDelete(DeleteBehavior.Restrict);
        });
    }

    /// <summary>Every enum property is stored as snake_case text with a CHECK constraint listing its allowed values.</summary>
    private static void ApplyEnumConventions(ModelBuilder b)
    {
        foreach (var entity in b.Model.GetEntityTypes().ToList())
        {
            var tableName = entity.GetTableName() ?? Naming.ToSnakeCase(entity.ClrType.Name);
            foreach (var property in entity.GetDeclaredProperties().ToList())
            {
                var enumType = Nullable.GetUnderlyingType(property.ClrType) ?? property.ClrType;
                if (!enumType.IsEnum) continue;

                var converter = (Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter)Activator.CreateInstance(
                    typeof(SnakeCaseEnumConverter<>).MakeGenericType(enumType))!;
                property.SetValueConverter(converter);
                property.SetMaxLength(40);

                var values = (IReadOnlyCollection<string>)typeof(SnakeCaseEnum<>).MakeGenericType(enumType)
                    .GetProperty("AllValues")!.GetValue(null)!;
                var column = Naming.ToSnakeCase(property.Name);
                var list = string.Join(",", values.Select(v => $"'{v}'"));
                var sql = property.IsNullable ? $"{column} IS NULL OR {column} IN ({list})" : $"{column} IN ({list})";
                entity.AddCheckConstraint($"ck_{Naming.ToSnakeCase(tableName)}_{column}", sql);
            }
        }
    }
}
