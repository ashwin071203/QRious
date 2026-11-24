using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace QRious.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pg_trgm", ",,");

            migrationBuilder.CreateTable(
                name: "attendees",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    suspended_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    last_active_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deactivated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_attendees", x => x.id);
                    table.CheckConstraint("ck_attendees_status", "status IN ('active','suspended','deactivated','deleted')");
                });

            migrationBuilder.CreateTable(
                name: "audit_logs",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    actor_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    target_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    target_id = table.Column<Guid>(type: "uuid", nullable: true),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: true),
                    event_id = table.Column<Guid>(type: "uuid", nullable: true),
                    ip_hash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: true),
                    data = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_logs", x => x.id);
                    table.CheckConstraint("ck_audit_logs_actor_type", "actor_type IN ('attendee','organizer','admin','system','gateway')");
                });

            migrationBuilder.CreateTable(
                name: "event_categories",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    description = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    image_url = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    sort_order = table.Column<short>(type: "smallint", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_categories", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "idempotency_keys",
                columns: table => new
                {
                    scope = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    key = table.Column<Guid>(type: "uuid", nullable: false),
                    request_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    session_id = table.Column<Guid>(type: "uuid", nullable: true),
                    response_status = table.Column<int>(type: "integer", nullable: false),
                    response_body = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_idempotency_keys", x => new { x.scope, x.key });
                });

            migrationBuilder.CreateTable(
                name: "organizer_roles",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    normalized_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    concurrency_stamp = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizer_roles", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "organizer_users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    display_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    user_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    normalized_user_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    normalized_email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    email_confirmed = table.Column<bool>(type: "boolean", nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: true),
                    security_stamp = table.Column<string>(type: "text", nullable: true),
                    concurrency_stamp = table.Column<string>(type: "text", nullable: true),
                    phone_number = table.Column<string>(type: "text", nullable: true),
                    phone_number_confirmed = table.Column<bool>(type: "boolean", nullable: false),
                    two_factor_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    lockout_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    lockout_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    access_failed_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizer_users", x => x.id);
                    table.CheckConstraint("ck_organizer_users_status", "status IN ('active','suspended')");
                });

            migrationBuilder.CreateTable(
                name: "outbox_messages",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    error = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_outbox_messages", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "payment_webhooks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    gateway = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    gateway_event_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    event_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    signature_valid = table.Column<bool>(type: "boolean", nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    processing_error = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_payment_webhooks", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "platform_settings",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    value = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_platform_settings", x => x.key);
                });

            migrationBuilder.CreateTable(
                name: "subscription_plans",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    audience = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    billing_period = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    price_minor = table.Column<int>(type: "integer", nullable: false),
                    currency = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    tax_inclusive = table.Column<bool>(type: "boolean", nullable: false),
                    gateway_plan_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    is_default = table.Column<bool>(type: "boolean", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    sort_order = table.Column<short>(type: "smallint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscription_plans", x => x.id);
                    table.CheckConstraint("ck_subscription_plans_audience", "audience IN ('attendee','organization')");
                    table.CheckConstraint("ck_subscription_plans_billing_period", "billing_period IN ('none','month','year','one_time')");
                    table.CheckConstraint("ck_subscription_plans_price", "price_minor >= 0");
                });

            migrationBuilder.CreateTable(
                name: "account_deletion_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    scheduled_for = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    cancelled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_account_deletion_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_account_deletion_requests_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "attendee_recovery_codes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code_hash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
                    salt = table.Column<byte[]>(type: "bytea", maxLength: 16, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    failed_attempts = table.Column<int>(type: "integer", nullable: false),
                    locked_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    rotated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_attendee_recovery_codes", x => x.id);
                    table.CheckConstraint("ck_attendee_recovery_codes_status", "status IN ('active','rotated','used','revoked')");
                    table.ForeignKey(
                        name: "fk_attendee_recovery_codes_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "attendee_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
                    previous_token_hash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: true),
                    previous_token_valid_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    token_issued_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    absolute_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_reason = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    client_kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    user_agent_summary = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_attendee_sessions", x => x.id);
                    table.CheckConstraint("ck_attendee_sessions_client_kind", "client_kind IN ('web','mobile')");
                    table.CheckConstraint("ck_attendee_sessions_revoked_reason", "revoked_reason IS NULL OR revoked_reason IN ('logout','user_revoked','admin','suspension','deletion','recovery','token_reuse')");
                    table.ForeignKey(
                        name: "fk_attendee_sessions_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "interests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    normalized_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    merged_into_id = table.Column<Guid>(type: "uuid", nullable: true),
                    group_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    created_by_attendee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_interests", x => x.id);
                    table.CheckConstraint("ck_interests_status", "status IN ('approved','pending','rejected','merged')");
                    table.ForeignKey(
                        name: "fk_interests_attendees_created_by_attendee_id",
                        column: x => x.created_by_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_interests_interests_merged_into_id",
                        column: x => x.merged_into_id,
                        principalTable: "interests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "notification_preferences",
                columns: table => new
                {
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    connection_requests = table.Column<bool>(type: "boolean", nullable: false),
                    connection_accepted = table.Column<bool>(type: "boolean", nullable: false),
                    messages = table.Column<bool>(type: "boolean", nullable: false),
                    event_updates = table.Column<bool>(type: "boolean", nullable: false),
                    billing = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_preferences", x => x.attendee_id);
                    table.ForeignKey(
                        name: "fk_notification_preferences_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "skills",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    normalized_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    merged_into_id = table.Column<Guid>(type: "uuid", nullable: true),
                    group_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    created_by_attendee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_skills", x => x.id);
                    table.CheckConstraint("ck_skills_status", "status IN ('approved','pending','rejected','merged')");
                    table.ForeignKey(
                        name: "fk_skills_attendees_created_by_attendee_id",
                        column: x => x.created_by_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_skills_skills_merged_into_id",
                        column: x => x.merged_into_id,
                        principalTable: "skills",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "user_blocks",
                columns: table => new
                {
                    blocker_attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    blocked_attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_blocks", x => new { x.blocker_attendee_id, x.blocked_attendee_id });
                    table.CheckConstraint("ck_user_blocks_not_self", "blocker_attendee_id <> blocked_attendee_id");
                    table.ForeignKey(
                        name: "fk_user_blocks_attendees_blocked_attendee_id",
                        column: x => x.blocked_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_user_blocks_attendees_blocker_attendee_id",
                        column: x => x.blocker_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_entitlements",
                columns: table => new
                {
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    feature_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    source_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    source_id = table.Column<Guid>(type: "uuid", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    limit_value = table.Column<int>(type: "integer", nullable: true),
                    valid_from = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    valid_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_entitlements", x => new { x.attendee_id, x.feature_key, x.source_type, x.source_id });
                    table.CheckConstraint("ck_user_entitlements_source_type", "source_type IN ('plan','subscription','promo','event_purchase')");
                    table.ForeignKey(
                        name: "fk_user_entitlements_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_profiles",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    display_name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    username = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    username_normalized = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    username_changed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    bio = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    profession = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    profession_normalized = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    company = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    location = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    looking_for_text = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    can_offer_text = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    photo_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    photo_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    is_public = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    anonymous_visibility_consented_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    company_visibility = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    location_visibility = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    show_saved_me = table.Column<bool>(type: "boolean", nullable: false),
                    premium_theme = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_profiles", x => x.id);
                    table.CheckConstraint("ck_user_profiles_company_visibility", "company_visibility IN ('public','members','connections')");
                    table.CheckConstraint("ck_user_profiles_display_name_not_blank", "length(btrim(display_name)) > 0");
                    table.CheckConstraint("ck_user_profiles_location_visibility", "location_visibility IN ('public','members','connections')");
                    table.CheckConstraint("ck_user_profiles_username_format", "username_normalized ~ '^[a-z0-9]([a-z0-9_]|\\.(?!\\.)){1,28}[a-z0-9_]$'");
                    table.ForeignKey(
                        name: "fk_user_profiles_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "networking_intentions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    category_id = table.Column<Guid>(type: "uuid", nullable: true),
                    slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    label = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    pulse_group = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    sort_order = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_networking_intentions", x => x.id);
                    table.CheckConstraint("ck_networking_intentions_pulse_group", "pulse_group IN ('collaboration','social','professional','creative','other')");
                    table.ForeignKey(
                        name: "fk_networking_intentions_event_categories_category_id",
                        column: x => x.category_id,
                        principalTable: "event_categories",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organizer_role_claims",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    role_id = table.Column<Guid>(type: "uuid", nullable: false),
                    claim_type = table.Column<string>(type: "text", nullable: true),
                    claim_value = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizer_role_claims", x => x.id);
                    table.ForeignKey(
                        name: "fk_organizer_role_claims_organizer_roles_role_id",
                        column: x => x.role_id,
                        principalTable: "organizer_roles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organizations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    logo_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    contact_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    contact_phone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    website = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizations", x => x.id);
                    table.CheckConstraint("ck_organizations_status", "status IN ('active','suspended')");
                    table.ForeignKey(
                        name: "fk_organizations_organizer_users_created_by",
                        column: x => x.created_by,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "organizer_user_claims",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    claim_type = table.Column<string>(type: "text", nullable: true),
                    claim_value = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizer_user_claims", x => x.id);
                    table.ForeignKey(
                        name: "fk_organizer_user_claims_organizer_users_user_id",
                        column: x => x.user_id,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organizer_user_logins",
                columns: table => new
                {
                    login_provider = table.Column<string>(type: "text", nullable: false),
                    provider_key = table.Column<string>(type: "text", nullable: false),
                    provider_display_name = table.Column<string>(type: "text", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizer_user_logins", x => new { x.login_provider, x.provider_key });
                    table.ForeignKey(
                        name: "fk_organizer_user_logins_organizer_users_user_id",
                        column: x => x.user_id,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organizer_user_roles",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizer_user_roles", x => new { x.user_id, x.role_id });
                    table.ForeignKey(
                        name: "fk_organizer_user_roles_organizer_roles_role_id",
                        column: x => x.role_id,
                        principalTable: "organizer_roles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_organizer_user_roles_organizer_users_user_id",
                        column: x => x.user_id,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organizer_user_tokens",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    login_provider = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    value = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizer_user_tokens", x => new { x.user_id, x.login_provider, x.name });
                    table.ForeignKey(
                        name: "fk_organizer_user_tokens_organizer_users_user_id",
                        column: x => x.user_id,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "subscription_features",
                columns: table => new
                {
                    plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    feature_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    limit_value = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscription_features", x => new { x.plan_id, x.feature_key });
                    table.ForeignKey(
                        name: "fk_subscription_features_subscription_plans_plan_id",
                        column: x => x.plan_id,
                        principalTable: "subscription_plans",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "category_interest_suggestions",
                columns: table => new
                {
                    category_id = table.Column<Guid>(type: "uuid", nullable: false),
                    interest_id = table.Column<Guid>(type: "uuid", nullable: false),
                    rank = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_category_interest_suggestions", x => new { x.category_id, x.interest_id });
                    table.ForeignKey(
                        name: "fk_category_interest_suggestions_event_categories_category_id",
                        column: x => x.category_id,
                        principalTable: "event_categories",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_category_interest_suggestions_interests_interest_id",
                        column: x => x.interest_id,
                        principalTable: "interests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "interest_aliases",
                columns: table => new
                {
                    alias_normalized = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    interest_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_interest_aliases", x => x.alias_normalized);
                    table.ForeignKey(
                        name: "fk_interest_aliases_interests_interest_id",
                        column: x => x.interest_id,
                        principalTable: "interests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "category_skill_suggestions",
                columns: table => new
                {
                    category_id = table.Column<Guid>(type: "uuid", nullable: false),
                    skill_id = table.Column<Guid>(type: "uuid", nullable: false),
                    rank = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_category_skill_suggestions", x => new { x.category_id, x.skill_id });
                    table.ForeignKey(
                        name: "fk_category_skill_suggestions_event_categories_category_id",
                        column: x => x.category_id,
                        principalTable: "event_categories",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_category_skill_suggestions_skills_skill_id",
                        column: x => x.skill_id,
                        principalTable: "skills",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "skill_aliases",
                columns: table => new
                {
                    alias_normalized = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    skill_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_skill_aliases", x => x.alias_normalized);
                    table.ForeignKey(
                        name: "fk_skill_aliases_skills_skill_id",
                        column: x => x.skill_id,
                        principalTable: "skills",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "profile_interests",
                columns: table => new
                {
                    profile_id = table.Column<Guid>(type: "uuid", nullable: false),
                    interest_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_profile_interests", x => new { x.profile_id, x.interest_id });
                    table.ForeignKey(
                        name: "fk_profile_interests_interests_interest_id",
                        column: x => x.interest_id,
                        principalTable: "interests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_profile_interests_user_profiles_profile_id",
                        column: x => x.profile_id,
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "profile_looking_for_skills",
                columns: table => new
                {
                    profile_id = table.Column<Guid>(type: "uuid", nullable: false),
                    skill_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_profile_looking_for_skills", x => new { x.profile_id, x.skill_id });
                    table.ForeignKey(
                        name: "fk_profile_looking_for_skills_skills_skill_id",
                        column: x => x.skill_id,
                        principalTable: "skills",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_profile_looking_for_skills_user_profiles_profile_id",
                        column: x => x.profile_id,
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "profile_skills",
                columns: table => new
                {
                    profile_id = table.Column<Guid>(type: "uuid", nullable: false),
                    skill_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_profile_skills", x => new { x.profile_id, x.skill_id });
                    table.ForeignKey(
                        name: "fk_profile_skills_skills_skill_id",
                        column: x => x.skill_id,
                        principalTable: "skills",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_profile_skills_user_profiles_profile_id",
                        column: x => x.profile_id,
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "social_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    profile_id = table.Column<Guid>(type: "uuid", nullable: false),
                    platform = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    visibility = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    sort_order = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_social_links", x => x.id);
                    table.CheckConstraint("ck_social_links_https", "url ~ '^https://'");
                    table.CheckConstraint("ck_social_links_platform", "platform IN ('instagram','linkedin','x','github','behance','dribbble','youtube','spotify','soundcloud','website','portfolio','other')");
                    table.CheckConstraint("ck_social_links_visibility", "visibility IN ('public','members','connections')");
                    table.ForeignKey(
                        name: "fk_social_links_user_profiles_profile_id",
                        column: x => x.profile_id,
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "username_history",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    profile_id = table.Column<Guid>(type: "uuid", nullable: false),
                    username_normalized = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    changed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    reserved_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_username_history", x => x.id);
                    table.ForeignKey(
                        name: "fk_username_history_user_profiles_profile_id",
                        column: x => x.profile_id,
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    category_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    description = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: true),
                    banner_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    venue_name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    venue_address = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    city = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    time_zone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    website = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    max_participants = table.Column<int>(type: "integer", nullable: true),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    moderation_status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    qr_access_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    branding = table.Column<string>(type: "jsonb", nullable: true),
                    participant_count = table.Column<int>(type: "integer", nullable: false),
                    published_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    activated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    archived_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_events", x => x.id);
                    table.CheckConstraint("ck_events_max_participants", "max_participants IS NULL OR max_participants > 0");
                    table.CheckConstraint("ck_events_moderation_status", "moderation_status IN ('ok','suspended')");
                    table.CheckConstraint("ck_events_participant_count", "participant_count >= 0");
                    table.CheckConstraint("ck_events_status", "status IN ('draft','published','active','networking_paused','ended','archived')");
                    table.CheckConstraint("ck_events_time_order", "ends_at > starts_at");
                    table.ForeignKey(
                        name: "fk_events_event_categories_category_id",
                        column: x => x.category_id,
                        principalTable: "event_categories",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_events_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_events_organizer_users_created_by",
                        column: x => x.created_by,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "organization_entitlements",
                columns: table => new
                {
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    feature_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    source_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    source_id = table.Column<Guid>(type: "uuid", nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    limit_value = table.Column<int>(type: "integer", nullable: true),
                    valid_from = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    valid_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_entitlements", x => new { x.organization_id, x.feature_key, x.source_type, x.source_id });
                    table.CheckConstraint("ck_organization_entitlements_source_type", "source_type IN ('plan','subscription','promo','event_purchase')");
                    table.ForeignKey(
                        name: "fk_organization_entitlements_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organization_members",
                columns: table => new
                {
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    organizer_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    invited_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_members", x => new { x.organization_id, x.organizer_user_id });
                    table.CheckConstraint("ck_organization_members_role", "role IN ('owner','member')");
                    table.ForeignKey(
                        name: "fk_organization_members_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_organization_members_organizer_users_organizer_user_id",
                        column: x => x.organizer_user_id,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "promotional_access",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    subscriber_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: true),
                    plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    granted_by = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_promotional_access", x => x.id);
                    table.CheckConstraint("ck_promotional_access_period", "ends_at > starts_at");
                    table.CheckConstraint("ck_promotional_access_subscriber_type", "subscriber_type IN ('attendee','organization')");
                    table.ForeignKey(
                        name: "fk_promotional_access_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_promotional_access_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_promotional_access_organizer_users_granted_by",
                        column: x => x.granted_by,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_promotional_access_subscription_plans_plan_id",
                        column: x => x.plan_id,
                        principalTable: "subscription_plans",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "subscriptions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    subscriber_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    gateway = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    gateway_subscription_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    current_period_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    current_period_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    cancel_at_period_end = table.Column<bool>(type: "boolean", nullable: false),
                    cancelled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscriptions", x => x.id);
                    table.CheckConstraint("ck_subscriptions_status", "status IN ('created','authenticated','active','pending','halted','cancelled','completed','expired')");
                    table.CheckConstraint("ck_subscriptions_subscriber", "(subscriber_type = 'attendee' AND attendee_id IS NOT NULL AND organization_id IS NULL) OR (subscriber_type = 'organization' AND organization_id IS NOT NULL AND attendee_id IS NULL)");
                    table.CheckConstraint("ck_subscriptions_subscriber_type", "subscriber_type IN ('attendee','organization')");
                    table.ForeignKey(
                        name: "fk_subscriptions_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_subscriptions_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_subscriptions_subscription_plans_plan_id",
                        column: x => x.plan_id,
                        principalTable: "subscription_plans",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "connections",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    requester_attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    addressee_attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_low_id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_high_id = table.Column<Guid>(type: "uuid", nullable: false),
                    origin_event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    intro_message = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    responded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    removed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    removed_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_connections", x => x.id);
                    table.CheckConstraint("ck_connections_not_self", "requester_attendee_id <> addressee_attendee_id");
                    table.CheckConstraint("ck_connections_pair_order", "attendee_low_id < attendee_high_id");
                    table.CheckConstraint("ck_connections_status", "status IN ('pending','accepted','declined','withdrawn','removed')");
                    table.ForeignKey(
                        name: "fk_connections_attendees_addressee_attendee_id",
                        column: x => x.addressee_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_connections_attendees_requester_attendee_id",
                        column: x => x.requester_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_connections_events_origin_event_id",
                        column: x => x.origin_event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_activity_counters",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bucket_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_activity_counters", x => new { x.event_id, x.bucket_start, x.kind });
                    table.CheckConstraint("ck_event_activity_counters_kind", "kind IN ('join','status_change','connection_accepted','message_sent')");
                    table.ForeignKey(
                        name: "fk_event_activity_counters_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "event_intentions",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    intention_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sort_order = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_intentions", x => new { x.event_id, x.intention_id });
                    table.ForeignKey(
                        name: "fk_event_intentions_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_intentions_networking_intentions_intention_id",
                        column: x => x.intention_id,
                        principalTable: "networking_intentions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "event_networking_settings",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    discover_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    anonymous_browsing_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    smart_matching_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    pulse_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    connections_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    messaging_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    availability_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    premium_highlighting_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_networking_settings", x => x.event_id);
                    table.ForeignKey(
                        name: "fk_event_networking_settings_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "event_purchases",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_purchases", x => x.id);
                    table.CheckConstraint("ck_event_purchases_status", "status IN ('pending','paid','refunded')");
                    table.ForeignKey(
                        name: "fk_event_purchases_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_event_purchases_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_event_purchases_subscription_plans_plan_id",
                        column: x => x.plan_id,
                        principalTable: "subscription_plans",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_qr_codes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    public_code = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    revoked_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_qr_codes", x => x.id);
                    table.CheckConstraint("ck_event_qr_codes_status", "status IN ('active','revoked')");
                    table.ForeignKey(
                        name: "fk_event_qr_codes_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_qr_codes_organizer_users_created_by",
                        column: x => x.created_by,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_event_qr_codes_organizer_users_revoked_by",
                        column: x => x.revoked_by,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "event_suggested_interests",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    interest_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sort_order = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_suggested_interests", x => new { x.event_id, x.interest_id });
                    table.ForeignKey(
                        name: "fk_event_suggested_interests_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_suggested_interests_interests_interest_id",
                        column: x => x.interest_id,
                        principalTable: "interests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "event_suggested_skills",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    skill_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sort_order = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_suggested_skills", x => new { x.event_id, x.skill_id });
                    table.ForeignKey(
                        name: "fk_event_suggested_skills_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_suggested_skills_skills_skill_id",
                        column: x => x.skill_id,
                        principalTable: "skills",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "match_dismissals",
                columns: table => new
                {
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    dismissed_profile_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_match_dismissals", x => new { x.attendee_id, x.event_id, x.dismissed_profile_id });
                    table.ForeignKey(
                        name: "fk_match_dismissals_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_match_dismissals_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_match_dismissals_user_profiles_dismissed_profile_id",
                        column: x => x.dismissed_profile_id,
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: true),
                    actor_profile_id = table.Column<Guid>(type: "uuid", nullable: true),
                    entity_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    read_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notifications", x => x.id);
                    table.CheckConstraint("ck_notifications_type", "type IN ('connection_request','connection_accepted','message','event_update','system','billing')");
                    table.ForeignKey(
                        name: "fk_notifications_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_notifications_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "saved_profiles",
                columns: table => new
                {
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    saved_profile_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_saved_profiles", x => new { x.attendee_id, x.saved_profile_id });
                    table.ForeignKey(
                        name: "fk_saved_profiles_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_saved_profiles_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_saved_profiles_user_profiles_saved_profile_id",
                        column: x => x.saved_profile_id,
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "connection_history",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    connection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    from_status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    to_status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_connection_history", x => x.id);
                    table.CheckConstraint("ck_connection_history_action", "action IN ('requested','accepted','declined','withdrawn','removed')");
                    table.CheckConstraint("ck_connection_history_from_status", "from_status IS NULL OR from_status IN ('pending','accepted','declined','withdrawn','removed')");
                    table.CheckConstraint("ck_connection_history_to_status", "to_status IN ('pending','accepted','declined','withdrawn','removed')");
                    table.ForeignKey(
                        name: "fk_connection_history_connections_connection_id",
                        column: x => x.connection_id,
                        principalTable: "connections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "conversations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    connection_id = table.Column<Guid>(type: "uuid", nullable: true),
                    attendee_low_id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_high_id = table.Column<Guid>(type: "uuid", nullable: false),
                    origin_event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    last_message_id = table.Column<long>(type: "bigint", nullable: true),
                    last_message_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_conversations", x => x.id);
                    table.CheckConstraint("ck_conversations_pair_order", "attendee_low_id < attendee_high_id");
                    table.ForeignKey(
                        name: "fk_conversations_connections_connection_id",
                        column: x => x.connection_id,
                        principalTable: "connections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_conversations_events_origin_event_id",
                        column: x => x.origin_event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "payments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    subscription_id = table.Column<Guid>(type: "uuid", nullable: true),
                    event_purchase_id = table.Column<Guid>(type: "uuid", nullable: true),
                    payer_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: true),
                    gateway = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    gateway_order_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    gateway_payment_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    amount_minor = table.Column<int>(type: "integer", nullable: false),
                    tax_minor = table.Column<int>(type: "integer", nullable: false),
                    fee_minor = table.Column<int>(type: "integer", nullable: false),
                    currency = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    refunded_minor = table.Column<int>(type: "integer", nullable: false),
                    failure_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    failure_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    method = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    captured_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_payments", x => x.id);
                    table.CheckConstraint("ck_payments_amounts", "amount_minor >= 0 AND refunded_minor >= 0 AND refunded_minor <= amount_minor");
                    table.CheckConstraint("ck_payments_payer_type", "payer_type IN ('attendee','organization')");
                    table.CheckConstraint("ck_payments_status", "status IN ('created','authorized','captured','failed','refunded','partially_refunded')");
                    table.ForeignKey(
                        name: "fk_payments_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_payments_event_purchases_event_purchase_id",
                        column: x => x.event_purchase_id,
                        principalTable: "event_purchases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_payments_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_payments_subscriptions_subscription_id",
                        column: x => x.subscription_id,
                        principalTable: "subscriptions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_participants",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    discovery_paused = table.Column<bool>(type: "boolean", nullable: false),
                    joined_via_qr_code_id = table.Column<Guid>(type: "uuid", nullable: true),
                    joined_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    left_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    removed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    removed_by = table.Column<Guid>(type: "uuid", nullable: true),
                    removal_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    export_consent = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_participants", x => x.id);
                    table.CheckConstraint("ck_event_participants_status", "status IN ('active','left','removed')");
                    table.ForeignKey(
                        name: "fk_event_participants_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_participants_event_qr_codes_joined_via_qr_code_id",
                        column: x => x.joined_via_qr_code_id,
                        principalTable: "event_qr_codes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_event_participants_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_participants_organizer_users_removed_by",
                        column: x => x.removed_by,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "conversation_members",
                columns: table => new
                {
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    last_read_message_id = table.Column<long>(type: "bigint", nullable: false),
                    last_read_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    muted = table.Column<bool>(type: "boolean", nullable: false),
                    joined_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_conversation_members", x => new { x.conversation_id, x.attendee_id });
                    table.ForeignKey(
                        name: "fk_conversation_members_attendees_attendee_id",
                        column: x => x.attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_conversation_members_conversations_conversation_id",
                        column: x => x.conversation_id,
                        principalTable: "conversations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "messages",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sender_attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    client_message_id = table.Column<Guid>(type: "uuid", nullable: false),
                    body = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_messages", x => x.id);
                    table.CheckConstraint("ck_messages_body_not_blank", "length(btrim(body)) > 0");
                    table.ForeignKey(
                        name: "fk_messages_attendees_sender_attendee_id",
                        column: x => x.sender_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_messages_conversations_conversation_id",
                        column: x => x.conversation_id,
                        principalTable: "conversations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "subscription_invoices",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    invoice_number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    subscription_id = table.Column<Guid>(type: "uuid", nullable: true),
                    payment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    gateway_invoice_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    amount_minor = table.Column<int>(type: "integer", nullable: false),
                    tax_minor = table.Column<int>(type: "integer", nullable: false),
                    period_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    period_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    issued_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    billing_name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    billing_gstin = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscription_invoices", x => x.id);
                    table.CheckConstraint("ck_subscription_invoices_status", "status IN ('issued','paid','void')");
                    table.ForeignKey(
                        name: "fk_subscription_invoices_payments_payment_id",
                        column: x => x.payment_id,
                        principalTable: "payments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_subscription_invoices_subscriptions_subscription_id",
                        column: x => x.subscription_id,
                        principalTable: "subscriptions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_availability",
                columns: table => new
                {
                    participant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    visibility = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_availability", x => x.participant_id);
                    table.CheckConstraint("ck_event_availability_status", "status IN ('available_now','open_to_conversations','meet_new_people','looking_for_collaborators','quick_conversations','temporarily_unavailable','discovery_paused')");
                    table.CheckConstraint("ck_event_availability_visibility", "visibility IN ('members','connections','hidden')");
                    table.ForeignKey(
                        name: "fk_event_availability_event_participants_participant_id",
                        column: x => x.participant_id,
                        principalTable: "event_participants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "event_participant_intentions",
                columns: table => new
                {
                    participant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    intention_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_participant_intentions", x => new { x.participant_id, x.intention_id });
                    table.ForeignKey(
                        name: "fk_event_participant_intentions_event_participants_participant",
                        column: x => x.participant_id,
                        principalTable: "event_participants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_participant_intentions_networking_intentions_intentio",
                        column: x => x.intention_id,
                        principalTable: "networking_intentions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_reports",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    reporter_attendee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reporter_organizer_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reported_attendee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: true),
                    message_id = table.Column<long>(type: "bigint", nullable: true),
                    reason = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    details = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    assigned_admin_id = table.Column<Guid>(type: "uuid", nullable: true),
                    resolution_note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    resolved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_reports", x => x.id);
                    table.CheckConstraint("ck_user_reports_one_reporter", "(reporter_attendee_id IS NOT NULL)::int + (reporter_organizer_user_id IS NOT NULL)::int = 1");
                    table.CheckConstraint("ck_user_reports_reason", "reason IN ('spam','harassment','inappropriate_content','fake_profile','underage','other')");
                    table.CheckConstraint("ck_user_reports_status", "status IN ('open','in_review','actioned','dismissed')");
                    table.ForeignKey(
                        name: "fk_user_reports_attendees_reported_attendee_id",
                        column: x => x.reported_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_user_reports_attendees_reporter_attendee_id",
                        column: x => x.reporter_attendee_id,
                        principalTable: "attendees",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_user_reports_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_user_reports_messages_message_id",
                        column: x => x.message_id,
                        principalTable: "messages",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_user_reports_organizer_users_assigned_admin_id",
                        column: x => x.assigned_admin_id,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_user_reports_organizer_users_reporter_organizer_user_id",
                        column: x => x.reporter_organizer_user_id,
                        principalTable: "organizer_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "moderation_actions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    target_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    target_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    report_id = table.Column<Guid>(type: "uuid", nullable: true),
                    metadata = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_moderation_actions", x => x.id);
                    table.CheckConstraint("ck_moderation_actions_action", "action IN ('suspend','restore','remove_participant','suspend_event','restore_event','approve_tag','reject_tag','merge_tag','delete_message','dismiss_report')");
                    table.CheckConstraint("ck_moderation_actions_actor_type", "actor_type IN ('attendee','organizer','admin','system','gateway')");
                    table.CheckConstraint("ck_moderation_actions_target_type", "target_type IN ('attendee','event','organization','interest','skill','message','participant')");
                    table.ForeignKey(
                        name: "fk_moderation_actions_user_reports_report_id",
                        column: x => x.report_id,
                        principalTable: "user_reports",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_account_deletion_requests_attendee_id",
                table: "account_deletion_requests",
                column: "attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_account_deletion_requests_scheduled_for",
                table: "account_deletion_requests",
                column: "scheduled_for",
                filter: "completed_at IS NULL AND cancelled_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ux_recovery_codes_one_active",
                table: "attendee_recovery_codes",
                column: "attendee_id",
                unique: true,
                filter: "status = 'active'");

            migrationBuilder.CreateIndex(
                name: "ix_attendee_sessions_active",
                table: "attendee_sessions",
                column: "attendee_id",
                filter: "revoked_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_attendee_sessions_previous_token_hash",
                table: "attendee_sessions",
                column: "previous_token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_attendee_sessions_token_hash",
                table: "attendee_sessions",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_audit_logs_organization_id_occurred_at",
                table: "audit_logs",
                columns: new[] { "organization_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "ix_audit_logs_target_type_target_id",
                table: "audit_logs",
                columns: new[] { "target_type", "target_id" });

            migrationBuilder.CreateIndex(
                name: "ix_category_interest_suggestions_interest_id",
                table: "category_interest_suggestions",
                column: "interest_id");

            migrationBuilder.CreateIndex(
                name: "ix_category_skill_suggestions_skill_id",
                table: "category_skill_suggestions",
                column: "skill_id");

            migrationBuilder.CreateIndex(
                name: "ix_connection_history_connection_id",
                table: "connection_history",
                column: "connection_id");

            migrationBuilder.CreateIndex(
                name: "ix_connections_addressee_attendee_id_status",
                table: "connections",
                columns: new[] { "addressee_attendee_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_connections_origin_event_id",
                table: "connections",
                column: "origin_event_id");

            migrationBuilder.CreateIndex(
                name: "ix_connections_requester_attendee_id_status",
                table: "connections",
                columns: new[] { "requester_attendee_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ux_connections_live_pair",
                table: "connections",
                columns: new[] { "attendee_low_id", "attendee_high_id" },
                unique: true,
                filter: "status IN ('pending','accepted')");

            migrationBuilder.CreateIndex(
                name: "ix_conversation_members_attendee_id",
                table: "conversation_members",
                column: "attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_conversations_attendee_low_id_attendee_high_id",
                table: "conversations",
                columns: new[] { "attendee_low_id", "attendee_high_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_conversations_connection_id",
                table: "conversations",
                column: "connection_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_conversations_origin_event_id",
                table: "conversations",
                column: "origin_event_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_availability_status",
                table: "event_availability",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_event_categories_slug",
                table: "event_categories",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_event_intentions_intention_id",
                table: "event_intentions",
                column: "intention_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_participant_intentions_intention_id",
                table: "event_participant_intentions",
                column: "intention_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_participants_attendee_id_status",
                table: "event_participants",
                columns: new[] { "attendee_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_event_participants_discoverable",
                table: "event_participants",
                columns: new[] { "event_id", "status" },
                filter: "discovery_paused = false");

            migrationBuilder.CreateIndex(
                name: "ix_event_participants_event_id_attendee_id",
                table: "event_participants",
                columns: new[] { "event_id", "attendee_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_event_participants_joined_via_qr_code_id",
                table: "event_participants",
                column: "joined_via_qr_code_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_participants_removed_by",
                table: "event_participants",
                column: "removed_by");

            migrationBuilder.CreateIndex(
                name: "ix_event_purchases_organization_id",
                table: "event_purchases",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_purchases_plan_id",
                table: "event_purchases",
                column: "plan_id");

            migrationBuilder.CreateIndex(
                name: "ux_event_purchases_paid",
                table: "event_purchases",
                columns: new[] { "event_id", "plan_id" },
                unique: true,
                filter: "status = 'paid'");

            migrationBuilder.CreateIndex(
                name: "ix_event_qr_codes_created_by",
                table: "event_qr_codes",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_event_qr_codes_public_code",
                table: "event_qr_codes",
                column: "public_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_event_qr_codes_revoked_by",
                table: "event_qr_codes",
                column: "revoked_by");

            migrationBuilder.CreateIndex(
                name: "ux_event_qr_codes_one_active",
                table: "event_qr_codes",
                column: "event_id",
                unique: true,
                filter: "status = 'active'");

            migrationBuilder.CreateIndex(
                name: "ix_event_suggested_interests_interest_id",
                table: "event_suggested_interests",
                column: "interest_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_suggested_skills_skill_id",
                table: "event_suggested_skills",
                column: "skill_id");

            migrationBuilder.CreateIndex(
                name: "ix_events_category_id",
                table: "events",
                column: "category_id");

            migrationBuilder.CreateIndex(
                name: "ix_events_created_by",
                table: "events",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_events_organization_id_status",
                table: "events",
                columns: new[] { "organization_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_events_status_starts_at",
                table: "events",
                columns: new[] { "status", "starts_at" });

            migrationBuilder.CreateIndex(
                name: "ix_idempotency_keys_expires_at",
                table: "idempotency_keys",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_interest_aliases_interest_id",
                table: "interest_aliases",
                column: "interest_id");

            migrationBuilder.CreateIndex(
                name: "ix_interests_created_by_attendee_id",
                table: "interests",
                column: "created_by_attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_interests_merged_into_id",
                table: "interests",
                column: "merged_into_id");

            migrationBuilder.CreateIndex(
                name: "ix_interests_name_trgm",
                table: "interests",
                column: "normalized_name")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_interests_normalized_name",
                table: "interests",
                column: "normalized_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_match_dismissals_dismissed_profile_id",
                table: "match_dismissals",
                column: "dismissed_profile_id");

            migrationBuilder.CreateIndex(
                name: "ix_match_dismissals_event_id",
                table: "match_dismissals",
                column: "event_id");

            migrationBuilder.CreateIndex(
                name: "ix_messages_conversation_id_client_message_id",
                table: "messages",
                columns: new[] { "conversation_id", "client_message_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_messages_conversation_id_id",
                table: "messages",
                columns: new[] { "conversation_id", "id" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_messages_sender_attendee_id",
                table: "messages",
                column: "sender_attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_moderation_actions_report_id",
                table: "moderation_actions",
                column: "report_id");

            migrationBuilder.CreateIndex(
                name: "ix_moderation_actions_target_type_target_id",
                table: "moderation_actions",
                columns: new[] { "target_type", "target_id" });

            migrationBuilder.CreateIndex(
                name: "ix_networking_intentions_category_id_slug",
                table: "networking_intentions",
                columns: new[] { "category_id", "slug" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "ix_notifications_attendee_id_created_at",
                table: "notifications",
                columns: new[] { "attendee_id", "created_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_notifications_event_id",
                table: "notifications",
                column: "event_id");

            migrationBuilder.CreateIndex(
                name: "ix_notifications_unread",
                table: "notifications",
                column: "attendee_id",
                filter: "read_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_organization_members_organizer_user_id",
                table: "organization_members",
                column: "organizer_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organizations_created_by",
                table: "organizations",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_organizations_slug",
                table: "organizations",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_organizer_role_claims_role_id",
                table: "organizer_role_claims",
                column: "role_id");

            migrationBuilder.CreateIndex(
                name: "RoleNameIndex",
                table: "organizer_roles",
                column: "normalized_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_organizer_user_claims_user_id",
                table: "organizer_user_claims",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organizer_user_logins_user_id",
                table: "organizer_user_logins",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organizer_user_roles_role_id",
                table: "organizer_user_roles",
                column: "role_id");

            migrationBuilder.CreateIndex(
                name: "EmailIndex",
                table: "organizer_users",
                column: "normalized_email");

            migrationBuilder.CreateIndex(
                name: "UserNameIndex",
                table: "organizer_users",
                column: "normalized_user_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_outbox_messages_pending",
                table: "outbox_messages",
                column: "id",
                filter: "processed_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_payment_webhooks_gateway_event_id",
                table: "payment_webhooks",
                column: "gateway_event_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_payments_attendee_id",
                table: "payments",
                column: "attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_payments_event_purchase_id",
                table: "payments",
                column: "event_purchase_id");

            migrationBuilder.CreateIndex(
                name: "ix_payments_gateway_order_id",
                table: "payments",
                column: "gateway_order_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_payments_gateway_payment_id",
                table: "payments",
                column: "gateway_payment_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_payments_organization_id",
                table: "payments",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "ix_payments_subscription_id",
                table: "payments",
                column: "subscription_id");

            migrationBuilder.CreateIndex(
                name: "ix_profile_interests_interest_id",
                table: "profile_interests",
                column: "interest_id");

            migrationBuilder.CreateIndex(
                name: "ix_profile_looking_for_skills_skill_id",
                table: "profile_looking_for_skills",
                column: "skill_id");

            migrationBuilder.CreateIndex(
                name: "ix_profile_skills_skill_id",
                table: "profile_skills",
                column: "skill_id");

            migrationBuilder.CreateIndex(
                name: "ix_promotional_access_attendee_id",
                table: "promotional_access",
                column: "attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_promotional_access_granted_by",
                table: "promotional_access",
                column: "granted_by");

            migrationBuilder.CreateIndex(
                name: "ix_promotional_access_organization_id",
                table: "promotional_access",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "ix_promotional_access_plan_id",
                table: "promotional_access",
                column: "plan_id");

            migrationBuilder.CreateIndex(
                name: "ix_saved_profiles_event_id",
                table: "saved_profiles",
                column: "event_id");

            migrationBuilder.CreateIndex(
                name: "ix_saved_profiles_saved_profile_id",
                table: "saved_profiles",
                column: "saved_profile_id");

            migrationBuilder.CreateIndex(
                name: "ix_skill_aliases_skill_id",
                table: "skill_aliases",
                column: "skill_id");

            migrationBuilder.CreateIndex(
                name: "ix_skills_created_by_attendee_id",
                table: "skills",
                column: "created_by_attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_skills_merged_into_id",
                table: "skills",
                column: "merged_into_id");

            migrationBuilder.CreateIndex(
                name: "ix_skills_name_trgm",
                table: "skills",
                column: "normalized_name")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_skills_normalized_name",
                table: "skills",
                column: "normalized_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_social_links_profile_id_url",
                table: "social_links",
                columns: new[] { "profile_id", "url" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_subscription_invoices_gateway_invoice_id",
                table: "subscription_invoices",
                column: "gateway_invoice_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_subscription_invoices_invoice_number",
                table: "subscription_invoices",
                column: "invoice_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_subscription_invoices_payment_id",
                table: "subscription_invoices",
                column: "payment_id");

            migrationBuilder.CreateIndex(
                name: "ix_subscription_invoices_subscription_id",
                table: "subscription_invoices",
                column: "subscription_id");

            migrationBuilder.CreateIndex(
                name: "ix_subscription_plans_code",
                table: "subscription_plans",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_subscriptions_gateway_subscription_id",
                table: "subscriptions",
                column: "gateway_subscription_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_subscriptions_plan_id",
                table: "subscriptions",
                column: "plan_id");

            migrationBuilder.CreateIndex(
                name: "ux_subscriptions_attendee_live",
                table: "subscriptions",
                column: "attendee_id",
                unique: true,
                filter: "attendee_id IS NOT NULL AND status IN ('created','authenticated','active','pending')");

            migrationBuilder.CreateIndex(
                name: "ux_subscriptions_org_live",
                table: "subscriptions",
                column: "organization_id",
                unique: true,
                filter: "organization_id IS NOT NULL AND status IN ('created','authenticated','active','pending')");

            migrationBuilder.CreateIndex(
                name: "ix_user_blocks_blocked_attendee_id",
                table: "user_blocks",
                column: "blocked_attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_profiles_attendee_id",
                table: "user_profiles",
                column: "attendee_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_profiles_display_name_trgm",
                table: "user_profiles",
                column: "display_name")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_user_profiles_profession_normalized",
                table: "user_profiles",
                column: "profession_normalized");

            migrationBuilder.CreateIndex(
                name: "ix_user_profiles_username_normalized",
                table: "user_profiles",
                column: "username_normalized",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_profiles_username_trgm",
                table: "user_profiles",
                column: "username_normalized")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_user_reports_assigned_admin_id",
                table: "user_reports",
                column: "assigned_admin_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_reports_event_id_status",
                table: "user_reports",
                columns: new[] { "event_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_user_reports_message_id",
                table: "user_reports",
                column: "message_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_reports_reported_attendee_id",
                table: "user_reports",
                column: "reported_attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_reports_reporter_attendee_id",
                table: "user_reports",
                column: "reporter_attendee_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_reports_reporter_organizer_user_id",
                table: "user_reports",
                column: "reporter_organizer_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_reports_status_created_at",
                table: "user_reports",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_username_history_profile_id",
                table: "username_history",
                column: "profile_id");

            migrationBuilder.CreateIndex(
                name: "ix_username_history_username_normalized_reserved_until",
                table: "username_history",
                columns: new[] { "username_normalized", "reserved_until" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "account_deletion_requests");

            migrationBuilder.DropTable(
                name: "attendee_recovery_codes");

            migrationBuilder.DropTable(
                name: "attendee_sessions");

            migrationBuilder.DropTable(
                name: "audit_logs");

            migrationBuilder.DropTable(
                name: "category_interest_suggestions");

            migrationBuilder.DropTable(
                name: "category_skill_suggestions");

            migrationBuilder.DropTable(
                name: "connection_history");

            migrationBuilder.DropTable(
                name: "conversation_members");

            migrationBuilder.DropTable(
                name: "event_activity_counters");

            migrationBuilder.DropTable(
                name: "event_availability");

            migrationBuilder.DropTable(
                name: "event_intentions");

            migrationBuilder.DropTable(
                name: "event_networking_settings");

            migrationBuilder.DropTable(
                name: "event_participant_intentions");

            migrationBuilder.DropTable(
                name: "event_suggested_interests");

            migrationBuilder.DropTable(
                name: "event_suggested_skills");

            migrationBuilder.DropTable(
                name: "idempotency_keys");

            migrationBuilder.DropTable(
                name: "interest_aliases");

            migrationBuilder.DropTable(
                name: "match_dismissals");

            migrationBuilder.DropTable(
                name: "moderation_actions");

            migrationBuilder.DropTable(
                name: "notification_preferences");

            migrationBuilder.DropTable(
                name: "notifications");

            migrationBuilder.DropTable(
                name: "organization_entitlements");

            migrationBuilder.DropTable(
                name: "organization_members");

            migrationBuilder.DropTable(
                name: "organizer_role_claims");

            migrationBuilder.DropTable(
                name: "organizer_user_claims");

            migrationBuilder.DropTable(
                name: "organizer_user_logins");

            migrationBuilder.DropTable(
                name: "organizer_user_roles");

            migrationBuilder.DropTable(
                name: "organizer_user_tokens");

            migrationBuilder.DropTable(
                name: "outbox_messages");

            migrationBuilder.DropTable(
                name: "payment_webhooks");

            migrationBuilder.DropTable(
                name: "platform_settings");

            migrationBuilder.DropTable(
                name: "profile_interests");

            migrationBuilder.DropTable(
                name: "profile_looking_for_skills");

            migrationBuilder.DropTable(
                name: "profile_skills");

            migrationBuilder.DropTable(
                name: "promotional_access");

            migrationBuilder.DropTable(
                name: "saved_profiles");

            migrationBuilder.DropTable(
                name: "skill_aliases");

            migrationBuilder.DropTable(
                name: "social_links");

            migrationBuilder.DropTable(
                name: "subscription_features");

            migrationBuilder.DropTable(
                name: "subscription_invoices");

            migrationBuilder.DropTable(
                name: "user_blocks");

            migrationBuilder.DropTable(
                name: "user_entitlements");

            migrationBuilder.DropTable(
                name: "username_history");

            migrationBuilder.DropTable(
                name: "event_participants");

            migrationBuilder.DropTable(
                name: "networking_intentions");

            migrationBuilder.DropTable(
                name: "user_reports");

            migrationBuilder.DropTable(
                name: "organizer_roles");

            migrationBuilder.DropTable(
                name: "interests");

            migrationBuilder.DropTable(
                name: "skills");

            migrationBuilder.DropTable(
                name: "payments");

            migrationBuilder.DropTable(
                name: "user_profiles");

            migrationBuilder.DropTable(
                name: "event_qr_codes");

            migrationBuilder.DropTable(
                name: "messages");

            migrationBuilder.DropTable(
                name: "event_purchases");

            migrationBuilder.DropTable(
                name: "subscriptions");

            migrationBuilder.DropTable(
                name: "conversations");

            migrationBuilder.DropTable(
                name: "subscription_plans");

            migrationBuilder.DropTable(
                name: "connections");

            migrationBuilder.DropTable(
                name: "attendees");

            migrationBuilder.DropTable(
                name: "events");

            migrationBuilder.DropTable(
                name: "event_categories");

            migrationBuilder.DropTable(
                name: "organizations");

            migrationBuilder.DropTable(
                name: "organizer_users");
        }
    }
}
