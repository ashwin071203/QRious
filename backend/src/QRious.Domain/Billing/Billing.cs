namespace QRious.Domain.Billing;

public enum PlanAudience { Attendee, Organization }

public enum BillingPeriod { None, Month, Year, OneTime }

public enum SubscriberType { Attendee, Organization }

public enum SubscriptionStatus { Created, Authenticated, Active, Pending, Halted, Cancelled, Completed, Expired }

public enum PaymentStatus { Created, Authorized, Captured, Failed, Refunded, PartiallyRefunded }

public enum InvoiceStatus { Issued, Paid, Void }

public enum EventPurchaseStatus { Pending, Paid, Refunded }

public enum EntitlementSource { Plan, Subscription, Promo, EventPurchase }

public class SubscriptionPlan
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string Code { get; set; } = "";
    public PlanAudience Audience { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public BillingPeriod BillingPeriod { get; set; }
    public int PriceMinor { get; set; }
    public string Currency { get; set; } = "INR";
    public bool TaxInclusive { get; set; } = true;
    public string? GatewayPlanId { get; set; }
    public bool IsDefault { get; set; }
    public bool IsActive { get; set; } = true;
    public short SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<SubscriptionFeature> Features { get; set; } = [];
}

public class SubscriptionFeature
{
    public Guid PlanId { get; set; }
    public string FeatureKey { get; set; } = "";
    public bool Enabled { get; set; } = true;
    /// <summary>Null = unlimited. Numeric limits stay null until approved (D-20).</summary>
    public int? LimitValue { get; set; }
}

public class Subscription
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PlanId { get; set; }
    public SubscriberType SubscriberType { get; set; }
    public Guid? AttendeeId { get; set; }
    public Guid? OrganizationId { get; set; }
    public SubscriptionStatus Status { get; set; } = SubscriptionStatus.Created;
    public string Gateway { get; set; } = "razorpay";
    public string? GatewaySubscriptionId { get; set; }
    public DateTimeOffset? CurrentPeriodStart { get; set; }
    public DateTimeOffset? CurrentPeriodEnd { get; set; }
    public bool CancelAtPeriodEnd { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class Payment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? SubscriptionId { get; set; }
    public Guid? EventPurchaseId { get; set; }
    public SubscriberType PayerType { get; set; }
    public Guid? AttendeeId { get; set; }
    public Guid? OrganizationId { get; set; }
    public string Gateway { get; set; } = "razorpay";
    public string? GatewayOrderId { get; set; }
    public string? GatewayPaymentId { get; set; }
    public int AmountMinor { get; set; }
    public int TaxMinor { get; set; }
    public int FeeMinor { get; set; }
    public string Currency { get; set; } = "INR";
    public PaymentStatus Status { get; set; } = PaymentStatus.Created;
    public int RefundedMinor { get; set; }
    public string? FailureCode { get; set; }
    public string? FailureReason { get; set; }
    public string? Method { get; set; }
    public DateTimeOffset? CapturedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class PaymentWebhook
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string Gateway { get; set; } = "razorpay";
    public string GatewayEventId { get; set; } = "";
    public string EventType { get; set; } = "";
    public bool SignatureValid { get; set; }
    public string Payload { get; set; } = "{}";
    public DateTimeOffset ReceivedAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
    public int Attempts { get; set; }
    public string? ProcessingError { get; set; }
}

public class SubscriptionInvoice
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string InvoiceNumber { get; set; } = "";
    public Guid? SubscriptionId { get; set; }
    public Guid PaymentId { get; set; }
    public string? GatewayInvoiceId { get; set; }
    public int AmountMinor { get; set; }
    public int TaxMinor { get; set; }
    public DateTimeOffset? PeriodStart { get; set; }
    public DateTimeOffset? PeriodEnd { get; set; }
    public DateTimeOffset IssuedAt { get; set; }
    public InvoiceStatus Status { get; set; } = InvoiceStatus.Issued;
    public string? BillingName { get; set; }
    public string? BillingGstin { get; set; }
}

public class EventPurchase
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid OrganizationId { get; set; }
    public Guid EventId { get; set; }
    public Guid PlanId { get; set; }
    public EventPurchaseStatus Status { get; set; } = EventPurchaseStatus.Pending;
    public DateTimeOffset CreatedAt { get; set; }
}

public class UserEntitlement
{
    public Guid AttendeeId { get; set; }
    public string FeatureKey { get; set; } = "";
    public EntitlementSource SourceType { get; set; }
    public Guid SourceId { get; set; }
    public bool Enabled { get; set; } = true;
    public int? LimitValue { get; set; }
    public DateTimeOffset ValidFrom { get; set; }
    public DateTimeOffset? ValidUntil { get; set; }
}

public class OrganizationEntitlement
{
    public Guid OrganizationId { get; set; }
    public string FeatureKey { get; set; } = "";
    public EntitlementSource SourceType { get; set; }
    public Guid SourceId { get; set; }
    public bool Enabled { get; set; } = true;
    public int? LimitValue { get; set; }
    public DateTimeOffset ValidFrom { get; set; }
    public DateTimeOffset? ValidUntil { get; set; }
}

public class PromotionalAccess
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public SubscriberType SubscriberType { get; set; }
    public Guid? AttendeeId { get; set; }
    public Guid? OrganizationId { get; set; }
    public Guid PlanId { get; set; }
    public Guid GrantedBy { get; set; }
    public string? Reason { get; set; }
    public DateTimeOffset StartsAt { get; set; }
    public DateTimeOffset EndsAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public Guid? RevokedBy { get; set; }
}

/// <summary>Feature keys for premium/organizer entitlements. Essential networking is never gated (D-20).</summary>
public static class FeatureKeys
{
    public const string SavedProfilesLimit = "attendee.saved_profiles.limit";
    public const string AdvancedFilters = "attendee.discover.advanced_filters";
    public const string DetailedMatching = "attendee.matching.detailed";
    public const string ProfileBadge = "attendee.profile.badge";
    public const string PremiumCustomization = "attendee.profile.customization";
    public const string SavedByVisibility = "attendee.saved_by.visibility";
    public const string NetworkingAnalytics = "attendee.analytics";
    public const string OrgActiveEventsLimit = "org.events.active.limit";
    public const string OrgParticipantsLimit = "org.participants.limit";
    public const string OrgAdvancedPulse = "org.pulse.advanced";
    public const string OrgReportsExport = "org.reports.export";
    public const string OrgBranding = "org.branding";
    public const string OrgMembers = "org.members";
    public const string OrgCrossEventAnalytics = "org.analytics.cross_event";
}
